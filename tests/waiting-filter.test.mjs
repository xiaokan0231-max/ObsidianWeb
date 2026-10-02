import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_JOB_FILTERS, jobMatchesFilters, jobWaitsOnCounterpart, toJobCard } from "../lib/jobs.ts";

// 等待对象是独立于选考阶段的事实；未応募的企业回复与内定条件回复也能筛出来。
const TODAY = "2026-09-28";
const job = (name, frontmatter) => ({
  path: `20_求職/${name}/案件.md`,
  frontmatter: { type: "job-case", company: name, ...frontmatter },
  content: `# ${name} — データエンジニア\n`,
  tags: [],
  stat: { ctime: 0, mtime: 1, size: 0 },
});
const notes = [
  job("株式会社テスト", { status: "未応募", waiting_for: "company", follow_up_at: "2026-09-20" }),
  job("株式会社サンプル", { status: "未応募", waiting_for: "self" }),
  job("株式会社ダミー", { status: "未応募" }),
  job("株式会社テスト二", { status: "応募済", channel: "Green", waiting_for: "company" }),
  job("株式会社テスト三", { status: "書類通過", channel: "Green" }),
  job("株式会社テスト四", { status: "面接中（2026-09-25・一次面接）", channel: "Green", waiting_for: "agent" }),
  job("株式会社テスト五", { status: "内定", channel: "Green", waiting_for: "company" }),
  job("株式会社テスト六", { status: "不採用", channel: "Green", waiting_for: "company" }),
  job("株式会社テスト七", { status: "保留", waiting_for: "company" }),
  job("株式会社テスト八", { status: "検討中", waiting_for: "company" }),
  // status 缺失的数据仍遵循看板的未応募兜底规则，字段合法性由 vault:check 校验。
  job("株式会社テスト九", { waiting_for: "company" }),
];

test("「只看等对方」覆盖未応募与内定，排除等本人、未记录等待与终结案件", () => {
  const filtered = notes.map(toJobCard)
    .filter((card) => jobMatchesFilters(card, { ...EMPTY_JOB_FILTERS, waitingOnly: true }, { today: TODAY }))
    .map((card) => card.path)
    .sort();
  assert.deepEqual(filtered.map((path) => path.split("/")[1]).sort(), ["株式会社テスト", "株式会社テスト九", "株式会社テスト二", "株式会社テスト五", "株式会社テスト四"].sort(),
    "未応募＋等对方与内定算；等本人・没记等待・终结・保留・无效状态都不算");
});

test("等待筛选可以与选考阶段组合，且不因跟进日期已过而丢失案件", () => {
  const filtered = notes.map(toJobCard)
    .filter((card) => jobMatchesFilters(card, { ...EMPTY_JOB_FILTERS, waitingOnly: true, statuses: ["未応募"] }, { today: TODAY }));
  assert.deepEqual(filtered.map((card) => card.company).sort(), ["株式会社テスト", "株式会社テスト九"].sort());
  assert.ok(filtered.every(jobWaitsOnCounterpart));
  assert.equal(filtered.find((card) => card.company === "株式会社テスト").followUpAt, "2026-09-20");
});
