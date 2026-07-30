import assert from "node:assert/strict";
import test from "node:test";
import { buildFocusBrief } from "../lib/focus-action.ts";

function note(path, frontmatter, title = path.replace(/\.md$/, "")) {
  return {
    path,
    stat: { ctime: 0, mtime: 0, size: 0 },
    tags: [],
    frontmatter,
    content: `# ${title}\n`,
  };
}

test("an active manual focus wins and produces display-safe copy", () => {
  const brief = buildFocusBrief(
    [
      note("overdue.md", {
        type: "todo",
        status: "未着手",
        priority: "high",
        action: "期限切れの応募確認",
        due: "2026-07-28",
      }),
      note("interview.md", {
        type: "todo",
        status: "進行中",
        priority: "high",
        company: "Sharing Innovations",
        category: "面接対策",
        action: "**一次面接準備**を始める [[回答品質復盤]]",
        due: "2026-08-02",
        focus: true,
        focus_until: "2026-08-02",
        blocks_next_stage: true,
      }),
    ],
    "2026-07-30",
  );

  assert.equal(brief.primary?.note.path, "interview.md");
  assert.equal(brief.primary?.action, "一次面接準備 を始める 回答品質復盤");
  assert.equal(brief.primary?.reason, "人工聚焦 · 8月2日 前 · 影响下一轮");
});

test("legacy starred job-case prose is never treated as an executable action", () => {
  const brief = buildFocusBrief(
    [
      note("case.md", {
        type: "job-case",
        case_id: "case",
        company: "Example",
        status: "面接中（2026-07-29 更新）",
        next_action: "⭐ 2026-07-29 に返信済み。企業の指定待ち。",
      }),
    ],
    "2026-07-30",
  );

  assert.equal(brief.primary, null);
  assert.deepEqual(brief.waiting, []);
});

test("external waiting stays in watchlist until its explicit follow-up date", () => {
  const source = note("case.md", {
    type: "job-case",
    case_id: "case",
    company: "Example",
    status: "面接中",
    waiting_for: "company",
    waiting_label: "一次面接日時の指定待ち",
    follow_up_at: "2026-08-01",
  });

  const before = buildFocusBrief([source], "2026-07-30");
  assert.equal(before.primary, null);
  assert.equal(before.waiting[0]?.label, "一次面接日時の指定待ち");

  const due = buildFocusBrief([source], "2026-08-01");
  assert.equal(due.primary?.source, "follow-up");
  assert.equal(due.primary?.due, "2026-08-01");
  assert.equal(due.waiting.length, 1);
});

test("completed and paused todos cannot become the primary action", () => {
  const brief = buildFocusBrief(
    [
      note("done.md", {
        type: "todo",
        status: "完了",
        priority: "high",
        action: "完了済み",
        focus: true,
        focus_until: "2026-08-02",
      }),
      note("paused.md", {
        type: "todo",
        status: "保留",
        priority: "high",
        action: "外部待ち",
      }),
    ],
    "2026-07-30",
  );

  assert.equal(brief.primary, null);
});

test("system maintenance never competes with the user's next action", () => {
  const brief = buildFocusBrief(
    [
      note("system.md", {
        type: "todo",
        status: "未着手",
        priority: "high",
        audience: "system",
        action: "job-case を補完する",
        due: "2026-07-29",
      }),
      note("user.md", {
        type: "todo",
        status: "未着手",
        priority: "medium",
        action: "面接の逆質問を準備する",
      }),
    ],
    "2026-07-30",
  );

  assert.equal(brief.primary?.note.path, "user.md");
  assert.deepEqual(brief.ranked.map((item) => item.note.path), ["user.md"]);
});
