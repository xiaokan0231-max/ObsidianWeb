import assert from "node:assert/strict";
import test from "node:test";
import { createContext, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildUserActions } from "../lib/user-actions.ts";
import { ConflictError } from "../lib/client-api.ts";
import { loadAppModule } from "./helpers/render-tsx.mjs";

const today = "2026-10-05";
const fetchedAt = Date.parse("2026-10-05T01:20:00Z");
const note = (path, frontmatter, content = "") => ({ path, frontmatter, content, tags: [], stat: { ctime: 100, mtime: 307, size: 100 } });
const job = note("20_求職/株式会社テスト/案件.md", { type: "job-case", case_id: "test-case", company: "株式会社テスト", position: "データエンジニア", status: "面接中" });
const otherJob = note("20_求職/株式会社テスト/別案件.md", { type: "job-case", case_id: "other-case", company: "株式会社テスト", position: "別の職種", status: "応募済" });
function todo(id = "current", fields = {}) {
  return note(`20_求職/_TODO/${id}.md`, { type: "todo", status: "未着手", case_id: "test-case", company: "旧表示会社", action: `${id}の具体的な対応`,
    action_owner: "user", action_kind: "required", action_reviewed_at: today, action_reason: "本人にしか確認できない事項があるため", action_source: "https://example.test/messages/one", action_next_owner: "company", ...fields }, `# ${id}の元記録\n\n確認すべき原文を保持します。`);
}
const mixed = () => [job, otherJob, todo(), todo("waiting", { action_owner: "company", action_kind: "waiting" }),
  todo("system", { action_owner: "ai" }), todo("optional", { action_kind: "optional" }), todo("history", { status: "完了" }),
  todo("review", { action_reviewed_at: undefined })];
const props = (notes) => ({ notes, today, loading: false, fetchedAt, onOpen() {}, onNoteWritten() {} });

async function render(notes, options = {}) {
  const { default: View } = await loadAppModule("app/user-actions-view.tsx", { stubs: { "./ui-locale": { useUiLocale: () => ({ locale: options.locale || "zh-CN" }) } }, globals: options.search ? { window: { location: { search: options.search } } } : {} });
  return renderToStaticMarkup(createElement(View, { ...props(notes), ...options }));
}

const renderDetail = (notes, options = {}) => render(notes, { search: `?action=${encodeURIComponent(notes.find((n) => n.frontmatter.type === "todo").path)}`, ...options });

function walk(value) {
  return !value || typeof value !== "object" ? [] : Array.isArray(value) ? value.flatMap(walk) : [value, ...walk(value.props?.children)];
}
function text(value) {
  return value == null || typeof value === "boolean" ? "" : typeof value !== "object" ? String(value) : Array.isArray(value) ? value.map(text).join("") : text(value.props?.children);
}
function button(tree, label) {
  const found = walk(tree).find((node) => node.type === "button" && text(node.props.children) === label);
  assert.ok(found, `button: ${label}`);
  return found;
}

async function interactive({ entry = todo(), notes = [job, entry], locale = "zh-CN", postJson = async () => ({ ok: true, note: entry }) } = {}) {
  let cursor = 0, refCursor = 0;
  const states = [], refs = [], opened = [], written = [], messages = [];
  const componentModule = await loadAppModule("app/user-actions-view.tsx", { stubs: {
    react: { createContext, useContext: () => undefined, useSyncExternalStore: (_subscribe, snapshot) => snapshot(), useEffect() {}, useMemo: (fn) => fn(), useState(initial) { const slot = cursor++; if (!(slot in states)) states[slot] = typeof initial === "function" ? initial() : initial; return [states[slot], (next) => { states[slot] = typeof next === "function" ? next(states[slot]) : next; }]; }, useRef(initial) { const slot = refCursor++; return refs[slot] ??= { current: initial }; } },
    "./ui-locale": { useUiLocale: () => ({ locale }) }, "@/lib/client-api": { postJson, ConflictError },
  } });
  let currentItem = Object.values(buildUserActions(notes, today)).flat().find((item) => item.note.path === entry.path);
  const reset = () => { cursor = 0; refCursor = 0; };
  const card = () => { reset(); return componentModule.UserActionCard({ item: currentItem, notes, today, onOpen: (n) => opened.push(n), onNoteWritten: (n) => written.push(n), onRecorded: (message) => messages.push(message) }); };
  return {
    card, html: () => renderToStaticMarkup(card()), opened, written, messages,
    click(label) { button(card(), label).props.onClick(); },
    draft(value) { const field = walk(card()).find((node) => node.type === "input" && node.props.type === "text"); assert.ok(field); field.props.onChange({ target: { value } }); },
    updateItem: (item) => { currentItem = item; },
    view() { reset(); return componentModule.default({ ...props(notes), onOpen: (n) => opened.push(n), onNoteWritten: (n) => written.push(n) }); },
  };
}
const settled = () => new Promise((resolve) => setImmediate(resolve));

