import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAppModule } from "./helpers/render-tsx.mjs";

const { CalendarInterviewLinks } = await loadAppModule("app/calendar-interview-links.tsx", { stubs: { "./ui-locale": { useUiLocale: () => ({ locale: "zh-CN" }) } } });
const target = { company: "株式会社テスト", date: "2026-08-10", time: "13:00", label: "一次面接", sourcePath: "source.md", caseId: "test-case" };
const targets = { session: { ...target, view: "session", path: "prep.md" }, review: { ...target, view: "review", path: "study.md" } };

test("两个链接分别指向同场准备与复盘，保留精确材料、时刻和案件", () => {
  const html = renderToStaticMarkup(createElement(CalendarInterviewLinks, { targets, onNavigate() {} }));
  for (const [path, key, value] of [["/interview", "prep", "prep.md"], ["/interview/review", "review", "study.md"]]) {
    const href = [...html.matchAll(/href="([^"]+)"/g)].map((m) => new URL(m[1].replaceAll("&amp;", "&"), "https://example.com")).find((url) => url.pathname === path);
    assert.equal(href.searchParams.get(key), value);
    assert.equal(href.searchParams.get("date"), target.date);
    assert.equal(href.searchParams.get("time"), target.time);
    assert.equal(href.searchParams.get("case"), target.caseId);
  }
  assert.doesNotMatch(html, /<button/);
});

test("点击独立入口传递选定视图，修饰点击仍可在新标签页打开", () => {
  const calls = [];
  const tree = CalendarInterviewLinks({ targets, onNavigate: (view) => calls.push(view) });
  const links = tree.props.children;
  let prevented = 0;
  for (const link of links) link.props.onClick({ button: 0, preventDefault() { prevented++; } });
  assert.deepEqual(calls, ["session", "review"]);
  links[0].props.onClick({ button: 0, ctrlKey: true, preventDefault() { prevented++; } });
  assert.equal(prevented, 2);
});

test("缺少材料仍保持同场入口并注明待补，不用别的场次代替", () => {
  const html = renderToStaticMarkup(createElement(CalendarInterviewLinks, { targets: { ...targets, session: { ...targets.session, path: null } }, onNavigate() {} }));
  assert.match(html, /title="面试准备 · 资料待补充"/);
  assert.match(html, /data-missing="true"/);
  assert.equal(CalendarInterviewLinks({ targets: { session: null, review: null }, onNavigate() {} }), null);
});
