import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PINCH_ENVELOPE_DEFAULTS } from "../lib/hand-gesture.mjs";
import { RECENT_NOTES_KEY as RECENT_NOTES_SOURCE_KEY } from "../lib/recent-notes.ts";
import { UI_MOTION_KEY, UI_SKIN_COOKIE, UI_THEME_COOKIE, UI_THEME_EVENT } from "../lib/ui-theme.ts";
import {
  AUTO_STATS_EVENT,
  AUTO_STATS_KEY,
  DEFAULT_READING_FONT_SIZE,
  DEFAULT_SETTINGS_TAB,
  GRAPH_HAND_DEFAULT_THRESHOLDS,
  GRAPH_HAND_KEY,
  GRAPH_RENDERER_KEY,
  isDefaultPreference,
  isProgressKey,
  LIBRARY_LAYOUT_EVENT,
  LIBRARY_LAYOUT_KEY,
  minutesSince,
  parseAutoStats,
  parseGraphHandPreferences,
  parseGraphRenderer,
  parseLibraryLayout,
  parseRail,
  parseReadingFontSize,
  parseReviewIndexGroup,
  parseReviewMode,
  parseReviewNovelLanguage,
  parseTimelineRenderer,
  PROGRESS_STORAGE_PREFIXES,
  QUICK_SETTINGS_KEY,
  RAIL_EVENT,
  RAIL_KEY,
  READING_FONT_KEY,
  READING_FONT_SIZES,
  readCookie,
  RECENT_NOTES_KEY,
  removablePreferenceKeys,
  resetGraphHandSensitivity,
  resolveSettingsTab,
  REVIEW_EVENT,
  REVIEW_INDEX_GROUP_KEY,
  REVIEW_MODE_KEY,
  REVIEW_NOVEL_LANGUAGE_KEY,
  serializeAutoStats,
  settingsConnectionStatus,
  SETTINGS_TABS,
  TIMELINE_RENDERER_KEY,
  truncateBridgeError,
  UI_PREFERENCES,
  withGraphHandEnabled,
} from "../lib/ui-settings.ts";
import { loadAppModule } from "./helpers/render-tsx.mjs";

/*
 * 设置页是这些本机偏好的第二个入口：键名、取值与解析必须和原来的读取方一字不差，
 * 否则设置页显示「列表」而资料库按「卡片」渲染，两边各说各话。
 * 读取方导出了解析函数的直接比对；没导出的（组件私有）按源码契约核对。
 */

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const localeStub = { "./ui-locale": { useUiLocale: () => ({ locale: "zh-CN", setLocale() {} }) } };

test("键名与同页事件和各读取方一致", () => {
  const atlas = read("app/memory-atlas.tsx");
  assert.match(atlas, new RegExp(`const RAIL_STORAGE_KEY = "${RAIL_KEY}"`));
  assert.match(atlas, new RegExp(`const RAIL_EVENT = "${RAIL_EVENT}"`));
  assert.match(atlas, new RegExp(`const AUTO_STATS_KEY = "${AUTO_STATS_KEY}"`));
  assert.match(atlas, new RegExp(`const AUTO_STATS_EVENT = "${AUTO_STATS_EVENT}"`));
  // 首帧脚本也认同一个键与同一个取值。
  assert.match(read("app/layout.tsx"), new RegExp(`getItem\\("${RAIL_KEY}"\\)==="collapsed"`));

  const library = read("app/library-view.tsx");
  assert.match(library, new RegExp(`const LAYOUT_KEY = "${LIBRARY_LAYOUT_KEY}"`));
  assert.match(library, new RegExp(`const LAYOUT_EVENT = "${LIBRARY_LAYOUT_EVENT}"`));

  const review = read("app/interview-review.tsx");
  assert.match(review, new RegExp(`const MODE_KEY = "${REVIEW_MODE_KEY}"`));
  assert.match(review, new RegExp(`const NOVEL_LANG_KEY = "${REVIEW_NOVEL_LANGUAGE_KEY}"`));
  assert.match(review, new RegExp(`const INDEX_GROUP_KEY = "${REVIEW_INDEX_GROUP_KEY}"`));
  assert.match(review, new RegExp(`const MODE_EVENT = "${REVIEW_EVENT}"`));

  assert.match(read("app/timeline-view.tsx"), new RegExp(`getItem\\("${TIMELINE_RENDERER_KEY.replaceAll(".", "\\.")}"\\) === "corridor"`));
  assert.match(read("app/graph-view.tsx"), new RegExp(`getItem\\("${GRAPH_RENDERER_KEY.replaceAll(".", "\\.")}"\\) === "space"`));
  assert.match(read("app/graph-hand-controls.tsx"), new RegExp(`const ONBOARDING_STORAGE_KEY = "${GRAPH_HAND_KEY}"`));

  assert.equal(RECENT_NOTES_KEY, RECENT_NOTES_SOURCE_KEY);
});

