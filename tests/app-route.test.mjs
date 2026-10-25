import assert from "node:assert/strict";
import test from "node:test";
import { appViewFromPathname, appViewHref, calendarRedirectHref, companyComparisonSearch } from "../app/app-route.ts";
import { loadAppModule } from "./helpers/render-tsx.mjs";

test("日历是首页视图，本人行动有固定独立入口", () => {
  assert.equal(appViewHref("calendar"), "/calendar");
  assert.equal(appViewFromPathname("/calendar/"), "calendar");
  assert.equal(appViewFromPathname("/actions"), "actions");
  assert.equal(appViewHref("actions"), "/actions");
  assert.equal(appViewFromPathname("/activity"), "activity");
  assert.equal(appViewHref("activity"), "/activity");
  assert.equal(appViewHref("analytics"), "/progress");
  for (const pathname of ["/", "/overview", "/overview/", "/todo"]) {
    assert.equal(appViewFromPathname(pathname), null);
  }
});

test("公司对比有独立地址，旧横向对照书签继续解析到同一视图", () => {
  assert.equal(appViewHref("insights"), "/interview/compare");
  assert.equal(appViewFromPathname("/interview/compare"), "insights");
  assert.equal(appViewFromPathname("/interview/compare/"), "insights");
  assert.equal(appViewFromPathname("/interview/insights"), "insights");
  assert.equal(appViewFromPathname("/interview/insights/"), "insights");
  assert.equal(appViewFromPathname("/interview/compare/unknown"), null);
  assert.equal(appViewHref("insights", new URLSearchParams({ selected: "テスト案件.md" })), "/interview/compare?selected=%E3%83%86%E3%82%B9%E3%83%88%E6%A1%88%E4%BB%B6.md");
});

test("公司对比的正本路径以重复参数往返，不按公司名去重也不在路由层限制数量", () => {
  const paths = ["20_求職/テスト A&B/案件 #1.md", "", "  ", "20_求職/テスト A&B/案件 #1.md", "20_求職/テスト A&B/別岗位.md",
    ...Array.from({ length: 8 }, (_, index) => `20_求職/テスト${index}/案件.md`)];
  const params = companyComparisonSearch(paths);
  const expected = paths.filter((value, index) => value.trim() && paths.indexOf(value) === index);
  assert.deepEqual(params.getAll("compare"), expected);
  assert.equal(params.has("company"), false);
  const url = new URL(appViewHref("insights", params), "https://example.test");
  assert.equal(url.pathname, "/interview/compare");
  assert.deepEqual(url.searchParams.getAll("compare"), expected);
  assert.ok(expected.length > 8, "数量上限由页面统一控制，路由保留明确传入的路径");
  assert.equal(companyComparisonSearch([]).toString(), "");
  assert.equal(paths.length, 13, "不改写传入的选择");
});

test("日历跳转清除行动筛选，完整保留笔记定位和重复查询参数", () => {
  const source = {
    tab: "open", who: "system", note: "20_求職/テスト A&B/记录 #1.md", section: "前提 + 确认",
    month: "2026-10", tag: ["面谈", "准备"], empty: "", omitted: undefined,
  };
  const url = new URL(calendarRedirectHref(source), "https://example.test");
  assert.equal(url.pathname, "/calendar");
  assert.equal(url.searchParams.has("tab"), false);
  assert.equal(url.searchParams.has("who"), false);
  assert.equal(url.searchParams.has("omitted"), false);
  assert.equal(url.searchParams.get("note"), source.note);
  assert.equal(url.searchParams.get("section"), source.section);
  assert.equal(url.searchParams.get("month"), source.month);
  assert.deepEqual(url.searchParams.getAll("tag"), source.tag);
  assert.equal(url.searchParams.get("empty"), "");
  assert.equal(source.tab, "open", "不改传入的页面参数");
  assert.equal(calendarRedirectHref(), "/calendar");
  const requestSearch = new URLSearchParams("note=test.md&tag=a&tag=b&tab=open&who=system");
  assert.equal(calendarRedirectHref(requestSearch), "/calendar?note=test.md&tag=a&tag=b");
  assert.equal(requestSearch.get("tab"), "open", "不改原始请求的查询参数");
});

const navigation = {
  redirect(href) { throw Object.assign(new Error("redirect"), { href }); },
  notFound() { throw new Error("not found"); },
};

test("根与总览跳转日历；本人行动页可直接打开", async () => {
  const { default: Home } = await loadAppModule("app/page.tsx", { stubs: { "next/navigation": navigation } });
  const { default: Section } = await loadAppModule("app/[section]/[[...rest]]/page.tsx", {
    stubs: { "next/navigation": navigation, "../../memory-atlas": { default() {} } },
  });
  const search = { tab: "open", who: "system", note: "记录.md", section: "确认" };
  const expected = calendarRedirectHref(search);
  await assert.rejects(Home({ searchParams: Promise.resolve(search) }), (error) => error.href === expected);
  for (const section of ["overview"]) {
    await assert.rejects(Section({
      params: Promise.resolve({ section }), searchParams: Promise.resolve(search),
    }), (error) => error.href === expected);
    await assert.rejects(Section({
      params: Promise.resolve({ section, rest: ["unknown"] }), searchParams: Promise.resolve({}),
    }), /not found/);
  }
  const calendar = await Section({ params: Promise.resolve({ section: "calendar" }), searchParams: Promise.resolve({}) });
  assert.equal(calendar.props.children.find((child) => child.props.initialView).props.initialView, "calendar");
  const actions = await Section({ params: Promise.resolve({ section: "actions" }), searchParams: Promise.resolve(search) });
  assert.equal(actions.props.children.find((child) => child.props.initialView).props.initialView, "actions");
  for (const name of ["compare", "insights"]) {
    const compared = await Section({ params: Promise.resolve({ section: "interview", rest: [name] }), searchParams: Promise.resolve({}) });
    assert.equal(compared.props.children.find((child) => child.props.initialView).props.initialView, "insights");
    assert.equal(compared.props.children[0].props.href, "/api/vault?scope=interview");
  }
  await assert.rejects(Section({ params: Promise.resolve({ section: "actions", rest: ["unknown"] }), searchParams: Promise.resolve({}) }), /not found/);
});
