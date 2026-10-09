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

/** 明暗或皮肤切换时派发在 window 上，给自己取色的 canvas 之类重绘用。 */
export const UI_THEME_EVENT = "echo:themechange";

/**
 * 皮肤：和明暗（data-theme）正交的一维，写在 <html data-skin>。每套皮肤都有浅色、暗色两版，
 * 所以顶栏的明暗开关在任何皮肤下都照常有效。默认皮肤不写 data-skin，画面与引入皮肤前完全一致。
 * 不塞进 data-theme 的取值：resolveUiTheme 只认 dark/light 是被测试钉住的契约。
 */
export type UiSkin = "default" | "sumi" | "kaiyo" | "sakura" | "matcha" | "kosho";

export const UI_SKIN_COOKIE = "career-room-skin";
export const DEFAULT_UI_SKIN: UiSkin = "default";

/** 设置中心里的皮肤卡：名称与说明中日成对；色块依次是 纸面、表面、主色、链接色、正文色。 */
export type UiSkinMeta = {
  id: UiSkin;
  name: readonly [string, string];
  description: readonly [string, string];
  swatches: { light: readonly string[]; dark: readonly string[] };
};

export const UI_SKINS: readonly UiSkinMeta[] = [
  {
    id: "default",
    name: ["默认", "墨夜"],
    description: ["墨夜作战室与纸墨版：墨绿底色配橙色强调，现在的样子。", "墨夜の作戦室と紙と墨の版：深緑の地に橙のアクセント。現在の見た目。"],
    swatches: { light: ["#f3f0e8", "#fbfaf6", "#e66d45", "#a84325", "#18231e"], dark: ["#0d1612", "#131f19", "#e66d45", "#f29a76", "#ebe6d9"] },
  },
  {
    id: "sumi",
    name: ["墨", "墨（すみ）"],
    description: ["宣纸白与松烟墨的无彩灰阶，只在按钮和高亮处落一点朱印。去掉了默认主题里的绿调，最安静。", "和紙の白と松煙墨のグレーに、ボタンと強調だけ朱を一点。いちばん静か。"],
    swatches: { light: ["#eef0f2", "#f9fafb", "#d8482c", "#aa4013", "#1f2125"], dark: ["#131416", "#1b1c1e", "#ea6347", "#f99360", "#eae6df"] },
  },
  {
    id: "kaiyo",
    name: ["海", "縹（はなだ）"],
    description: ["雾蓝纸面配深海藏青文字，浅葱色做按钮和强调；暗色是夜里的深海。冷静、适合看数据。", "霧がかった青い紙面に紺の文字、浅葱色のボタン。暗色は夜の深海。落ち着いてデータが見やすい。"],
    swatches: { light: ["#e6f2fa", "#f5fbff", "#1988aa", "#006a8e", "#17222f"], dark: ["#061424", "#0c1d2f", "#3eb5d0", "#5cb9d2", "#dee8ec"] },
  },
  {
    id: "sakura",
    name: ["樱", "桜（さくら）"],
    description: ["极淡的樱色纸面、梅紫墨色字，樱粉做主色；进行中状态用叶樱的嫩绿。柔和不甜腻。", "ごく淡い桜色の紙面に梅紫の文字、桜色が主色。やわらかく甘すぎない。"],
    swatches: { light: ["#f9ecf0", "#fff8fa", "#cc6783", "#9f3e72", "#291c22"], dark: ["#1d0f15", "#26161e", "#db7fac", "#e194c2", "#ede3e2"] },
  },
  {
    id: "matcha",
    name: ["抹茶", "抹茶（まっちゃ）"],
    description: ["抹茶奶霜色纸面，抹茶黄绿做主色，深千岁绿做进行中；暗色是浓茶。整体暖绿、护眼。", "抹茶クリーム色の紙面に抹茶の黄緑。暗色は濃茶。暖かい緑で目にやさしい。"],
    swatches: { light: ["#f0f2dd", "#fafbf1", "#708d28", "#486d15", "#242119"], dark: ["#111609", "#191e0f", "#93b24c", "#98b962", "#e9e8dd"] },
  },
  {
    id: "kosho",
    name: ["古书", "古書（こしょ）"],
    description: ["旧书页的生成色纸面、焦茶墨色字，琥珀色做图表；暗色像台灯下读书。低刺激，适合长时间精读。", "古書の生成り色の紙面に焦茶の文字、琥珀色のグラフ。暗色は灯りの下の読書。長時間の精読向き。"],
    swatches: { light: ["#f5ebd7", "#faf5eb", "#69472f", "#853922", "#261a11"], dark: ["#1c1108", "#25190f", "#c4804a", "#cfa38f", "#eee5d6"] },
  },
];

export function resolveUiSkin(value: unknown): UiSkin {
  return UI_SKINS.some((skin) => skin.id === value) ? value as UiSkin : DEFAULT_UI_SKIN;
}

/**
 * 减弱动效：「跟随系统」看 prefers-reduced-motion；「总是减弱」在 <html data-motion="reduce"> 上兜底，
 * CSS 与 JS 两边都认这个属性。存本机 localStorage，首帧前由 layout 的内联脚本恢复（同 echo:rail）。
 */
export type UiMotion = "system" | "reduce";
export const UI_MOTION_KEY = "echo:motion";
export const DEFAULT_UI_MOTION: UiMotion = "system";

export function resolveUiMotion(value: unknown): UiMotion {
  return value === "reduce" ? "reduce" : DEFAULT_UI_MOTION;
}
