import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAppModule } from "./helpers/render-tsx.mjs";

const props = { notes: [], today: "2026-10-25", view: "activity", actionsLoading: false, activityLoading: false,
  actionsFetchedAt: 100, activityFetchedAt: 100, onNavigate() {}, onOpen() {}, onNoteWritten() {} };
const workspace = await loadAppModule("app/progress-workspace.tsx");
const render = (extra = {}) => renderToStaticMarkup(createElement(workspace.default, { ...props, ...extra }));

test("进展与事项共用标题，保留两种浏览入口且不再挂常驻行动警示", () => {
  for (const view of ["activity", "actions"]) {
    const html = render({ view });
    assert.equal((html.match(/<h1[ >]/g) || []).length, 1);
    assert.match(html, /href="\/activity"/);
    assert.match(html, /href="\/actions"/);
    assert.doesNotMatch(html, /user-actions-entry|progress-workspace-action-count/);
  }
});

test("工作区切换走应用导航，修饰点击保留浏览器的打开行为", async () => {
  const navigated = [];
  const interactive = await loadAppModule("app/progress-workspace.tsx", { stubs: { react: { useMemo: (fn) => fn() }, "./ui-locale": { useUiLocale: () => ({ locale: "zh-CN" }) } } });
  const tree = interactive.default({ ...props, onNavigate: (view) => navigated.push(view) });
  const walk = (value) => !value || typeof value !== "object" ? [] : Array.isArray(value) ? value.flatMap(walk) : [value, ...walk(value.props?.children)];
  const link = walk(tree).find((node) => node.type === "a" && node.props.href === "/actions");
  for (const modified of [true, false]) {
    let prevented = false;
    link.props.onClick({ button: 0, ctrlKey: modified, preventDefault() { prevented = true; } });
    assert.equal(prevented, !modified);
  }
  assert.deepEqual(navigated, ["actions"]);
});

test("进展的时间范围与事项分类在合并后仍可独立查看", () => {
  assert.match(render(), /进展时间范围/);
  assert.match(render({ view: "actions" }), /当前需要处理/);
  assert.doesNotMatch(render(), /当前需要你处理<\/h2>/);
});
