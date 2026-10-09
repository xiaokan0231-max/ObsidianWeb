import { PINCH_ENVELOPE_DEFAULTS } from "./hand-gesture.mjs";
import { RECENT_NOTES_KEY } from "./recent-notes.ts";
import {
  DEFAULT_UI_MOTION,
  DEFAULT_UI_SKIN,
  DEFAULT_UI_THEME,
  resolveUiMotion,
  resolveUiSkin,
  resolveUiTheme,
  UI_MOTION_KEY,
  UI_SKIN_COOKIE,
  UI_THEME_COOKIE,
  UI_THEME_EVENT,
} from "./ui-theme.ts";

/*
 * 设置中心读写的本机偏好：键名登记、默认值、解析与序列化。纯函数，不碰 DOM，node:test 直接 import。
 *
 * 为什么键名不重新起：这些键早已散在各页里各自读写（侧栏、资料库、复盘、3D、快练……），
 * 设置页只是同一份存储的第二个入口。换键名等于把本人存下的偏好全部作废；
 * 解析规则也必须与读取方逐字一致，否则设置页显示「列表」而资料库按「卡片」渲染。
 * 每个解析函数旁边写了读取方的位置，tests/ui-settings.test.mjs 用读取方源码或其导出锁住两边。
 *
 * 只存本机（localStorage / cookie）：偏好是这台电脑上的使用习惯，不是事实，不写 vault。
 */

// ── 设置页分组 ────────────────────────────────────────────────

export const SETTINGS_TABS = [
  "appearance",
  "locale",
  "training",
  "career",
  "library",
  "gesture",
  "data",
  "shortcuts",
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];
export const DEFAULT_SETTINGS_TAB: SettingsTab = "appearance";

export function resolveSettingsTab(value: unknown): SettingsTab {
  return SETTINGS_TABS.includes(value as SettingsTab) ? value as SettingsTab : DEFAULT_SETTINGS_TAB;
}

// ── 键名与同页事件 ────────────────────────────────────────────

/** 侧栏折叠：app/memory-atlas.tsx 的 RAIL_STORAGE_KEY；layout.tsx 的首帧脚本也读它。 */
export const RAIL_KEY = "echo:rail";
/** RailToggle 订阅的同页事件。设置页改完派发它，侧栏底部按钮的箭头与 aria 跟着变。 */
export const RAIL_EVENT = "echo:railchange";
/** 写回后自动重算派生统计：app/memory-atlas.tsx 的 AUTO_STATS_KEY（设置页经外壳 props 改，不直接写）。 */
export const AUTO_STATS_KEY = "echo:auto-stats";
export const AUTO_STATS_EVENT = "echo:autostatschange";
/** 正文字号：app/reading-mode.tsx 的 FONT_KEY，阅读层与原笔记详情页共用。 */
export const READING_FONT_KEY = "reading:font-size";
/** 资料库卡片 / 列表：app/library-view.tsx 的 LAYOUT_KEY；事件同名（LAYOUT_EVENT）。 */
export const LIBRARY_LAYOUT_KEY = "echo:library-layout";
export const LIBRARY_LAYOUT_EVENT = "echo:library-layout";
/** 复盘三键：app/interview-review.tsx 的 MODE_KEY / NOVEL_LANG_KEY / INDEX_GROUP_KEY，共用 MODE_EVENT。 */
export const REVIEW_MODE_KEY = "review:mode";
export const REVIEW_NOVEL_LANGUAGE_KEY = "review:novel-language";
export const REVIEW_INDEX_GROUP_KEY = "review:index-group";
export const REVIEW_EVENT = "review:modechange";
/** 时间线 / 关系图默认渲染：app/timeline-view.tsx、app/graph-view.tsx 里写成字面量的键。 */
export const TIMELINE_RENDERER_KEY = "echo.timeline.renderer";
export const GRAPH_RENDERER_KEY = "echo.graph.renderer";
/** 星图手势存档：app/graph-hand-controls.tsx 的 ONBOARDING_STORAGE_KEY。 */
export const GRAPH_HAND_KEY = "echo:graph-hand-onboarding:v3";
/** 快练设置：app/language-quick-sync.ts 的 QUICK_SETTINGS_KEY（设置页用 useQuickSettings 读写，同一份快照）。 */
export const QUICK_SETTINGS_KEY = "echo:language-quick-settings:v1";
export { RECENT_NOTES_KEY, UI_MOTION_KEY };

