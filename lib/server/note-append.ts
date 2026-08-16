import type { ObsidianNote } from "./obsidian.ts";
import { primeNote, readNoteOrNull, writeNote } from "./obsidian.ts";

/**
 * 追記型ノート（批注・フィードバック・重練キュー・専項進度）の共通骨格。
 * 4 ルートが各自で「読む→無ければ骨組み→去重→追記」を書いていて、既に漂流が起きた——
 * feedback には「存在判定と本文読みは同じ1往復で足りる」と注記があるのに、
 * topics/progress のコピーは noteExists + readNote + appendNote 内の再判定で
 * 同じノートに 3 回 GET を打っていた。骨格をここに固めて、コピーごと消す。
 *
 * 書き込みは「全文を組み立てて PUT 1回」。appendNote は内部でもう一度存在判定を
 * 打つ上に最終内容が手元に残らない——残しておけば、更新後のノートを応答に載せて
 * クライアントが notes 配列の1件を差し替えられる（書くたびの全庫再取得を消す前提）。
 */
export type AppendPlan<T> =
  | { duplicate: T }
  | {
      nextContent: string;
      value: T;
      /** ノート新規作成時にクライアントへ返す frontmatter。既存ノートでは使わない。 */
      frontmatterForNew?: Record<string, unknown>;
    };

export type AppendOutcome<T> = {
  value: T;
  deduplicated: boolean;
  /** 更新後のノート。重複（何も書かなかった）時は既存ノート、それも無ければ null。 */
  note: ObsidianNote | null;
};

export async function upsertAppendNote<T>(options: {
  path: string;
  /** 既存ノート（無ければ null）から、重複か「書くべき全文」を決める。 */
  plan: (existing: ObsidianNote | null) => AppendPlan<T>;
}): Promise<AppendOutcome<T>> {
  const existing = await readNoteOrNull(options.path);
  const planned = options.plan(existing);
  if ("duplicate" in planned) {
    return { value: planned.duplicate, deduplicated: true, note: existing };
  }
  await writeNote(options.path, planned.nextContent);
  // stat/frontmatter は手元の知識から組み立てる。書いた直後の readNote は
  // Obsidian の metadata cache が追いつく前の frontmatter を返し得るので、往復を増やさない。
  const now = Date.now();
  const note: ObsidianNote = {
    path: options.path,
    stat: {
      ctime: existing?.stat.ctime ?? now,
      mtime: now,
      size: planned.nextContent.length,
    },
    tags: existing?.tags ?? [],
    frontmatter: existing?.frontmatter ?? planned.frontmatterForNew ?? {},
    content: planned.nextContent,
  };
  // 組み立てた権威データをキャッシュへも置く。新規作成の場合はこれが無いと、
  // 作成がスキャンより後だったラウンドで「まだ存在しないノート」として扱われる。
  primeNote(note);
  return { value: planned.value, deduplicated: false, note };
}
