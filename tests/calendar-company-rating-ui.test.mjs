import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAppModule } from "./helpers/render-tsx.mjs";
import { noteInVaultScope } from "../lib/vault-scope.ts";

const zh = await loadAppModule("app/calendar-company-rating.tsx");
const ja = await loadAppModule("app/calendar-company-rating.tsx", { stubs: { "./ui-locale": { useUiLocale: () => ({ locale: "ja" }) } } });
const rating = { platform: "OpenWork", score: 4.18, scale: 5, sampleCount: 12, sampleUnit: "名回答者", readOn: "2026-08-10", commentPeriod: "2024〜2026年", limitations: "样本范围有限", coverage: "工程师", url: "https://example.com/company/reviews", status: "available" };
const render = (mod, props) => renderToStaticMarkup(createElement(mod.CalendarCompanyRatingBadge, props));

test("口碑紧凑显示星标，完整量尺、样本及日期保留在提示中", () => {
  const html = render(zh, { rating, compact: true });
  assert.match(html, /calendar-rating-star">★<\/span> 4\.18/);
  assert.match(html, /aria-label="OpenWork · 公司口碑 4\.18\/5/);
  assert.match(html, /12 名回答者/);
  assert.match(html, /读取日期 2026-08-10/);
  assert.match(html, /2024〜2026年/);
  assert.doesNotMatch(html, /4\.18分|85分/);
  assert.match(render(zh, { rating }), /calendar-rating-platform">OpenWork <\/span>/);
});

test("未知评分不显示数字，非五分制仍显示原量尺，日语标签可读", () => {
  assert.equal(render(zh, {}), "");
  assert.match(render(zh, { rating: { ...rating, platform: "口コミサイト", score: 8.2, scale: 10 }, compact: true }), /8\.20\/10/);
  assert.match(render(ja, { rating }), /企業の口コミ評価 4\.18\/5/);
});

test("日历冷启动读取公司卷宗，普通公司研究报告仍按需加载", () => {
  const note = (frontmatter) => ({ path: "test.md", content: "", tags: [], stat: { ctime: 0, mtime: 0, size: 0 }, frontmatter });
  assert.equal(noteInVaultScope(note({ type: "company" }), "actions"), true);
  assert.equal(noteInVaultScope(note({ type: "ai-report", report_kind: "company-summary" }), "actions"), false);
  assert.equal(noteInVaultScope(note({ type: "ai-report", report_kind: "company-fit" }), "actions"), false);
});