test("快练设置键与快练页同一个（直接读 language-quick-sync 的导出）", async () => {
  const quick = await loadAppModule("app/language-quick-sync.ts", { stubs: localeStub });
  assert.equal(QUICK_SETTINGS_KEY, quick.QUICK_SETTINGS_KEY);
});

test("阅读字号与阅读层的 readFontSize 逐值一致", async () => {
  let stored = null;
  const reading = await loadAppModule("app/reading-mode.tsx", {
    stubs: localeStub,
    globals: { window: { localStorage: { getItem: () => stored } } },
  });
  assert.equal(READING_FONT_KEY, reading.FONT_KEY);
  for (const raw of [null, "", "16", "17", "18", "20", "22", "24", "26", "abc", "18.0", " 20 "]) {
    stored = raw;
    assert.equal(parseReadingFontSize(raw), reading.readFontSize(), `raw=${JSON.stringify(raw)}`);
  }
  assert.deepEqual([...READING_FONT_SIZES], [16, 18, 20, 22, 24]);
  assert.equal(DEFAULT_READING_FONT_SIZE, 18);
  // 阅读层按 ±2 调字号、夹在 16–24：五档正好是它能到达的全部值。
  assert.match(read("app/reading-mode.tsx"), /Math\.min\(24, Math\.max\(16, fontSize \+ delta\)\)/);
});

test("各枚举键的解析与读取方源码里的判断同形", () => {
  // 读取方源码里的判断原文：改了任何一边，这里就对不上。
  assert.match(read("app/memory-atlas.tsx"), /stored === null \? autoStatsFallback : stored !== "off"/);
  assert.match(read("app/library-view.tsx"), /getItem\(LAYOUT_KEY\) === "list" \? "list" : "card"/);
  const review = read("app/interview-review.tsx");
  assert.match(review, /value === "compare" \|\| value === "novel" \? value : "study"/);
  assert.match(review, /getItem\(NOVEL_LANG_KEY\) === "zh" \? "zh" : "ja"/);
  assert.match(review, /getItem\(INDEX_GROUP_KEY\) === "all" \? "all" : "company"/);
  assert.match(read("app/memory-atlas.tsx"), /dataset\.rail === "collapsed"/);

  assert.equal(parseRail("collapsed"), "collapsed");
  for (const raw of [null, "expanded", "", "Collapsed"]) assert.equal(parseRail(raw), "expanded");
  assert.equal(parseAutoStats(null), true);
  assert.equal(parseAutoStats("on"), true);
  assert.equal(parseAutoStats("off"), false);
  assert.equal(parseAutoStats("garbage"), true);
  assert.equal(serializeAutoStats(false), "off");
  assert.equal(serializeAutoStats(true), "on");
  assert.equal(parseLibraryLayout("list"), "list");
  assert.equal(parseLibraryLayout("grid"), "card");
  assert.equal(parseReviewMode("compare"), "compare");
  assert.equal(parseReviewMode("novel"), "novel");
  assert.equal(parseReviewMode("other"), "study");
  assert.equal(parseReviewNovelLanguage("zh"), "zh");
  assert.equal(parseReviewNovelLanguage("zh-CN"), "ja");
  assert.equal(parseReviewIndexGroup("all"), "all");
  assert.equal(parseReviewIndexGroup(null), "company");
  assert.equal(parseTimelineRenderer("corridor"), "corridor");
  assert.equal(parseTimelineRenderer("space"), "list");
  assert.equal(parseGraphRenderer("space"), "space");
  assert.equal(parseGraphRenderer("corridor"), "map");
});

