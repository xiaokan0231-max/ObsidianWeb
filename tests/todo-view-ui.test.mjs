import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAppModule } from "./helpers/render-tsx.mjs";

// 行动清单：状态标签的件数、「本人行动／系统维护」的分流、空态。
// useUrlState 只在 useState 的初始化里读 window：不注入 window 就是 SSR 路径；
// 注入只有 location 的 window 则模拟「带着 ?tab= / ?who= 打开」。
const loadTodoView = async (search) => (await loadAppModule("app/todo-view.tsx", search === undefined ? {} : { globals: { window: { location: { search } } } })).default;

const TODAY = "2026-09-28";
const todo = (name, frontmatter) => ({ path: `20_求職/_TODO/${name}.md`, frontmatter: { type: "todo", action: name, ...frontmatter }, content: `# ${name}\n`, tags: [], stat: { ctime: 0, mtime: 1, size: 0 } });
const notes = [
  todo("株式会社テストの書類を準備する", { status: "未着手", priority: "high" }),
  todo("株式会社サンプルへ返信する", { status: "未着手", priority: "medium" }),
  todo("株式会社ダミーの面談準備", { status: "進行中", priority: "medium" }),
  todo("済んだ件", { status: "完了", priority: "low" }),
  todo("台帳の補修", { status: "未着手", audience: "system" }),
  todo("同期スクリプトの修理", { status: "保留", audience: "system" }),
  // type が todo でないノートは数えない。
  { path: "20_求職/株式会社テスト/案件.md", frontmatter: { type: "job-case", status: "未着手" }, content: "", tags: [], stat: { ctime: 0, mtime: 1, size: 0 } },
];
const render = (TodoView, list = notes) => renderToStaticMarkup(createElement(TodoView, { notes: list, today: TODAY, onOpen() {}, onStatus: async () => null }));
const tabs = (html) => [...(html.match(/aria-label="行动状态筛选">([\s\S]*?)<\/div>/)?.[1] ?? "")
  .matchAll(/<button class="(active|)">([^<]+?) <small>(\d+)<\/small><\/button>/g)]
  .map(([, active, label, count]) => [label, Number(count), active === "active"]);
const cards = (html) => [...html.matchAll(/<h2>([^<]+)<\/h2>/g)].map((match) => match[1]);

test("没有 window 也能渲染（SSR）：默认本人行动・全部标签，件数按状态分开数", async () => {
  const html = render(await loadTodoView());
  assert.deepEqual(tabs(html), [["全部", 4, true], ["未完成", 3, false], ["未着手", 2, false], ["進行中", 1, false], ["完了", 1, false]], "没有事项的状态（保留）不出标签");
  assert.match(html, /<span>未完成 <strong>3<\/strong><\/span><span>高优先 <strong>1<\/strong><\/span>/);
  assert.deepEqual(cards(html), ["株式会社テストの書類を準備する", "株式会社サンプルへ返信する", "株式会社ダミーの面談準備", "済んだ件"], "按优先级、再按状态顺序排");
  assert.match(html, /<h1 class="sr-only">行动清单<\/h1>/);
  // 系统维护只在「管理工具」里露一个入口，件数只数未完成的。
  assert.match(html, /<summary>管理工具<\/summary>/);
  assert.match(html, /查看系统维护 <small>2<\/small> →/);
  assert.doesNotMatch(html, /台帳の補修|同期スクリプトの修理/);
});

test("?who=system 切到系统维护：只列系统事项，有返回入口，不再出管理工具", async () => {
  const html = render(await loadTodoView("?who=system"));
  assert.match(html, /<h1 class="sr-only">系统维护<\/h1>/);
  assert.match(html, /← 返回行动清单/);
  assert.deepEqual(tabs(html), [["全部", 2, true], ["未完成", 2, false], ["未着手", 1, false], ["保留", 1, false]]);
  assert.match(html, /<span>未完成 <strong>2<\/strong><\/span><span>内部记录 <strong>2<\/strong><\/span>/);
  assert.deepEqual(cards(html).sort(), ["台帳の補修", "同期スクリプトの修理"].sort());
  assert.doesNotMatch(html, /管理工具/);
});

test("?tab= 选中某个状态只列该状态；URL 里写错的标签落回全部", async () => {
  const inProgress = render(await loadTodoView("?tab=進行中"));
  assert.deepEqual(tabs(inProgress).find(([, , active]) => active), ["進行中", 1, true]);
  assert.deepEqual(cards(inProgress), ["株式会社ダミーの面談準備"]);
  const bogus = render(await loadTodoView("?tab=検討中"));
  assert.deepEqual(tabs(bogus)[0], ["全部", 4, true]);
  assert.equal(cards(bogus).length, 4);
});

test("?tab=open：只列未完成（完了以外），件数与摘要里的「未完成」、首页的「N 件待办」同一口径", async () => {
  const html = render(await loadTodoView("?tab=open"));
  assert.deepEqual(tabs(html).find(([, , active]) => active), ["未完成", 3, true]);
  assert.deepEqual(cards(html), ["株式会社テストの書類を準備する", "株式会社サンプルへ返信する", "株式会社ダミーの面談準備"]);
  assert.match(html, /<span>未完成 <strong>3<\/strong>/);
});

test("本人侧存在但该状态为空时提示「该状态下没有事项」", async () => {
  const html = render(await loadTodoView("?tab=保留"));
  assert.equal(cards(html).length, 0);
  assert.match(html, /该状态下没有事项。/);
  assert.doesNotMatch(html, /当前没有行动。/);
});

test("空列表：两侧各自的空态文案，不出管理工具入口", async () => {
  const empty = render(await loadTodoView(), []);
  assert.deepEqual(tabs(empty), [["全部", 0, true]]);
  assert.match(empty, /当前没有行动。/);
  assert.match(empty, /<code>20_求職\/_TODO\/<\/code>/);
  assert.doesNotMatch(empty, /管理工具|该状态下没有事项/);
  const emptySystem = render(await loadTodoView("?who=system"), []);
  assert.match(emptySystem, /当前没有系统维护事项。/);
});
