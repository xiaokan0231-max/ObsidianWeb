import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAppModule } from "./helpers/render-tsx.mjs";

// 月份从 ?month= 读：注入一个只有 location 的 window，其余 lib 依赖由加载器按真实模块解析。
const components = await loadAppModule("app/calendar-view.tsx", { globals: { window: { location: { search: "?month=2026-08" } } } });

test("日历月格与议程显示明确时间范围，并标注日本时间", () => {
  const html = renderToStaticMarkup(createElement(components.default, {
    today: "2026-08-10",
    events: [{
      id: "test", note: {}, kind: "event", date: "2026-08-10", time: "10:00", endTime: "10:30",
      company: "株式会社テスト", label: "面谈", phase: "upcoming", caseId: "", prepPath: "",
    }],
    interviewTargets: new Map(), onOpen() {}, onInterview() {},
  }));
  assert.match(html, /日本时间（JST）/);
  assert.match(html, /dateTime="2026-08-10T10:00\+09:00">10:00–10:30<\/time>/);
  assert.match(html, /<small>10:00–10:30 · 面谈<\/small>/);
  assert.match(html, /aria-label="2026-08-10 · 10:00–10:30 · JST · 株式会社テスト/);
});