async function interactivePage({ search = "", notes = mixed() } = {}) {
  let cursor = 0, refCursor = 0, effectCursor = 0, index = 0, backCalls = 0;
  const states = [], refs = [], effects = [], runEffects = [], scrolls = [], focused = [], writes = [], listeners = new Map();
  const entries = [{ url: `/actions${search}`, state: { __echoEntry: "existing-shell-entry", unrelated: true } }];
  const location = { pathname: "/actions", search };
  const syncLocation = (url) => { const next = new URL(url, "http://localhost:3000"); location.pathname = next.pathname; location.search = next.search; };
  const history = {
    get state() { return entries[index].state; },
    replaceState(state, _, url) { entries[index] = { state, url: url ?? entries[index].url }; syncLocation(entries[index].url); },
    pushState(state, _, url) { entries.splice(index + 1); entries.push({ state, url }); index++; syncLocation(url); },
    back() { backCalls++; if (!index) return; index--; syncLocation(entries[index].url); for (const fn of listeners.get("popstate") ?? []) fn(); },
  };
  const window = {
    location, history, scrollY: 0,
    scrollTo(position) { this.scrollY = position.top; scrolls.push(position.top); },
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    setTimeout(fn) { fn(); return 1; }, clearTimeout() {},
  };
  const { default: View } = await loadAppModule("app/user-actions-view.tsx", { globals: {
    window, document: { getElementById: (id) => ({ focus: () => focused.push(id) }) },
  }, stubs: {
    react: {
      createContext, useContext: () => undefined, useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
      useMemo: (fn) => fn(),
      useState(initial) { const slot = cursor++; if (!(slot in states)) states[slot] = typeof initial === "function" ? initial() : initial; return [states[slot], (next) => { states[slot] = typeof next === "function" ? next(states[slot]) : next; }]; },
      useRef(initial) { const slot = refCursor++; return refs[slot] ??= { current: initial }; },
      useEffect(fn, deps) { const slot = effectCursor++; const previous = effects[slot]; if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return; previous?.cleanup?.(); const effect = { deps }; effects[slot] = effect; runEffects.push(() => { effect.cleanup = fn(); }); },
    },
    "./ui-locale": { useUiLocale: () => ({ locale: "zh-CN" }) },
    "@/lib/client-api": { postJson: async () => { throw new Error("navigation must not write"); }, ConflictError },
  } });
  const render = () => {
    cursor = 0; refCursor = 0; effectCursor = 0;
    const tree = View({ ...props(notes), onNoteWritten: (value) => writes.push(value) });
    for (const node of walk(tree)) if (node.props?.ref && typeof node.props.ref === "object") node.props.ref.current = { focus: () => focused.push(node.props["aria-label"]) };
    runEffects.splice(0).forEach((effect) => effect());
    return tree;
  };
  const open = (options = {}) => {
    const row = walk(render()).find((node) => typeof node.type === "function" && node.type.name === "UserActionListRow");
    assert.ok(row);
    let prevented = false;
    row.props.onSelect({ button: 0, preventDefault() { prevented = true; }, ...options }, row.props.item);
    return prevented;
  };
  return { render, open, window, entries, focused, scrolls, writes, backCalls: () => backCalls };
}

