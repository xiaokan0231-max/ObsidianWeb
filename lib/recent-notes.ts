/**
 * ⌘K 空着时列「最近打开」。只存在本机（localStorage），不写 vault：
 * 这是浏览习惯，不是事实。私密窗口或存储被禁用时静默退化成「最近更新」。
 */
export const RECENT_NOTES_KEY = "echo:recent-notes";
export const RECENT_NOTES_LIMIT = 8;

/** 把刚打开的笔记放到最前，去重并截断。纯函数，方便测试。 */
export function pushRecentPath(list: readonly string[], path: string, limit = RECENT_NOTES_LIMIT): string[] {
  return [path, ...list.filter((item) => item !== path)].slice(0, limit);
}

export function readRecentPaths(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): string[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(RECENT_NOTES_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string").slice(0, RECENT_NOTES_LIMIT) : [];
  } catch {
    return [];
  }
}

export function rememberRecentPath(path: string, storage: Pick<Storage, "getItem" | "setItem"> | undefined = globalThis.localStorage) {
  try {
    storage?.setItem(RECENT_NOTES_KEY, JSON.stringify(pushRecentPath(readRecentPaths(storage), path)));
  } catch {
    // 写不进去只影响下次的空态列表。
  }
}
