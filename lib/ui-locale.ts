/** 界面语言只影响产品菜单；vault 的标题、正文与枚举值继续保留原文。 */
export type UiLocale = "zh-CN" | "ja";

export const UI_LOCALE_COOKIE = "career-room-locale";

export function resolveUiLocale(value: unknown): UiLocale {
  return value === "ja" ? "ja" : "zh-CN";
}

export const APP_BRANDING: Record<UiLocale, { name: string; description: string }> = {
  "zh-CN": {
    name: "求职作战室",
    description: "以 Obsidian 为唯一数据源的求职作战室：岗位、选考进度、面试准备与训练。",
  },
  ja: {
    name: "転職作戦室",
    description: "Obsidian を唯一のデータソースにする転職作戦室。求人、選考状況、面接準備とトレーニングを一か所で。",
  },
};
