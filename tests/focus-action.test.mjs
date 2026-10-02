import assert from "node:assert/strict";
import test from "node:test";
import { buildWaitingItems, focusDateLabel } from "../lib/focus-action.ts";

function note(path, frontmatter) {
  return { path, stat: { ctime: 0, mtime: 0, size: 0 }, tags: [], frontmatter, content: `# ${path.replace(/\.md$/, "")}\n` };
}

test("等待列表保留企业原始要求，在跟进日后随 today 更新逾期提示", () => {
  const source = note("case.md", {
    type: "job-case", company: "株式会社テスト", status: "面接中",
    waiting_for: "company", waiting_label: "一次面接日時の指定待ち", follow_up_at: "2026-08-01",
  });
  const before = buildWaitingItems([source], "2026-07-30");
  assert.equal(before[0]?.label, "一次面接日時の指定待ち");
  assert.equal(before[0]?.waitingFor, "企业");
  assert.equal(before[0]?.followUpAt, "2026-08-01");
  assert.equal(before[0]?.overdue, false);
  assert.equal(buildWaitingItems([source], "2026-08-01")[0]?.overdue, false);
  assert.equal(buildWaitingItems([source], "2026-08-02")[0]?.overdue, true);
});

test("待办与未明确记录等待的案件不进入等待区", () => {
  const list = [
    note("prep.md", { type: "todo", status: "進行中", company: "株式会社テスト", priority: "high", due: "2026-07-28" }),
    note("case.md", { type: "job-case", company: "株式会社テスト", status: "面接中", next_action: "⭐ 返信済み。企業の指定待ち。" }),
  ];
  assert.deepEqual(buildWaitingItems(list, "2026-07-30"), []);
});

test("等待覆盖未応募与内定，排除等本人和终结案件；最早跟进日排在前面", () => {
  const list = [
    note("fresh.md", { type: "job-case", company: "株式会社ダミー", status: "応募済", waiting_for: "company", follow_up_at: "2026-10-05" }),
    note("offer.md", { type: "job-case", company: "株式会社サンプル", status: "内定", waiting_for: "company", follow_up_at: "2026-09-25" }),
    note("liked.md", { type: "job-case", company: "株式会社テスト", status: "未応募", waiting_for: "company", follow_up_at: "2026-09-20" }),
    note("no-date.md", { type: "job-case", company: "株式会社テスト二", status: "面接中", waiting_for: "agent" }),
    note("self.md", { type: "job-case", company: "株式会社ホールド", status: "応募済", waiting_for: "self", follow_up_at: "2026-09-01" }),
    note("dead.md", { type: "job-case", company: "株式会社リジェクト", status: "不採用", waiting_for: "company", follow_up_at: "2026-09-01" }),
  ];
  assert.deepEqual(buildWaitingItems(list, "2026-09-26").map((item) => [item.note.path, item.overdue]), [
    ["liked.md", true], ["offer.md", true], ["fresh.md", false], ["no-date.md", false],
  ]);
});

test("无效跟进日期不形成逾期；等待内容去除 Markdown 后显示", () => {
  const source = note("case.md", { type: "job-case", company: "株式会社テスト", status: "面接中", waiting_for: "company", follow_up_at: "2026-02-30", waiting_label: "**条件確認** [[回答]]" });
  const [item] = buildWaitingItems([source], "2026-09-26");
  assert.equal(item.followUpAt, "");
  assert.equal(item.overdue, false);
  assert.equal(item.label, "条件確認 回答");
  assert.equal(focusDateLabel("2026-09-26"), "9月26日");
  assert.equal(focusDateLabel(""), "");
});
