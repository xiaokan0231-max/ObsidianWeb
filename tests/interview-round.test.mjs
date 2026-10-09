import assert from "node:assert/strict";
import test from "node:test";
import { calendarRoundBadge, interviewRound } from "../lib/interview-round.ts";
import { resolveCalendarInterview, resolveCalendarRoundBadge } from "../lib/calendar-interview.ts";
import { buildCalendarEvents, calendarEventLabel } from "../lib/memory-atlas-data.ts";

function note(path, type, frontmatter = {}) {
  return { path, frontmatter: { type, ...frontmatter }, content: "", tags: [], stat: { ctime: 0, mtime: 0, size: 0 } };
}

test("轮次徽标区分轻松面谈、正式轮次和最终面试，支持中日简繁与全角", () => {
  for (const label of ["カジュアル面談", "ｶｼﾞｭｱﾙ面談", "轻松面谈", "輕鬆面談", "Casual interview"]) {
    assert.equal(interviewRound(label), "casual", label);
    assert.deepEqual(calendarRoundBadge(label), { mark: "0", label: "轻松面谈", kind: "casual" }, label);
    assert.equal(calendarEventLabel(label), "轻松面谈", label);
  }
  const variants = [
    ["一次面接", "第一次面试", "第１輪面試", "first interview"],
    ["二次面接", "第2次面试", "二面", "Second round"],
    ["三次面接", "第三次面试", "第３次面接", "第三輪面試", "third interview", "三次"],
    ["四次面接", "第４次面談", "fourth interview"],
    ["五次面接", "第5轮面试", "fifth meeting"],
    ["六次面接", "第 六 次 面接", "sixth"],
  ];
  for (const [index, labels] of variants.entries()) {
    const display = `第${["一", "二", "三", "四", "五", "六"][index]}次面试`;
    for (const label of labels) {
      assert.equal(interviewRound(label), `round-${index + 1}`, label);
      assert.deepEqual(calendarRoundBadge(label), { mark: String(index + 1), label: display, kind: "numbered" }, label);
      assert.equal(calendarEventLabel(label), display, label);
    }
  }
  for (const label of ["最終面接", "最终面试", "終面", "终面", "Final interview", "三次面接（最終）"]) {
    assert.equal(interviewRound(label), "final", label);
    assert.deepEqual(calendarRoundBadge(label), { mark: "终", label: "最终面试", kind: "final" }, label);
    assert.equal(calendarEventLabel(label), "最终面试", label);
  }
});

test("泛称、猎头与说明会没有轮次徽标，不把役員职级或未知数字猜作终面", () => {
  for (const label of ["面谈", "面試", "面接", "役員面接", "技术面试", "人事面談", "", "十三次面接", "11次面接", "第７次面接", "First aid meeting", "Finalist interview", "最終調整", "最终确认", "Final checks", "Casual dress", "猎头回复"]) {
    assert.equal(interviewRound(label), "", label);
    assert.equal(calendarRoundBadge(label), null, label);
  }
  for (const label of ["エージェント面談", "猎头面谈", "獵頭面談", "Recruiter interview", "猎头面谈（一次面试对策）"]) {
    assert.equal(interviewRound(label), "agent", label);
    assert.equal(calendarRoundBadge(label), null, label);
    assert.equal(calendarEventLabel(label), "猎头面谈", label);
  }
  for (const label of ["第一次说明会", "一次面接説明会", "第三次說明會", "First seminar"]) {
    assert.equal(interviewRound(label), "", label);
    assert.equal(calendarRoundBadge(label), null, label);
    assert.equal(calendarEventLabel(label), "招聘说明会", label);
  }
  assert.equal(calendarEventLabel("役員面接"), "面试");
});

test("日历从本场名称投影轮次，接触序号与案件当前下一步不改写历史", () => {
  const owner = note("20_求職/テスト/案件.md", "job-case", {
    company: "株式会社テスト", case_id: "test-case", next_event_at: "2026-09-29 10:00", next_event_label: "三次面接", next_action: "第３次面接",
  });
  const history = [
    note("轻松.md", "interview-prep", { date: "2026-09-01", time: "10:00", round: "カジュアル面談", session_order: 1 }),
    note("一次.md", "interview-prep", { date: "2026-09-08", time: "10:00", round: "一次面接", session_order: 2 }),
    note("二次.md", "interview-prep", { date: "2026-09-15", time: "10:00", round: "二次面接", session_order: 3 }),
  ];
  for (const item of history) Object.assign(item.frontmatter, { company: "株式会社テスト", case_id: "test-case", session_status: "completed" });
  const events = buildCalendarEvents([owner, ...history], new Date("2026-09-29T00:00:00Z"));
  assert.deepEqual(events.map((event) => calendarRoundBadge(event.label)?.mark), ["0", "1", "2", "3"]);
  assert.deepEqual(events.map((event) => event.time), ["10:00", "10:00", "10:00", "10:00"]);
});

