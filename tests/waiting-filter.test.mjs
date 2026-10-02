import assert from "node:assert/strict";
import test from "node:test";
import { buildWaitingItems } from "../lib/focus-action.ts";
import { EMPTY_JOB_FILTERS, jobMatchesFilters, jobWaitsOnCounterpart, toJobCard } from "../lib/jobs.ts";

// 首页「等待回复 · 全部 N 项」点进看板后，「只看等对方」的条数必须就是 N。
// 两边各写一份判定时，首页数了未応募＋等对方、看板却按进行中状态筛，恰好漏掉想找的那一条。
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
  // status 欠落（vault:check は拒否する不正データ）でも、首页と看板は同じ読み方（jobStatus＝未応募扱い）をする。
  job("株式会社テスト九", { waiting_for: "company" }),
];

test("「只看等对方」的结果与首页等待列表是同一批案件", () => {
  const waiting = buildWaitingItems(notes, TODAY).map((item) => item.note.path).sort();
  const filtered = notes.map(toJobCard)
    .filter((card) => jobMatchesFilters(card, { ...EMPTY_JOB_FILTERS, waitingOnly: true }, { today: TODAY }))
    .map((card) => card.path)
    .sort();
  assert.deepEqual(filtered, waiting);
  assert.deepEqual(filtered.map((path) => path.split("/")[1]).sort(), ["株式会社テスト", "株式会社テスト九", "株式会社テスト二", "株式会社テスト五", "株式会社テスト四"].sort(),
    "未応募＋等对方与内定算；等本人・没记等待・终结・保留・无效状态都不算");
});

test("旧的落点（按进行中状态筛）与等待列表对不上——这正是要修的", () => {
  const byStatus = notes.map(toJobCard).filter((card) => ["応募済", "書類通過", "面接中", "内定"].includes(card.status));
  assert.ok(byStatus.some((card) => !jobWaitsOnCounterpart(card)), "进行中但没在等的会混进来");
  assert.ok(!byStatus.some((card) => card.status === "未応募"), "未応募＋等对方会被漏掉");
});
