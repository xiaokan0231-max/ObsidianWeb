"use client";

import "./styles/settings.css";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { describeConnectionError } from "@/lib/connection-error";
import type { CodexRuntimeStatus } from "@/lib/dojo/types";
import { JOB_STATUSES } from "@/lib/job-status";
import { QUICK_EASY_INTERVAL, QUICK_INTERVALS } from "@/lib/language/quick-progress";
import { quickDailyNewLimit } from "@/lib/language/quick-select";
import { QUICK_AUTO_ADVANCE_SECONDS, QUICK_DAY_START_HOUR, QUICK_SET_SIZES } from "@/lib/language/quick-types";
import { REDUCED_MOTION_QUERY } from "@/lib/motion";
import { readRecentPaths, RECENT_NOTES_LIMIT } from "@/lib/recent-notes";
import { SHORTCUT_GROUPS } from "@/lib/shortcuts";
import {
  DEFAULT_UI_MOTION,
  DEFAULT_UI_SKIN,
  DEFAULT_UI_THEME,
  UI_SKIN_COOKIE,
  UI_SKINS,
  UI_THEME_COOKIE,
  UI_THEME_EVENT,
  type UiMotion,
  type UiSkinMeta,
  type UiTheme,
} from "@/lib/ui-theme";
import {
  AUTO_STATS_EVENT,
  DRAWER_FONT_OFFSET,
  GRAPH_HAND_DEFAULT_THRESHOLDS,
  GRAPH_HAND_KEY,
  GRAPH_RENDERER_KEY,
  isDefaultPreference,
  LIBRARY_LAYOUT_KEY,
  minutesSince,
  parseGraphHandPreferences,
  parseGraphRenderer,
  parseLibraryLayout,
  parseReadingFontSize,
  parseReviewIndexGroup,
  parseReviewMode,
  parseReviewNovelLanguage,
  parseTimelineRenderer,
  QUICK_SETTINGS_KEY,
  RAIL_EVENT,
  RAIL_KEY,
  READING_FONT_KEY,
  READING_FONT_SIZES,
  readCookie,
  RECENT_NOTES_KEY,
  removablePreferenceKeys,
  resetGraphHandSensitivity,
  REVIEW_INDEX_GROUP_KEY,
  REVIEW_MODE_KEY,
  REVIEW_NOVEL_LANGUAGE_KEY,
  SETTINGS_STORAGE_EVENT,
  SETTINGS_TABS,
  DEFAULT_SETTINGS_TAB,
  TIMELINE_RENDERER_KEY,
  truncateBridgeError,
  UI_PREFERENCES,
  withGraphHandEnabled,
  type SettingsConnectionStatus,
  type SettingsTab,
  type UiPreference,
} from "@/lib/ui-settings";
import { DEFAULT_QUICK_SETTINGS, parseQuickSettings, useQuickSettings } from "./language-quick-sync";
import { useSettingsCopy, type SettingsCopyKey } from "./settings-copy";
import { useUiLocale } from "./ui-locale";
import { useUiMotion, useUiSkin, useUiTheme } from "./ui-theme";
import { enumCodec, useUrlState } from "./use-url-state";

/*
 * 设置中心。只存本机（cookie / localStorage），不写 vault，也不加任何服务端状态。
 *
 * 每个设置都沿用原页面早就在用的那份存储（键名、取值、事件见 lib/ui-settings.ts）：
 * 设置页只是第二个入口，原页面里的开关照常可用，两边改的是同一个值。
 * 页内分组记在 ?tab=：刷新或从别页回来仍停在同一组；用 replaceState，切组不会堆历史。
 */

export type DerivedStatsState = "fresh" | "stale" | "rebuilding";

/** 外壳已有的连接状态，原样传进来（memory-atlas.tsx 的 error / loading / fetchedAt）。 */
export type SettingsConnection = {
  /** 当前所用 scope 读取正常（外壳：!error）。 */
  ok: boolean;
  /** 正在读取（外壳：loading）。 */
  loading?: boolean;
  /** 最近一次同步完成的时间戳（外壳：fetchedAt）。 */
  fetchedAt: number | null;
  /** 读取失败的原文，空串表示没有错误（外壳：error）。 */
  error: string;
};

export type SettingsViewProps = {
  connection: SettingsConnection;
  /** 写回后自动重算派生统计（外壳的 autoStats，与顶栏「统计 · 自动」同一个开关）。 */
  autoStats: boolean;
  onToggleAutoStats: () => void;
  /** 与 JobsAnalytics 同名的三项：派生统计是否追上事实、上次失败原因、立即重算。 */
  derivedState?: DerivedStatsState;
  statsError?: string;
  onRebuildStats?: () => void;
  /** 重新读取 vault（外壳：loadVault({ fresh: true })）。不给就不显示按钮。 */
  onReload?: () => void;
};

const TAB_CODEC = enumCodec<SettingsTab>(SETTINGS_TABS);

