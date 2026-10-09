import assert from "node:assert/strict";
import test from "node:test";
import { userActionsHref, userActionsListPosition, userActionsRoute } from "../app/user-actions-route.ts";

test("事项深链以完整路径定位并保留列表分类，非法分类回到当前事项", () => {
  const route = { category: "review", actionPath: "20_求職/_TODO/株式会社テスト_材料 #1.md" };
  const href = userActionsHref(route);
  assert.ok(href.startsWith("/actions?category=review&action="));
  assert.deepEqual(userActionsRoute(href.slice(href.indexOf("?"))), route);
  assert.deepEqual(userActionsRoute("?category=unknown&action="), { category: "current", actionPath: null });
  assert.equal(userActionsHref({ category: "current", actionPath: null }), "/actions");
  assert.equal(userActionsHref({ category: "waiting", actionPath: null }), "/actions?category=waiting");
});

test("列表位置只接受有效的专属history记录，不借用外壳滚动槽", () => {
  const position = { category: "waiting", path: "20_求職/_TODO/株式会社テスト.md", scrollY: 438 };
  assert.deepEqual(userActionsListPosition({ __echoEntry: "shell-entry", __echoScrollY: 999, __echoActionsList: position }), position);
  for (const state of [null, { __echoScrollY: 999 }, { __echoActionsList: { ...position, category: "unknown" } }, { __echoActionsList: { ...position, scrollY: -1 } }, { __echoActionsList: { ...position, scrollY: Infinity } }, { __echoActionsList: { ...position, path: 12 } }]) {
    assert.equal(userActionsListPosition(state), null);
  }
});
