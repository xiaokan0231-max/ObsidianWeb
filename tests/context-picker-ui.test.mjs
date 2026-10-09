import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAppModule } from "./helpers/render-tsx.mjs";
import { readAppCss } from "./css-source.mjs";

const source = await readFile(new URL("../app/context-picker.tsx", import.meta.url), "utf8");
const session = await readFile(new URL("../app/interview-session.tsx", import.meta.url), "utf8");
const components = await loadAppModule("app/context-picker.tsx");
const render = (component, props) => renderToStaticMarkup(createElement(component, props));

const TODAY = "2026-09-23";
const item = (id, overrides = {}) => ({ id, kind: "case", company: "株式会社テスト", title: "データエンジニア", status: "応募済", tone: "progress", assessed: false, eventAt: "", rounds: 0, updatedOn: "2026-09-01", haystack: "", ...overrides });
const groups = [
  { id: "upcoming", label: "即将面谈", hint: "按日期先后", collapsible: false, items: [item("context:a.md", { status: "面接中", tone: "interview", eventAt: "2026-09-24 13:00", rounds: 2, assessed: true })] },
  { id: "active", label: "选考进行中", hint: "面接中 · 内定 · 書類通過 · 応募済", collapsible: false, items: [item("context:b.md", { company: "株式会社サンプル", title: "SRE" }), item("context:m.md", { kind: "meeting", company: "株式会社ダミー", title: "カジュアル面談", status: "", tone: "meeting" })] },
  { id: "closed", label: "已结束", hint: "不採用与已完成的面谈", collapsible: true, items: Array.from({ length: 40 }, (_, index) => item(`context:closed-${index}.md`, { company: `株式会社終了${index}`, status: "不採用", tone: "reject" })) },
  { id: "legacy", label: "历史准备稿", hint: "尚未关联案件或面谈正本", collapsible: false, items: [item("series:old", { kind: "series", company: "旧社", title: "历史准备", status: "", tone: "neutral", rounds: 1 })] },
];

test("触发器把当前项的公司、岗位、状态和下一场日期直接写出来，不再只靠一行 option 文案", () => {
  const html = render(components.default, { groups, selectedId: "context:a.md", today: TODAY, onSelect() {} });
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /<strong>株式会社テスト<\/strong><span>データエンジニア<\/span>/);
  assert.match(html, /class="co-context-pill">面接中</);
  assert.match(html, /<time[^>]*>明天 13:00<\/time>/);
  assert.match(html, /已评估/);
  assert.match(html, /2 轮/);
  assert.doesNotMatch(html, /role="dialog"/, "未点开时不渲染面板");
  const empty = render(components.default, { groups, selectedId: "", today: TODAY, onSelect() {} });
  assert.match(empty, /请选择公司／岗位或面谈/);
  assert.match(empty, /co-context-trigger empty/);
  const meeting = render(components.default, { groups, selectedId: "context:m.md", today: TODAY, onSelect() {} });
  assert.match(meeting, /公司／岗位或面谈 · 面谈/);
  assert.match(meeting, /class="co-context-pill">面谈</);
});

test("面板按组渲染，已结束默认折叠只剩组头和数量，当前项标 aria-selected", () => {
  const html = render(components.ContextPickerPanel, { groups, selectedId: "context:b.md", today: TODAY, onSelect() {}, onClose() {} });
  assert.match(html, /role="dialog"[^>]*aria-label="切换公司、案件或面谈"/);
  assert.match(html, /共 44 项 · 已结束 40 默认折叠/);
  assert.match(html, /role="combobox"[^>]*aria-controls="[^"]+-list"/);
  assert.match(html, /aria-activedescendant="[^"]+"/, "输入框指向当前活动项");
  assert.match(html, /role="listbox"/);
  for (const label of ["当前", "即将面谈", "选考进行中", "已结束", "历史准备稿"]) assert.match(html, new RegExp(`<span>${label}<b>\\d+</b></span>`));
  assert.match(html, /aria-expanded="false"[^>]*>显示 40 项</, "已结束只留展开按钮");
  assert.doesNotMatch(html, /株式会社終了0/, "折叠组的项不渲染");
  assert.equal((html.match(/role="option"/g) ?? []).length, 4);
  assert.match(html, /<span>当前<b>1<\/b><\/span>[\s\S]*?role="option" aria-selected="true"[^>]*class="co-context-option tone-progress current active"/, "当前项钉在顶部");
  assert.match(html, /<span>选考进行中<b>1<\/b><\/span>/, "当前项从原组拿掉，不重复");
  assert.match(html, /<b class="co-context-current" aria-hidden="true">当前<\/b>/);
  assert.match(html, /co-context-option tone-meeting/);
  assert.match(html, /class="co-context-pill">历史准备稿</);
});

test("当前项在已结束里时，钉在顶部即可看见自己在哪，已结束仍保持折叠", () => {
  const html = render(components.ContextPickerPanel, { groups, selectedId: "context:closed-3.md", today: TODAY, onSelect() {}, onClose() {} });
  assert.match(html, /<span>当前<b>1<\/b><\/span>[\s\S]*?株式会社終了3/);
  assert.match(html, /<span>已结束<b>39<\/b><\/span>/, "已结束的计数不含钉走的当前项");
  assert.match(html, /aria-expanded="false"[^>]*>显示 39 项</);
  assert.doesNotMatch(html, /株式会社終了4/);
  assert.equal((html.match(/role="option"/g) ?? []).length, 5);
});

test("键盘契约与页面接线：上下键、Enter、Esc 都在，旧的 select 已经从本场面试页移除", () => {
  assert.match(source, /event\.key === "ArrowDown"/);
  assert.match(source, /event\.key === "ArrowUp"/);
  assert.match(source, /event\.key === "Enter"/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /event\.key === "ArrowDown" \|\| event\.key === "ArrowUp"\) \{ event\.preventDefault\(\); setOpen\(true\)/, "触发器方向键可打开");
  assert.match(source, /useDialogFocus\(dialogRef, true\)/, "与公司对比选择器同样隔离外层焦点");
  assert.match(source, /refocusPending = false;\s*triggerRef\.current\?\.focus\(\{ preventScroll: true \}\)/, "外壳重挂载后焦点仍回到触发器");
  assert.match(session, /<ContextPicker groups=\{pickerGroups\}/);
  assert.match(session, /buildContextPickerGroups\(\{ contexts, series, docs, docContexts, today \}\)/);
  assert.doesNotMatch(session, /co-context-picker/);
  assert.doesNotMatch(session, /<label className="co-context-picker">/, "公司总览与 v2 头部不再用原生 select");
});

test("样式：触发器、分组头、选项和面谈色都有定义，旧的 select 样式已删", async () => {
  const css = await readAppCss();
  for (const selector of [".co-context-trigger {", ".co-context-group h3 {", ".co-context-option {", ".co-context-option.current {", ".tone-meeting {", ".co-context-meta .co-context-pill {"]) assert.ok(css.includes(selector), selector);
  assert.ok(!css.includes(".co-context-picker select"), "旧 select 样式已删");
});
