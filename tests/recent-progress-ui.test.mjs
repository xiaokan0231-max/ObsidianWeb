import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildRecentProgress } from "../lib/recent-progress.ts";
import { loadAppModule } from "./helpers/render-tsx.mjs";

const today = "2026-10-05";
const fetchedAt = Date.parse("2026-10-05T01:20:00Z");
const note = (path, frontmatter, content = "") => ({ path, frontmatter, content, tags: [], stat: { ctime: 100, mtime: 999, size: 100 } });
const job = note("20_求職/株式会社テスト/案件.md", { type: "job-case", case_id: "test-case", company: "株式会社テスト", position: "データエンジニア", status: "応募済", status_updated: "2026-10-03", url: "https://example.test/jobs/one" });
const todo = note("20_求職/_TODO/本人確認.md", { type: "todo", status: "未着手", case_id: "test-case", action: "企業指定の確認項目を確認する", action_owner: "user", action_kind: "required", action_reviewed_at: "2026-10-04", action_reason: "本人だけが確認できるため", action_source: "https://example.test/messages/one" });
const work = note("20_求職/_記録/内部作業ログ.md", { type: "application_log", status: "completed", date: "2026-10-02", title: "秘密の指示タイトル" }, "# 内部指示本文は表示しない\n未公開の思考とメモ");
const draft = note("20_求職/_応募書類/下書き.md", { type: "outbound-draft", company: "株式会社サンプル", status: "saved", date: "2026-10-01" }, "秘密のメール草稿");
const notes = [job, todo, work, draft];
const props = { notes, today, loading: false, fetchedAt, onOpenSource() {} };
const walk = (value) => !value || typeof value !== "object" ? [] : Array.isArray(value) ? value.flatMap(walk) : [value, ...walk(value.props?.children), ...(typeof value.type === "function" && ["ProgressOverview", "ProgressListRow", "ProgressDashboard", "ProgressDistribution"].includes(value.type.name) ? walk(value.type(value.props)) : [])];
const text = (value) => value == null || typeof value === "boolean" ? "" : typeof value !== "object" ? String(value) : Array.isArray(value) ? value.map(text).join("") : text(value.props?.children);
const find = (tree, predicate) => { const node = walk(tree).find(predicate); assert.ok(node); return node; };
const button = (tree, label) => find(tree, (node) => node.type === "button" && text(node.props.children) === label);
const clickEvent = (fields = {}) => ({ button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, preventDefault() { this.prevented = true; }, ...fields });

async function render(options = {}) {
  const viewModule = await loadAppModule("app/recent-progress-view.tsx", { stubs: { "./ui-locale": { useUiLocale: () => ({ locale: options.locale || "zh-CN" }) } }, globals: options.search ? { window: { location: { search: options.search } } } : {} });
  return renderToStaticMarkup(createElement(viewModule.default, { ...props, ...options }));
}

function firstRow(tree) {
  const element = find(tree, (node) => typeof node.type === "function" && node.type.name === "ProgressListRow");
  return find(element.type(element.props), (node) => node.type === "a" && node.props.className?.split(" ").includes("recent-progress-row"));
}

async function interactive(search = "", pathname = "/activity", inputNotes = notes) {
  let cursor = 0, refCursor = 0, effectCursor = 0, index = 0;
  const states = [], refs = [], effects = [], pending = [], opened = [], scrolls = [], focus = [];
  const listeners = new Map();
  const stack = [{ url: `${pathname}${search}`, state: { __echoAppView: "activity" } }];
  const window = { location: { pathname, search }, scrollY: 740,
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    scrollTo(value) { scrolls.push(value.top); this.scrollY = value.top; }, setTimeout(fn) { fn(); return 1; }, clearTimeout() {},
  };
  const locate = (url) => { const parsed = new URL(url, "https://example.test"); window.location.pathname = parsed.pathname; window.location.search = parsed.search; };
  window.history = {
    get state() { return stack[index].state; },
    replaceState(state, unused, url) { stack[index] = { state, url: url || stack[index].url }; locate(stack[index].url); },
    pushState(state, unused, url) { stack.splice(index + 1); stack.push({ state, url }); index++; locate(url); },
    back() { if (index === 0) return; index--; locate(stack[index].url); for (const fn of listeners.get("popstate") || []) fn(); },
  };
  const viewModule = await loadAppModule("app/recent-progress-view.tsx", { stubs: {
    react: { useMemo: (fn) => fn(), useState(initial) { const slot = cursor++; if (!(slot in states)) states[slot] = typeof initial === "function" ? initial() : initial; return [states[slot], (next) => { states[slot] = typeof next === "function" ? next(states[slot]) : next; }]; },
      useRef(initial) { const slot = refCursor++; return refs[slot] ??= { current: initial }; },
      useEffect(fn, deps) { const slot = effectCursor++; if (!effects[slot] || deps.some((value, i) => !Object.is(value, effects[slot].deps[i]))) { effects[slot]?.cleanup?.(); effects[slot] = { deps }; pending.push(() => { effects[slot].cleanup = fn(); }); } },
    }, "./ui-locale": { useUiLocale: () => ({ locale: "zh-CN" }) },
  }, globals: { window, document: { getElementById(id) { return { focus() { focus.push(id); } }; } } } });
  const view = () => { cursor = 0; refCursor = 0; effectCursor = 0; const tree = viewModule.default({ ...props, notes: inputNotes, onOpenSource: (path) => opened.push(path) }); while (pending.length) pending.shift()(); return tree; };
  return { view, window, opened, scrolls, focus, stack };
}