test("星图手势存档：默认阈值、取舍规则与组件一致", () => {
  const source = read("app/graph-hand-controls.tsx");
  assert.match(source, new RegExp(`closeThreshold: ${GRAPH_HAND_DEFAULT_THRESHOLDS.closeThreshold},`));
  assert.match(source, new RegExp(`releaseThreshold: ${GRAPH_HAND_DEFAULT_THRESHOLDS.releaseThreshold},`));
  assert.match(source, /thresholds\.closeThreshold >= DEFAULT_THRESHOLDS\.closeThreshold/);
  assert.match(source, /thresholds\.releaseThreshold > thresholds\.closeThreshold/);
  assert.match(source, /envelope\.max - envelope\.min >= PINCH_ENVELOPE_DEFAULTS\.minSpan/);
  assert.match(source, /enabled: parsed\?\.enabled === true/);

  const empty = parseGraphHandPreferences(null);
  assert.deepEqual(empty, { seen: false, enabled: false, thresholds: { ...GRAPH_HAND_DEFAULT_THRESHOLDS }, customThresholds: false, envelope: null });
  assert.equal(parseGraphHandPreferences("{broken").enabled, false);

  // 比默认更宽松才采用；偏紧的旧标定落回默认（否则怎么捏都进不了按下状态）。
  const loose = parseGraphHandPreferences(JSON.stringify({ seen: true, enabled: true, thresholds: { closeThreshold: 0.5, releaseThreshold: 0.72, calibrated: true } }));
  assert.equal(loose.customThresholds, true);
  assert.equal(loose.thresholds.closeThreshold, 0.5);
  assert.equal(loose.enabled, true);
  const tight = parseGraphHandPreferences(JSON.stringify({ thresholds: { closeThreshold: 0.3, releaseThreshold: 0.5 } }));
  assert.equal(tight.customThresholds, false);
  assert.equal(tight.thresholds.closeThreshold, GRAPH_HAND_DEFAULT_THRESHOLDS.closeThreshold);

  const span = PINCH_ENVELOPE_DEFAULTS.minSpan;
  assert.deepEqual(parseGraphHandPreferences(JSON.stringify({ envelope: { min: 0.2, max: 0.25 + span } })).envelope, { min: 0.2, max: 0.25 + span });
  assert.equal(parseGraphHandPreferences(JSON.stringify({ envelope: { min: 0.2, max: 0.2 + span / 2 } })).envelope, null);
  // 存档写的正是默认值：被采用，但不算自定义。
  const stored = parseGraphHandPreferences(JSON.stringify({ thresholds: { ...GRAPH_HAND_DEFAULT_THRESHOLDS } }));
  assert.equal(stored.customThresholds, false);
});