test("默认主列表只有已审核本人必要动作，待核显眼而不加入当前计数", async () => {
  const html = await render(mixed());
  assert.match(html, /aria-label="当前已确认的本人动作"><strong>1<\/strong>/);
  assert.match(html, /1 条记录仍待核实/);
  assert.match(html, /待核实记录单独保留，不计入当前事项/);
  assert.match(html, /data-action-category="current"/);
  assert.equal((html.match(/class="user-action-list-row"/g) || []).length, 1);
  assert.equal(html.includes("user-action-card"), false);
  assert.equal(html.includes("本人にしか確認できない事項があるため"), false);
  assert.equal(html.includes("https://example.test/messages/one"), false);
  assert.equal(html.includes(">记录已处理</button>"), false);
  assert.match(html, /currentの具体的な対応/);
  for (const excluded of ["waiting", "system", "optional", "history", "review"]) assert.equal(html.includes(`${excluded}の具体的な対応`), false);
  assert.match(html, /資料|资料读取时间/);
  assert.match(html, /JST/);
  assert.match(html, /邮箱或招聘网站的最新核实时间/);
});

test("各分类实际可切换，等待与历史不会混回主列表", async () => {
  const ui = await interactive({ notes: mixed() });
  for (const [label, category] of [["待核实", "review"], ["等待对方", "waiting"], ["AI / 系统事项", "system"], ["可选事项", "optional"], ["处理历史", "history"], ["当前需要处理", "current"]]) {
    button(ui.view(), `${label}1`).props.onClick();
    const html = renderToStaticMarkup(ui.view());
    assert.match(html, new RegExp(`data-action-category="${category}"`));
    assert.equal((html.match(/class="user-action-list-row"/g) || []).length, 1);
    if (category !== "current") {
      assert.equal(html.includes(">记录已处理</button>"), false);
      assert.equal(html.includes(">不再处理</button>"), false);
    }
  }
  assert.deepEqual(ui.written, []);
});

test("中文待核列表使用已有中文说明全文，详情解释待核性质并折叠保存原文", async () => {
  const explanation = "现有记录尚未核实是否仍需处理。原条件尚未确认，也不能据此认定为本人必办。";
  const entry = todo("review-zh", { action_kind: "review", action: "日程の回答を確認する", action_reason: explanation, action_next_owner: undefined });
  entry.content = "# 日程確認の元記録\n\n原文は保存されています。";
  const ui = await interactive({ entry, notes: [job, entry] });
  button(ui.view(), "待核实1").props.onClick();
  const list = renderToStaticMarkup(ui.view());
  assert.match(list, /现有记录尚未核实是否仍需处理。原条件尚未确认，也不能据此认定为本人必办。/);
  assert.equal(list.includes(entry.frontmatter.action), false);
  assert.equal(list.includes("日程確認の元記録"), false);
  const detail = await renderDetail([job, entry], { search: `?category=review&action=${encodeURIComponent(entry.path)}` });
  for (const label of ["需要核实的事项", "为什么暂列待核", "核实说明", "仍待确认", "下一步", "下一步责任方仍待确认", "原记录责任方", "原记录的责任方不等于当前已确认的执行义务。"]) assert.ok(detail.includes(label), label);
  assert.equal(detail.split(explanation).length - 1, 1);
  assert.match(detail, /原记录仍标记为待核，尚未确认当前是否仍需执行/);
  const [main, original] = detail.split('<details class="user-action-disclosure">');
  assert.equal(main.includes(entry.frontmatter.action), false);
  assert.equal(main.includes("日程確認の元記録"), false);
  assert.match(original, /原始事项（尚未确认仍需执行）/);
  assert.ok(original.includes(entry.frontmatter.action));
  assert.match(original, /日程確認の元記録/);
  assert.match(original, /不是新增指示/);
  assert.equal(detail.includes(">记录已处理</button>"), false);
  assert.deepEqual(ui.written, []);
});

test("缺少可用中文说明时明确待核空态，缺动作也不直接拿日文标题充当指示", async () => {
  const fallback = "尚无可用中文说明，请先核实原记录；不因此认定为本人必办。";
  for (const reason of [undefined, "", "現在の対応要否は未確認です。", "給与は据え置きです。"] ) {
    const entry = todo("review-missing-zh", { action_kind: "review", action: undefined, action_reason: reason, action_next_owner: undefined });
    const list = await render([job, entry], { search: "?category=review" });
    assert.ok(list.includes(fallback));
    assert.equal(list.includes("review-missing-zhの元記録"), false);
    const detail = await renderDetail([job, entry]);
    assert.ok(detail.includes(fallback));
    assert.match(detail, /原记录未填写动作/);
    assert.match(detail, /review-missing-zhの元記録/);
    if (reason) assert.ok(detail.includes(reason));
  }
});

