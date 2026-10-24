import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAppModule } from "./helpers/render-tsx.mjs";

const month = await loadAppModule("app/calendar-view.tsx", {
  globals: { window: { location: { search: "?month=2026-08" } } },
});
const week = await loadAppModule("app/calendar-view.tsx", {
  globals: { window: { location: { search: "?calview=week&calweek=2026-08-10" } } },
});

const examples = [
  ["株式会社テスト開発", "テスト開発"],
  ["テスト研究株式会社", "テスト研究"],
  ["合同会社 テスト企画", "テスト企画"],
  ["テスト制作 有限会社", "テスト制作"],
  ["テスト株式会社研究所", "テスト株式会社研究所"],
];
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function render(module, company, time = "10:00") {
  const event = {
    id: "sample", note: { path: "テスト.md", frontmatter: { type: "todo" }, content: "", tags: [], stat: { ctime: 0, mtime: 1, size: 0 } },
    kind: "event", date: "2026-08-12", time, company, label: "一次面接", phase: "upcoming", caseId: "", prepPath: "",
  };
  return renderToStaticMarkup(createElement(module.default, {
    today: "2026-08-10", notes: [], events: [event], interviewTargets: new Map(), onOpen() {}, onInterview() {},
  }));
}

function button(html, className) {
  return [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)]
    .map((match) => match[0])
    .find((value) => new RegExp(`class="${className}(?: |")`).test(value));
}

function checkName(card, fullName, visibleName) {
  assert.ok(card, "应找到对应的日程按钮");
  assert.match(card, new RegExp(`<strong(?: class="[^"]*")?>${escape(visibleName)}<\\/strong>`));
  // 视觉简称不能替换辅助阅读与悬停提示中的正式名称。
  for (const attribute of ["title", "aria-label"]) {
    assert.match(card, new RegExp(`${attribute}="[^"]*${escape(fullName)}[^"]*"`));
  }
}

test("月格和右侧议程使用公司简称，完整名称仍可通过提示和辅助阅读取得", () => {
  for (const [fullName, visibleName] of examples) {
    const html = render(month, fullName);
    checkName(button(html, "calendar-event"), fullName, visibleName);
    checkName(button(html, "agenda-main"), fullName, visibleName);
    assert.match(button(html, "calendar-event"), />10:00<\/time>/, "时间继续显示");
  }
});

test("周视图普通时间块与全天项同样使用简称并保留完整名称", () => {
  for (const [fullName, visibleName] of examples.slice(0, 2)) {
    checkName(button(render(week, fullName), "cw-block"), fullName, visibleName);
    checkName(button(render(week, fullName, ""), "cw-chip"), fullName, visibleName);
  }
});
