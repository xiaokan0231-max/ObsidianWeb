/** 界面主题：暗色是「墨夜作战室」，浅色是原来的纸墨版。只换外观，不影响任何数据。 */
export type UiTheme = "dark" | "light";

export const UI_THEME_COOKIE = "career-room-theme";

/**
 * 没选过主题时的默认值：墨夜作战室（暗色）。全站样式都已改成语义 token，
 * 本人在顶栏或 ⌘K 里切回浅色后，cookie 会记住选择。
 */
export const DEFAULT_UI_THEME: UiTheme = "dark";

export function resolveUiTheme(value: unknown): UiTheme {
  return value === "dark" || value === "light" ? value : DEFAULT_UI_THEME;
}

/** 切换时派发在 window 上，给自己取色的 canvas 之类重绘用。 */
export const UI_THEME_EVENT = "echo:themechange";
