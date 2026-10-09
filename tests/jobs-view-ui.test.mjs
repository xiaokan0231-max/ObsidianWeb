import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAppModule } from "./helpers/render-tsx.mjs";

// 求职看板的决策台：不注入 window，URL 状态走 SSR 分支（默认视图＝决策台、默认只看未応募）。
// 周复盘的 Markdown 渲染与这里断言的看板・空态无关，换成替身，免得把阅读模块链整条拉进来。
const { default: JobsView } = await loadAppModule("app/jobs-view.tsx", {
  stubs: { "./markdown-document": { default: () => null } },
});

const V2 = {
  rating_version: "v2", fit_score_100: 74, fit_band_final: "B", hard_gate: "hold",
  score_technical_value: 20, score_document_match: 6, score_transferability: 12, score_org_legibility: 16, score_client_deployability: 12, score_role_coherence: 8,
};
const jobCase = (name, frontmatter) => ({
  path: `20_求職/${name}/案件.md`,
  frontmatter: { type: "job-case", company: name, ...frontmatter },
  content: `# ${name} — データエンジニア\n`,
  tags: [],
  stat: { ctime: 0, mtime: 1, size: 0 },
});
const render = (notes) => renderToStaticMarkup(createElement(JobsView, { notes, today: "2026-09-28", onOpen() {} }));

test("决策台详情带六轴雷达、技术栈与「投了 / 保留 / 见送」快捷判断", () => {
  const html = render([
    jobCase("株式会社テスト", { status: "未応募", rating: 8, stack: ["Python", "Spark"], ...V2 }),
    jobCase("株式会社サンプル", { status: "未応募", rating: 7 }),
  ]);
  const detail = html.match(/<article class="jobs-decision-detail">([\s\S]*?)<\/article>/)?.[1] ?? "";
  assert.match(detail, /<h2>株式会社テスト<\/h2>/, "队首是评分最高的一条");
  assert.match(detail, /class="job-fit-panel"[\s\S]*class="radar-chart job-fit-radar"/);
  assert.match(detail, /class="job-stack jobs-decision-stack"[^>]*><span>Python<\/span><span>Spark<\/span>/);
  assert.match(detail, /class="job-quick-decisions" role="group"[^>]*><button type="button" class="job-quick-applied">投了<\/button><button type="button" class="job-quick-hold">保留<\/button><button type="button" class="job-quick-pass">见送<\/button>/);
  assert.match(html, /<button aria-current="true" class="active"/, "队列里标出当前选中");
});

test("筛选结果为空时逐组给出「去掉后可得 N 条」", () => {
  const html = render([jobCase("株式会社テスト", { status: "応募済", channel: "Green", rating: 8 })]);
  assert.match(html, /没有岗位同时满足这些条件。/);
  assert.match(html, /<ul class="jobs-empty-relax" aria-label="逐项放宽"><li><button type="button"><b>应募状态<\/b><span>去掉后可得 1 条<\/span><\/button><\/li><\/ul>/);
});
