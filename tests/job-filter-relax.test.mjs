import assert from "node:assert/strict";
import test from "node:test";
import {
  activeJobFilterKeys,
  EMPTY_JOB_FILTERS,
  jobFilterRelaxations,
  jobMatchesFilters,
  toJobCard,
} from "../lib/jobs.ts";

// 筛选结果为空时的「去掉后可得 N 条」：按钮上的数字必须等于点下去之后的条数。
const TODAY = "2026-09-28";
let seq = 0;
const job = (frontmatter) => {
  seq += 1;
  return toJobCard({
    path: `20_求職/テスト/relax-${seq}.md`,
    frontmatter: { type: "job-case", company: `株式会社テスト${seq}`, ...frontmatter },
    content: "# 株式会社テスト — x",
    tags: [],
    stat: { ctime: 0, mtime: seq, size: 0 },
  });
};
const JOBS = [
  job({ status: "未応募", rating: 8, location: "東京都" }),
  job({ status: "未応募", rating: 6, location: "大阪府" }),
  job({ status: "応募済", channel: "Green", rating: 9, location: "東京都" }),
  job({ status: "面接中", channel: "Green", rating: 7, location: "大阪府" }),
];

test("只列出正在起作用的筛选组，关键词也算一组", () => {
  assert.deepEqual(activeJobFilterKeys(EMPTY_JOB_FILTERS), []);
  assert.deepEqual(
    activeJobFilterKeys({ ...EMPTY_JOB_FILTERS, statuses: ["未応募"], minSalary: 700, waitingOnly: true }, " java "),
    ["query", "statuses", "salary", "waiting"],
  );
});

test("每组的可得条数 ＝ 去掉这一组后真实筛出的条数，按条数降序", () => {
  const filters = { ...EMPTY_JOB_FILTERS, statuses: ["未応募"], ratings: ["9"], regions: ["大阪府"] };
  const relaxations = jobFilterRelaxations(JOBS, filters, { today: TODAY });
  for (const { key, count } of relaxations) {
    const expected = JOBS.filter((item) => jobMatchesFilters(item, filters, { today: TODAY, except: key })).length;
    assert.equal(count, expected, key);
  }
  assert.deepEqual(relaxations.map((item) => item.key).sort(), ["rating", "regions", "statuses"].sort());
  assert.ok(relaxations.every((item, index) => index === 0 || relaxations[index - 1].count >= item.count));
});

test("清空一组之后，用新条件筛出的条数正好等于那一组提示的可得条数", async () => {
  const { withoutJobFilter } = await import("../lib/jobs.ts");
  const filters = { ...EMPTY_JOB_FILTERS, statuses: ["未応募"], ratings: ["9"], minSalary: 900, remoteOnly: true };
  for (const { key, count } of jobFilterRelaxations(JOBS, filters, { today: TODAY })) {
    const relaxed = withoutJobFilter(filters, key);
    assert.deepEqual(activeJobFilterKeys(relaxed).includes(key), false, `${key} 已清空`);
    assert.equal(JOBS.filter((item) => jobMatchesFilters(item, relaxed, { today: TODAY })).length, count, key);
  }
  assert.equal(withoutJobFilter(filters, "query"), filters, "关键词不在 filters 里");
});
