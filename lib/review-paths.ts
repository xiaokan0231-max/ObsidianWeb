// 面接一回分のノートは「同じディレクトリ・同じ `<日付>_<回>` 前綴・接尾辞だけ違う」という
// vault 側の命名規約でつながっている。その規約の持ち主をこのファイル一つに限る。
// 各 route に replace と startsWith を裸で置くと、接尾辞や許可ルートを直したときに
// 一箇所だけ古いまま残っても誰も気づかない——生成先が静かにずれ、検査が静かに緩む。
//
// 純粋な文字列関数だけを置くこと。app/interview-review.tsx（"use client"）からも読むので、
// node: も lib/server/* もここに入れてはいけない。

/** 種別 → 実ファイルの接尾辞。値は vault の実名そのもの。 */
export const REVIEW_NOTE_SUFFIX = {
  seirikou: "_整理稿.md",
  annotation: "_批注.md",
  review: "_復盤.md",
  answerFeedback: "_回答品質批注.md",
  answerReview: "_回答品質復盤.md",
  practice: "_回答練習.md",
} as const;

export type ReviewNoteKind = keyof typeof REVIEW_NOTE_SUFFIX;

/**
 * 整理稿から派生できる種別。`review`（面接結果の復盤・type: review）と
 * `answerReview`（回答品質復盤・type: interview-answer-review）は別のノート。
 * route 側では両方 reviewPath という変数名だったので、キー名で取り違えないこと。
 */
export type ReviewDerivedKind = Exclude<ReviewNoteKind, "seirikou">;

const SEIRIKOU_SUFFIX = /_整理稿\.md$/;

/** 整理稿のパスから同じ回の派生ノートのパスを作る。末尾が整理稿でなければそのまま返る。 */
export function reviewSiblingPath(seirikouPath: string, kind: ReviewDerivedKind): string {
  return seirikouPath.replace(SEIRIKOU_SUFFIX, REVIEW_NOTE_SUFFIX[kind]);
}

/**
 * 受け取った notePath が「書き込んでよいノート」かの検査。ブラウザから来た文字列が
 * そのまま Obsidian REST API の URL に載るので、3条件はどれ一つ欠けても穴になる：
 * 20_求職/ 配下に限る・種別を接尾辞で限る・`..` で vault 外へ抜ける経路を塞ぐ。**緩めないこと**。
 *
 * kind を引数に取るのは、批注への追記 route だけ入口が `_批注.md` だから。
 * 「整理稿に揃える」と、その route が自分の書き込み先を弾いて機能ごと死ぬ。
 */
export function isReviewNotePath(notePath: string, kind: ReviewNoteKind): boolean {
  return (
    notePath.startsWith("20_求職/") &&
    notePath.endsWith(REVIEW_NOTE_SUFFIX[kind]) &&
    !notePath.includes("..")
  );
}