/**
 * 设置页自己写完本机存储后派发：同页的 storage 事件不会触发（只有别的标签页才收到），
 * 设置页里「当前是否有值」那张表靠它刷新。
 */
export const SETTINGS_STORAGE_EVENT = "echo:settingschange";

// ── 解析：与读取方一致 ────────────────────────────────────────

export type RailState = "collapsed" | "expanded";
/** RailToggle 只认 "collapsed"；其余（含 "expanded"、空）都是展开。 */
export function parseRail(raw: string | null | undefined): RailState {
  return raw === "collapsed" ? "collapsed" : "expanded";
}

/** readAutoStats：没存过算开，只有 "off" 是关。 */
export function parseAutoStats(raw: string | null | undefined): boolean {
  return raw == null ? true : raw !== "off";
}
export function serializeAutoStats(on: boolean): string {
  return on ? "on" : "off";
}

export const READING_FONT_SIZES = [16, 18, 20, 22, 24] as const;
export type ReadingFontSize = (typeof READING_FONT_SIZES)[number];
export const DEFAULT_READING_FONT_SIZE: ReadingFontSize = 18;
/** readFontSize：Number(raw) 落在五档里才算数，否则 18。阅读层按 ±2 调，所以只有偶数档。 */
export function parseReadingFontSize(raw: string | null | undefined): ReadingFontSize {
  const size = Number(raw);
  return READING_FONT_SIZES.includes(size as ReadingFontSize) ? size as ReadingFontSize : DEFAULT_READING_FONT_SIZE;
}
/** 原笔记详情页（note-drawer）比阅读层小 2px 显示同一个值。 */
export const DRAWER_FONT_OFFSET = 2;

export type LibraryLayout = "card" | "list";
export function parseLibraryLayout(raw: string | null | undefined): LibraryLayout {
  return raw === "list" ? "list" : "card";
}

export type ReviewMode = "study" | "compare" | "novel";
export function parseReviewMode(raw: string | null | undefined): ReviewMode {
  return raw === "compare" || raw === "novel" ? raw : "study";
}

export type ReviewNovelLanguage = "ja" | "zh";
export function parseReviewNovelLanguage(raw: string | null | undefined): ReviewNovelLanguage {
  return raw === "zh" ? "zh" : "ja";
}

export type ReviewIndexGroup = "company" | "all";
export function parseReviewIndexGroup(raw: string | null | undefined): ReviewIndexGroup {
  return raw === "all" ? "all" : "company";
}

export type TimelineRenderer = "list" | "corridor";
export function parseTimelineRenderer(raw: string | null | undefined): TimelineRenderer {
  return raw === "corridor" ? "corridor" : "list";
}

export type GraphRenderer = "map" | "space";
export function parseGraphRenderer(raw: string | null | undefined): GraphRenderer {
  return raw === "space" ? "space" : "map";
}

// ── 星图手势存档 ──────────────────────────────────────────────

export type GraphHandThresholds = { closeThreshold: number; releaseThreshold: number; calibrated?: boolean };
/** app/graph-hand-controls.tsx 的 DEFAULT_THRESHOLDS（组件私有，测试按源码核对这两个数）。 */
export const GRAPH_HAND_DEFAULT_THRESHOLDS: Readonly<GraphHandThresholds> = Object.freeze({
  closeThreshold: 0.46,
  releaseThreshold: 0.68,
});

