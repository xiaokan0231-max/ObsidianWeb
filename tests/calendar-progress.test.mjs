import assert from "node:assert/strict";
import test from "node:test";
import { calendarProgress } from "../lib/calendar-progress.ts";

function note(path, type, frontmatter = {}) {
  return { path, frontmatter: { type, company: "株式会社テスト", ...frontmatter }, content: "", tags: [], stat: { ctime: 0, mtime: 0, size: 0 } };
}

function event(source, overrides = {}) {
  return {
    id: "test-event", note: source, kind: "event", company: "株式会社テスト",
    date: "2026-08-10", time: "10:00", label: "第一次面试", phase: "past",
    caseId: source.frontmatter.case_id ?? "", prepPath: "", ...overrides,
  };
}

function job(path = "20_求職/テスト/案件.md", frontmatter = {}) {
  return note(path, "job-case", { case_id: "test-case", status: "面接中", waiting_for: "company", ...frontmatter });
}

test("明确拒信、保留、内定盖过旧等待和未清理的未来预约", () => {
  for (const [status, tone, label] of [
    ["不採用（2026-08-11・一次面接）", "closed", "已结束"],
    ["保留", "paused", "暂停推进"],
    ["内定", "active", "已获内定"],
  ]) {
    const source = job(undefined, { status });
    const progress = calendarProgress(event(source, { phase: "upcoming" }), [source]);
    assert.equal(progress.tone, tone);
    assert.equal(progress.label, label);
  }
});

test("待面谈盖过等待对象，当天有完成记录后才显示等回复", () => {
  const source = job();
  const scheduled = event(source, { phase: "upcoming" });
  assert.equal(calendarProgress(scheduled, [source]).label, "待进行");
  const prep = note("20_求職/テスト/一次准备.md", "interview-prep", {
    case_id: "test-case", date: scheduled.date, round: "一次面接", time: "10:00", session_status: "completed",
  });
  const waiting = calendarProgress(scheduled, [source, prep]);
  assert.equal(waiting.tone, "waiting");
  assert.match(waiting.detail, /等待企业/);
  assert.equal(calendarProgress(event(job(undefined, { waiting_for: "self" })), []).label, "进行中");
});

test("等回复、暂停推进和资料缺失分别显示，并保留暂停原因", () => {
  const waiting = job();
  const paused = job("暂停.md", { case_id: "paused", status: "保留（本人判断で見送り）" });
  const missing = note("未关联.md", "review", { date: "2026-08-10" });
  assert.equal(calendarProgress(event(waiting), [waiting]).tone, "waiting");
  const held = calendarProgress(event(paused), [paused]);
  assert.equal(held.tone, "paused");
  assert.match(held.detail, /本人判断で見送り/);
  const unknown = calendarProgress(event(missing), [waiting, paused, missing]);
  assert.equal(unknown.tone, "unknown");
  assert.equal(unknown.label, "资料待核对");
});

test("同公司两个岗位按 case_id 分开，准备稿读取对应案件的当前结果", () => {
  const rejected = job(undefined, { status: "不採用" });
  const ongoing = job("20_求職/テスト/別案件.md", { case_id: "test-other", waiting_for: "agent" });
  const prep = note("20_求職/テスト/准备.md", "interview-prep", { case_id: "test-other" });
  const progress = calendarProgress(event(prep), [rejected, ongoing, prep]);
  assert.equal(progress.tone, "waiting");
  assert.match(progress.detail, /等待中介/);
  const explicit = note("20_求職/テスト/明确准备.md", "interview-prep", { case: "[[案件]]" });
  assert.equal(calendarProgress(event(explicit), [rejected, ongoing, explicit]).tone, "closed");
});

test("独立面谈的准备 TODO 完了不代表后续结束，显式进展才改变状态点", () => {
  const meeting = note("20_求職/テスト/独立面谈.md", "todo", { status: "完了", waiting_label: "面談後の結果" });
  const prep = note("20_求職/テスト/面谈准备.md", "interview-prep", { meeting: "[[独立面谈]]" });
  assert.equal(calendarProgress(event(prep), [meeting, prep]).label, "资料待核对");
  for (const [selection_status, tone] of [["waiting", "waiting"], ["closed", "closed"]]) {
    const updated = { ...meeting, frontmatter: { ...meeting.frontmatter, selection_status } };
    const progress = calendarProgress(event(prep), [updated, prep]);
    assert.equal(progress.tone, tone);
    if (selection_status === "waiting") assert.match(progress.detail, /面談後の結果/);
  }
});

