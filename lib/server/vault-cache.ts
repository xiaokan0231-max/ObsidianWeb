import type { ObsidianNote } from "./obsidian.ts";

/**
 * vault 的服务端进程内缓存。
 *
 * 为什么需要：readAllNotes 一次是「递归列目录 + 300 个逐文件 GET」（实测约 0.4s），
 * 而它被踩得极密——/api/vault 每次挂载/写后重拉都全量爬，语言类路由一次请求爬两遍，
 * 单击一次「标记为练过」上下游合计 600+ 个 GET。慢的不是网络（都在本机），
 * 是「每次都当第一次」。
 *
 * 为什么不用 fs 的 mtime：服务端跑在 workerd（nodejs_compat 是虚拟文件系统），
 * 碰不到宿主机磁盘。变更信号只能来自 Local REST API 自己——
 * POST /search/ 用 JsonLogic {"var":"stat.mtime"} 一次拿到全库 mtime（实测 12ms），
 * 于是每次读 = 1 次扫描 + 只重取 mtime 变过的文件。
 *
 * 一致性边界（有意为之，不追求更强）：
 * - 写入方全部经过本进程（writeNote/appendNote/patchHeading 会调 invalidate），
 *   Obsidian 里手改的笔记由 mtime 扫描兜住——下一次 readAll 就能看到。
 * - 扫描失败（旧插件没有 /search/、瞬断）不报错，退回全量爬取＝改动前的行为。
 * - 写后紧接着的并发读可能把旧内容塞回缓存，但存的是「扫描时刻的 mtime」，
 *   下一次扫描必然 mtime 不合而重取——脏数据活不过一轮，不需要世代计数。
 */
export type VaultCacheIO = {
  /** 一次往返拿全库 { path → mtime }。环境不支持时返回 null（不要抛错）。 */
  statAllNotes(): Promise<Map<string, number> | null>;
  readNote(path: string): Promise<ObsidianNote>;
  /** 兜底的全量爬取，等价于没有缓存层时的 readAllNotes。 */
  crawlAllNotes(): Promise<ObsidianNote[]>;
  /** 重取变更文件时的并发度，与 crawlAllNotes 的口径保持一致。 */
  concurrency?: number;
  /** 时钟。测试用；业务侧不传就是 Date.now。 */
  now?: () => number;
};

/**
 * 「次回スキャンで必ず取り直す」印。実在の mtime（正の epoch ミリ秒）と衝突しない値。
 * 条目を消すのではなく印を付けるのは、消すと在途の増分リフレッシュに穴が空くため（下記）。
 */
const STALE_MTIME = -1;

/**
 * prime した権威データを磁盘側が追いつくまで守る時間。
 * Obsidian の metadataCache は非同期に再解析されるので、書いた直後の GET は
 * 「新しい mtime ＋ 古い frontmatter」を返し得る。それを鵜呑みにすると mtime が
 * 一致してしまい、古い frontmatter が永久に居座る（看板の status が巻き戻る）。
 */
const PRIME_GUARD_MS = 5_000;

/** frontmatter が同値か。キー順に依存しない（Obsidian のパーサと自前の組み立てで順序が違い得る）。 */
function sameFrontmatter(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
) {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    (key, index) =>
      rightKeys[index] === key &&
      JSON.stringify(left[key]) === JSON.stringify(right[key]),
  );
}

