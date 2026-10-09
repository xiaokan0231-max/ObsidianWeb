import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAppModule } from "./helpers/render-tsx.mjs";

// 选考与分析页：scope 未到时不能把「没加载」画成「没有」，台帳过期要明说，优先案件卡要落到正确的案件。
// 不注入 window：期间筛选的 useUrlState 走 SSR 分支（只在 useState 初始化里读 window）。
const { default: JobsAnalytics } = await loadAppModule("app/jobs-analytics.tsx");

const jobCase = (name, frontmatter, content = `# ${name} — データエンジニア\n`) => ({
  path: `20_求職/${name}/案件.md`, frontmatter: { type: "job-case", company: name, ...frontmatter }, content, tags: [], stat: { ctime: 0, mtime: 1, size: content.length },
});
const notes = [
  jobCase("株式会社テスト", {
    status: "面接中（2026-09-25・一次面接）", channel: "Green", status_updated: "2026-09-25", rating: 8,
    next_event_at: "2026-10-02 14:00", next_action: "二次面接の準備", stack: ["Python", "Spark"],
  }),
  jobCase("株式会社サンプル", { status: "応募済", channel: "Green", status_updated: "2026-09-20", rating: 9 }),
  jobCase("株式会社ダミー", { status: "未応募", rating: 7 }),
];
const render = (props) => renderToStaticMarkup(createElement(JobsAnalytics, { notes, onOpen() {}, onViewJobs() {}, ...props }));
const EMPTY_LEDGER = "台帳の集計がまだ生成されていない。";

test("scope 未到（loading）时台帳卡画读取中，不画「台帳还没生成」", () => {
  const loading = render({ loading: true, notes: [] });
  assert.match(loading, /<div class="scope-loading" role="status" aria-live="polite">/);
  assert.match(loading, /正在读取台帳…/);
  assert.doesNotMatch(loading, new RegExp(EMPTY_LEDGER));
  const loaded = render({ loading: false, notes: [] });
  assert.match(loaded, new RegExp(EMPTY_LEDGER));
  assert.doesNotMatch(loaded, /scope-loading/);
});

test("loading 时同样读台帳的月别推移・应募日两张卡也不该画空态", () => {
  const loading = render({ loading: true, notes: [] });
  assert.doesNotMatch(loading, /この期間に該当するデータがない。/);
  assert.doesNotMatch(loading, /応募日台帳がまだ無い。/);
});

test("derivedState：stale 显示过期横幅与重算按钮（带错误说明），rebuilding 显示重算中，fresh 不显示", () => {
  const stale = render({ derivedState: "stale", statsError: "vault:stats 失败。", onRebuildStats() {} });
  assert.match(stale, /<p class="analytics-stale stale" role="status">案件状态已写入，下方图表仍是上一次 vault:stats 的结果。 vault:stats 失败。<button type="button">立即重算<\/button><\/p>/);
  const staleWithoutAction = render({ derivedState: "stale" });
  assert.match(staleWithoutAction, /class="analytics-stale stale"/);
  assert.doesNotMatch(staleWithoutAction, /立即重算/, "外壳没给重算入口时不画一个点了没反应的按钮");
  const rebuilding = render({ derivedState: "rebuilding", onRebuildStats() {} });
  assert.match(rebuilding, /<p class="analytics-stale rebuilding" role="status">案件状态已写入，正在重算台帳的派生统计…<\/p>/);
  assert.doesNotMatch(render({}), /analytics-stale/);
});

test("面接中的案件成为优先卡：状态・公司・岗位・下一步・次回日程・评分都落在同一条案件上", () => {
  const html = render({});
  const card = html.match(/<button type="button" class="analytics-priority-card">([\s\S]*?)<\/button>/)?.[1] ?? "";
  assert.ok(card, "渲染出优先卡");
  assert.match(card, /<b>面接を最優先<\/b><i class="tone-[a-z]+">面接中<\/i>/);
  assert.match(card, /<strong>株式会社テスト<\/strong><small>データエンジニア<\/small>/);
  assert.match(card, /<span>下一步<\/span><p>二次面接の準備<\/p>/);
  assert.match(card, /<dt>次回日程<\/dt><dd>10\/2 14:00<\/dd>/);
  assert.match(card, /<dt>応募优先度<\/dt><dd>8 \/ 10<\/dd>/);
  assert.match(card, /class="analytics-priority-evidence">Python・Spark</);
  // 另一条高分的応募済进观察名单，而不是抢走优先卡。
  assert.match(html, /class="analytics-watch-row"[\s\S]*?<strong>株式会社サンプル<\/strong>/);
  assert.match(html, /<span>2 件进行中 · 1 件优先处理 · 1 件观察<\/span>/);
});

test("没有选考中的案件时不出优先卡，改为空态", () => {
  const html = render({ notes: [jobCase("株式会社ダミー", { status: "未応募", rating: 7 })] });
  assert.doesNotMatch(html, /analytics-priority-card/);
  assert.match(html, /当前没有处于选考中的案件。/);
});

test("选考管线：KPI 下常驻分段条，每段按状态上色、可点进看板只看这一段", () => {
  const seen = [];
  const html = render({ onViewJobs: (filters) => seen.push(filters) });
  const track = html.match(/<div class="analytics-pipeline-track">([\s\S]*?)<\/div>/)?.[1] ?? "";
  assert.match(track, /data-tone="progress" data-status="応募済"[^>]*><span>応募済<\/span><b>1<\/b><\/button>/);
  assert.match(track, /data-tone="interview" data-status="面接中"[^>]*><span>面接中<\/span><b>1<\/b><\/button>/);
  assert.doesNotMatch(track, /書類通過|内定/, "0 件的段不画");
  const empty = render({ notes: [jobCase("株式会社ダミー", { status: "未応募", rating: 7 })] });
  assert.match(empty, /<span class="analytics-pipeline-empty">暂无进行中的案件<\/span>/);
});

test("「当前推进」默认展开；漏斗画成梯形并标相邻转化率，表格多一列前段比", () => {
  const html = render({});
  assert.match(html, /<details class="analytics-command analytics-command-disclosure" open="">/);
  assert.match(html, /<svg class="chart-funnel"[^>]*role="img"/);
  assert.equal((html.match(/class="chart-funnel-shape"/g) ?? []).length, 4);
  // 応募（観測済）＝不採用 0 ＋ 进行中 2；書類通過＝面接中 1 → 前段比 50.0%。
  assert.match(html, /class="chart-funnel-rate"[^>]*>→ (?:<!-- -->)?50\.0%<\/text>/);
  assert.match(html, /<th>段階<\/th><th>件数<\/th><th>応募比<\/th><th>前段比<\/th>/);
});
