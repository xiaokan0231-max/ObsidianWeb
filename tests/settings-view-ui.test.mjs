import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JOB_STATUSES } from "../lib/job-status.ts";
import { SHORTCUT_GROUPS } from "../lib/shortcuts.ts";
import { UI_SKINS } from "../lib/ui-theme.ts";
import { SETTINGS_TABS, UI_PREFERENCES } from "../lib/ui-settings.ts";
import { loadAppModule } from "./helpers/render-tsx.mjs";

/*
 * 设置页 SSR 渲染：每个分组、中日两种界面语言。外壳的 ui-locale / ui-theme 用桩替换，
 * 首帧（服务端快照）一律按默认值渲染，挂载后才读本机存储——这里断言的正是首帧。
 */

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const baseProps = {
  connection: { ok: true, loading: false, fetchedAt: Date.UTC(2026, 9, 6, 3, 5), error: "" },
  autoStats: true,
  onToggleAutoStats() {},
  derivedState: "fresh",
  statsError: "",
  onRebuildStats() {},
  onReload() {},
};

async function renderSettings(tab, { locale = "zh-CN", theme = "dark", skin = "default", props = {} } = {}) {
  const { default: SettingsView } = await loadAppModule("app/settings-view.tsx", {
    stubs: {
      "./ui-locale": { useUiLocale: () => ({ locale, setLocale() {} }) },
      "./ui-theme": {
        useUiTheme: () => ({ theme, setTheme() {} }),
        useUiSkin: () => ({ skin, setSkin() {} }),
        useUiMotion: () => ({ motion: "system", setMotion() {} }),
      },
    },
    globals: {
      window: {
        location: { pathname: "/settings", search: tab ? `?tab=${tab}` : "", hash: "" },
        localStorage: { getItem: () => null },
      },
    },
  });
  return renderToStaticMarkup(createElement(SettingsView, { ...baseProps, ...props }));
}

const count = (html, pattern) => (html.match(pattern) ?? []).length;

test("左侧八个分组，?tab= 决定选中与内容；认不出的值落回外观", async () => {
  for (const tab of SETTINGS_TABS) {
    const html = await renderSettings(tab);
    assert.equal(count(html, /role="tab"/g), 8, tab);
    assert.match(html, new RegExp(`id="settings-tab-${tab}"[^>]*aria-selected="true"`), tab);
    assert.equal(count(html, /aria-selected="true"/g), 1, tab);
    assert.match(html, new RegExp(`data-tab="${tab}"`));
    assert.match(html, /role="tabpanel"/);
  }
  assert.match(await renderSettings("section"), /data-tab="appearance"/);
  assert.match(await renderSettings(null), /data-tab="appearance"/);
});

test("中日两种界面语言下分组名与说明都翻译", async () => {
  const zh = await renderSettings("appearance");
  const ja = await renderSettings("appearance", { locale: "ja" });
  for (const [cn, jp] of [["外观", "外観"], ["语言与地区", "言語と地域"], ["日语训练", "日本語トレーニング"], ["日历与求职", "カレンダーと求職"], ["资料库与阅读", "資料庫と閲覧"], ["星图手势", "星図ジェスチャー"], ["数据与连接", "データと接続"], ["快捷键", "ショートカット"]]) {
    assert.ok(zh.includes(cn), cn);
    assert.ok(ja.includes(jp), jp);
  }
  assert.match(zh, /不写 vault/);
  assert.match(ja, /vault には書きません/);
  assert.match(ja, /<h1 class="sr-only">設定<\/h1>/);
});

