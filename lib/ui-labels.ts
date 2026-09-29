/**
 * 画面の中文層で繰り返し出る文言の正本。
 *
 * 同じ操作（原笔记を開く・面试一覧へ戻る…）が画面ごとに「打开 Obsidian 原笔记」「在记忆库中打开」
 * 「查看完整案件笔记」と別名で書かれていた。名前が違うと、利用者は「違う操作なのか」を毎回確かめることになる。
 * 日本語が残るのはデータの枚举値（応募状態・面接区分など）と日本語で書かれた文だけ。中文の地の文は「面试」で統一する。
 */

/** 原笔记（Obsidian のノートそのもの）を右側の drawer で開くボタン。 */
export const OPEN_NOTE_LABEL = "打开原笔记";

/** 面试复盘の詳細から一覧へ戻るボタン。 */
export const INTERVIEW_LIST_BACK_LABEL = "← 面试一览";

/** 復盤カードの批注件数。未解決が残っていれば件数で、無ければ総数だけ出す。 */
export function annotationCountLabel(open: number, total: number) {
  return open > 0 ? `${open} 条未结` : String(total);
}

/** 書込み成功の直後に出す手応え。撤销ボタンと並べる。 */
export function changedToLabel(value: string) {
  return `已改为「${value}」`;
}

export const UNDO_LABEL = "撤销";

/**
 * 回答重练的状态。数据里是英文枚举（skill 写入的机器值），列表上直接露出 "queued" 读不懂。
 * 键与 lib/review-practice.ts 的 InterviewPracticeStatus 一致；认不出的值原样显示，不吞掉。
 */
export const PRACTICE_STATUS_LABEL: Record<string, string> = {
  queued: "待练",
  active: "练习中",
  snoozed: "已延后",
  completed: "已完成",
};

export function practiceStatusLabel(status: string) {
  return PRACTICE_STATUS_LABEL[status] ?? status;
}