test("中文说明里的日文引用完整保留，结构化缺项可读；日语与当前事项仍用原动作", async () => {
  const reason = "核实说明引用「候補日をご連絡ください」，但尚未确认是否仍有效；不因此认定为本人必办。";
  const entry = todo("review-mixed", { action_kind: "review", action: "候補日を連絡する", action_reason: reason, action_owner: undefined, action_next_owner: "company" });
  const zhList = await render([job, entry], { search: "?category=review" });
  assert.ok(zhList.includes(reason));
  assert.equal(zhList.includes("尚无可用中文说明"), false);
  const detail = await renderDetail([job, entry]);
  assert.ok(detail.includes(reason));
  assert.match(detail, /尚未确认责任人/);
  assert.match(detail, /原记录的下一步责任方：企业 \/ 对方/);
  const jaList = await render([job, entry], { search: "?category=review", locale: "ja" });
  assert.ok(jaList.includes(entry.frontmatter.action));
  assert.equal(jaList.includes(reason), false);
  assert.equal(jaList.includes("核实说明"), false);
  const jaDetail = await renderDetail([job, entry], { locale: "ja" });
  assert.match(jaDetail, /<h3>候補日を連絡する<\/h3>/);
  assert.match(jaDetail, /対応が必要な理由/);
  assert.equal(jaDetail.includes("需要核实的事项"), false);
  const current = todo("current-original", { action: "原文の必要な対応", action_reason: reason });
  const currentList = await render([job, current]);
  assert.ok(currentList.includes(current.frontmatter.action));
  assert.equal(currentList.includes(reason), false);
});

test("默认事项行只显示真实期限，建议日期与说明留在详情且折叠来源和操作", async () => {
  const entry = todo("compact", { due: "2026-10-08", suggested_due: "2026-10-06" });
  const html = await render([job, entry]);
  assert.match(html, /dateTime="2026-10-08"/);
  assert.equal(html.includes("2026-10-06"), false);
  assert.match(html, /href="\/actions\?action=/);
  assert.match(html, /需本人处理/);
  const detail = await renderDetail([job, entry]);
  assert.match(detail, /事项详情/);
  assert.match(detail, /<details class="user-action-disclosure"><summary>依据与原文<\/summary>/);
  assert.match(detail, /<details class="user-action-disclosure"><summary>操作与记录说明<\/summary>/);
  assert.match(detail, /查看详情不会完成事项，也不代表批准任何外部操作/);
  assert.equal(detail.includes("user-action-list-row"), false);
});

test("语义色与文字状态一致：真实到期才标紧急，等待中性，完成正向，结束低强调", async () => {
  const rowTone = (html) => html.match(/<a class="user-action-list-row"[^>]*data-tone="([^"]+)"/)?.[1];
  const current = await render([job, todo("required")]);
  assert.equal(rowTone(current), "action");
  assert.match(current, /需本人处理/);
  assert.match(current, /aria-hidden="true">→<\/span>/);
  const overdue = await render([job, todo("overdue", { due: "2026-10-03" })]);
  assert.equal(rowTone(overdue), "urgent");
  assert.match(overdue, /已过所列期限，请先核对是否仍有效/);
  const dueToday = await render([job, todo("due-today", { due: today })]);
  assert.equal(rowTone(dueToday), "urgent");
  assert.match(dueToday, /今天截止/);
  assert.equal(dueToday.includes("已过所列期限"), false);
  for (const fields of [{ suggested_due: "2026-10-03" }, { due_text: "案内から三日以内" }, { due: "2026-10-06" }]) {
    const html = await render([job, todo("no-urgency", fields)]);
    assert.equal(rowTone(html), "action");
    assert.equal(html.includes('data-tone="urgent"'), false);
  }
  const waiting = await render([job, todo("waiting", { action_owner: "company", action_kind: "waiting" })], { search: "?category=waiting" });
  assert.equal(rowTone(waiting), "neutral");
  assert.match(waiting, /等待对方/);
  const review = await render([job, todo("review", { action_reviewed_at: undefined })], { search: "?category=review" });
  assert.equal(rowTone(review), "neutral");
  const completed = await render([job, todo("done", { status: "完了" })], { search: "?category=history" });
  assert.equal(rowTone(completed), "positive");
  assert.match(completed, /aria-hidden="true">✓<\/span>已处理/);
  const rejected = await render([{ ...job, frontmatter: { ...job.frontmatter, status: "不採用" } }, todo("ended")], { search: "?category=history" });
  assert.equal(rowTone(rejected), "muted");
  assert.match(rejected, /关联案件已结束/);
  const cancelled = await render([job, todo("cancelled", { action_kind: "history", action_resolution: "cancelled" })], { search: "?category=history" });
  assert.equal(rowTone(cancelled), "muted");
  assert.match(cancelled, /不再处理/);
});

