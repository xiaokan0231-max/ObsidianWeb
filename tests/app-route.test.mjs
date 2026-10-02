import assert from "node:assert/strict";
import test from "node:test";
import { appViewFromPathname, appViewHref, calendarRedirectHref } from "../app/app-route.ts";
import { loadAppModule } from "./helpers/render-tsx.mjs";

test("总览拥有独立地址，根入口和旧行动入口不再是视图", () => {
  assert.equal(appViewHref("overview"), "/overview");
  assert.equal(appViewFromPathname("/overview/"), "overview");
  assert.equal(appViewFromPathname("/calendar/"), "calendar");
  for (const pathname of ["/", "/actions", "/todo"]) {
    assert.equal(appViewFromPathname(pathname), null);
  }
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

test("根页面和旧行动页面执行服务器跳转并保留原笔记", async () => {
  const { default: Home } = await loadAppModule("app/page.tsx", { stubs: { "next/navigation": navigation } });
  const { default: Section } = await loadAppModule("app/[section]/[[...rest]]/page.tsx", {
    stubs: { "next/navigation": navigation, "../../memory-atlas": { default() {} } },
  });
  const search = { tab: "open", who: "system", note: "记录.md", section: "确认" };
  const expected = calendarRedirectHref(search);
  await assert.rejects(Home({ searchParams: Promise.resolve(search) }), (error) => error.href === expected);
  await assert.rejects(Section({
    params: Promise.resolve({ section: "actions" }), searchParams: Promise.resolve(search),
  }), (error) => error.href === expected);
  const overview = await Section({ params: Promise.resolve({ section: "overview" }), searchParams: Promise.resolve({}) });
  assert.equal(overview.props.initialView, "overview");
  const calendar = await Section({ params: Promise.resolve({ section: "calendar" }), searchParams: Promise.resolve({}) });
  assert.equal(calendar.props.initialView, "calendar");
  await assert.rejects(Section({
    params: Promise.resolve({ section: "actions", rest: ["unknown"] }), searchParams: Promise.resolve({}),
  }), /not found/);
});