test("进展按可靠日期分组，当前状态与记录状态分开呈现", async () => {
  const html = await render({ search: "?activityView=timeline" });
  assert.match(html, /aria-label="最近进展"/);
  for (const date of ["2026-10-04", "2026-10-03", "2026-10-02", "2026-10-01"]) assert.match(html, new RegExp(`id="progress-date-${date}"`));
  assert.ok(html.indexOf('id="progress-date-2026-10-04"') < html.indexOf('id="progress-date-2026-10-03"'));
  assert.match(html, /已申请/); assert.match(html, /工作记录标为完成/); assert.match(html, /已保存/);
  assert.match(html, /核实日期/); assert.match(html, /记录日期/); assert.match(html, /发生日期/);
  assert.doesNotMatch(html, /书类通过|今天新增|今日更新/);
  assert.match(html, /href="\/activity\?activityView=timeline&amp;update=/);
});

test("列表不泄露日志标题、内部正文、草稿全文或操作说明", async () => {
  const html = await render();
  for (const hidden of ["秘密の指示タイトル", "内部指示本文", "未公開の思考", "秘密のメール草稿", "内部作業ログ", "本人だけが確認できるため"]) assert.equal(html.includes(hidden), false);
  assert.doesNotMatch(html, /记录已处理|确认发送|生成计划|新增待办/);
});

test("加载、失败、空态与覆盖缺口不会混淆", async () => {
  const loading = await render({ notes: [], loading: true, fetchedAt: null });
  assert.match(loading, /正在读取进展记录/); assert.doesNotMatch(loading, /暂无可展示/);
  const failed = await render({ notes: [], loading: false, fetchedAt: null, error: "private technical error" });
  assert.match(failed, /role="alert"/); assert.match(failed, /读取失败/); assert.doesNotMatch(failed, /private technical|暂无可展示/);
  const empty = await render({ notes: [] }); assert.match(empty, /暂无可展示的进展/);
  const undated = await render({ notes: [{ ...job, frontmatter: { ...job.frontmatter, status_updated: undefined, updated: today } }] });
  assert.match(undated, /部分资料待核实或尚未覆盖/); assert.match(undated, /日期缺失：1/); assert.doesNotMatch(undated, /progress-date-/);
  const invalidReadTime = await render({ notes: [], fetchedAt: NaN }); assert.match(invalidReadTime, /尚未读取进展资料/);
});

test("分类筛选使用同一批事实，事项详情按深链直接打开", async () => {
  const ui = await interactive("?activityView=timeline"); ui.view();
  button(ui.view(), "处理与准备2").props.onClick();
  let html = renderToStaticMarkup(ui.view());
  assert.match(html, /data-progress-category="work"/); assert.doesNotMatch(html, /data-progress-kind="blocker"|data-progress-kind="status"/);
  assert.equal(new URLSearchParams(ui.window.location.search).get("activityKind"), "work");
  button(ui.view(), "仍有阻碍1").props.onClick();
  html = renderToStaticMarkup(ui.view()); assert.match(html, /data-progress-kind="blocker"/);
  const item = buildRecentProgress(notes, today).entries.find((entry) => entry.kind === "blocker");
  const detail = await render({ search: `?update=${item.id}` });
  assert.match(detail, /aria-label="进展详情"/); assert.match(detail, /本人だけが確認できるため/); assert.match(detail, /现有事项的核实日期/);
  assert.match(detail, /<details class="recent-progress-sources">/); assert.doesNotMatch(detail, /recent-progress-row"/);
});

test("打开详情和返回保留筛选、滚动与键盘焦点，不触碰源记录", async () => {
  const ui = await interactive("?activityKind=work", "/activity/");
  const row = firstRow(ui.view());
  const event = clickEvent(); row.props.onClick(event); assert.equal(event.prevented, true);
  assert.equal(ui.window.history.state.__echoAppView, "activity");
  assert.deepEqual(ui.window.history.state.__echoProgressList, { route: { category: "work", id: null, range: "7d", view: "timeline", open: [] }, id: new URL(row.props.href, "https://example.test").searchParams.get("update"), scrollY: 740 });
  let tree = ui.view(); assert.match(renderToStaticMarkup(tree), /进展详情/); assert.equal(ui.scrolls.at(-1), 0);
  button(tree, "← 返回进展列表").props.onClick(); tree = ui.view();
  assert.equal(ui.window.location.pathname, "/activity/"); assert.equal(new URLSearchParams(ui.window.location.search).get("activityKind"), "work"); assert.equal(ui.scrolls.at(-1), 740); assert.equal(ui.focus.at(-1), row.props.id);
  assert.match(renderToStaticMarkup(tree), /data-progress-category="work"/); assert.deepEqual(ui.opened, []);
});

test("直接打开详情的返回留在网站列表，修饰点击仍由浏览器打开新页", async () => {
  const item = buildRecentProgress(notes, today).entries[0];
  const ui = await interactive(`?activityKind=blocker&update=${item.id}`);
  button(ui.view(), "← 返回进展列表").props.onClick(); ui.view();
  assert.equal(new URLSearchParams(ui.window.location.search).get("activityKind"), "blocker"); assert.equal(ui.stack.length, 1);
  const row = firstRow(ui.view());
  const event = clickEvent({ ctrlKey: true }); row.props.onClick(event);
  assert.equal(event.prevented, undefined); assert.equal(ui.stack.length, 1);
  const missing = await render({ search: "?update=missing" }); assert.match(missing, /未找到这条进展/);
});

test("来源只打开精确路径，外部链接限http(s)，岗位来源不充当回复", async () => {
  const { ProgressDetail, progressZh } = await loadAppModule("app/recent-progress-view.tsx");
  const item = buildRecentProgress(notes, today).entries.find((entry) => entry.kind === "status");
  const opened = [];
  const tree = ProgressDetail({ item, copy: progressZh, onOpenSource: (path) => opened.push(path) });
  button(tree, "打开案件记录").props.onClick(); assert.deepEqual(opened, [job.path]);
  const html = renderToStaticMarkup(tree); assert.match(html, /打开求人来源/); assert.match(html, /不等于企业回复原文/); assert.match(html, /未记载的历史变化不会自动补全/);
  const ai = renderToStaticMarkup(ProgressDetail({ item: { ...item, kind: "application", sourceType: "ai-application", state: "application-submitted", actor: "Codex" }, copy: progressZh, onOpenSource() {} }));
  assert.match(ai, /执行者/); assert.match(ai, /Codex/); assert.match(ai, /打开求人来源/); assert.match(ai, /不等于企业回复原文/);
  for (const source of ["javascript:alert(1)", "data:text/html,test", "//example.test/unsafe", "https://user:pass@example.test/private"]) {
    const unsafe = renderToStaticMarkup(ProgressDetail({ item: { ...item, externalSources: [source] }, copy: progressZh, onOpenSource() {} }));
    assert.doesNotMatch(unsafe, /href=/);
  }
});

test("工作记录完成不冒称发送，保存和草稿状态保持准确", async () => {
  const entry = buildRecentProgress(notes, today).entries.find((item) => item.kind === "work");
  const html = await render({ search: `?update=${entry.id}` });
  assert.match(html, /工作记录完成不代表外部申请或消息已发送/); assert.match(html, /处理或同步记录的日期/); assert.match(html, /结构化摘要/);
  assert.doesNotMatch(html, /内部作業ログ|秘密の指示|未公開の思考/);
  const { progressStateLabel, progressZh } = await loadAppModule("app/recent-progress-view.tsx");
  assert.deepEqual(["draft", "prepared", "awaiting-approval", "saved", "sent", "not-sent"].map((state) => progressStateLabel(state, progressZh)), ["草稿", "已准备", "待批准", "已保存", "已发送", "尚未发送"]);
});

test("日语页有独立界面文案，保留来源本身的语言", async () => {
  const html = await render({ locale: "ja", search: "?activityView=timeline" });
  assert.match(html, /最近の進展/); assert.match(html, /案件の動き/); assert.match(html, /対応・準備/); assert.match(html, /確認日/); assert.match(html, /作業記録は完了/);
  assert.doesNotMatch(html, /最近进展|处理与准备|发生日期/);
});

test("URL保留分类和记录身份；页面仅有读取及导航能力", async () => {
  const { recentProgressRoute, recentProgressHref } = await loadAppModule("app/recent-progress-view.tsx");
  assert.deepEqual(recentProgressRoute("?activityKind=wrong&update=a%2Fb"), { category: "all", id: "a/b", range: "7d", view: "overview", open: [] });
  assert.deepEqual(recentProgressRoute(new URL(recentProgressHref("id/?#", "work"), "https://example.test").search), { category: "work", id: "id/?#", range: "7d", view: "timeline", open: [] });
  const source = await readFile(new URL("../app/recent-progress-view.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /postJson|fetch\(|\/api\/|onNoteWritten/);
});

const caseEntry = (id, company, position, status, date = today) => note(`20_求職/${company}/${id}.md`, { type: "job-case", case_id: id, company, position, status, status_updated: date });
const rejectOne = caseEntry("reject-a1", "株式会社架空アルファ", "開発第一職", "不採用");
const rejectTwo = caseEntry("reject-a2", "株式会社架空アルファ", "開発第二職", "不採用");
const rejectThree = caseEntry("reject-b1", "株式会社架空ベータ", "分析職", "不採用");
const advanceOne = caseEntry("advance-a", "株式会社架空ガンマ", "基盤職", "書類通過");
const advanceTwo = caseEntry("advance-b", "株式会社架空デルタ", "設計職", "面接中", "2026-10-02");
const oldAdvance = caseEntry("advance-old", "株式会社架空イプシロン", "過去職", "内定", "2026-09-15");
const oldAction = note("20_求職/_TODO/以前から必要.md", { ...todo.frontmatter, action: "以前から残る必要な本人確認", action_reviewed_at: "2026-09-01", due: "2026-10-07" });
const overviewNotes = [job, todo, oldAction, work, draft, rejectOne, rejectTwo, rejectThree, advanceOne, advanceTwo, oldAdvance];
const groupToggle = (tree, key) => find(tree, (node) => node.type === "button" && node.props["aria-controls"] === `progress-${key}-records`);

test("概览首屏只展示有限的必要动作和推进，未采用按公司合并收起", async () => {
  const html = await render({ notes: overviewNotes });
  assert.match(html, /data-progress-view="overview"/);
  assert.match(html, /当前需要你处理/); assert.match(html, /不受时间范围限制/); assert.match(html, /已确认的推进/);
  assert.equal((html.match(/class="recent-progress-row recent-progress-row-compact"/g) || []).length, 3);
  assert.match(html, /未采用<strong>2 家公司/);
  assert.doesNotMatch(html, /株式会社架空アルファ|株式会社架空ベータ|開発第一職|開発第二職/);
  assert.match(html, /各组公司数不可相加/); assert.doesNotMatch(html, /面试失败/);
  assert.match(html, /aria-expanded="false" aria-controls="progress-rejected-records"/);
  assert.match(html, /aria-expanded="false" aria-controls="progress-waiting-records"/);
  assert.match(html, /aria-expanded="false" aria-controls="progress-work-records"/);
  assert.doesNotMatch(html, /工作记录标为完成|已保存/);
});

test("公司折叠展开保留每个岗位和详情，展开状态进入URL并能刷新还原", async () => {
  const ui = await interactive("", "/activity", overviewNotes);
  const closed = groupToggle(ui.view(), "rejected"); assert.equal(closed.props["aria-expanded"], false);
  closed.props.onClick();
  const tree = ui.view(); assert.equal(groupToggle(tree, "rejected").props["aria-expanded"], true);
  assert.equal(new URLSearchParams(ui.window.location.search).get("activityOpen"), "rejected");
  const html = renderToStaticMarkup(tree);
  assert.match(html, /株式会社架空アルファ/); assert.match(html, /開発第一職/); assert.match(html, /開発第二職/); assert.match(html, /分析職/);
  assert.equal((html.match(/<h3>株式会社架空アルファ<\/h3>/g) || []).length, 1);
  const reloaded = await render({ notes: overviewNotes, search: ui.window.location.search });
  assert.match(reloaded, /aria-expanded="true" aria-controls="progress-rejected-records"/); assert.match(reloaded, /開発第二職/);
  groupToggle(ui.view(), "waiting").props.onClick();
  assert.match(renderToStaticMarkup(ui.view()), /不表示这些公司目前都在等待回复/);
});

test("时间范围首尾含JST，旧必要动作持续展示，timeline清楚说明日期边界", async () => {
  const seven = await render({ notes: overviewNotes });
  assert.match(seven, /2026-09-29/); assert.match(seven, /首尾均含.*JST/); assert.match(seven, /以前から残る必要な本人確認/); assert.doesNotMatch(seven, /株式会社架空イプシロン/);
  const thirty = await render({ notes: overviewNotes, search: "?activityRange=30d&activityOpen=advancing" });
  assert.match(thirty, /2026-09-06/); assert.match(thirty, /株式会社架空イプシロン/); assert.match(thirty, /以前から残る必要な本人確認/);
  const all = await render({ notes: overviewNotes, search: "?activityRange=all&activityView=timeline" });
  assert.match(all, /全部 · 截至/); assert.match(all, /以前から残る必要な本人確認/);
  const timeline = await render({ notes: overviewNotes, search: "?activityView=timeline&activityKind=blocker" });
  assert.match(timeline, /日期明细按所选范围筛选；仍有效的本人动作请查看进展概览/); assert.doesNotMatch(timeline, /以前から残る必要な本人確認/);
  const oldId = buildRecentProgress(overviewNotes, today).entries.find((item) => item.actionPath === oldAction.path).id;
  const oldDetail = await render({ notes: overviewNotes, search: `?update=${oldId}` });
  assert.match(oldDetail, /以前から残る必要な本人確認/); assert.match(oldDetail, /2026-09-01/);
});

test("概览范围和展开组随详情返回保留，来源展开也可刷新复原", async () => {
  const ui = await interactive("?activityRange=30d&activityOpen=rejected", "/activity/", overviewNotes);
  const row = walk(ui.view()).find((node) => node.type === "a" && text(node.props.children).includes("開発第二職")); assert.ok(row);
  row.props.onClick(clickEvent());
  let tree = ui.view();
  let query = new URLSearchParams(ui.window.location.search); assert.equal(query.get("activityRange"), "30d"); assert.equal(query.get("activityOpen"), "rejected");
  const detail = find(tree, (node) => typeof node.type === "function" && node.type.name === "ProgressDetail"); detail.props.onSourcesToggle(true);
  tree = ui.view(); query = new URLSearchParams(ui.window.location.search); assert.equal(query.get("activityOpen"), "rejected,sources");
  const reloaded = await render({ notes: overviewNotes, search: ui.window.location.search }); assert.match(reloaded, /class="recent-progress-sources" open=""/);
  button(tree, "← 返回进展列表").props.onClick(); tree = ui.view();
  assert.equal(ui.window.location.pathname, "/activity/"); assert.equal(ui.scrolls.at(-1), 740); assert.equal(ui.focus.at(-1), row.props.id);
  assert.equal(groupToggle(tree, "rejected").props["aria-expanded"], true); assert.match(renderToStaticMarkup(tree), /2026-09-06/);
});

test("明确期限配合文字传达紧急性，相对期限不误报紧急", async () => {
  for (const [due, label] of [[today, "今天截止"], ["2026-10-04", "已过期限，请先核对有效性"]]) {
    const dated = { ...todo, frontmatter: { ...todo.frontmatter, due } };
    const html = await render({ notes: [job, dated] }); assert.match(html, /data-tone="urgent"/); assert.ok(html.includes(label));
    const id = buildRecentProgress([job, dated], today).entries.find((item) => item.kind === "blocker").id;
    const detail = await render({ notes: [job, dated], search: `?update=${id}` }); assert.ok(detail.includes(label));
  }
  const relativeNotes = [job, { ...todo, frontmatter: { ...todo.frontmatter, due_text: "連絡から三営業日以内" } }];
  const relative = await render({ notes: relativeNotes });
  assert.match(relative, /原文相对期限 · 见详情/); assert.doesNotMatch(relative, /data-tone="urgent"|今天截止/);
  const relativeId = buildRecentProgress(relativeNotes, today).entries.find((entry) => entry.kind === "blocker").id;
  assert.match(await render({ notes: relativeNotes, search: `?update=${relativeId}` }), /原文期限：連絡から三営業日以内/);
});

test("资料待核只链接审核分类，状态颜色保持语义且无需颜色也可阅读", async () => {
  const unreviewed = { ...todo, frontmatter: { ...todo.frontmatter, action_reviewed_at: undefined } };
  const html = await render({ notes: [job, unreviewed, advanceOne, rejectOne], search: "?activityView=timeline" });
  assert.match(html, /href="\/actions\?category=review"/); assert.match(html, /资料待核实 1/); assert.match(html, /不是新回复或新增义务/);
  assert.match(html, /data-tone="neutral"/); assert.match(html, /data-tone="positive"/); assert.match(html, /data-tone="muted"/);
  assert.match(html, /已申请/); assert.match(html, /书类通过/); assert.match(html, /未采用/);
  const ja = await render({ notes: overviewNotes, locale: "ja" });
  assert.match(ja, /期間の指定に関係なく表示/); assert.match(ja, /応募・保留の記録/); assert.match(ja, /各社数は合計できません/);
});


test("仪表盘图表筛选可刷新还原，返回详情保留选择与唯一行焦点", async () => {
  const ui = await interactive("", "/activity", overviewNotes);
  const chartBar = find(ui.view(), (node) => node.type === "button" && node.props.className === "momentum-bar" && node.props["aria-label"].startsWith("10/5 ·"));
  chartBar.props.onClick();
  assert.equal(new URLSearchParams(ui.window.location.search).get("activityChart"), "day:2026-10-05");
  let tree = ui.view();
  let html = renderToStaticMarkup(tree);
  assert.match(html, /aria-label="企业动态明细"/);
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "图表明细与推进卡片使用不同锚点");
  const row = find(tree, (node) => node.type === "a" && node.props.id?.endsWith("-chart"));
  row.props.onClick(clickEvent({ currentTarget: { id: row.props.id } }));
  tree = ui.view();
  button(tree, "← 返回进展列表").props.onClick();
  tree = ui.view();
  assert.equal(ui.focus.at(-1), row.props.id);
  assert.equal(new URLSearchParams(ui.window.location.search).get("activityChart"), "day:2026-10-05");
  const refreshed = await render({ notes: overviewNotes, search: ui.window.location.search });
  assert.match(refreshed, /aria-label="企业动态明细"/);
  const rejected = find(tree, (node) => node.type === "button" && node.props["data-segment"] === "rejected");
  rejected.props.onClick();
  tree = ui.view();
  assert.equal(new URLSearchParams(ui.window.location.search).get("activityChart"), "segment:rejected");
  html = renderToStaticMarkup(tree);
  assert.match(html, /開発第一職/); assert.match(html, /開発第二職/);
  assert.doesNotMatch(html, /aria-label="企业动态明细"/);
  button(tree, "近 30 天").props.onClick();
  assert.equal(new URLSearchParams(ui.window.location.search).get("activityChart"), null);
});

test("图表日期深链拒绝非法日期，两种语言的仪表盘都有独立文案", async () => {
  const { recentProgressRoute, recentProgressHref } = await loadAppModule("app/recent-progress-view.tsx");
  for (const value of ["day:2026-02-30", "segment:wrong", "anything"]) assert.equal(recentProgressRoute(`?activityChart=${value}`).chart, undefined);
  const route = recentProgressRoute("?activityRange=30d&activityChart=segment:advancing");
  assert.equal(recentProgressRoute(new URL(recentProgressHref(null, "all", route), "https://example.test").search).chart, route.chart);
  const ja = await render({ notes: overviewNotes, locale: "ja" });
  assert.match(ja, /期間内の案件内訳/); assert.match(ja, /棒をクリックして会社を確認/);
  assert.doesNotMatch(ja, /企业动态趋势|本期案件分布|有动态的公司|清除选择/);
});