test("手势开关只改 enabled；恢复默认灵敏度清掉阈值与区间、保留引导与开关", () => {
  const stored = JSON.stringify({ seen: true, enabled: false, thresholds: { closeThreshold: 0.5, releaseThreshold: 0.7 }, envelope: { min: 0.1, max: 0.5 } });
  const toggled = JSON.parse(withGraphHandEnabled(stored, true));
  assert.equal(toggled.enabled, true);
  assert.deepEqual(toggled.thresholds, { closeThreshold: 0.5, releaseThreshold: 0.7 });
  assert.deepEqual(toggled.envelope, { min: 0.1, max: 0.5 });
  assert.deepEqual(JSON.parse(withGraphHandEnabled(null, true)), { enabled: true });

  const reset = JSON.parse(resetGraphHandSensitivity(JSON.stringify({ ...JSON.parse(stored), enabled: true })));
  assert.deepEqual(reset, { seen: true, enabled: true, thresholds: { ...GRAPH_HAND_DEFAULT_THRESHOLDS } });
  const parsed = parseGraphHandPreferences(JSON.stringify(reset));
  assert.equal(parsed.customThresholds, false);
  assert.equal(parsed.envelope, null);
  assert.deepEqual(JSON.parse(resetGraphHandSensitivity("not json")), { seen: false, enabled: false, thresholds: { ...GRAPH_HAND_DEFAULT_THRESHOLDS } });
});

test("偏好登记表不含进度、草稿与浏览记录；恢复默认只删能直接删的键", () => {
  const keys = UI_PREFERENCES.map((item) => item.key);
  assert.equal(new Set(keys).size, keys.length, "键名不重复");
  for (const item of UI_PREFERENCES) {
    assert.ok(!isProgressKey(item.key), `${item.key} 是进度键`);
    assert.notEqual(item.key, RECENT_NOTES_KEY);
    assert.ok(item.label[0] && item.label[1], `${item.key} 缺中日名称`);
    assert.ok(SETTINGS_TABS.includes(item.tab));
  }
  // 进度类前缀：说过「言えた」、场景课草稿与答题、教材位置、表达课位置。
  for (const key of ["echo:said:20_求職/x.md", "echo:language-scenario:v1:course:1", "echo:language-scenario:v1:course:1:attempt:a", "obsidianweb:textbook-position:v1:ch1", "echo:language-expression-position:v1"]) {
    assert.ok(isProgressKey(key), key);
  }
  assert.equal(PROGRESS_STORAGE_PREFIXES.length, 4);

  const removable = removablePreferenceKeys();
  assert.ok(removable.includes(RAIL_KEY));
  assert.ok(removable.includes(LIBRARY_LAYOUT_KEY));
  assert.ok(removable.includes(GRAPH_HAND_KEY));
  // 读取方在内存里另有快照的、外壳持有的、cookie：删键不够，必须走各自的 setter。
  for (const key of [QUICK_SETTINGS_KEY, UI_MOTION_KEY, AUTO_STATS_KEY, UI_SKIN_COOKIE, UI_THEME_COOKIE, RECENT_NOTES_KEY]) {
    assert.ok(!removable.includes(key), key);
  }
  // 界面语言 cookie 不在表里：恢复默认不该把日语界面突然换回中文。
  assert.ok(!keys.includes("career-room-locale"));

  const events = Object.fromEntries(UI_PREFERENCES.filter((item) => item.event).map((item) => [item.key, item.event]));
  assert.equal(events[RAIL_KEY], RAIL_EVENT);
  assert.equal(events[LIBRARY_LAYOUT_KEY], LIBRARY_LAYOUT_EVENT);
  assert.equal(events[REVIEW_MODE_KEY], REVIEW_EVENT);
  assert.equal(events[AUTO_STATS_KEY], AUTO_STATS_EVENT);
  assert.equal(events[UI_SKIN_COOKIE], UI_THEME_EVENT);
});