test("详情深链直接显示跨分类事项，未找到时明确空态且不会回落冒充主列表", async () => {
  const history = todo("history", { status: "完了" });
  const html = await render([job, todo(), history], { search: `?category=current&action=${encodeURIComponent(history.path)}` });
  assert.match(html, /historyの具体的な対応/);
  assert.match(html, /data-action-category="history"/);
  assert.equal(html.includes("currentの具体的な対応"), false);
  assert.equal(html.includes(">记录已处理</button>"), false);
  const missing = await render([job, todo()], { search: "?action=missing.md" });
  assert.match(missing, /未找到这条事项/);
  assert.match(missing, /返回事项列表/);
  assert.equal(missing.includes("currentの具体的な対応"), false);
});

test("列表→详情→返回保留分类、精确滚动和焦点，不覆盖外壳状态也不写记录", async () => {
  const ui = await interactivePage();
  button(ui.render(), "待核实1").props.onClick(); ui.render();
  assert.equal(ui.window.location.search, "?category=review");
  ui.window.scrollY = 438;
  assert.equal(ui.open(), true); ui.render();
  assert.match(ui.window.location.search, /category=review&action=/);
  assert.equal(ui.window.history.state.__echoEntry, "existing-shell-entry");
  assert.equal(ui.window.history.state.unrelated, true);
  assert.ok(ui.focused.includes("事项详情"));
  button(ui.render(), "← 返回事项列表").props.onClick(); ui.render();
  assert.equal(ui.window.location.search, "?category=review");
  assert.equal(ui.window.scrollY, 438);
  assert.match(ui.focused.at(-1), /user-action-/);
  assert.equal(ui.backCalls(), 1);
  assert.deepEqual(ui.writes, []);
});

test("深链返回列表不执行浏览器后退；修饰键保留链接原生新窗口行为", async () => {
  const entry = todo();
  const deep = await interactivePage({ search: `?category=waiting&action=${encodeURIComponent(entry.path)}` });
  button(deep.render(), "← 返回事项列表").props.onClick(); deep.render();
  assert.equal(deep.backCalls(), 0);
  assert.equal(deep.window.location.search, "?category=waiting");
  const list = await interactivePage();
  assert.equal(list.open({ metaKey: true }), false);
  assert.equal(list.entries.length, 1);
  assert.equal(list.window.location.search, "");
  assert.deepEqual(list.writes, []);
});

test("未读资料不显示零待办；已载入但有待核时不冒充全部确认", async () => {
  const loading = await render([], { loading: true, fetchedAt: null });
  assert.match(loading, /正在读取行动与来源记录/);
  assert.match(loading, /<strong>—<\/strong>/);
  assert.equal(loading.includes("没有列入当前列表"), false);
  const unknown = await render([job, todo("review", { action_reason: "" })]);
  assert.match(unknown, /目前已核实的资料中/);
  assert.match(unknown, /仍有待核实记录，不能据此认定全部事项已经确认/);
  assert.doesNotMatch(unknown, /没有待办|全部已完成/);
});

test("公司岗位来自精确关联案件，原TODO同名公司不会串联另一岗位", async () => {
  const html = await renderDetail([otherJob, job, todo()]);
  assert.match(html, /株式会社テスト/);
  assert.match(html, /データエンジニア/);
  assert.equal(html.includes("別の職種"), false);
  assert.equal(html.includes("旧表示会社"), false);
  const own = await renderDetail([todo("own", { case_id: undefined, company: "株式会社サンプル", position: "確認担当" })]);
  assert.match(own, /株式会社サンプル/);
  assert.match(own, /確認担当/);
  assert.match(own, /未确认精确关联案件/);
});