const TAB_COPY: Record<SettingsTab, { label: SettingsCopyKey; caption: SettingsCopyKey; summary: SettingsCopyKey }> = {
  appearance: { label: "外观", caption: "外观 · 摘要", summary: "外观 · 说明" },
  locale: { label: "语言与地区", caption: "语言与地区 · 摘要", summary: "语言与地区 · 说明" },
  training: { label: "日语训练", caption: "日语训练 · 摘要", summary: "日语训练 · 说明" },
  career: { label: "日历与求职", caption: "日历与求职 · 摘要", summary: "日历与求职 · 说明" },
  library: { label: "资料库与阅读", caption: "资料库与阅读 · 摘要", summary: "资料库与阅读 · 说明" },
  gesture: { label: "星图手势", caption: "星图手势 · 摘要", summary: "星图手势 · 说明" },
  data: { label: "数据与连接", caption: "数据与连接 · 摘要", summary: "数据与连接 · 说明" },
  shortcuts: { label: "快捷键", caption: "快捷键 · 摘要", summary: "快捷键 · 说明" },
};

// ── 本机存储快照 ──────────────────────────────────────────────

/** 设置页读的 localStorage 键（快练设置与侧栏另有各自的订阅，这里只用来判断「有没有存」）。 */
const TRACKED_KEYS = [...new Set([
  ...UI_PREFERENCES.filter((item) => item.storage === "local").map((item) => item.key),
  RECENT_NOTES_KEY,
])];

const PREFERENCE_EVENTS = new Map(UI_PREFERENCES.filter((item) => item.event).map((item) => [item.key, item.event as string]));

// 存储被禁用（私密窗口等）时，本次打开期间的改动记在这里，设置页至少能显示刚选的值。
const memoryStore = new Map<string, string | null>();

function readLocal(key: string): string | null {
  if (memoryStore.has(key)) return memoryStore.get(key) ?? null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** 写一个键并通知：设置页自己的快照，加上读取方订阅的同页事件（侧栏、资料库、复盘）。 */
function writeLocal(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
    memoryStore.delete(key);
  } catch {
    memoryStore.set(key, value);
  }
  const ownerEvent = PREFERENCE_EVENTS.get(key);
  if (ownerEvent) window.dispatchEvent(new Event(ownerEvent));
  window.dispatchEvent(new Event(SETTINGS_STORAGE_EVENT));
}

const SNAPSHOT_EVENTS = ["storage", SETTINGS_STORAGE_EVENT, RAIL_EVENT, AUTO_STATS_EVENT, UI_THEME_EVENT, ...PREFERENCE_EVENTS.values()];

function subscribeSnapshot(onChange: () => void) {
  const names = [...new Set(SNAPSHOT_EVENTS)];
  for (const name of names) window.addEventListener(name, onChange);
  return () => {
    for (const name of names) window.removeEventListener(name, onChange);
  };
}

type StorageSnapshot = { local: Record<string, string | null>; cookies: Record<string, string | null> };

/** 拼成字符串交给 useSyncExternalStore：内容不变时 Object.is 相等，不会无谓重渲染。 */
function readSnapshot(): string {
  let cookieString = "";
  try {
    cookieString = document.cookie;
  } catch {
    // 拿不到 cookie 只影响「有没有存」那一列。
  }
  const snapshot: StorageSnapshot = {
    local: Object.fromEntries(TRACKED_KEYS.map((key) => [key, readLocal(key)])),
    cookies: { [UI_SKIN_COOKIE]: readCookie(cookieString, UI_SKIN_COOKIE), [UI_THEME_COOKIE]: readCookie(cookieString, UI_THEME_COOKIE) },
  };
  return JSON.stringify(snapshot);
}

const SERVER_SNAPSHOT = JSON.stringify({ local: {}, cookies: {} } satisfies StorageSnapshot);

function useStorageSnapshot(): StorageSnapshot {
  const raw = useSyncExternalStore(subscribeSnapshot, readSnapshot, () => SERVER_SNAPSHOT);
  return useMemo(() => JSON.parse(raw) as StorageSnapshot, [raw]);
}

const localValue = (snapshot: StorageSnapshot, key: string) => snapshot.local[key] ?? null;

// ── 侧栏与系统动效：读 DOM / 媒体查询 ─────────────────────────