async function mapConcurrent<T, R>(
  values: T[],
  limit: number,
  mapper: (value: T) => Promise<R>,
) {
  const results = new Array<R>(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(values[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, () => worker()),
  );
  return results;
}

export function createVaultCache(io: VaultCacheIO) {
  const limit = io.concurrency ?? 8;
  const now = io.now ?? Date.now;
  // value.mtime 存扫描返回的值而不是 note.stat.mtime：两者在「扫描和 GET 之间文件又变了」
  // 时会不同，存扫描值可保证下一轮扫描必然发现差异并重取（宁可多取一次，不可漏取）。
  // primedAt が在るのは「書いた側が権威データを置いた」条目（下の prime を参照）。
  const entries = new Map<
    string,
    { mtime: number; note: ObsidianNote; primedAt?: number }
  >();
  /**
   * 直近に書いたパス → 書いた時刻。
   *
   * prime できるのは「更新後の note を組み立てられる書き手」だけで、実際には
   * writeNote の呼び出し 15 箇所のうち 2 箇所しかない。残りは invalidate だけなので、
   * 印を付けて取り直させても、その取り直しが metadataCache の再解析より早ければ
   * 「新しい mtime ＋ 古い frontmatter」をそのまま mtime 一致で固定してしまう
   * ——prime 経路で塞いだのと同じ穴が、prime していない経路には残っていた。
   * 特に generated-artifact の supersede は既存ノートの frontmatter だけを書き換えるので、
   * Obsidian は旧 metadataCache を即座に返す（新規ファイルの時だけ待つ）＝必ず踏む。
   *
   * 権威データが無くても「書いた直後は固定しない」ことはできる。守り時間の間は
   * 取り直した内容を配りつつ印は残し、時間が過ぎてから初めて mtime で固定する。
   */
  const writtenAt = new Map<string, number>();

  // 并发的 readAll 共享同一趟在途请求；写入 invalidate 时置空，让下一个调用者重新扫描。
  let inflight: Promise<ObsidianNote[]> | null = null;

  function withinGuard(at: number | undefined) {
    return at !== undefined && now() - at < PRIME_GUARD_MS;
  }

  /** prime 直後か（＝metadataCache がまだ追いついていない可能性がある間か）。 */
  function withinPrimeGuard(entry: { primedAt?: number } | undefined) {
    return withinGuard(entry?.primedAt);
  }

  /** 書いた直後で、まだ mtime で固定してはいけないパスか。 */
  function recentlyWritten(path: string) {
    return withinGuard(writtenAt.get(path));
  }

  /**
   * 取り直した note をキャッシュへ収める。**固定してよい時だけ mtime を入れる**。
   * 書いた直後（＝metadataCache が追いついている保証が無い）は印を残したまま
   * 内容だけ更新する——次のラウンドでもう一度突き合わせるため。
   */
  function store(
    path: string,
    note: ObsidianNote,
    scanMtime: number | undefined,
    /** 権威データと frontmatter が一致した＝metadataCache が追いついた確証がある。 */
    provenSettled = false,
  ) {
    const primedAt = entries.get(path)?.primedAt;
    if (!provenSettled && recentlyWritten(path)) {
      entries.set(path, { mtime: STALE_MTIME, note, ...(primedAt ? { primedAt } : {}) });
      return;
    }
    writtenAt.delete(path);
    entries.set(path, { mtime: scanMtime ?? note.stat.mtime, note });
  }

  /**
   * 取り直した note が prime した権威データを上書きしてよいか。
   *
   * 🔴 判定は **frontmatter** で行う。content で見てはいけない——
   * Local REST API の content は磁盘（PUT 完了後なので必ず新しい）、frontmatter は
   * 非同期に再解析される metadataCache から来る。つまり滞留中は
   * 「新しい mtime ＋ 新しい content ＋ 古い frontmatter」であって、
   * content は必ず一致してしまう＝判定にならない。この守りの最初の版が
   * content を見ていて、防ぎたかった当の場面（看板の status 巻き戻り）で空振りした。
   */
  function shouldKeepPrimed(
    current: { note: ObsidianNote; primedAt?: number } | undefined,
    fetched: ObsidianNote,
  ) {
    return withinPrimeGuard(current) &&
      !sameFrontmatter(current!.note.frontmatter, fetched.frontmatter);
  }

  function sorted(notes: ObsidianNote[]) {
    return notes.sort((left, right) => right.stat.mtime - left.stat.mtime);
  }

  async function refresh(force: boolean): Promise<ObsidianNote[]> {
    const stats = force ? null : await io.statAllNotes();
    if (!stats || stats.size === 0) {
      // 拿不到变更信号就退回全量爬取＝旧行为；顺手重建缓存，让下一轮能走増分。
      const notes = await io.crawlAllNotes();
      // ただし prime した権威データは守り時間内なら残す。crawl は「全部読み直す」であって
      // 「metadataCache の再解析を待つ」ではないので、無条件に採用すると増分側と同じ
      // 「新しい content ＋ 古い frontmatter」を、今度は取り直しの機会も無いまま固定する
      // （書いた直後に R キーを押す＝カードが変わらないので押したくなる、が実際の踏み方）。
      const primed = new Map([...entries].filter(([, entry]) => withinPrimeGuard(entry)));
      entries.clear();
      for (const path of [...writtenAt.keys()]) {
        if (!recentlyWritten(path)) writtenAt.delete(path);
      }
      for (const note of notes) {
        const kept = primed.get(note.path);
        // 印は STALE_MTIME のままなので、次のスキャンで必ずもう一度突き合わせる。
        if (kept && shouldKeepPrimed(kept, note)) entries.set(note.path, kept);
        else store(note.path, note, undefined, Boolean(kept));
      }
      // 列挙より後に作られたノートも落とさない（作りたての批注ノートなど）。
      for (const [path, entry] of primed) {
        if (!entries.has(path)) entries.set(path, entry);
      }
      return sorted([...entries.values()].map((entry) => entry.note));
    }

    const stale: string[] = [];
    for (const [path, mtime] of stats) {
      if (entries.get(path)?.mtime !== mtime) stale.push(path);
    }
    const fetched = await mapConcurrent(stale, limit, io.readNote);
    fetched.forEach((note, index) => {
      const path = stale[index];
      const current = entries.get(path);
      // 権威データを守る。ここで入れると「新しい mtime ＋ 古い frontmatter」が固定される。
      // 印（STALE_MTIME）を残したまま見送れば、次のスキャンでもう一度取り直す。
      if (shouldKeepPrimed(current, note)) return;
      // ここへ来た時 current が守り時間内の prime なら、frontmatter が権威と一致した＝
      // metadataCache が追いついた確証。無駄に取り直し続けず固定してよい。
      store(path, note, stats.get(path), withinPrimeGuard(current));
    });
    // 已删除的文件不会出现在扫描里，从缓存中清掉，否则删除的笔记会永远留在页面上。
    for (const [path, entry] of entries) {
      if (stats.has(path)) continue;
      // 作りたてのノートは、作成がこのラウンドのスキャンより後なら まだ現れない。
      // 守り時間内は消さない——消すと「今書いたノートが無い」画面になる。
      if (withinPrimeGuard(entry) || recentlyWritten(path)) continue;
      entries.delete(path);
      writtenAt.delete(path);
    }
    return sorted([...entries.values()].map((entry) => entry.note));
  }

  async function readAll(options?: { force?: boolean }): Promise<ObsidianNote[]> {
    const force = options?.force ?? false;
    if (!force && inflight) return inflight;
    const run = refresh(force).finally(() => {
      if (inflight === run) inflight = null;
    });
    if (!force) inflight = run;
    return run;
  }

  /**
   * 写入后调用。**消さずに印だけ付ける**のが要点。
   * 消すと、在途の増分リフレッシュ（スキャン済み・再取得待ち）が「そのパスは stale ではない」と
   * 判断した後に穴が空き、そのラウンドの結果からノートが丸ごと落ちる——クライアントは
   * それを全量スナップショットとして setNotes するので、画面から消えたまま手動再読込まで戻らない。
   * 印なら、内容は1ラウンド古いことがあっても存在は消えず、次のスキャンで必ず取り直す。
   */
  function invalidate(path: string) {
    const current = entries.get(path);
    if (current) entries.set(path, { ...current, mtime: STALE_MTIME });
    // 権威データが無くても、守り時間の間は mtime で固定しない（上の writtenAt を参照）。
    writtenAt.set(path, now());
    inflight = null;
  }

  /**
   * 書いた側が権威データをそのまま置く（write-through）。invalidate だけだと、
   * 次の再取得が Obsidian の metadataCache 再解析に先んじて「新しい mtime ＋ 古い frontmatter」を
   * 掴み、mtime 一致でそれが固定される。書き手は全文も frontmatter も手元に持っているので、
   * 推測させずに渡す。印は STALE_MTIME のままなので、磁盘の値とは次のラウンドで必ず突き合わせる。
   */
  function prime(note: ObsidianNote) {
    entries.set(note.path, { mtime: STALE_MTIME, note, primedAt: now() });
    writtenAt.set(note.path, now());
    inflight = null;
  }

  return {
    readAll,
    invalidate,
    prime,
    /** 仅测试用：观察缓存规模，不要在业务代码里读。 */
    size: () => entries.size,
  };
}