test("官方日期、相对期限、无期限及建议日期分开呈现", async () => {
  const date = await renderDetail([job, todo("dated", { due: "2026-10-03", due_text: "案内から三日以内", suggested_due: "2026-10-02" })]);
  assert.match(date, /官方期限/);
  assert.match(date, /dateTime="2026-10-03"/);
  assert.match(date, /原文相对期限：案内から三日以内/);
  assert.match(date, /建议处理日（仅建议）/);
  assert.match(date, /已过所列期限，请先核对是否仍有效/);
  const relative = await renderDetail([job, todo("relative", { due_text: "案内から五営業日以内", suggested_due: "2026-10-08" })]);
  assert.match(relative, /原文相对期限/);
  assert.match(relative, /案内から五営業日以内/);
  const none = await renderDetail([job, todo()]);
  assert.match(none, /未提供明确期限/);
  assert.match(none, /下一步由谁处理/);
  assert.match(none, /企业 \/ 对方/);
});

test("外部链接只允许http(s)，本地来源按完整路径开笔记，所有打开都不写状态", async () => {
  const source = note("20_求職/_素材/確認記録.md", { type: "material" }, "# 原文");
  const entry = todo("source", { action_source: "[[20_求職/_素材/確認記録#根拠]]" });
  let calls = 0;
  const ui = await interactive({ entry, notes: [job, entry, source], postJson: async () => { calls++; return { ok: true, note: entry }; } });
  // Source 子组件没有状态，直接执行以取得实际的 onOpen 控件。
  const sourceElement = walk(ui.card()).find((node) => typeof node.type === "function" && node.type.name === "ActionSource");
  button(sourceElement.type(sourceElement.props), "打开来源笔记").props.onClick();
  ui.click("打开原 TODO"); ui.click("打开关联案件");
  assert.deepEqual(ui.opened.map((n) => n.path), [source.path, entry.path, job.path]);
  assert.equal(calls, 0); assert.deepEqual(ui.written, []);
  const external = await renderDetail([job, todo()]);
  assert.match(external, /href="https:\/\/example.test\/messages\/one" target="_blank" rel="noopener noreferrer"/);
  for (const action_source of ["javascript:alert(1)", "data:text/html,test", "//example.test/unsafe", "../../outside.md"]) {
    const html = await renderDetail([job, todo("unsafe", { action_source })]);
    assert.equal(html.includes("href="), false);
    assert.match(html, /来源地址不可直接打开/);
  }
  const missing = await renderDetail([job, todo("missing", { action_source: "20_求職/_素材/未载入.md" })]);
  assert.match(missing, /来源笔记未载入/);
});

test("记录已处理需要两步及说明，发送mtime并只接收API回读note", async () => {
  const entry = todo(); const calls = [];
  const saved = { ...entry, stat: { ...entry.stat, mtime: 308 }, frontmatter: { ...entry.frontmatter, status: "完了", action_resolution: "completed", action_resolution_note: "本人已实际处理" } };
  const ui = await interactive({ entry, postJson: async (...args) => { calls.push(args); return { ok: true, note: saved }; } });
  ui.click("记录已处理");
  assert.equal(calls.length, 0);
  assert.match(ui.html(), /不会提交外部申请、发送消息、签署文件或作出授权/);
  assert.equal(button(ui.card(), "确认记录已处理").props.disabled, true);
  ui.draft("  本人已实际处理  "); ui.click("确认记录已处理"); await settled();
  assert.deepEqual(calls, [["/api/todos/status", { path: entry.path, resolution: "completed", resolutionNote: "本人已实际处理", expectedMtime: 307 }]]);
  assert.deepEqual(ui.written, [saved]);
  assert.match(ui.messages[0], /处理历史/);
});

test("不再处理保留取消历史，不记为完成，返回确认不产生写入", async () => {
  const entry = todo(); const calls = [];
  const saved = { ...entry, frontmatter: { ...entry.frontmatter, status: "保留", action_kind: "history", action_resolution: "cancelled", action_resolution_note: "已不需要此动作", action_resolved_at: today } };
  const ui = await interactive({ entry, postJson: async (...args) => { calls.push(args); return { ok: true, note: saved }; } });
  ui.click("不再处理"); ui.draft("暂不记录"); ui.click("返回，不记录");
  assert.equal(calls.length, 0);
  ui.click("不再处理"); ui.draft("已不需要此动作"); ui.click("确认记录不再处理"); await settled();
  assert.equal(calls[0][1].resolution, "cancelled"); assert.equal(ui.written[0].frontmatter.status, "保留");
  const history = buildUserActions([job, saved], today).history[0];
  ui.updateItem(history);
  assert.match(ui.html(), /<strong>不再处理<\/strong>/);
  assert.match(ui.html(), /已不需要此动作/);
  assert.equal(walk(ui.card()).some((node) => node.type === "button" && text(node.props.children) === "记录已处理"), false);
});