export type GraphHandPreferences = {
  /** 看过首次校准引导。 */
  seen: boolean;
  /** 进入 3D 星图时自动打开摄像头。默认关：一进全屏就弹授权框太突兀。 */
  enabled: boolean;
  /** 实际生效的阈值：存档里比默认更宽松才采用，否则就是默认。 */
  thresholds: GraphHandThresholds;
  /** 正在用的阈值是否不同于默认（存档被采用且数值与默认不同）。 */
  customThresholds: boolean;
  /** 识别时学到的捏合区间，用来给新出现的手起步。 */
  envelope: { min: number; max: number } | null;
};

function readJson(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** 与组件的 readStoredPreferences 同一套取舍：阈值只接受「比默认更宽松」的一侧，区间跨度不够就不用。 */
export function parseGraphHandPreferences(raw: string | null | undefined): GraphHandPreferences {
  const parsed = readJson(raw);
  const thresholds = parsed?.thresholds as Partial<GraphHandThresholds> | undefined;
  const envelope = parsed?.envelope as { min?: unknown; max?: unknown } | undefined;
  const usable = finite(thresholds?.closeThreshold)
    && finite(thresholds?.releaseThreshold)
    && thresholds.closeThreshold >= GRAPH_HAND_DEFAULT_THRESHOLDS.closeThreshold
    && thresholds.releaseThreshold > thresholds.closeThreshold;
  const seed = finite(envelope?.min) && finite(envelope?.max)
    && envelope.max - envelope.min >= PINCH_ENVELOPE_DEFAULTS.minSpan
    ? { min: envelope.min, max: envelope.max }
    : null;
  // 存档里写的就是默认值（「恢复默认灵敏度」之后正是这样）不算自定义。
  const custom = usable && (thresholds.closeThreshold !== GRAPH_HAND_DEFAULT_THRESHOLDS.closeThreshold
    || thresholds.releaseThreshold !== GRAPH_HAND_DEFAULT_THRESHOLDS.releaseThreshold);
  return {
    seen: parsed?.seen === true,
    enabled: parsed?.enabled === true,
    thresholds: usable ? thresholds as GraphHandThresholds : { ...GRAPH_HAND_DEFAULT_THRESHOLDS },
    customThresholds: Boolean(custom),
    envelope: seed,
  };
}

/** 同 writeEnabledPreference：只改开关一项，阈值与包络原样保留。 */
export function withGraphHandEnabled(raw: string | null | undefined, enabled: boolean): string {
  return JSON.stringify({ ...(readJson(raw) ?? {}), enabled });
}

/**
 * 同组件里的「恢复默认灵敏度」：阈值回默认，学到的区间一并丢掉（留着的话新出现的手仍从旧区间起步）。
 * 看过引导与开关保持原样——这里只管灵敏度，不该顺手让引导再弹一次或替本人开摄像头。
 */
export function resetGraphHandSensitivity(raw: string | null | undefined): string {
  const parsed = readJson(raw) ?? {};
  return JSON.stringify({
    seen: parsed.seen === true,
    enabled: parsed.enabled === true,
    thresholds: { ...GRAPH_HAND_DEFAULT_THRESHOLDS },
  });
}

// ── 本机偏好登记（数据与连接 → 本机存储） ────────────────────

/**
 * owner：恢复默认时由谁动手。
 * - "remove"：直接删键，读取方下次读到空值就落回默认。
 * - "hook"：读取方在内存里还留着一份快照（快练设置、减弱动效、皮肤与明暗 cookie），
 *   必须走它自己的 setter 写回默认值，否则当前页面要刷新才变。
 * - "shell"：外壳持有（写回后自动重算），经外壳给的 props 切回默认。
 */
export type PreferenceOwner = "remove" | "hook" | "shell";

export type UiPreference = {
  key: string;
  storage: "local" | "cookie";
  tab: SettingsTab;
  label: readonly [string, string];
  owner: PreferenceOwner;
  /** 读取方订阅的同页事件：设置页写完派发它，已挂载的页面（侧栏、资料库、复盘）跟着变。 */
  event?: string;
};

export const UI_PREFERENCES: readonly UiPreference[] = [
  { key: UI_SKIN_COOKIE, storage: "cookie", tab: "appearance", label: ["皮肤", "スキン"], owner: "hook", event: UI_THEME_EVENT },
  { key: UI_THEME_COOKIE, storage: "cookie", tab: "appearance", label: ["明暗", "明暗"], owner: "hook", event: UI_THEME_EVENT },
  { key: UI_MOTION_KEY, storage: "local", tab: "appearance", label: ["减弱动效", "動きを減らす"], owner: "hook", event: UI_THEME_EVENT },
  { key: READING_FONT_KEY, storage: "local", tab: "appearance", label: ["阅读字号", "本文の文字サイズ"], owner: "remove" },
  { key: RAIL_KEY, storage: "local", tab: "appearance", label: ["侧栏收起", "サイドバーの折りたたみ"], owner: "remove", event: RAIL_EVENT },
  { key: QUICK_SETTINGS_KEY, storage: "local", tab: "training", label: ["快练设置", "クイック練習の設定"], owner: "hook" },
  { key: LIBRARY_LAYOUT_KEY, storage: "local", tab: "library", label: ["资料库布局", "資料庫の表示"], owner: "remove", event: LIBRARY_LAYOUT_EVENT },
  { key: REVIEW_MODE_KEY, storage: "local", tab: "library", label: ["复盘阅读模式", "振り返りの表示モード"], owner: "remove", event: REVIEW_EVENT },
  { key: REVIEW_NOVEL_LANGUAGE_KEY, storage: "local", tab: "library", label: ["全文阅读语言", "全文表示の言語"], owner: "remove", event: REVIEW_EVENT },
  { key: REVIEW_INDEX_GROUP_KEY, storage: "local", tab: "library", label: ["复盘一览分组", "振り返り一覧の並び"], owner: "remove", event: REVIEW_EVENT },
  { key: TIMELINE_RENDERER_KEY, storage: "local", tab: "library", label: ["时间线默认显示", "タイムラインの既定表示"], owner: "remove" },
  { key: GRAPH_RENDERER_KEY, storage: "local", tab: "library", label: ["关系图默认显示", "関係図の既定表示"], owner: "remove" },
  { key: GRAPH_HAND_KEY, storage: "local", tab: "gesture", label: ["星图手势", "星図ジェスチャー"], owner: "remove" },
  { key: AUTO_STATS_KEY, storage: "local", tab: "data", label: ["写入后自动重算", "書き込み後の自動再計算"], owner: "shell", event: AUTO_STATS_EVENT },
];

/**
 * 进度与草稿：不是偏好，恢复默认一律不碰。清掉它们会丢掉只存在本机的答题记录、未同步的场景课答案或教材读到哪。
 * 前缀族（动态键）与固定键都列在这里，测试保证上面的登记表里没有一个落进这些范围。
 */
export const PROGRESS_STORAGE_PREFIXES = [
  "echo:said:",
  "echo:language-scenario:v1:",
  "obsidianweb:textbook-position:v1:",
  "echo:language-expression-position:v1",
] as const;

export function isProgressKey(key: string): boolean {
  return PROGRESS_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** 恢复默认时可以直接删掉的 localStorage 键（其余由各自的 setter 或外壳回默认）。 */
export function removablePreferenceKeys(preferences: readonly UiPreference[] = UI_PREFERENCES): string[] {
  return preferences
    .filter((item) => item.storage === "local" && item.owner === "remove" && !isProgressKey(item.key) && item.key !== RECENT_NOTES_KEY)
    .map((item) => item.key);
}

/**
 * 存下的原值是否等于默认（「本机存储」列表里分「默认值 / 已自定义」用）。没存过算默认。
 * 快练设置的解析在 app/language-quick-sync.ts，这里认不出就返回 null，由调用方自己判断。
 */
export function isDefaultPreference(key: string, raw: string | null): boolean | null {
  if (raw === null) return true;
  switch (key) {
    case UI_SKIN_COOKIE: return resolveUiSkin(raw) === DEFAULT_UI_SKIN;
    case UI_THEME_COOKIE: return resolveUiTheme(raw) === DEFAULT_UI_THEME;
    case UI_MOTION_KEY: return resolveUiMotion(raw) === DEFAULT_UI_MOTION;
    case READING_FONT_KEY: return parseReadingFontSize(raw) === DEFAULT_READING_FONT_SIZE;
    case RAIL_KEY: return parseRail(raw) === "expanded";
    case LIBRARY_LAYOUT_KEY: return parseLibraryLayout(raw) === "card";
    case REVIEW_MODE_KEY: return parseReviewMode(raw) === "study";
    case REVIEW_NOVEL_LANGUAGE_KEY: return parseReviewNovelLanguage(raw) === "ja";
    case REVIEW_INDEX_GROUP_KEY: return parseReviewIndexGroup(raw) === "company";
    case TIMELINE_RENDERER_KEY: return parseTimelineRenderer(raw) === "list";
    case GRAPH_RENDERER_KEY: return parseGraphRenderer(raw) === "map";
    case AUTO_STATS_KEY: return parseAutoStats(raw);
    case GRAPH_HAND_KEY: {
      // 「看过引导」不算偏好：看过之后再也回不到没看过，不该因此一直显示「已自定义」。
      const hand = parseGraphHandPreferences(raw);
      return !hand.enabled && !hand.customThresholds && !hand.envelope;
    }
    default: return null;
  }
}

/** 从 document.cookie 取一枚 cookie 的值；没有就是 null。 */
export function readCookie(cookieString: string, name: string): string | null {
  for (const part of cookieString.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      return part.slice(index + 1).trim();
    }
  }
  return null;
}

// ── 数据与连接 ────────────────────────────────────────────────

/** GET /api/settings/connection 的响应。只有地址的主机与端口和布尔值：密钥、令牌与 URL 里的认证段一律不出服务端。 */
export type SettingsConnectionStatus = {
  obsidian: { host: string; port: string; keyConfigured: boolean };
  vaultPathConfigured: boolean;
};

const DEFAULT_OBSIDIAN_URL = "http://127.0.0.1:27123";

/**
 * 由环境变量算出可以给界面看的那部分。URL 只取 hostname 与 port：
 * 写成 http://user:pass@host 的认证段、路径与查询串都可能夹带凭证，所以不原样回传。
 */
export function settingsConnectionStatus(env: Record<string, string | undefined>): SettingsConnectionStatus {
  let host = "";
  let port = "";
  try {
    const url = new URL(env.OBSIDIAN_API_URL || DEFAULT_OBSIDIAN_URL);
    host = url.hostname;
    port = url.port || (url.protocol === "https:" ? "443" : url.protocol === "http:" ? "80" : "");
  } catch {
    // 地址写坏了：界面显示「未能解析」，不回显原文（原文可能就是带凭证的那串）。
  }
  return {
    obsidian: { host, port, keyConfigured: Boolean(env.OBSIDIAN_API_KEY?.trim()) },
    vaultPathConfigured: Boolean(env.OBSIDIAN_VAULT_PATH?.trim()),
  };
}

/**
 * Codex Bridge 的 lastError 可能带本机绝对路径（用户名就在路径里）：路径换成「…」，再截断。
 * 只给设置页一行状态用，完整原文去终端看。
 */
export function truncateBridgeError(message: string | undefined, max = 90): string {
  if (!message) return "";
  const masked = message
    .replace(/(?:file:\/\/)?\/(?:Users|home|private|var|tmp|opt|Volumes)\/[^\s"'`)]+/g, "…")
    .replace(/[A-Za-z]:\\[^\s"'`)]+/g, "…")
    .replace(/\s+/g, " ")
    .trim();
  return masked.length > max ? `${masked.slice(0, max - 1)}…` : masked;
}

/** 距上次同步的整分钟数；还没同步或时钟未就绪时为 null。 */
export function minutesSince(fetchedAt: number | null, now: number): number | null {
  if (!fetchedAt || !now) return null;
  return Math.max(0, Math.floor((now - fetchedAt) / 60_000));
}