test("挂着案件的 TODO 不得以独立面谈状态盖过案件，缺失案件也不降级猜测", () => {
  const source = job(undefined, { status: "不採用" });
  const meeting = note("20_求職/テスト/准备任务.md", "todo", {
    case_id: "test-case", status: "完了", selection_status: "waiting",
  });
  const prep = note("20_求職/テスト/准备.md", "interview-prep", { meeting: "[[准备任务]]" });
  assert.equal(calendarProgress(event(prep), [source, meeting, prep]).tone, "closed");
  assert.equal(calendarProgress(event(prep), [meeting, prep]).tone, "unknown");
});

test("缺失、重名、重复 ID 和矛盾关联不按公司或文件顺序猜结果", () => {
  const rejected = job(undefined, { status: "不採用" });
  const duplicateId = job("20_求職/テスト/重复ID.md");
  const duplicateName = job("20_求職/別/案件.md", { case_id: "test-other" });
  for (const [frontmatter, notes, overrides] of [
    [{}, [rejected], {}],
    [{ case_id: "test-missing" }, [rejected], {}],
    [{ case_id: "test-case" }, [rejected, duplicateId], {}],
    [{ case: "[[案件]]" }, [rejected, duplicateName], {}],
    [{ case_id: "test-other", case: "[[20_求職/テスト/案件]]" }, [rejected], {}],
    [{ case_id: "test-case" }, [rejected], { caseId: "test-other" }],
  ]) {
    const prep = note("20_求職/テスト/准备.md", "interview-prep", frontmatter);
    assert.equal(calendarProgress(event(prep, overrides), [...notes, prep]).tone, "unknown");
  }
});

test("无关联旧复盘借唯一当轮准备稿定位独立面谈，有失效引用或多场歧义时不借", () => {
  const meeting = note("20_求職/テスト/独立面谈.md", "todo", { status: "完了", selection_status: "closed" });
  const prep = note("20_求職/テスト/准备.md", "interview-prep", {
    meeting: "[[独立面谈]]", date: "2026-08-10", round: "一次面接", time: "10:00",
  });
  const review = note("20_求職/テスト/旧复盘.md", "review", { date: "2026-08-10" });
  const notes = [meeting, prep, review];
  assert.equal(calendarProgress(event(review), notes).tone, "closed");
  const broken = { ...review, frontmatter: { ...review.frontmatter, meeting: "[[缺失面谈]]" } };
  assert.equal(calendarProgress(event(broken), [meeting, prep, broken]).tone, "unknown");
  const otherPrep = { ...prep, path: "20_求職/テスト/另一场准备.md", frontmatter: { ...prep.frontmatter, meeting: "[[其他面谈]]" } };
  assert.equal(calendarProgress(event(review), [...notes, otherPrep]).tone, "unknown");
});

test("每个判定分支带稳定 code，日语界面按 code 翻译而不改中文正本", () => {
  const cases = [
    [job(undefined, { status: "不採用" }), "upcoming", "rejected"],
    [job(undefined, { status: "保留（本人判断）" }), "past", "paused"],
    [job(undefined, { status: "内定" }), "past", "offer"],
    [job(), "upcoming", "scheduled"],
    [job(undefined, { waiting_label: "結果連絡" }), "past", "waiting-case"],
    [job(undefined, { waiting_for: "self" }), "past", "active-self"],
    [note("未关联.md", "review", { date: "2026-08-10" }), "past", "unrecorded"],
  ];
  for (const [source, phase, code] of cases) {
    const progress = calendarProgress(event(source, { phase }), [source]);
    assert.equal(progress.code, code, code);
  }
  const waiting = calendarProgress(event(job(undefined, { waiting_label: "結果連絡" })), [job(undefined, { waiting_label: "結果連絡" })]);
  assert.equal(waiting.waitingFor, "company");
  assert.equal(waiting.waitingLabel, "結果連絡");
  const paused = job(undefined, { status: "保留（本人判断）" });
  assert.equal(calendarProgress(event(paused), [paused]).reason, "本人判断");
});