test("存下的原值是否等于默认", () => {
  assert.equal(isDefaultPreference(RAIL_KEY, null), true);
  assert.equal(isDefaultPreference(RAIL_KEY, "expanded"), true);
  assert.equal(isDefaultPreference(RAIL_KEY, "collapsed"), false);
  assert.equal(isDefaultPreference(READING_FONT_KEY, "18"), true);
  assert.equal(isDefaultPreference(READING_FONT_KEY, "22"), false);
  assert.equal(isDefaultPreference(UI_SKIN_COOKIE, "default"), true);
  assert.equal(isDefaultPreference(UI_SKIN_COOKIE, "kaiyo"), false);
  assert.equal(isDefaultPreference(UI_THEME_COOKIE, "dark"), true);
  assert.equal(isDefaultPreference(UI_THEME_COOKIE, "light"), false);
  assert.equal(isDefaultPreference(UI_MOTION_KEY, "reduce"), false);
  assert.equal(isDefaultPreference(AUTO_STATS_KEY, "off"), false);
  assert.equal(isDefaultPreference(GRAPH_HAND_KEY, JSON.stringify({ seen: true, enabled: false })), true, "看过引导不算自定义");
  assert.equal(isDefaultPreference(GRAPH_HAND_KEY, JSON.stringify({ enabled: true })), false);
  assert.equal(isDefaultPreference(QUICK_SETTINGS_KEY, "{}"), null, "快练设置交给 app 侧解析");
});

test("连接状态只给 host:port 与布尔值，URL 里的认证段与密钥不出去", () => {
  const status = settingsConnectionStatus({
    OBSIDIAN_API_URL: "https://someone:hunter2@127.0.0.1:27124/vault?token=abc",
    OBSIDIAN_API_KEY: "test-obsidian-key-123",
    CODEX_BRIDGE_TOKEN: "test-bridge-token-456",
    OBSIDIAN_VAULT_PATH: "/tmp/test-vault",
  });
  assert.deepEqual(status, { obsidian: { host: "127.0.0.1", port: "27124", keyConfigured: true }, vaultPathConfigured: true });
  const text = JSON.stringify(status);
  for (const secret of ["someone", "hunter2", "abc", "test-obsidian-key-123", "test-bridge-token-456", "/tmp/test-vault", "https"]) {
    assert.ok(!text.includes(secret), secret);
  }
  // 没配地址用默认端口；协议默认端口补成数字；密钥是空白算没配。
  assert.deepEqual(settingsConnectionStatus({}), { obsidian: { host: "127.0.0.1", port: "27123", keyConfigured: false }, vaultPathConfigured: false });
  assert.equal(settingsConnectionStatus({ OBSIDIAN_API_URL: "https://localhost" }).obsidian.port, "443");
  assert.equal(settingsConnectionStatus({ OBSIDIAN_API_KEY: "   " }).obsidian.keyConfigured, false);
  // 写坏的地址不回显原文。
  assert.deepEqual(settingsConnectionStatus({ OBSIDIAN_API_URL: "not a url with-secret" }).obsidian, { host: "", port: "", keyConfigured: false });
});

test("桥接错误去掉本机路径再截断", () => {
  const message = "spawn /Users/someone/Library/codex/bin/codex ENOENT\n  at C:\\Users\\someone\\x.js and file:///home/someone/app.mjs";
  const masked = truncateBridgeError(message, 200);
  assert.ok(!masked.includes("someone"), masked);
  assert.match(masked, /^spawn … ENOENT at … and …$/);
  assert.equal(truncateBridgeError("x".repeat(200), 20).length, 20);
  assert.ok(truncateBridgeError("x".repeat(200), 20).endsWith("…"));
  assert.equal(truncateBridgeError(undefined), "");
});

test("分组、cookie 读取与相对时间", () => {
  assert.equal(SETTINGS_TABS.length, 8);
  assert.equal(resolveSettingsTab("data"), "data");
  assert.equal(resolveSettingsTab("section"), DEFAULT_SETTINGS_TAB);
  assert.equal(readCookie("a=1; career-room-skin=kaiyo; b=2", UI_SKIN_COOKIE), "kaiyo");
  assert.equal(readCookie("career-room-skinx=1", UI_SKIN_COOKIE), null);
  assert.equal(readCookie("", UI_THEME_COOKIE), null);
  assert.equal(minutesSince(null, 1_000_000), null);
  assert.equal(minutesSince(1_000, 0), null);
  assert.equal(minutesSince(0 + 60_000, 60_000 * 5 + 30_000), 4);
});
