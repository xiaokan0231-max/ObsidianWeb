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

// 🔴 実例そのまま：最終面接（8/13）は終わって結果待ちなのに、準備 todo が
// 進行中のまま dueRank の「已逾期＝最優先」に乗り、hero を占領し続けた。
// 過去のイベントの準備は「もっと急ぐ」ではなく「収尾する」対象。
test("イベントが過ぎた準備 todo は primary にならず、収尾（stale）へ移る", () => {
  const brief = buildFocusBrief(
    [
      note("prep.md", {
        type: "todo",
        status: "進行中",
        priority: "high",
        category: "面接対策",
        action: "8月13日13:30の最終面接（対面）の準備を完成する",
        due: "2026-08-12",
        focus: true,
        focus_until: "2026-08-13",
        blocks_next_stage: true,
      }),
      note("reauth.md", {
        type: "todo",
        status: "進行中",
        priority: "medium",
        action: "Gmail 0231 を再認証する",
        due: "2026-08-11",
      }),
    ],
    "2026-08-16",
  );

  // 真の期限超過（今日やれば有効）はこれまで通り最優先のまま
  assert.equal(brief.primary?.note.path, "reauth.md");
  assert.match(brief.primary?.reason ?? "", /已逾期/);
  // 失効した準備 todo は ranked から消え、stale に入る
  assert.equal(brief.ranked.some((item) => item.note.path === "prep.md"), false);
  assert.deepEqual(brief.stale.map((item) => item.note.path), ["prep.md"]);
});

test("expires_at はイベント当日まで primary の資格を奪わない", () => {
  const prep = note("prep.md", {
    type: "todo",
    status: "進行中",
    priority: "high",
    action: "面接の準備",
    due: "2026-08-12",
    expires_at: "2026-08-13",
  });
  // 当日（8/13）はまだ有効＝準備は意味がある
  const onTheDay = buildFocusBrief([prep], "2026-08-13");
  assert.equal(onTheDay.primary?.note.path, "prep.md");
  assert.deepEqual(onTheDay.stale, []);
  // 翌日から失効
  const after = buildFocusBrief([prep], "2026-08-14");
  assert.equal(after.primary, null);
  assert.equal(after.stale.length, 1);
});

test("focus_until だけでは失効と推断しない（due が窗口の外なら期限タスク扱い）", () => {
  // 人工置頂が切れただけで、期限は将来＝生きているタスク。巻き込んではいけない。
  const brief = buildFocusBrief(
    [
      note("alive.md", {
        type: "todo",
        status: "未着手",
        priority: "high",
        action: "書類を提出する",
        due: "2026-08-20",
        focus: true,
        focus_until: "2026-08-10",
      }),
    ],
    "2026-08-16",
  );
  assert.equal(brief.primary?.note.path, "alive.md");
  assert.deepEqual(brief.stale, []);
});

test("完了した待办は stale にも入らない（収尾済みを蒸し返さない）", () => {
  const brief = buildFocusBrief(
    [
      note("done.md", {
        type: "todo",
        status: "完了",
        action: "終わった準備",
        due: "2026-08-12",
        expires_at: "2026-08-13",
      }),
    ],
    "2026-08-16",
  );
  assert.deepEqual(brief.stale, []);
  assert.equal(brief.primary, null);
});

// —— 対抗審査で出た穴のふさぎ込み ——

test("新鮮な手動 pin は expires_at より強い（本人の「まだやる」を静かに無効化しない）", () => {
  const brief = buildFocusBrief(
    [
      note("thankyou.md", {
        type: "todo",
        status: "進行中",
        priority: "high",
        action: "面接のお礼と補足を送る",
        due: "2026-08-12",
        expires_at: "2026-08-13",
        focus: true,
        focus_until: "2026-08-18",
      }),
    ],
    "2026-08-16",
  );
  assert.equal(brief.primary?.note.path, "thankyou.md");
  assert.deepEqual(brief.stale, []);
});

test("案件が不採用になった待办は日付に関係なく収尾へ（最も確実な死亡信号）", () => {
  const brief = buildFocusBrief(
    [
      note("case.md", {
        type: "job-case",
        case_id: "Acme_エンジニア",
        company: "Acme",
        status: "不採用（2026-08-15・書類選考）",
      }),
      note("prep.md", {
        type: "todo",
        status: "未着手",
        priority: "high",
        case_id: "Acme_エンジニア",
        action: "Acme の一次面接準備",
        due: "2026-08-25",
      }),
    ],
    "2026-08-16",
  );
  assert.equal(brief.primary, null);
  assert.deepEqual(brief.stale.map((item) => item.note.path), ["prep.md"]);
});

test("常青タスク（due 無し）は focus 窗口が過ぎても失効しない", () => {
  const brief = buildFocusBrief(
    [
      note("training.md", {
        type: "todo",
        status: "未着手",
        priority: "medium",
        category: "面接対策",
        action: "日本語応答訓練を続ける",
        focus: true,
        focus_until: "2026-08-10",
      }),
    ],
    "2026-08-16",
  );
  assert.equal(brief.primary?.note.path, "training.md");
  assert.deepEqual(brief.stale, []);
});

test("推断は 面接対策 限定：返信系待办は pin の残骸だけで失効しない", () => {
  const brief = buildFocusBrief(
    [
      note("reply.md", {
        type: "todo",
        status: "未着手",
        priority: "high",
        category: "応募経路",
        action: "エージェントへ意向確認の返信をする",
        due: "2026-08-10",
        focus: true,
        focus_until: "2026-08-10",
      }),
    ],
    "2026-08-16",
  );
  // 窗口は丸ごと過去だが、返信義務は残っている＝真の期限超過として催促し続ける
  assert.equal(brief.primary?.note.path, "reply.md");
  assert.match(brief.primary?.reason ?? "", /已逾期/);
  assert.deepEqual(brief.stale, []);
});