test("三次徽标与准备稿匹配使用同一轮次，已知不同轮次仍排除", () => {
  const owner = note("案件.md", "job-case", { company: "株式会社テスト", case_id: "test-case" });
  const makePrep = (path, round) => note(path, "interview-prep", {
    company: "株式会社テスト", case_id: "test-case", date: "2026-09-29", time: "10:00", round,
  });
  const third = makePrep("三次.md", "第３次面接");
  const final = makePrep("最終.md", "最終面接");
  const event = {
    id: "test-event", kind: "event", note: owner, company: "株式会社テスト", date: "2026-09-29", time: "10:00",
    label: calendarEventLabel("三次面接"), phase: "upcoming", caseId: "test-case", prepPath: "",
  };
  assert.equal(calendarRoundBadge(event.label)?.mark, "3");
  assert.equal(resolveCalendarInterview(event, [owner, third, final]).path, third.path);
  assert.equal(resolveCalendarInterview(event, [owner, final]).path, null);
});

test("明确轻松面谈中的沟通方式，以及面谈注明的选考阶段，保留轮次", () => {
  for (const label of ["初回カジュアル電話面談", "カジュアルオンライン面談", "カジュアルWeb面談", "カジュアル WEB 面談"]) {
    assert.equal(interviewRound(label), "casual", label);
    assert.equal(calendarRoundBadge(label)?.mark, "0", label);
    assert.equal(calendarEventLabel(label), "轻松面谈", label);
  }
  for (const label of ["1次選考", "１次選考", "Web面談（求人票の選考フローでは STEP1 1次選考）"]) {
    assert.equal(interviewRound(label), "round-1", label);
    assert.equal(calendarEventLabel(label), "第一次面试", label);
  }
  for (const label of ["カジュアルな雰囲気の面談", "Web面談（STEP1）", "書類の1次選考", "1次選考の案内", "最終調整"]) {
    assert.equal(calendarRoundBadge(label), null, label);
  }
});

const ROUND_OWNER = note("20_求職/テスト/案件.md", "job-case", {
  company: "株式会社テスト", case_id: "test-case", next_event_at: "2026-09-29 10:00", next_action: "面接",
});

function roundMaterial(path, type, round, fields = {}) {
  return note(path, type, { company: "株式会社テスト", case_id: "test-case", date: "2026-09-29", time: "10:00", round, ...fields });
}

function genericEvent(source = ROUND_OWNER, fields = {}) {
  return {
    id: "test-round-event", kind: "event", note: source, company: "株式会社テスト", date: "2026-09-29", time: "10:00",
    label: "面试", phase: "upcoming", caseId: "test-case", prepPath: "", ...fields,
  };
}

test("日历合并后从当轮资料补足泛称，不让高优先级泛称压过明确阶段", () => {
  const prep = roundMaterial("准备.md", "interview-prep", "Web面談（STEP1 1次選考）", { session_status: "scheduled" });
  for (const notes of [[ROUND_OWNER, prep], [prep, ROUND_OWNER]]) {
    const events = buildCalendarEvents(notes, new Date("2026-09-29T00:00:00Z"));
    assert.equal(events.length, 1);
    assert.equal(events[0].note.path, ROUND_OWNER.path, "阶段补足不更换日程正本");
    assert.equal(events[0].label, "第一次面试");
    assert.equal(resolveCalendarInterview(events[0], notes)?.path, prep.path);
  }
  const study = roundMaterial("整理稿.md", "transcript-study", "二次面接");
  const events = buildCalendarEvents([ROUND_OWNER, study], new Date("2026-09-29T00:00:00Z"));
  assert.equal(events.length, 1, "资料只补阶段，不额外生成场次");
  assert.equal(events[0].label, "第二次面试");
});

