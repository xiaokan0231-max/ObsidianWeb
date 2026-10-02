import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IN_FLIGHT_STATUSES, awaitingCounterpart, toJobCard } from "../lib/jobs.ts";
import { buildDerivedData } from "../lib/memory-atlas-data.ts";
import { loadAppModule } from "./helpers/render-tsx.mjs";

// 概览顶部三个数字各自是跳转入口：件数必须和点进去的那一页同一条规则，否则数字没法信。
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
  onOpen() {}, onView() {}, onOpenReview() {},
}));

/** 顶部统计条里的按钮：[数字, 标签]。 */
const statTiles = (html) => {
  const strip = html.match(/<div class="overview-stats">([\s\S]*?)<\/div>/)?.[1] ?? "";
  return [...strip.matchAll(/<button type="button" data-zero="(true|false)"><strong>(\d+)<\/strong><span>([^<]+)<\/span><\/button>/g)]
    .map(([, zero, value, label]) => ({ zero: zero === "true", value: Number(value), label }));
};

test("三个统计块都是 <button>，件数与各自的跳转规则一致", () => {
  const tiles = statTiles(render(notes));
  assert.deepEqual(tiles.map((tile) => tile.label), ["个进行中案件", "条待应募岗位", "个复盘点待裁定"]);

  const cards = notes.filter((item) => item.frontmatter.type === "job-case").map(toJobCard);
  // 待应募＝未応募 且不在等对方（看板的「未动手」）；waiting_for: self 仍算自己手里的。
  const untouched = cards.filter((job) => job.status === "未応募" && !awaitingCounterpart(job)).length;
  assert.equal(untouched, 2, "fixture 自检：3 条未応募里 1 条在等企业");
  // 进行中＝IN_FLIGHT_STATUSES（内定不在其内，与看板筛选一致）。
  const inFlight = cards.filter((job) => IN_FLIGHT_STATUSES.includes(job.status)).length;
  assert.equal(inFlight, 3, "fixture 自检：応募済・書類通過・面接中");

  assert.deepEqual(tiles, [
    { zero: false, value: inFlight, label: "个进行中案件" },
    { zero: false, value: untouched, label: "条待应募岗位" },
    { zero: true, value: 0, label: "个复盘点待裁定" },
  ]);
});

test("概览不展示待办、当前行动或收尾提醒，保留独立面谈的日程", () => {
  const list = [...notes, todo("一次面談", { company: "株式会社面談テスト", status: "未着手", category: "面談・説明会", next_event_at: "2026-09-29 10:00" })];
  const html = render(list);
  assert.match(html, /概览<\/h1>/);
  assert.match(html, /dateTime|datetime/);
  assert.doesNotMatch(html, /当前行动|行动清单|件待办|全部行动|开始这件事|完成这件事|保留<\/button>|待办已经不用做了|data-overview-panel="todos"/);
  for (const name of ["書類を準備する", "面談の日程を返信する", "終わった件", "台帳の補修"]) assert.doesNotMatch(html, new RegExp(name));
  assert.match(html, /株式会社面談テスト/);
  assert.match(html, /日本时间（JST）/);
  assert.match(html, /10:00/);
});

test("近期安排是统计之后的首个面板，没有日程时明确展示空态", () => {
  const html = render(notes);
  const panels = [...html.matchAll(/data-overview-panel="([^"]+)"/g)].map(([, panel]) => panel);
  assert.equal(panels[0], "schedule");
  assert.match(html, /未来 7 天没有已确认的安排。/);
});

test("空 vault 渲染日历空态而不抛错，三个选考与复盘数字都是 0", () => {
  let html = "";
  assert.doesNotThrow(() => { html = render([]); });
  assert.match(html, /未来 7 天没有已确认的安排。/);
  assert.doesNotMatch(html, /data-overview-panel="(cases|jobs|waiting|review|practice)"/, "没有数据的辅助面板整块不出");
  assert.doesNotMatch(html, /class="overview-columns/, "没有辅助数据时不生成空列");
  assert.deepEqual(statTiles(html).map((tile) => [tile.value, tile.zero]), [[0, true], [0, true], [0, true]]);
});

test("「待整理稿」只提醒已过的面试・面谈；说明会也在日历上，但不该让人去生成整理稿", () => {
  const list = [
    jobCase("株式会社テスト", { status: "面接中", channel: "Green", status_updated: "2026-09-24", next_event_at: "2026-09-24 10:00", next_event_label: "一次面接" }),
    // 日文写法、不带「セミナー」：标签若退回默认的「面谈」，就会被当成面试提醒。
    jobCase("株式会社サンプル", { status: "未応募", next_event_at: "2026-09-25 15:00", next_event_label: "会社説明会" }),
    jobCase("株式会社ダミー", { status: "未応募", next_event_at: "2026-09-23 11:00", next_event_label: "Company seminar" }),
  ];
  const html = render(list);
  const missing = html.match(/<ul class="overview-review-missing"[^>]*>([\s\S]*?)<\/ul>/)?.[1] ?? "";
  assert.match(missing, /株式会社テスト<\/strong>/, "面试要提醒");
  assert.doesNotMatch(missing, /株式会社サンプル/, "日文「説明会」不提醒");
  assert.doesNotMatch(missing, /株式会社ダミー/, "seminar 不提醒");
});

test("等待面板「全部 N 项」落在看板的「只看等对方」，不按进行中状态筛", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../app/overview-view.tsx", import.meta.url), "utf8");
  assert.match(source, /onViewJobs\(\{ waiting: true \}\)/);
  assert.doesNotMatch(source, /onViewJobs\(\{ statuses: IN_PROGRESS_STATUSES \}\)/);
  const shell = await readFile(new URL("../app/memory-atlas.tsx", import.meta.url), "utf8");
  assert.match(shell, /if \(filters\?\.waiting\) params\.set\("waiting", "1"\)/, "外壳把它写进 URL");
});
