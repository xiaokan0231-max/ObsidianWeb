/**
 * 「现在焦点在输入场景里」的唯一判定。
 *
 * 全局与各页的单键快捷键（R 重读、/ 聚焦搜索、1–9 切筛选、方向键翻页）都要先问这一句，
 * 否则在输入框、下拉框或 contentEditable 里打字就会误触。原来 app 里有 5 份各自的写法，
 * 有的漏了 select、有的漏了 contentEditable——同一个键在不同页面表现不一样。
 * 这里不引用 DOM 类型（只看 tagName / isContentEditable），node:test 也能直接 import。
 */
export function isTypingTarget(target: EventTarget | null | undefined): boolean {
  if (!target || typeof target !== "object") return false;
  const element = target as { tagName?: unknown; isContentEditable?: unknown };
  if (element.isContentEditable === true) return true;
  return typeof element.tagName === "string" && /^(INPUT|TEXTAREA|SELECT)$/i.test(element.tagName);
}