test("冲突与保存失败保留说明且不报告成功，也不自动重试", async () => {
  for (const cause of [new ConflictError("stale"), new Error("offline")]) {
    let calls = 0;
    const ui = await interactive({ postJson: async () => { calls++; throw cause; } });
    ui.click("记录已处理"); ui.draft("已处理的实际说明"); ui.click("确认记录已处理"); await settled();
    assert.equal(calls, 1); assert.equal(ui.written.length, 0); assert.equal(ui.messages.length, 0);
    assert.match(ui.html(), /role="alert"/);
    assert.match(ui.html(), /已处理的实际说明/);
    assert.match(ui.html(), cause instanceof ConflictError ? /笔记已被更新/ : /本地记录未保存/);
  }
});

test("说明字段为单行500字；空白、换行和超限内容都不发请求", async () => {
  let calls = 0;
  const ui = await interactive({ postJson: async () => { calls++; return { ok: true }; } });
  ui.click("记录已处理");
  const input = walk(ui.card()).find((node) => node.type === "input");
  assert.equal(input.props.type, "text"); assert.equal(input.props.maxLength, 500);
  for (const invalid of ["  ", "完成\n补充", "あ".repeat(501)]) {
    ui.draft(invalid); ui.click("确认记录已处理"); await settled();
    assert.equal(calls, 0);
    assert.match(ui.html(), /500 字以内的单行/);
  }
});

test("API没有返回本条笔记时不做乐观完成或成功通知", async () => {
  for (const payload of [{ ok: true }, { ok: true, note: job }]) {
    const ui = await interactive({ postJson: async () => payload });
    ui.click("记录已处理"); ui.draft("已执行且有记录"); ui.click("确认记录已处理"); await settled();
    assert.equal(ui.written.length, 0); assert.equal(ui.messages.length, 0);
    assert.match(ui.html(), /未收到已保存的笔记/);
  }
});

test("正在保存时阻止重复POST，编辑过程中版本改变则要求重读", async () => {
  const entry = todo(); let calls = 0, resolve;
  const ui = await interactive({ entry, postJson: () => { calls++; return new Promise((done) => { resolve = done; }); } });
  ui.click("记录已处理"); ui.draft("真实说明");
  const submit = button(ui.card(), "确认记录已处理"); submit.props.onClick(); submit.props.onClick();
  assert.equal(calls, 1); assert.match(ui.html(), /正在保存本地记录/);
  resolve({ ok: true, note: { ...entry, frontmatter: { ...entry.frontmatter, status: "完了" } } }); await settled();
  const stale = await interactive({ entry, postJson: async () => { throw new Error("must not post"); } });
  stale.click("记录已处理"); stale.draft("真实说明");
  const item = buildUserActions([job, entry], today).current[0];
  stale.updateItem({ ...item, note: { ...entry, stat: { ...entry.stat, mtime: 400 } } });
  stale.click("确认记录已处理"); await settled();
  assert.match(stale.html(), /笔记已被更新/); assert.equal(stale.written.length, 0);
});

test("日语覆盖分类、期限、来源和本地确认流程，不包含外部同意按钮", async () => {
  const html = await render(mixed(), { locale: "ja" });
  for (const label of ["あなたの対応が必要", "確認済みの本人対応", "確認が必要", "相手の対応待ち", "任意の事項", "対応履歴"]) assert.ok(html.includes(label), label);
  const detail = await renderDetail(mixed(), { locale: "ja" });
  for (const label of ["先方が指定した期限", "次に対応する人", "元の TODO を開く", "事項一覧に戻る", "操作と記録の説明"]) assert.ok(detail.includes(label), label);
  for (const label of ["需要你处理", "官方期限", "记录已处理", "打开原 TODO"]) assert.equal(html.includes(label), false);
  const ui = await interactive({ locale: "ja" }); ui.click("対応済みと記録");
  assert.match(ui.html(), /ローカルの対応記録だけを更新/);
  assert.match(ui.html(), /署名、同意や権限付与は行いません/);
  assert.equal(walk(ui.card()).some((node) => node.type === "button" && /^(同意|応募|送信)/.test(text(node.props.children))), false);
});