function subscribeRail(onChange: () => void) {
  window.addEventListener(RAIL_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(RAIL_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** 与 RailToggle 同一个真相：<html data-rail>（首帧脚本按 echo:rail 写好）。 */
const isRailCollapsed = () => document.documentElement.dataset.rail === "collapsed";

function setRailCollapsed(collapsed: boolean) {
  const next = collapsed ? "collapsed" : "expanded";
  // 先改属性再派发：RailToggle 收到 echo:railchange 时读的就是属性。
  document.documentElement.dataset.rail = next;
  writeLocal(RAIL_KEY, next);
}

function subscribeSystemMotion(onChange: () => void) {
  const list = window.matchMedia?.(REDUCED_MOTION_QUERY);
  list?.addEventListener?.("change", onChange);
  return () => list?.removeEventListener?.("change", onChange);
}

const systemReducesMotion = () => Boolean(window.matchMedia?.(REDUCED_MOTION_QUERY).matches);

/** 相对时间只要分钟精度：每分钟走一次，首个值在挂载后补上，渲染里不直接读 Date.now()。 */
function useMinuteClock() {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 60_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, []);
  return now;
}

/** 只读 GET。nonce 变了就重取；结果带上 nonce，过期的那次不会被当成当前状态。 */
function useRemoteJson<T>(url: string, enabled: boolean) {
  const [nonce, setNonce] = useState(0);
  const [result, setResult] = useState<{ nonce: number; data: T | null; error: string } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    const controller = new AbortController();
    // 本机 bridge 卡住时服务端会一直等：前端自己掐 8 秒，状态写「不可用」而不是一直转圈。
    const timer = window.setTimeout(() => controller.abort(), 8_000);
    fetch(url, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as T;
      })
      .then((data) => { if (!disposed) setResult({ nonce, data, error: "" }); })
      .catch((error: unknown) => {
        if (disposed) return;
        setResult({ nonce, data: null, error: error instanceof Error ? error.message : String(error) });
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, nonce, url]);
  const current = result?.nonce === nonce ? result : null;
  return {
    data: current ? current.data : result?.data ?? null,
    error: current?.error ?? "",
    loading: enabled && !current,
    refresh: () => setNonce((value) => value + 1),
  };
}

// ── 通用控件 ──────────────────────────────────────────────────

type Choice<T extends string | number> = { value: T; label: string; lang?: string };

function Segmented<T extends string | number>({ label, choices, value, onChange }: {
  label: string;
  choices: readonly Choice<T>[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="settings-seg" role="group" aria-label={label}>
      {choices.map((choice) => (
        <button key={String(choice.value)} type="button" aria-pressed={choice.value === value} onClick={() => onChange(choice.value)}>
          {/* lang 放在内层：首屏测试按「button 上的 lang + aria-pressed」认顶栏语言开关，这里不该被认成第二个。 */}
          {choice.lang ? <span lang={choice.lang}>{choice.label}</span> : choice.label}
        </button>
      ))}
    </div>
  );
}

function Switch({ checked, label, onChange, disabled = false }: {
  checked: boolean;
  label: string;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const { t } = useSettingsCopy();
  return (
    <button
      type="button"
      role="switch"
      className="settings-switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <i aria-hidden="true" />
      <span aria-hidden="true">{checked ? t("开") : t("关")}</span>
    </button>
  );
}

function SettingRow({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-row-copy">
        <strong>{title}</strong>
        {hint && <p>{hint}</p>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

function SettingsCard({ title, note, wide = false, children }: { title: string; note?: string; wide?: boolean; children: ReactNode }) {
  return (
    <section className={`settings-card${wide ? " is-wide" : ""}`}>
      <header className="settings-card-head">
        <h3>{title}</h3>
        {note && <p>{note}</p>}
      </header>
      {children}
    </section>
  );
}

function Facts({ items }: { items: readonly { term: string; detail: ReactNode }[] }) {
  return (
    <dl className="settings-facts">
      {items.map((item) => (
        <div key={item.term}>
          <dt>{item.term}</dt>
          <dd>{item.detail}</dd>
        </div>
      ))}
    </dl>
  );
}

/** 一次性操作后的回执（已清空、已恢复）。aria-live 让读屏也知道点击生效了。 */
function Receipt({ text }: { text: string }) {
  return <span className="settings-receipt" role="status" aria-live="polite">{text}</span>;
}

// ── 外观 ──────────────────────────────────────────────────────

function SkinCard({ meta, theme, active, onSelect }: { meta: UiSkinMeta; theme: UiTheme; active: boolean; onSelect: () => void }) {
  const { t, pick } = useSettingsCopy();
  const [paper, surface, brand, link, ink] = meta.swatches[theme];
  // 预览只用皮肤自己的色块：画在卡片内的小样，不受当前页面主题影响，才看得出切过去是什么样。
  const preview = { "--skin-paper": paper, "--skin-surface": surface, "--skin-brand": brand, "--skin-link": link, "--skin-ink": ink } as CSSProperties;
  return (
    <button type="button" className="settings-skin" aria-pressed={active} onClick={onSelect} data-skin-option={meta.id}>
      <span className="settings-skin-preview" style={preview} aria-hidden="true">
        <span className="settings-skin-sheet">
          <b>{t("预览字样")}</b>
          <u>{t("预览链接")}</u>
          <i />
        </span>
        <span className="settings-skin-chips">
          {meta.swatches[theme].map((color, index) => <i key={index} style={{ background: color }} />)}
        </span>
      </span>
      <span className="settings-skin-copy">
        <strong>{pick(meta.name)}{active && <em>{t("使用中")}</em>}</strong>
        <small>{pick(meta.description)}</small>
      </span>
    </button>
  );
}

function AppearancePanel() {
  const { t } = useSettingsCopy();
  const snapshot = useStorageSnapshot();
  const { theme, setTheme } = useUiTheme();
  const { skin, setSkin } = useUiSkin();
  const { motion, setMotion } = useUiMotion();
  const systemMotion = useSyncExternalStore(subscribeSystemMotion, systemReducesMotion, () => false);
  const railCollapsed = useSyncExternalStore(subscribeRail, isRailCollapsed, () => false);
  const fontSize = parseReadingFontSize(localValue(snapshot, READING_FONT_KEY));

  return (
    <>
      <SettingsCard title={t("皮肤")} note={t("皮肤说明")}>
        <div className="settings-skins">
          {UI_SKINS.map((meta) => (
            <SkinCard key={meta.id} meta={meta} theme={theme} active={skin === meta.id} onSelect={() => setSkin(meta.id)} />
          ))}
        </div>
      </SettingsCard>
      <SettingsCard title={t("显示")}>
        {/* 四项控件都很短：两列排，右半边不至于整片空着。 */}
        <div className="settings-row-grid">
        <SettingRow title={t("明暗")} hint={t("明暗说明")}>
          <Segmented<UiTheme>
            label={t("明暗")}
            value={theme}
            onChange={setTheme}
            choices={[{ value: "dark", label: t("暗色") }, { value: "light", label: t("浅色") }]}
          />
        </SettingRow>
        <SettingRow title={t("减弱动效")} hint={`${t("减弱动效说明")} ${systemMotion ? t("系统当前：已减弱") : t("系统当前：未减弱")}`}>
          <Segmented<UiMotion>
            label={t("减弱动效")}
            value={motion}
            onChange={setMotion}
            choices={[{ value: "system", label: t("跟随系统") }, { value: "reduce", label: t("总是减弱") }]}
          />
        </SettingRow>
        <SettingRow title={t("阅读字号")} hint={t("阅读字号说明", { offset: DRAWER_FONT_OFFSET })}>
          <Segmented<number>
            label={t("阅读字号")}
            value={fontSize}
            onChange={(size) => writeLocal(READING_FONT_KEY, String(size))}
            choices={READING_FONT_SIZES.map((size) => ({ value: size, label: `${size}px` }))}
          />
        </SettingRow>
        <SettingRow title={t("侧栏默认收起")} hint={t("侧栏默认收起说明")}>
          <Switch checked={railCollapsed} label={t("侧栏默认收起")} onChange={setRailCollapsed} />
        </SettingRow>
        </div>
      </SettingsCard>
    </>
  );
}

// ── 语言与地区 ────────────────────────────────────────────────

function LocalePanel() {
  const { t } = useSettingsCopy();
  const { locale, setLocale } = useUiLocale();
  return (
    <div className="settings-columns">
      <SettingsCard title={t("语言")}>
        <SettingRow title={t("界面语言")} hint={t("界面语言说明")}>
          <Segmented
            label={t("界面语言")}
            value={locale}
            onChange={setLocale}
            choices={[{ value: "zh-CN", label: "中文", lang: "zh-CN" }, { value: "ja", label: "日本語", lang: "ja" }]}
          />
        </SettingRow>
      </SettingsCard>
      <SettingsCard title={t("时区与日期")} note={t("固定，不提供修改")}>
        <Facts items={[
          { term: t("时区"), detail: t("时区说明") },
          { term: t("练习日"), detail: t("练习日说明", { hour: QUICK_DAY_START_HOUR }) },
          { term: t("一周"), detail: t("一周说明") },
        ]} />
      </SettingsCard>
    </div>
  );
}

// ── 日语训练 ──────────────────────────────────────────────────

function TrainingPanel() {
  const { t } = useSettingsCopy();
  const [quick, updateQuick] = useQuickSettings();
  const autoValue = quick.autoAdvance ? quick.autoAdvanceSeconds : 0;
  return (
    <>
      <SettingsCard title={t("快练")} note={t("快练说明")}>
        <SettingRow title={t("每组题数")} hint={t("每组题数说明", { limit: quickDailyNewLimit(quick.size) })}>
          <Segmented<number>
            label={t("每组题数")}
            value={quick.size}
            onChange={(size) => updateQuick({ size: size as (typeof QUICK_SET_SIZES)[number] })}
            choices={QUICK_SET_SIZES.map((size) => ({ value: size, label: t("{count} 题", { count: size }) }))}
          />
        </SettingRow>
        <SettingRow title={t("打字题")} hint={t("打字题说明")}>
          <Switch checked={quick.typing} label={t("打字题")} onChange={(typing) => updateQuick({ typing })} />
        </SettingRow>
        <SettingRow title={t("答对自动下一题")} hint={t("答对自动下一题说明")}>
          <Segmented<number>
            label={t("答对自动下一题")}
            value={autoValue}
            onChange={(seconds) => updateQuick(seconds === 0
              ? { autoAdvance: false }
              : { autoAdvance: true, autoAdvanceSeconds: seconds as (typeof QUICK_AUTO_ADVANCE_SECONDS)[number] })}
            choices={[
              { value: 0, label: t("关") },
              ...QUICK_AUTO_ADVANCE_SECONDS.map((seconds) => ({ value: seconds, label: t("{count} 秒", { count: seconds }) })),
            ]}
          />
        </SettingRow>
      </SettingsCard>
      <SettingsCard title={t("复习规则")} note={t("复习规则说明")}>
        <Facts items={[
          { term: t("复习间隔"), detail: t("复习间隔值", { first: QUICK_INTERVALS.firstSuccess, second: QUICK_INTERVALS.retrievable, third: QUICK_INTERVALS.stable }) },
          { term: t("答错"), detail: t("答错值", { days: QUICK_INTERVALS.failure }) },
          { term: t("首答定成败"), detail: t("首答定成败值") },
          { term: t("太简单"), detail: t("太简单值", { days: QUICK_EASY_INTERVAL }) },
          { term: t("练习日"), detail: t("练习日说明", { hour: QUICK_DAY_START_HOUR }) },
          { term: t("为什么只读"), detail: t("为什么只读值") },
        ]} />
      </SettingsCard>
    </>
  );
}

// ── 日历与求职 ────────────────────────────────────────────────

function CareerPanel() {
  const { t } = useSettingsCopy();
  return (
    <div className="settings-columns">
      <SettingsCard title={t("应募状态")} note={t("只读")}>
        <p className="settings-copy">{t("应募状态说明", { count: JOB_STATUSES.length })}</p>
        <ul className="settings-status-list" aria-label={t("合法状态值")}>
          {JOB_STATUSES.map((status) => <li key={status} lang="ja">{status}</li>)}
        </ul>
        <p className="settings-copy">{t("状态补充写法")} <code lang="ja">不採用（YYYY-MM-DD・書類選考）</code></p>
      </SettingsCard>
      <SettingsCard title={t("日程规则")} note={t("只读")}>
        <Facts items={[
          { term: t("时区"), detail: t("日程时区值") },
          { term: t("日历只放真实日程"), detail: t("日历只放真实日程值") },
          { term: t("等待与跟进"), detail: t("等待与跟进值") },
        ]} />
      </SettingsCard>
      <SettingsCard title={t("正本")} wide>
        <p className="settings-copy">
          {t("正本说明")} <code>99_系统/_数据字典.md</code>
          <span className="settings-copy-sep" aria-hidden="true">·</span>
          {t("校验命令")} <code>npm run vault:check</code>
        </p>
      </SettingsCard>
    </div>
  );
}

// ── 资料库与阅读 ──────────────────────────────────────────────

function LibraryPanel() {
  const { t } = useSettingsCopy();
  const snapshot = useStorageSnapshot();
  const [cleared, setCleared] = useState(false);
  const recentCount = readRecentPaths({ getItem: () => localValue(snapshot, RECENT_NOTES_KEY) }).length;
  return (
    <>
      <SettingsCard title={t("资料库与复盘")} note={t("默认视图说明")}>
        <SettingRow title={t("资料库布局")} hint={t("资料库布局说明")}>
          <Segmented
            label={t("资料库布局")}
            value={parseLibraryLayout(localValue(snapshot, LIBRARY_LAYOUT_KEY))}
            onChange={(layout) => writeLocal(LIBRARY_LAYOUT_KEY, layout)}
            choices={[{ value: "card", label: t("卡片") }, { value: "list", label: t("列表") }]}
          />
        </SettingRow>
        <SettingRow title={t("复盘默认阅读模式")} hint={t("复盘默认阅读模式说明")}>
          <Segmented
            label={t("复盘默认阅读模式")}
            value={parseReviewMode(localValue(snapshot, REVIEW_MODE_KEY))}
            onChange={(mode) => writeLocal(REVIEW_MODE_KEY, mode)}
            choices={[{ value: "study", label: t("学习") }, { value: "compare", label: t("对照") }, { value: "novel", label: t("全文阅读") }]}
          />
        </SettingRow>
        <SettingRow title={t("全文阅读语言")} hint={t("全文阅读语言说明")}>
          <Segmented
            label={t("全文阅读语言")}
            value={parseReviewNovelLanguage(localValue(snapshot, REVIEW_NOVEL_LANGUAGE_KEY))}
            onChange={(language) => writeLocal(REVIEW_NOVEL_LANGUAGE_KEY, language)}
            choices={[{ value: "ja", label: "日本語", lang: "ja" }, { value: "zh", label: "中文", lang: "zh-CN" }]}
          />
        </SettingRow>
        <SettingRow title={t("复盘一览分组")} hint={t("复盘一览分组说明")}>
          <Segmented
            label={t("复盘一览分组")}
            value={parseReviewIndexGroup(localValue(snapshot, REVIEW_INDEX_GROUP_KEY))}
            onChange={(group) => writeLocal(REVIEW_INDEX_GROUP_KEY, group)}
            choices={[{ value: "company", label: t("按公司") }, { value: "all", label: t("全部场次") }]}
          />
        </SettingRow>
      </SettingsCard>
      <SettingsCard title={t("时间线、关系图与浏览记录")} note={t("渲染默认说明")}>
        <SettingRow title={t("时间线默认显示")}>
          <Segmented
            label={t("时间线默认显示")}
            value={parseTimelineRenderer(localValue(snapshot, TIMELINE_RENDERER_KEY))}
            onChange={(renderer) => writeLocal(TIMELINE_RENDERER_KEY, renderer)}
            choices={[{ value: "list", label: t("时间列表") }, { value: "corridor", label: t("探索模式 · 3D") }]}
          />
        </SettingRow>
        <SettingRow title={t("关系图默认显示")}>
          <Segmented
            label={t("关系图默认显示")}
            value={parseGraphRenderer(localValue(snapshot, GRAPH_RENDERER_KEY))}
            onChange={(renderer) => writeLocal(GRAPH_RENDERER_KEY, renderer)}
            choices={[{ value: "map", label: t("关系地图") }, { value: "space", label: t("探索模式 · 3D") }]}
          />
        </SettingRow>
        <SettingRow title={t("最近打开")} hint={t("最近打开说明", { limit: RECENT_NOTES_LIMIT, count: recentCount })}>
          <button
            type="button"
            className="settings-button"
            disabled={recentCount === 0}
            onClick={() => {
              writeLocal(RECENT_NOTES_KEY, null);
              setCleared(true);
            }}
          >
            {t("清空最近打开")}
          </button>
          {cleared && recentCount === 0 && <Receipt text={t("已清空")} />}
        </SettingRow>
      </SettingsCard>
    </>
  );
}

// ── 星图手势 ──────────────────────────────────────────────────

const threshold = (value: number) => value.toFixed(2);

function GesturePanel() {
  const { t } = useSettingsCopy();
  const snapshot = useStorageSnapshot();
  const [resetDone, setResetDone] = useState(false);
  const raw = localValue(snapshot, GRAPH_HAND_KEY);
  const hand = parseGraphHandPreferences(raw);
  const source = !hand.customThresholds ? t("默认值") : hand.thresholds.calibrated ? t("校准所得") : t("存档值");
  return (
    <div className="settings-columns">
      <SettingsCard title={t("手势控制")}>
        <SettingRow title={t("进入 3D 星图时自动开启手势")} hint={t("自动开启手势说明")}>
          <Switch
            checked={hand.enabled}
            label={t("进入 3D 星图时自动开启手势")}
            onChange={(enabled) => writeLocal(GRAPH_HAND_KEY, withGraphHandEnabled(readLocal(GRAPH_HAND_KEY), enabled))}
          />
        </SettingRow>
        <SettingRow title={t("恢复默认灵敏度")} hint={t("恢复默认灵敏度说明")}>
          <button
            type="button"
            className="settings-button"
            onClick={() => {
              writeLocal(GRAPH_HAND_KEY, resetGraphHandSensitivity(readLocal(GRAPH_HAND_KEY)));
              setResetDone(true);
            }}
          >
            {t("恢复默认")}
          </button>
          {resetDone && !hand.customThresholds && !hand.envelope && <Receipt text={t("已恢复默认")} />}
        </SettingRow>
        <p className="settings-note">{t("重新校准说明")}</p>
      </SettingsCard>
      <SettingsCard title={t("当前阈值")} note={t("只读")}>
        <Facts items={[
          { term: t("按下（捏合）"), detail: threshold(hand.thresholds.closeThreshold) },
          { term: t("松开"), detail: threshold(hand.thresholds.releaseThreshold) },
          { term: t("阈值来源"), detail: source },
          { term: t("学到的捏合区间"), detail: hand.envelope ? `${threshold(hand.envelope.min)}–${threshold(hand.envelope.max)}` : t("尚未学到") },
          { term: t("默认阈值"), detail: `${threshold(GRAPH_HAND_DEFAULT_THRESHOLDS.closeThreshold)} / ${threshold(GRAPH_HAND_DEFAULT_THRESHOLDS.releaseThreshold)}` },
          { term: t("首次引导"), detail: hand.seen ? t("已看过") : t("未看过") },
        ]} />
      </SettingsCard>
    </div>
  );
}

// ── 数据与连接 ────────────────────────────────────────────────

const BRIDGE_READY = new Set<CodexRuntimeStatus["bridge"]>(["ready", "busy"]);

function preferenceState(item: UiPreference, snapshot: StorageSnapshot): "unset" | "default" | "custom" {
  const raw = item.storage === "cookie" ? snapshot.cookies[item.key] ?? null : localValue(snapshot, item.key);
  if (raw === null) return "unset";
  // 快练设置的解析在 app 侧（parseQuickSettings 等于默认时返回同一个冻结对象）。
  const isDefault = item.key === QUICK_SETTINGS_KEY ? parseQuickSettings(raw) === DEFAULT_QUICK_SETTINGS : isDefaultPreference(item.key, raw);
  return isDefault === false ? "custom" : "default";
}

const STATE_COPY: Record<ReturnType<typeof preferenceState>, SettingsCopyKey> = { unset: "未保存", default: "默认值", custom: "已自定义" };

function DataPanel({ connection, autoStats, onToggleAutoStats, derivedState = "fresh", statsError = "", onRebuildStats, onReload }: SettingsViewProps) {
  const { t, pick, locale } = useSettingsCopy();
  // 每个面板自己订阅：快练设置这类只经内存快照通知的改动，会让本面板重渲染并顺带重读一次存储。
  const snapshot = useStorageSnapshot();
  const { setTheme } = useUiTheme();
  const { setSkin } = useUiSkin();
  const { setMotion } = useUiMotion();
  const [, updateQuick] = useQuickSettings();
  const env = useRemoteJson<SettingsConnectionStatus>("/api/settings/connection", true);
  const bridge = useRemoteJson<CodexRuntimeStatus>("/api/dojo/runtime", true);
  const now = useMinuteClock();
  const [armed, setArmed] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const armTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (armTimer.current) window.clearTimeout(armTimer.current);
  }, []);

  const minutes = minutesSince(connection.fetchedAt, now);
  const syncedAt = connection.fetchedAt
    ? `${new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" }).format(connection.fetchedAt)} JST`
    : t("尚未同步");
  const syncedDetail = minutes === null ? syncedAt
    : `${syncedAt} · ${minutes < 1 ? t("刚刚") : t("{count} 分钟前", { count: minutes })}`;
  const broken = !connection.ok || Boolean(connection.error);
  const connectionTone = broken ? "danger" : connection.loading ? "pending" : "ok";
  const connectionLabel = broken ? t("连接中断") : connection.loading ? t("读取中") : t("已连接");
  const errorKind = connection.error ? describeConnectionError(connection.error).kind : null;
  const obsidian = env.data?.obsidian;
  const bridgeStatus = bridge.data?.bridge;
  const bridgeOk = bridgeStatus ? BRIDGE_READY.has(bridgeStatus) : false;
  const bridgeError = truncateBridgeError(bridge.data?.lastError || bridge.error);

  const resetPreferences = () => {
    // 侧栏要先改属性：RailToggle 收到事件时读的是 <html data-rail>。
    document.documentElement.dataset.rail = "expanded";
    for (const key of removablePreferenceKeys()) writeLocal(key, null);
    // 这几项读取方在内存里另有快照，删键不够，走各自的 setter 写回默认。
    updateQuick({ ...DEFAULT_QUICK_SETTINGS });
    setMotion(DEFAULT_UI_MOTION);
    setSkin(DEFAULT_UI_SKIN);
    setTheme(DEFAULT_UI_THEME);
    if (!autoStats) onToggleAutoStats();
  };

  const onReset = () => {
    if (armTimer.current) window.clearTimeout(armTimer.current);
    if (!armed) {
      setArmed(true);
      setResetDone(false);
      // 第二下要在 5 秒内点：隔太久的一下不算确认，免得回来随手一点就清掉。
      armTimer.current = window.setTimeout(() => setArmed(false), 5_000);
      return;
    }
    armTimer.current = null;
    setArmed(false);
    resetPreferences();
    setResetDone(true);
  };

  return (
    <div className="settings-columns">
      <SettingsCard title={t("Obsidian 连接")}>
        <Facts items={[
          { term: t("状态"), detail: <span className="settings-state" data-tone={connectionTone}><i aria-hidden="true" />{connectionLabel}</span> },
          { term: t("最后同步"), detail: syncedDetail },
          {
            term: t("地址"),
            detail: env.loading && !env.data ? t("读取中")
              : obsidian ? (obsidian.host ? <code>{obsidian.host}:{obsidian.port}</code> : t("未能解析地址"))
                : t("读取失败"),
          },
          {
            term: t("密钥已配置"),
            detail: obsidian ? (obsidian.keyConfigured ? t("是") : t("否")) : "—",
          },
          {
            term: t("vault 路径变量"),
            detail: env.data ? (env.data.vaultPathConfigured ? t("网页进程已读到") : t("网页进程未读到")) : "—",
          },
        ]} />
        {errorKind && (
          <p className="settings-alert" role="status">
            <strong>{t(errorKind === "credentials" ? "连接错误：凭证" : errorKind === "unreachable" ? "连接错误：连不上" : "连接错误：其他")}</strong>
            <span>{truncateBridgeError(connection.error, 140)}</span>
          </p>
        )}
        <div className="settings-actions">
          {onReload && <button type="button" className="settings-button" disabled={connection.loading} onClick={onReload}>{t("重新读取")}</button>}
          <button type="button" className="settings-button" disabled={env.loading} onClick={env.refresh}>{t("重新检测地址")}</button>
        </div>
        <p className="settings-note">{t("密钥不显示说明")}</p>
      </SettingsCard>

      {/* 右列两张短卡叠放，和左边较高的连接卡对齐，不在桥接卡旁边留出一整块空白。 */}
      <div className="settings-stack">
        <SettingsCard title={t("派生统计")}>
          <Facts items={[
            {
              term: t("状态"),
              detail: (
                <span className="settings-state" data-tone={derivedState === "fresh" ? "ok" : derivedState === "rebuilding" ? "pending" : "warning"}>
                  <i aria-hidden="true" />
                  {t(derivedState === "fresh" ? "已是最新" : derivedState === "rebuilding" ? "重算中" : "待重算")}
                </span>
              ),
            },
            ...(statsError ? [{ term: t("上次失败"), detail: truncateBridgeError(statsError, 140) }] : []),
          ]} />
          <SettingRow title={t("写入后自动重算")} hint={t("写入后自动重算说明")}>
            <Switch checked={autoStats} label={t("写入后自动重算")} onChange={() => onToggleAutoStats()} />
          </SettingRow>
          <SettingRow title={t("立即重算")} hint={t("立即重算说明")}>
            <button
              type="button"
              className="settings-button"
              disabled={!onRebuildStats || derivedState === "rebuilding"}
              onClick={() => onRebuildStats?.()}
            >
              {derivedState === "rebuilding" ? t("重算中") : t("立即重算")}
            </button>
          </SettingRow>
        </SettingsCard>

        <SettingsCard title={t("Codex 桥接")}>
          <Facts items={[
            {
              term: t("状态"),
              detail: bridge.loading && !bridge.data
                ? t("检测中")
                : <span className="settings-state" data-tone={bridgeOk ? "ok" : "danger"}><i aria-hidden="true" />{bridgeOk ? t("可用") : t("不可用")}</span>,
            },
            ...(bridgeError && !bridgeOk ? [{ term: t("最近错误"), detail: bridgeError }] : []),
          ]} />
          <div className="settings-actions">
            <button type="button" className="settings-button" disabled={bridge.loading} onClick={bridge.refresh}>{t("重新检测")}</button>
          </div>
          <p className="settings-note">{t("Codex 桥接说明")}</p>
        </SettingsCard>
      </div>

      <SettingsCard title={t("本机存储")} note={t("本机存储说明")} wide>
        <ul className="settings-storage">
          {UI_PREFERENCES.map((item) => {
            const state = preferenceState(item, snapshot);
            return (
              <li key={item.key}>
                <span className="settings-storage-name">
                  <strong>{pick(item.label)}</strong>
                  <code>{item.key}</code>
                </span>
                <span className="settings-storage-state" data-state={state}>{t(STATE_COPY[state])}</span>
              </li>
            );
          })}
        </ul>
        <div className="settings-actions">
          <button type="button" className={`settings-button${armed ? " is-armed" : ""}`} onClick={onReset} aria-live="polite">
            {armed ? t("再点一次确认恢复") : t("恢复界面偏好默认值")}
          </button>
          {resetDone && <Receipt text={t("已恢复界面偏好默认值")} />}
        </div>
        <p className="settings-note">{t("恢复默认不碰")}</p>
      </SettingsCard>
    </div>
  );
}

// ── 快捷键 ────────────────────────────────────────────────────

function ShortcutsPanel() {
  const { pick } = useSettingsCopy();
  return (
    <div className="settings-keys-grid">
      {SHORTCUT_GROUPS.map((group) => (
        <section key={group.id} className="settings-card settings-keys" aria-labelledby={`settings-keys-${group.id}`}>
          <header className="settings-card-head">
            <h3 id={`settings-keys-${group.id}`}>{pick(group.title)}</h3>
            <p>{pick(group.scope)}</p>
          </header>
          <dl>
            {group.entries.map((entry) => (
              <div key={entry.id}>
                <dt>{entry.keys.map((key) => <kbd key={key}>{key}</kbd>)}</dt>
                <dd>{pick(entry.label)}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

// ── 页面 ──────────────────────────────────────────────────────

export default function SettingsView(props: SettingsViewProps) {
  const { t } = useSettingsCopy();
  const [tab, setTab] = useUrlState<SettingsTab>("tab", DEFAULT_SETTINGS_TAB, TAB_CODEC);
  const tabRefs = useRef(new Map<SettingsTab, HTMLButtonElement>());

  // 竖排标签：↑↓ 换组、Home / End 到首尾。只挂在标签按钮上，不抢别处的方向键。
  const onTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const index = SETTINGS_TABS.indexOf(tab);
    const target = event.key === "ArrowDown" ? SETTINGS_TABS[(index + 1) % SETTINGS_TABS.length]
      : event.key === "ArrowUp" ? SETTINGS_TABS[(index - 1 + SETTINGS_TABS.length) % SETTINGS_TABS.length]
        : event.key === "Home" ? SETTINGS_TABS[0]
          : event.key === "End" ? SETTINGS_TABS[SETTINGS_TABS.length - 1]
            : null;
    if (!target) return;
    event.preventDefault();
    setTab(target);
    tabRefs.current.get(target)?.focus();
  };

  const copy = TAB_COPY[tab];
  return (
    <section className="settings-view">
      <h1 className="sr-only">{t("设置")}</h1>
      <nav className="settings-nav" aria-label={t("设置分组")}>
        <div className="settings-tabs" role="tablist" aria-orientation="vertical" aria-label={t("设置分组")}>
          {SETTINGS_TABS.map((id) => (
            <button
              key={id}
              ref={(node) => {
                if (node) tabRefs.current.set(id, node);
                else tabRefs.current.delete(id);
              }}
              type="button"
              role="tab"
              id={`settings-tab-${id}`}
              aria-selected={tab === id}
              aria-controls="settings-panel"
              tabIndex={tab === id ? 0 : -1}
              className="settings-tab"
              onClick={() => setTab(id)}
              onKeyDown={onTabKeyDown}
            >
              <strong>{t(TAB_COPY[id].label)}</strong>
              <small>{t(TAB_COPY[id].caption)}</small>
            </button>
          ))}
        </div>
        <p className="settings-nav-note">{t("仅本机说明")}</p>
      </nav>
      <div className="settings-panel" role="tabpanel" id="settings-panel" aria-labelledby={`settings-tab-${tab}`} data-tab={tab}>
        <header className="settings-panel-head">
          <h2>{t(copy.label)}</h2>
          <p>{t(copy.summary)}</p>
        </header>
        {tab === "appearance" && <AppearancePanel />}
        {tab === "locale" && <LocalePanel />}
        {tab === "training" && <TrainingPanel />}
        {tab === "career" && <CareerPanel />}
        {tab === "library" && <LibraryPanel />}
        {tab === "gesture" && <GesturePanel />}
        {tab === "data" && <DataPanel {...props} />}
        {tab === "shortcuts" && <ShortcutsPanel />}
      </div>
    </section>
  );
}
