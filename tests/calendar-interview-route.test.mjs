import assert from "node:assert/strict";
import test from "node:test";
import {
  appViewFromPathname,
  appViewHref,
  calendarInterviewFromSearch,
  calendarInterviewSearch,
  companyOverviewSearch,
} from "../app/app-route.ts";

test("公司总览以真实上下文路径分享，无准备稿不借用其他场次", () => {
  const context = "20_求職/_TODO/テスト A&B_面談.md";
  const params = companyOverviewSearch("株式会社テスト", context);
  const url = new URL(appViewHref("session", params), "https://example.test");
  assert.equal(url.searchParams.get("context"), context);
  assert.equal(url.searchParams.has("prep"), false);
  assert.equal(calendarInterviewFromSearch("session", params.toString()), null);
  assert.equal(companyOverviewSearch("株式会社テスト", context, "准备.md").get("prep"), "准备.md");
});

function target(overrides = {}) {
  return {
    view: "session", path: "20_求職/テスト/一次面接_准备.md", company: "株式会社テスト",
    date: "2026-09-14", label: "第一次面试", sourcePath: "20_求職/テスト/案件.md",
    caseId: "test-case", time: undefined, ...overrides,
  };
}

test("准备和复盘链接可以从 URL 完整恢复原日历场次", () => {
  for (const [view, path, route] of [
    ["session", "20_求職/テスト/准备.md", "/interview"],
    ["review", "20_求職/テスト/整理稿.md", "/interview/review"],
  ]) {
    const original = target({ view, path });
    const params = calendarInterviewSearch(original);
    const url = new URL(appViewHref(view, params), "https://example.test");
    assert.equal(url.pathname, route);
    assert.deepEqual(calendarInterviewFromSearch(appViewFromPathname(url.pathname), url.search), original);
    assert.equal(params.get(view === "session" ? "prep" : "review"), path);
    assert.equal(params.has(view === "session" ? "review" : "prep"), false);
  }
});

test("没有准备稿或整理稿时仍保留公司、日期、轮次和来源，恢复为空路径", () => {
  for (const view of ["session", "review"]) {
    const original = target({ view, path: null, caseId: "" });
    const params = calendarInterviewSearch(original);
    assert.equal(params.has("prep"), false);
    assert.equal(params.has("review"), false);
    assert.equal(params.has("case"), false);
    assert.deepEqual(calendarInterviewFromSearch(view, params.toString()), original);
  }
});

test("Unicode、空格和 URL 保留字符不能改变场次或路径", () => {
  const original = target({
    company: "株式会社テスト Ａ＆Ｂ", label: "轻松面谈 / 技術 Q&A",
    path: "20_求職/テスト Ａ＆Ｂ/准备 #1 + 100%?.md",
    sourcePath: "20_求職/テスト/案件&role=別件.md", caseId: "test-case+面谈/01",
  });
  const url = new URL(appViewHref("session", calendarInterviewSearch(original)), "https://example.test");
  assert.equal(url.hash, "");
  assert.equal(url.searchParams.has("role"), false);
  assert.deepEqual(calendarInterviewFromSearch("session", url.search), original);
});

test("已知时间随链接保留，完整资料加载后仍能区分同日同轮的场次", () => {
  const original = target({ time: "09:30" });
  const url = new URL(appViewHref("session", calendarInterviewSearch(original)), "https://example.test");
  assert.equal(url.searchParams.get("time"), "09:30");
  assert.deepEqual(calendarInterviewFromSearch("session", url.search), original);
  assert.equal(calendarInterviewSearch(target()).has("time"), false);
});

test("缺少来源或日期、日期格式损坏时不建立日历上下文", () => {
  const invalid = [
    "", "?prep=legacy.md", "?event=source.md", "?date=2026-09-14",
    "?event=&date=2026-09-14", "?event=source.md&date=",
    "?event=source.md&date=2026/09/14", "?event=source.md&date=2026-9-14",
    "?event=source.md&date=2026-09-14extra",
  ];
  for (const view of ["session", "review"]) {
    for (const search of invalid) assert.equal(calendarInterviewFromSearch(view, search), null, search);
  }
});

test("其他页面不消费日历面试参数，准备和复盘各自只读自己的选中键", () => {
  const params = calendarInterviewSearch(target());
  for (const view of ["overview", "prep", "practice", "language", "jobs", "calendar", "todo", "library"]) {
    assert.equal(calendarInterviewFromSearch(view, params.toString()), null, view);
  }
  assert.equal(calendarInterviewFromSearch("review", params.toString()).path, null);
  params.delete("prep");
  params.set("review", "整理稿.md");
  assert.equal(calendarInterviewFromSearch("session", params.toString()).path, null);
});

test("可选信息缺省时保留安全默认值，href 接受 URLSearchParams 或查询字符串", () => {
  const search = "event=source.md&date=2026-09-14";
  assert.deepEqual(calendarInterviewFromSearch("session", search), {
    view: "session", path: null, company: "", date: "2026-09-14", label: "面试", sourcePath: "source.md", caseId: "", time: undefined,
  });
  assert.equal(appViewHref("session", `?${search}`), appViewHref("session", new URLSearchParams(search)));
  assert.equal(appViewHref("session", ""), "/interview");
  assert.equal(appViewHref("review"), "/interview/review");
});
