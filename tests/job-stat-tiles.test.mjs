import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_JOB_FILTERS,
  JOB_STAT_TILES,
  jobMatchesFilters,
  jobMatchesRatingBands,
  jobStatTileFilters,
  jobStatTilePools,
  jobTouch,
  toJobCard,
} from "../lib/jobs.ts";

// 看板顶部的统计格：格子上的数字 ＝ 点开后列表的条数。两边各有一套写法（业务口径直写 vs 看板筛选），
// 这里用覆盖各种组合的样本证明它们数到同一个数。
const TODAY = "2026-09-28";
const VERIFIED = "# 株式会社テスト — x\n\n## ✅ 原文確認済\n\n読んだ";
const WARNED = "# 株式会社テスト — x\n\n## ⚠️ 要確認\n\nまだ";
const PLAIN = "# 株式会社テスト — x";

let seq = 0;
const job = (frontmatter, content = PLAIN) => {
  seq += 1;
  return toJobCard({
    path: `20_求職/テスト/case-${seq}.md`,
    frontmatter: { type: "job-case", company: `株式会社テスト${seq}`, ...frontmatter },
    content,
    tags: [],
    stat: { ctime: 0, mtime: seq, size: 0 },
  });
};

const JOBS = [
  // 未応募・未着手・高分・今日入库・已核对
  job({ status: "未応募", rating: 8, date: TODAY }, VERIFIED),
  // 未応募・已动手（等企业）・高分・3 日内・未核对 → 不算「7 分以上待判断」
  job({ status: "未応募", rating: 9, date: "2026-09-26", waiting_for: "company" }),
  // waiting_for=self 是球在本人手里 → 仍算未着手
  job({ status: "未応募", rating: 7, date: "2026-08-01", waiting_for: "self" }),
  // 未採点（rating 缺失＝0）・7 日内
  job({ status: "未応募", date: "2026-09-22" }),
  // 6.5 分・没写 date・需确认
  job({ status: "未応募", rating: 6.5 }, WARNED),
  // 带括号注记的未応募
  job({ status: "未応募（2026-09-27・スカウト返信済）", rating: 7.5, date: "2026-09-27", waiting_for: "agent" }, VERIFIED),
  // 没写 status → 默认未応募
  job({ rating: 7, date: "2026-09-10" }, VERIFIED),
  // 应募之后的各状态：高分・新・已核对・有等待，也一律不进任何格
  job({ status: "応募済（2026-09-27・Green経由）", channel: "Green", rating: 9, date: TODAY }, VERIFIED),
  job({ status: "書類通過", channel: "Green", rating: 8, date: "2026-09-25", waiting_for: "company" }, VERIFIED),
  job({ status: "面接中", channel: "Findy", rating: 7, date: "2026-09-26" }),
  job({ status: "保留", rating: 8, date: TODAY }, VERIFIED),
  job({ status: "不採用（2026-09-20・書類選考）", channel: "Green", rating: 9, waiting_for: "company", date: "2026-09-21" }),
  job({ status: "内定", channel: "Green", rating: 10, date: "2026-09-01" }, VERIFIED),
];

test("每个统计格：格子上的数字 ＝ 用它的筛选在看板上筛出的条数", () => {
  const pools = jobStatTilePools(JOBS, TODAY);
  for (const tile of JOB_STAT_TILES) {
    const filters = jobStatTileFilters(tile.id);
    const matched = JOBS.filter((item) => jobMatchesFilters(item, filters, { today: TODAY }));
    assert.equal(matched.length, pools[tile.id].length, `${tile.label}`);
    assert.deepEqual(matched.map((item) => item.path).sort(), pools[tile.id].map((item) => item.path).sort(), `${tile.label} 的成员一致`);
  }
});

test("样本确实覆盖到每一格，且数字符合业务口径", () => {
  const pools = jobStatTilePools(JOBS, TODAY);
  const counts = Object.fromEntries(Object.entries(pools).map(([id, list]) => [id, list.length]));
  assert.deepEqual(counts, { untouched: 5, awaiting: 2, ready: 3, recent: 4, verified: 3 });
});

test("统计格的筛选从空条件起步，旧条件不残留", () => {
  for (const tile of JOB_STAT_TILES) {
    const filters = jobStatTileFilters(tile.id);
    assert.deepEqual(Object.keys(filters).sort(), Object.keys(EMPTY_JOB_FILTERS).sort());
    assert.deepEqual(filters.statuses, ["未応募"], `${tile.label} 只看未応募`);
    assert.equal(filters.minSalary, 0);
    assert.deepEqual(filters.stacks, []);
  }
  assert.deepEqual(jobStatTileFilters("ready").ratings, ["7plus"]);
});

test("7plus ⇔ rating ≥ 7：与「7 分以上待判断」的口径一致", () => {
  for (const rating of [0, 5, 6.5, 6.99, 7, 7.5, 8, 9, 10]) {
    assert.equal(jobMatchesRatingBands(rating, ["7plus"]), rating >= 7, String(rating));
  }
});

test("动手状态只属于未応募：应募之后没有值，筛选启用时一律落选", () => {
  assert.equal(jobTouch({ status: "未応募", waitingFor: "" }), "untouched");
  assert.equal(jobTouch({ status: "未応募", waitingFor: "self" }), "untouched");
  assert.equal(jobTouch({ status: "未応募", waitingFor: "company" }), "awaiting");
  assert.equal(jobTouch({ status: "応募済", waitingFor: "company" }), null);
  assert.equal(jobTouch({ status: "不採用", waitingFor: "" }), null);

  const both = { ...EMPTY_JOB_FILTERS, touches: ["untouched", "awaiting"] };
  const matched = JOBS.filter((item) => jobMatchesFilters(item, both, { today: TODAY }));
  assert.ok(matched.every((item) => item.status === "未応募"));
  assert.equal(matched.length, JOBS.filter((item) => item.status === "未応募").length);
});

test("facet 联动：except 指定的那一组不参与判定", () => {
  const filters = { ...EMPTY_JOB_FILTERS, statuses: ["応募済"], touches: ["untouched"] };
  assert.equal(JOBS.filter((item) => jobMatchesFilters(item, filters, { today: TODAY })).length, 0, "应募済没有动手状态");
  assert.equal(
    JOBS.filter((item) => jobMatchesFilters(item, filters, { today: TODAY, except: "touches" })).length,
    1,
    "去掉动手状态这一组后只剩状态条件",
  );
  assert.equal(
    JOBS.filter((item) => jobMatchesFilters(item, EMPTY_JOB_FILTERS, { today: TODAY, query: "株式会社テスト1" })).length,
    5,
    "关键词照常参与（テスト1 / 10 / 11 / 12 / 13）",
  );
});
