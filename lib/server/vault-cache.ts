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
 * - 写后紧接着的并发读可能把旧内容塞回缓存，但写后的短时间内不用 mtime 固定
 *   （下面 WRITE_SETTLE_MS），所以脏数据活不过那个窗口，不需要世代计数。
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
 * 書いた直後、mtime で固定するまでの猶予。
 *
 * 背景：Local REST API の content/stat は磁盘由来だが frontmatter は
 * 非同期に再解析される metadataCache 由来——という插件ソース上の構造から、
 * 「新しい mtime ＋ 古い frontmatter」を掴んで固定してしまう窓が理屈上ある。
 *
 * ただし**実測ではこの窓を再現できなかった**（本機・Obsidian 1.13.7、
 * 小ファイル 8 回 + 400KB ファイル 12 回、いずれも PUT 直後の初回 GET で
 * frontmatter は既に新しく、滞留は 0ms）。write が reconcile を待ってから
 * resolve するので、次の HTTP 要求が処理される頃には窓が閉じているらしい。
 *
 * なので**正しい値を知る必要のある守り方（権威データとの frontmatter 比較）は持たない**。
 * 代わりに「書いた直後は固定しない」だけにしてある：真値を知らなくてよく、
 * 滞留がどの量級でもこの時間までは覆う。代償は書込後この時間内に限り
 * そのファイルを毎回取り直すこと（書込は稀なので実質ゼロ）。
 */
const WRITE_SETTLE_MS = 5_000;

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
  const entries = new Map<string, { mtime: number; note: ObsidianNote }>();
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

  /** 書いた直後で、まだ mtime で固定してはいけないパスか。 */
  function recentlyWritten(path: string) {
    const at = writtenAt.get(path);
    return at !== undefined && now() - at < WRITE_SETTLE_MS;
  }

  /**
   * 取り直した note をキャッシュへ収める。**固定してよい時だけ mtime を入れる**。
   * 書いた直後は印（STALE_MTIME）を残したまま内容だけ更新する——次のラウンドで
   * もう一度取り直すので、仮に取り直しが古い値を掴んでいても固定されない。
   */
  function store(path: string, note: ObsidianNote, scanMtime: number | undefined) {
    if (recentlyWritten(path)) {
      entries.set(path, { mtime: STALE_MTIME, note });
      return;
    }
    writtenAt.delete(path);
    entries.set(path, { mtime: scanMtime ?? note.stat.mtime, note });
  }

  function sorted(notes: ObsidianNote[]) {
    return notes.sort((left, right) => right.stat.mtime - left.stat.mtime);
  }

  async function refresh(force: boolean): Promise<ObsidianNote[]> {
    const stats = force ? null : await io.statAllNotes();
    if (!stats || stats.size === 0) {
      // 拿不到变更信号就退回全量爬取＝旧行为；顺手重建缓存，让下一轮能走増分。
      const notes = await io.crawlAllNotes();
      // 直近に書いたノートは、列挙がその作成より前なら まだ現れない。落とさず残す。
      const pendingWrites = new Map(
        [...entries].filter(([path]) => recentlyWritten(path)),
      );
      entries.clear();
      for (const path of [...writtenAt.keys()]) {
        if (!recentlyWritten(path)) writtenAt.delete(path);
      }
      // crawl も「全部読み直す」だけで metadataCache の再解析を待つわけではないので、
      // 書いた直後のパスは store() 経由で固定を見送る（R キーを押した時に効く）。
      for (const note of notes) store(note.path, note, undefined);
      for (const [path, entry] of pendingWrites) {
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
      store(path, note, stats.get(path));
    });
    // 已删除的文件不会出现在扫描里，从缓存中清掉，否则删除的笔记会永远留在页面上。
    for (const path of [...entries.keys()]) {
      if (stats.has(path)) continue;
      // 作りたてのノートは、作成がこのラウンドのスキャンより後なら まだ現れない。
      // 守り時間内は消さない——消すと「今書いたノートが無い」画面になる。
      if (recentlyWritten(path)) continue;
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

  return {
    readAll,
    invalidate,
    /** 仅测试用：观察缓存规模，不要在业务代码里读。 */
    size: () => entries.size,
  };
}
