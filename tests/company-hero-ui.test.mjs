import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as model from "../lib/company-hero.ts";
import { readAppCss } from "./css-source.mjs";

const source = await readFile(new URL("../app/company-hero.tsx", import.meta.url), "utf8");
const session = await readFile(new URL("../app/interview-session.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const require = createRequire(import.meta.url);
const components = {};
runInNewContext(compiled.outputText, { exports: components, require: (specifier) => specifier === "@/lib/company-hero" ? model : require(specifier) });
const render = (props) => renderToStaticMarkup(createElement(components.default, { rounds: [], today: "2026-09-26", fallbackCompany: "", onOpen() {}, ...props }));

const makeNote = (path, frontmatter, content = "# 株式会社テスト — データエンジニア") => ({ path, frontmatter, content, tags: [], stat: { ctime: 0, mtime: 0, size: 0 } });
const caseNote = makeNote("20_求職/テスト/データエンジニア.md", {
  type: "job-case", case_id: "test", origin: "scout", company: "株式会社テスト",
  status: "書類通過（2026-09-22・Green／企業がカジュアル面談を打診）", status_updated: "2026-09-22", channel: "Green",
  next_action: "予約URLで面談日時を確定する", salary: "800万円 ～ 1200万円", employment: "不明（求人原文未取得）", location: "東京都・リモート可", date: "2026-09-23",
  url: "https://example.com/job", stack: ["Python", "Spark"], next_event_at: "2026-09-27 13:00", waiting_for: "company", waiting_label: "企業の返信",
});
const context = (note, overrides = {}) => ({ key: `case:${note.path}`, kind: "case", note, company: "株式会社テスト", title: "データエンジニア", caseId: "test", dossier: null, profile: null, assessment: null, profileStatus: "missing", assessmentStatus: "missing", issues: [], ...overrides });

test("社名行：衬线 h1 里法人格降为小字、状态胶囊紧跟其后；岗位、进度行、条件行、链接、此刻行依次排下", () => {
  const html = render({ context: context(caseNote) });
  assert.match(html, /<p class="co-kicker" title="入库 2026-09-23 · Scout">公司画像 · 案件<\/p>/);
  assert.match(html, /<div class="co-hero-title-row"><h1 class="co-hero-name" lang="ja"><small class="co-hero-prefix">株式会社<\/small>テスト<\/h1><em class="co-hero-pill tone-progress" title="2026-09-22・Green／企業がカジュアル面談を打診">書類通過<\/em><\/div>/);
  assert.match(html, /<p class="co-context-title" title="データエンジニア">データエンジニア<\/p>/);
  assert.match(html, /<ul class="co-hero-progress" aria-label="选考进度"><li><span>経路<\/span><b>Green<\/b><\/li><li><span>更新<\/span><b title="2026-09-22">9\/22 · 4日前<\/b><\/li><li class="co-hero-note"><b title="[^"]+">2026-09-22・Green／企業がカジュアル面談を打診<\/b><\/li><\/ul>/);
  assert.match(html, /<div class="salary"><dt>年収<\/dt><dd title="800万円 ～ 1200万円">800〜1200万<\/dd><\/div>/);
  assert.match(html, /<div><dt>勤務地<\/dt><dd>東京都・リモート可<\/dd><\/div>/);
  assert.match(html, /<div class="muted"><dt>雇用形態<\/dt><dd title="不明（求人原文未取得）">不明<\/dd><\/div>/);
  assert.match(html, /<div class="muted"><dt>応募优先度<\/dt><dd title="未採点（求人原文を読んでいない）">未採点<\/dd><\/div>/);
  assert.match(html, /<ul class="co-hero-links" aria-label="打开"><li><a href="https:\/\/example.com\/job" target="_blank" rel="noopener noreferrer">求人原文 ↗<\/a><i class="co-hero-badge quiet">未核对<\/i><\/li><li><button type="button">案件记录 ↗<\/button><\/li><\/ul>/);
  assert.match(html, /<p class="co-hero-now" title="予約URLで面談日時を確定する · 等待企业 · 企業の返信 · 面談 明天 13:00"><span class="co-hero-now-label">下一步<\/span><span class="co-hero-now-seg action">予約URLで面談日時を確定する<\/span><span class="co-hero-now-seg">等待企业 · 企業の返信<\/span><span class="co-hero-now-seg event">面談 明天 13:00<\/span><\/p>/);
  assert.doesNotMatch(html, /co-hero-mark|co-hero-band|co-hero-stack|公司卷宗/, "首字徽标、五格行动带、技术栈、卷宗链接都不在头部");
});

test("此刻行的空态分档：跟进过期整行转橙；选考进行中全空显示未記録；未応募全空整行不渲染", () => {
  const overdue = render({ context: context(makeNote("o.md", { ...caseNote.frontmatter, next_action: "", next_event_at: "", follow_up_at: "2026-09-07" })) });
  assert.match(overdue, /<p class="co-hero-now overdue" title="等待企业 · 企業の返信 · 跟进 9\/7 · 已过 19 天"><span class="co-hero-now-label">下一步<\/span><span class="co-hero-now-seg">等待企业 · 企業の返信<\/span><span class="co-hero-now-seg overdue-seg">跟进 9\/7 · 已过 19 天<\/span><\/p>/);
  const empty = render({ context: context(makeNote("e.md", { ...caseNote.frontmatter, next_action: "", next_event_at: "", waiting_for: "", waiting_label: "" })) });
  assert.match(empty, /<p class="co-hero-now muted"><span class="co-hero-now-label">下一步<\/span><span class="co-hero-now-seg">未記録<\/span><\/p>/);
  const unapplied = render({ context: context(makeNote("u.md", { ...caseNote.frontmatter, status: "未応募", status_updated: "", next_action: "", next_event_at: "", waiting_for: "", waiting_label: "", channel: "" })) });
  assert.doesNotMatch(unapplied, /co-hero-now/);
  assert.match(unapplied, /<ul class="co-hero-progress" aria-label="选考进度"><li><span>入库<\/span><b title="2026-09-23">9\/23<\/b><\/li>/, "未応募没有経路也没有来源：只剩入库日兜底，不染橙");
  assert.doesNotMatch(unapplied, /class="warn"/);
  const stale = render({ context: context(makeNote("s.md", { ...caseNote.frontmatter, next_event_at: "2026-09-10 10:00", channel: "" })) });
  assert.match(stale, /<span class="co-hero-now-seg past">面談 9\/10 10:00 · 已过・待更新<\/span>/);
  assert.match(stale, /<li class="warn"><span>経路<\/span><b title="[^"]+">未記録<\/b><\/li>/, "応募済以降没写 channel 染橙");
});

test("没有正本时退回旧的空壳：只有公司名与引导句，社名同样拆法人格，不渲染进度与此刻行", () => {
  const html = render({ context: null, fallbackCompany: "株式会社テスト", fallbackTitle: "一次面接" });
  assert.match(html, /class="co-hero co-hero-empty"/);
  assert.match(html, /<h1 class="co-hero-name" lang="ja"><small class="co-hero-prefix">株式会社<\/small>テスト<\/h1>/);
  assert.match(html, /class="co-context-title">一次面接</);
  assert.match(render({ context: null, fallbackCompany: "Sample Inc." }), /<h1 class="co-hero-name">Sample<span class="co-hero-sep"> <\/span><small class="co-hero-suffix">Inc.<\/small><\/h1>/, "英文社名不标 lang=ja；原文空格留在文本里");
  assert.doesNotMatch(html, /co-hero-progress|co-hero-facts|co-hero-now|co-hero-pill/);
  assert.match(render({ context: null }), /<h1 class="co-hero-name">公司总览<\/h1>[\s\S]*选择一个真实案件或面谈/, "占位「公司总览」不标 lang=ja");
});

test("面谈：胶囊用面谈色，进度行放日時／期限／类别与面谈记录链接，没有条件行，此刻行只有下一步", () => {
  const note = makeNote("20_求職/_TODO/テスト_面談.md", { type: "todo", status: "進行中", category: "面接準備", company: "株式会社テスト", next_event_at: "2026-09-26 15:00", due: "2026-09-26", action: "逆質問を用意する" }, "# 株式会社テスト 面談");
  const html = render({ context: context(note, { kind: "meeting", key: `meeting:${note.path}`, title: "カジュアル面談" }) });
  assert.match(html, /<p class="co-kicker">公司画像 · 面谈<\/p>/);
  assert.match(html, /<em class="co-hero-pill tone-meeting" title="進行中">面谈<\/em>/);
  assert.match(html, /<ul class="co-hero-progress" aria-label="面谈安排"><li><span>日時<\/span><b title="2026-09-26 15:00">今天 15:00<\/b><\/li><li><span>期限<\/span><b title="2026-09-26">9\/26<\/b><\/li><li><b>面接準備<\/b><\/li><li class="co-hero-progress-link"><button type="button">面谈记录 ↗<\/button><\/li><\/ul>/);
  assert.doesNotMatch(html, /co-hero-facts|年収|経路|応募优先度|案件记录/);
  assert.match(html, /<span class="co-hero-now-seg action">逆質問を用意する<\/span>/);
});

test("页面接线：公司总览壳的头部用新组件、壳上带状态色类；样式选择器齐全，旧的徽标与行动带样式已删", async () => {
  assert.match(session, /<div className=\{`co-shell\$\{context \? ` tone-\$\{companyHeroTone\(context, today\)\}` : ""\}`\}><header className="co-shell-head"><CompanyHeroCard context=\{context\} rounds=\{contextRounds\} today=\{today\}/);
  assert.match(session, /docs\.filter\(\(doc\) => docContexts\.get\(doc\.note\.path\)\?\.key === context\.key\)/);
  assert.doesNotMatch(session, /<p className="co-kicker">公司画像\{context\?\.kind/, "旧的三行头部已被替换");
  const css = await readAppCss();
  for (const selector of [".co-shell { background: #fffefa; border-top: 3px solid var(--tone-bar, var(--green));", ".co-shell-controls .co-header-actions { align-self: end; }", ".co-shell-head .co-context-trigger .co-context-main strong {", ".co-hero-title-row {", ".co-hero-name .co-hero-prefix {", ".co-hero-name .co-hero-sep {", ".co-hero-link-missing {", ".co-shell-head h1.co-hero-name {", ".co-hero-name small {", ".co-hero-pill {", ".co-hero-progress li + li::before {", ".co-hero-progress .warn b {", ".co-hero-facts .salary dd {", ".co-hero-links :is(a,button) {", ".co-hero-badge.warn {", ".co-hero-now {", ".co-hero-now.overdue {", "--tone-bar: #12646a"]) assert.ok(css.includes(selector), selector);
  for (const stale of [".co-hero-mark", ".co-hero-band", ".co-hero-cell", ".co-hero-stack", ".co-hero-waiting", ".co-hero-remote", ".co-hero-links .muted", "small:first-child", ".co-shell-head .co-context-main strong {", "text-wrap: balance; overflow-wrap"]) assert.ok(!css.includes(stale), `${stale} 已删`);
});