test("外观：六张皮肤卡，当前皮肤 aria-pressed，色块随当前明暗取", async () => {
  const dark = await renderSettings("appearance", { skin: "kaiyo" });
  assert.equal(count(dark, /data-skin-option="/g), 6);
  assert.equal(UI_SKINS.length, 6);
  assert.match(dark, /aria-pressed="true"[^>]*data-skin-option="kaiyo"/);
  assert.equal(count(dark, /class="settings-skin" aria-pressed="true"/g), 1);
  for (const meta of UI_SKINS) assert.ok(dark.includes(meta.name[0]), meta.id);
  const kaiyo = UI_SKINS.find((meta) => meta.id === "kaiyo");
  assert.ok(dark.includes(kaiyo.swatches.dark[0]));
  const light = await renderSettings("appearance", { skin: "kaiyo", theme: "light" });
  assert.ok(light.includes(kaiyo.swatches.light[0]));
  assert.ok(!light.includes(kaiyo.swatches.dark[0]));
  const ja = await renderSettings("appearance", { locale: "ja" });
  for (const meta of UI_SKINS) assert.ok(ja.includes(meta.name[1]), meta.id);

  // 明暗、减弱动效、字号五档、侧栏开关。
  assert.match(dark, /aria-label="明暗"[\s\S]*?aria-pressed="true"[^>]*>暗色/);
  assert.match(dark, />跟随系统</);
  assert.match(dark, />总是减弱</);
  for (const size of [16, 18, 20, 22, 24]) assert.match(dark, new RegExp(`>${size}px<`));
  assert.match(dark, /aria-pressed="true"[^>]*>18px</, "首帧按默认 18");
  assert.match(dark, /role="switch"[^>]*aria-checked="false"[^>]*aria-label="侧栏默认收起"/);
});

test("语言与地区：界面语言两档，时区与练习日只读", async () => {
  const html = await renderSettings("locale");
  assert.match(html, /<span lang="ja">日本語<\/span>/);
  assert.match(html, /日本时间（JST，UTC\+9）/);
  assert.match(html, /4:00 起算/);
  assert.match(html, /周一开始/);
  // lang 只在内层 span：首屏测试按「button 上 lang + aria-pressed」认顶栏语言开关，设置页不能冒充第二个。
  assert.doesNotMatch(html, /<button[^>]*\blang=/);
  const ja = await renderSettings("locale", { locale: "ja" });
  assert.match(ja, /日本時間（JST、UTC\+9）/);
});

test("日语训练：题数旁写明每日新题额度，自动下一题四档，复习规则只读", async () => {
  const html = await renderSettings("training");
  for (const size of [10, 20, 30]) assert.match(html, new RegExp(`>${size} 题<`));
  assert.match(html, /每日新题额度＝2×题数：现在每天最多引入 40 道新题/);
  assert.match(html, /role="switch"[^>]*aria-checked="true"[^>]*aria-label="打字题"/);
  assert.match(html, /aria-label="答对自动下一题"/);
  for (const label of ["关", "1 秒", "3 秒", "5 秒"]) assert.match(html, new RegExp(`>${label}<`));
  assert.match(html, /aria-pressed="true"[^>]*>1 秒</);
  assert.match(html, /首次答对后 3 天 → 7 天 → 30 天/);
  assert.match(html, /1 天后（次日）再出/);
  assert.match(html, /改动会改写全部进度，所以不开放修改/);
  const ja = await renderSettings("training", { locale: "ja" });
  assert.match(ja, /1日最大 40 問/);
  assert.match(ja, /変えると全ての進捗が書き換わる/);
});

test("日历与求职：七个合法 status 来自契约模块，正本路径只作文字", async () => {
  const html = await renderSettings("career");
  for (const status of JOB_STATUSES) assert.ok(html.includes(`<li lang="ja">${status}</li>`), status);
  assert.match(html, /合法值只有这 7 个/);
  assert.match(html, /<code>99_系统\/_数据字典\.md<\/code>/);
  assert.match(html, /等待企业回复与跟进日期不进日历/);
  assert.doesNotMatch(html, /href="[^"]*数据字典/);
  // 不在视图里手抄状态数组（domain-vocabulary 测试也会拦）。
  assert.doesNotMatch(read("app/settings-view.tsx"), /"応募済"|"書類通過"/);
});

test("资料库与阅读：各页默认视图沿用原页面的按钮名，首帧是各自默认", async () => {
  const html = await renderSettings("library");
  for (const label of ["卡片", "列表", "学习", "对照", "全文阅读", "按公司", "全部场次", "时间列表", "关系地图", "探索模式 · 3D"]) {
    assert.match(html, new RegExp(`>${label}<`), label);
  }
  assert.match(html, /aria-label="资料库布局"[^>]*><button type="button" aria-pressed="true">卡片/);
  assert.match(html, /aria-label="时间线默认显示"[^>]*><button type="button" aria-pressed="true">时间列表/);
  assert.match(html, /清空最近打开/);
  assert.match(html, /现在记着 0 篇/);
});

test("星图手势：开关、恢复默认灵敏度、只读阈值与校准说明", async () => {
  const html = await renderSettings("gesture");
  assert.match(html, /role="switch"[^>]*aria-checked="false"[^>]*aria-label="进入 3D 星图时自动开启手势"/);
  assert.match(html, /恢复默认灵敏度/);
  assert.match(html, />0\.46</);
  assert.match(html, />0\.68</);
  assert.match(html, /0\.46 \/ 0\.68/);
  assert.match(html, /重新校准需要摄像头/);
});

test("数据与连接：连接、统计、桥接与本机存储；密钥只说有没有配置", async () => {
  const html = await renderSettings("data");
  assert.match(html, /已连接/);
  assert.match(html, /12:05 JST/, "最后同步按日本时间显示");
  assert.match(html, />重新读取</);
  assert.match(html, /role="switch"[^>]*aria-checked="true"[^>]*aria-label="写入后自动重算"/);
  assert.match(html, />立即重算</);
  assert.match(html, /Codex 桥接/);
  assert.match(html, /只在服务端使用，这里只显示有没有配置/);
  for (const item of UI_PREFERENCES) assert.ok(html.includes(`<code>${item.key}</code>`), item.key);
  assert.match(html, />恢复界面偏好默认值</);
  assert.match(html, /练习进度、场景课草稿、教材读到的位置/);
  assert.doesNotMatch(html, /Bearer|OBSIDIAN_API_KEY|CODEX_BRIDGE_TOKEN/);

  const offline = await renderSettings("data", {
    props: { connection: { ok: false, loading: false, fetchedAt: null, error: "fetch failed ECONNREFUSED" }, derivedState: "stale", statsError: "spawn /Users/someone/bin/x ENOENT", onRebuildStats: undefined, onReload: undefined },
  });
  assert.match(offline, /连接中断/);
  assert.match(offline, /连不上 Obsidian 的 Local REST API/);
  assert.match(offline, /待重算/);
  assert.doesNotMatch(offline, /someone/, "错误里的本机路径要先去掉");
  assert.match(offline, /<button type="button" class="settings-button" disabled="">立即重算<\/button>/);
  assert.doesNotMatch(offline, />重新读取</);
});

test("快捷键：每组都列出来，中日两份说明", async () => {
  const html = await renderSettings("shortcuts");
  const ja = await renderSettings("shortcuts", { locale: "ja" });
  for (const group of SHORTCUT_GROUPS) {
    assert.ok(html.includes(group.title[0]), group.id);
    assert.ok(ja.includes(group.title[1]), group.id);
  }
  assert.match(html, /<kbd>⌘K<\/kbd>/);
  assert.match(html, /<kbd>Esc<\/kbd>/);
});

test("任何分组都不出现 textarea，也不往 lang 属性外泄", async () => {
  for (const tab of SETTINGS_TABS) {
    const html = await renderSettings(tab, { locale: "ja" });
    assert.doesNotMatch(html, /<textarea/, tab);
  }
});

test("文案：中日成对、占位符一致、视图用到的键都存在", async () => {
  const { SETTINGS_COPY } = await loadAppModule("app/settings-copy.ts", { stubs: { "./ui-locale": { useUiLocale: () => ({ locale: "zh-CN" }) } } });
  for (const [key, pair] of Object.entries(SETTINGS_COPY)) {
    assert.equal(pair.length, 2, key);
    assert.ok(pair[0].trim() && pair[1].trim(), key);
    const holes = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    assert.deepEqual(holes(pair[1]), holes(pair[0]), `${key} 的占位符中日不一致`);
  }
  const view = read("app/settings-view.tsx");
  const used = new Set([
    ...[...view.matchAll(/\bt\("([^"]+)"/g)].map((match) => match[1]),
    // TAB_COPY 一行三个键：分组名、左栏摘要、面板说明。
    ...[...view.matchAll(/\{ label: "([^"]+)", caption: "([^"]+)", summary: "([^"]+)" \}/g)].flatMap((match) => match.slice(1)),
  ]);
  assert.ok(used.size > 100, `只扫到 ${used.size} 个文案键`);
  for (const key of used) assert.ok(Object.hasOwn(SETTINGS_COPY, key), `settings-copy 里缺 ${key}`);
  assert.match(read("app/settings-copy.ts"), /as const satisfies Record<string, readonly \[string, string\]>/);
});

test("settings.css：只用语义 token、没有十六进制色、字号 ≥11px、不拿品牌橙当文字色", () => {
  const css = read("app/styles/settings.css");
  const base = read("app/styles/base.css");
  const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(code, /#[0-9a-f]{3,8}\b/i, "出现十六进制颜色");
  assert.doesNotMatch(code, /\b(rgb|rgba|hsl|hsla|oklch)\(/i, "出现字面量颜色函数");
  assert.doesNotMatch(code, /(^|[^-])\b(white|black)\b(?!-)/i, "出现颜色关键字");
  assert.doesNotMatch(code, /(?:^|[;{\s])color:\s*var\(--(brand|orange)\)/, "品牌橙当文字色");

  const tokens = new Set([...base.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((match) => match[1]));
  for (const [, name] of code.matchAll(/var\((--[a-z0-9-]+)/g)) {
    // --skin-*：皮肤卡小样的色块，由卡片内联给出；--chrome-top：外壳的顶栏高度。
    if (name.startsWith("--skin-") || name === "--chrome-top") continue;
    assert.ok(tokens.has(name), `${name} 不是 base.css 的 token`);
  }

  const sizes = [...code.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((match) => Number(match[1]));
  assert.ok(sizes.length > 10);
  for (const size of sizes) assert.ok(size >= 11, `字号 ${size}px < 11px`);
  const fonts = [...code.matchAll(/font:\s*\d+\s+(\d+)px/g)].map((match) => Number(match[1]));
  for (const size of fonts) assert.ok(size >= 11, `字号 ${size}px < 11px`);
  // 正文类（说明、事实值、快捷键说明）至少 13px。
  for (const selector of [".settings-row-copy p", ".settings-copy", ".settings-facts dd", ".settings-keys dd", ".settings-skin-copy small"]) {
    const block = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`).exec(code);
    assert.ok(block, selector);
    const size = Number(/font-size:\s*(\d+)px/.exec(block[1])?.[1]);
    assert.ok(size >= 13, `${selector} 正文字号 ${size}px`);
  }

  // 过渡只在没要求减弱动效时才有。
  const transitions = code.split("@media (prefers-reduced-motion: no-preference)");
  assert.doesNotMatch(transitions[0], /\btransition\s*:/, "减弱动效的媒体查询外出现了 transition");
  assert.match(transitions[1] ?? "", /:root:not\(\[data-motion="reduce"\]\)/);

  // 样式随设置页按需加载，不进全局首屏 CSS。
  assert.match(read("app/settings-view.tsx"), /import "\.\/styles\/settings\.css";/);
  assert.doesNotMatch(read("app/globals.css"), /settings\.css/);
});