test("轮次补足共享跨材料消歧，同日多轮或不同时间不能选一份猜数字", () => {
  const first = roundMaterial("一次准备.md", "interview-prep", "一次面接");
  const second = roundMaterial("二次整理.md", "transcript-study", "二次面接");
  const event = genericEvent();
  assert.equal(resolveCalendarRoundBadge(event, [ROUND_OWNER, first, second]), null);
  assert.equal(resolveCalendarInterview(event, [ROUND_OWNER, first, second])?.path, null);
  const afternoon = roundMaterial("下午整理.md", "transcript-study", "一次面接", { time: "15:00" });
  assert.equal(resolveCalendarRoundBadge(genericEvent(ROUND_OWNER, { time: "" }), [ROUND_OWNER, first, afternoon]), null);
  assert.equal(resolveCalendarRoundBadge(event, [ROUND_OWNER, first, afternoon])?.mark, "1");
  const duplicate = roundMaterial("同轮整理.md", "transcript-study", "第１次面接");
  assert.equal(resolveCalendarRoundBadge(event, [ROUND_OWNER, first, duplicate])?.mark, "1");
});

test("场次来源只借自身日期的明确round，案件当前字段和不相关材料不能补足", () => {
  const review = roundMaterial("复盘.md", "review", "二次面接");
  assert.equal(resolveCalendarRoundBadge(genericEvent(review), [review])?.mark, "2");
  assert.equal(resolveCalendarRoundBadge(genericEvent(review, { date: "2026-09-30" }), [review]), null);
  assert.equal(resolveCalendarRoundBadge(genericEvent(review, { time: "15:00" }), [review]), null);
  const owner = note("案件.md", "job-case", { ...ROUND_OWNER.frontmatter, round: "最終面接", next_action: "三次面接" });
  assert.equal(resolveCalendarRoundBadge(genericEvent(owner), [owner]), null);
  for (const fields of [{ case_id: "other-case" }, { date: "2026-09-30" }, { time: "15:00" }, { company: "株式会社サンプル", case_id: "" }]) {
    const material = roundMaterial("其他资料.md", "interview-prep", "一次面接", fields);
    assert.equal(resolveCalendarRoundBadge(genericEvent(), [ROUND_OWNER, material]), null);
  }
});

test("猎头和说明会不借正式轮次，取消或未定准备稿不补数字", () => {
  const prep = roundMaterial("准备.md", "interview-prep", "一次面接");
  for (const label of ["猎头面谈", "招聘说明会"]) {
    assert.equal(resolveCalendarRoundBadge(genericEvent(ROUND_OWNER, { label }), [ROUND_OWNER, prep]), null);
  }
  for (const session_status of ["cancelled", "preparing", "pending"]) {
    const excluded = roundMaterial("待定准备.md", "interview-prep", "一次面接", { session_status });
    const [event] = buildCalendarEvents([ROUND_OWNER, excluded], new Date("2026-09-29T00:00:00Z"));
    assert.equal(event.label, "面谈");
  }
});

test("无归属旧稿不能替同公司不同案件补轮次，外部资料也不能省略本场已知时刻", () => {
  const otherOwner = note("另一案件.md", "job-case", { ...ROUND_OWNER.frontmatter, case_id: "other-case" });
  const legacy = roundMaterial("旧整理稿.md", "transcript-study", "一次面接", { case_id: "" });
  const notes = [ROUND_OWNER, otherOwner, legacy];
  assert.equal(resolveCalendarRoundBadge(genericEvent(), notes), null);
  assert.equal(resolveCalendarRoundBadge(genericEvent(otherOwner, { caseId: "other-case" }), notes), null);
  const linked = roundMaterial("关联准备.md", "interview-prep", "二次面接", { time: "" });
  for (const time of ["10:00", "15:00"]) {
    assert.equal(resolveCalendarRoundBadge(genericEvent(ROUND_OWNER, { time }), [ROUND_OWNER, linked]), null);
  }
  assert.equal(resolveCalendarRoundBadge(genericEvent(ROUND_OWNER, { time: "" }), [ROUND_OWNER, linked])?.mark, "2");
  assert.equal(resolveCalendarRoundBadge(genericEvent(legacy), notes)?.mark, "1", "本场来源自身的明确阶段不需要借其他材料");
});
