import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IN_FLIGHT_STATUSES, awaitingCounterpart, toJobCard } from "../lib/jobs.ts";
import { buildDerivedData } from "../lib/memory-atlas-data.ts";
import { loadAppModule } from "./helpers/render-tsx.mjs";

// 首页顶部四个数字各自是跳转入口：件数必须和点进去的那一页同一条规则，否则数字没法信。
// derived 按外壳（app/memory-atlas.tsx）同样的方式从 notes 现算，不手搓 DerivedData。
const { default: Overview } = await loadAppModule("app/overview-view.tsx");

const TODAY = "2026-09-28";
const note = (path, frontmatter, content = "") => ({ path, frontmatter, content, tags: [], stat: { ctime: 0, mtime: 1, size: content.length } });
const jobCase = (name, frontmatter) => note(`20_求職/${name}/案件.md`, { type: "job-case", company: name, ...frontmatter }, `# ${name} — データエンジニア\n`);
const todo = (name, frontmatter) => note(`20_求職/_TODO/${name}.md`, { type: "todo", action: name, ...frontmatter }, `# ${name}\n`);

const notes = [
  jobCase("株式会社テスト", { status: "未応募", rating: 8 }),
  jobCase("株式会社サンプル", { status: "未応募", rating: 7, waiting_for: "company" }),
  jobCase("株式会社ダミー", { status: "未応募", rating: 6, waiting_for: "self" }),
  jobCase("株式会社テスト二", { status: "応募済", channel: "Green", status_updated: "2026-09-20" }),
  jobCase("株式会社テスト三", { status: "書類通過", channel: "Green", status_updated: "2026-09-21" }),
  jobCase("株式会社テスト四", { status: "面接中（2026-09-25・一次面接）", channel: "Green", status_updated: "2026-09-25" }),
  jobCase("株式会社テスト五", { status: "内定", channel: "Green", status_updated: "2026-09-26" }),
  jobCase("株式会社テスト六", { status: "不採用", channel: "Green", status_updated: "2026-09-10" }),
  todo("書類を準備する", { status: "未着手", priority: "high" }),
  todo("面談の日程を返信する", { status: "進行中", priority: "medium" }),
  todo("終わった件", { status: "完了", priority: "low" }),
  todo("台帳の補修", { status: "未着手", audience: "system" }),
];

const render = (list) => renderToStaticMarkup(createElement(Overview, {
  notes: list,
  derived: buildDerivedData(list, new Date(`${TODAY}T00:00:00`)),
  today: TODAY,
  onOpen() {}, onView() {}, onQuery() {}, onOpenReview() {},
  onTodoStatus: async () => null,
}));

/** 顶部统计条里的按钮：[数字, 标签]。 */
const statTiles = (html) => {
  const strip = html.match(/<div class="overview-current-stats">([\s\S]*?)<\/div>/)?.[1] ?? "";
  return [...strip.matchAll(/<button type="button" data-zero="(true|false)"><strong>(\d+)<\/strong><span>([^<]+)<\/span><\/button>/g)]
    .map(([, zero, value, label]) => ({ zero: zero === "true", value: Number(value), label }));
};

test("四个统计块都是 <button>，件数与各自的跳转规则一致", () => {
  const tiles = statTiles(render(notes));
  assert.deepEqual(tiles.map((tile) => tile.label), ["件待办", "个进行中案件", "条待应募岗位", "个复盘点待裁定"]);

  const cards = notes.filter((item) => item.frontmatter.type === "job-case").map(toJobCard);
  // 待应募＝未応募 且不在等对方（看板的「未动手」）；waiting_for: self 仍算自己手里的。
  const untouched = cards.filter((job) => job.status === "未応募" && !awaitingCounterpart(job)).length;
  assert.equal(untouched, 2, "fixture 自检：3 条未応募里 1 条在等企业");
  // 进行中＝IN_FLIGHT_STATUSES（内定不在其内，与看板筛选一致）。
  const inFlight = cards.filter((job) => IN_FLIGHT_STATUSES.includes(job.status)).length;
  assert.equal(inFlight, 3, "fixture 自检：応募済・書類通過・面接中");

  assert.deepEqual(tiles, [
    { zero: false, value: 2, label: "件待办" },
    { zero: false, value: inFlight, label: "个进行中案件" },
    { zero: false, value: untouched, label: "条待应募岗位" },
    { zero: true, value: 0, label: "个复盘点待裁定" },
  ]);
});

test("行动数只数本人的未完成项：系统维护与完了不计入", () => {
  const html = render(notes);
  assert.match(html, /全部 2 项/);
  assert.match(html, /書類を準備する/);
  assert.doesNotMatch(html, /台帳の補修/);
  assert.doesNotMatch(html, /終わった件/);
});

test("空 vault 渲染空态而不抛错，四个数字都是 0", () => {
  let html = "";
  assert.doesNotThrow(() => { html = render([]); });
  assert.match(html, /当前没有待执行的重点行动/);
  assert.match(html, /当前没有需要推进的行动。/);
  assert.doesNotMatch(html, /data-overview-panel="(cases|jobs|schedule|waiting|review|practice)"/, "没有数据的面板整块不出");
  assert.match(html, /class="overview-columns is-single"/);
  assert.deepEqual(statTiles(html).map((tile) => [tile.value, tile.zero]), [[0, true], [0, true], [0, true], [0, true]]);
});
