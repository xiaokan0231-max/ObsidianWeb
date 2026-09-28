/**
 * TODO ノートの状態契約。lib/memory-atlas-data.ts と scripts/vault-check.mjs が
 * 各自の配列を持っていたので、job-status.mjs と同じく素の ESM に一本化する。
 */
export const TODO_STATUSES = ["未着手", "進行中", "保留", "完了"];
/** まだ動かせる TODO。首页の重点行動・行動清单の既定表示はこれだけ。 */
export const OPEN_TODO_STATUSES = ["未着手", "進行中"];
export const TODO_PRIORITIES = ["high", "medium", "low"];
export const TODO_PRIORITY_META = {
  high: { label: "高", rank: 0 },
  medium: { label: "中", rank: 1 },
  low: { label: "低", rank: 2 },
};
