import assert from "node:assert/strict";
import test from "node:test";
import { calendarProgress, isCalendarHistoricalProgress } from "../lib/calendar-progress.ts";

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
  assert.equal(unknown.tone, "neutral");
  assert.equal(unknown.code, "historical-unlinked");
  assert.equal(unknown.label, "历史记录");
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
  assert.equal(calendarProgress(event(prep), [meeting, prep]).code, "meeting-unrecorded");
  assert.equal(calendarProgress(event(prep), [meeting, prep]).tone, "neutral");
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
  assert.equal(calendarProgress(event(prep), [meeting, prep]).code, "association-missing");
  assert.equal(calendarProgress(event(prep), [meeting, prep]).tone, "neutral");
});

test("缺失、重名、重复 ID 和矛盾关联不按公司或文件顺序猜结果", () => {
  const rejected = job(undefined, { status: "不採用" });
  const duplicateId = job("20_求職/テスト/重复ID.md");
  const duplicateName = job("20_求職/別/案件.md", { case_id: "test-other" });
  for (const [frontmatter, notes, overrides, code] of [
    [{}, [rejected], {}, "historical-unlinked"],
    [{ case_id: "test-missing" }, [rejected], {}, "association-missing"],
    [{ case_id: "test-case" }, [rejected, duplicateId], {}, "association-conflict"],
    [{ case: "[[案件]]" }, [rejected, duplicateName], {}, "association-conflict"],
    [{ case_id: "test-other", case: "[[20_求職/テスト/案件]]" }, [rejected], {}, "association-conflict"],
    [{ case_id: "test-case" }, [rejected], { caseId: "test-other" }, "association-conflict"],
  ]) {
    const prep = note("20_求職/テスト/准备.md", "interview-prep", frontmatter);
    const progress = calendarProgress(event(prep, overrides), [...notes, prep]);
    assert.equal(progress.code, code);
    assert.equal(progress.tone, code === "association-conflict" ? "unknown" : "neutral");
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
  assert.equal(calendarProgress(event(broken), [meeting, prep, broken]).code, "association-missing");
  const otherPrep = { ...prep, path: "20_求職/テスト/另一场准备.md", frontmatter: { ...prep.frontmatter, meeting: "[[其他面谈]]" } };
  assert.equal(calendarProgress(event(review), [...notes, otherPrep]).code, "historical-unlinked");
});

test("每个判定分支带稳定 code，日语界面按 code 翻译而不改中文正本", () => {
  const cases = [
    [job(undefined, { status: "不採用" }), "upcoming", "rejected"],
    [job(undefined, { status: "保留（本人判断）" }), "past", "paused"],
    [job(undefined, { status: "内定" }), "past", "offer"],
    [job(), "upcoming", "scheduled"],
    [job(undefined, { waiting_label: "結果連絡" }), "past", "waiting-case"],
    [job(undefined, { waiting_for: "self" }), "past", "active-self"],
    [note("未关联.md", "review", { date: "2026-08-10" }), "past", "historical-unlinked"],
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

test("未关联复盘的结构化当轮结果保留，不从旧通过结果推出当前选考或本人动作", () => {
  for (const [result, code, tone, label] of [
    ["不採用", "recorded-rejected", "closed", "当轮未通过"],
    ["通過", "recorded-passed", "neutral", "当轮通过"],
    ["面談完了", "recorded-meeting-completed", "neutral", "面谈已完成"],
    ["面談完了・過去の確認事項", "recorded-meeting-completed", "neutral", "面谈已完成"],
    ["面談完了／履歴の補足", "recorded-meeting-completed", "neutral", "面谈已完成"],
    ["面談完了予定", "historical-result", "neutral", "已有当轮记录"],
    ["翌日返信で実質終了", "historical-result", "neutral", "已有当轮记录"],
    ["完了", "historical-result", "neutral", "已有当轮记录"],
    ["不採用（翌日）", "historical-result", "neutral", "已有当轮记录"],
  ]) {
    const source = note("20_求職/テスト/旧复盘.md", "review", { date: "2026-08-10", result });
    const progress = calendarProgress(event(source), [source, job()]);
    assert.equal(progress.code, code);
    assert.equal(progress.tone, tone);
    assert.equal(progress.label, label);
    assert.equal(progress.recordedResult, result);
    assert.equal(progress.ownerKey, undefined, "同公司现行案件不能冒充明确关联");
    assert.equal(isCalendarHistoricalProgress(progress), true);
  }
  for (const result of [undefined, null, ["不採用"], { value: "不採用" }]) {
    const source = note("20_求職/テスト/旧复盘.md", "review", { result });
    source.content = "## 結果\n不採用\n";
    assert.equal(calendarProgress(event(source), [source]).code, "historical-unlinked", "不解析正文推断结果");
  }
  const privateContext = note("20_求職/テスト/面谈记录.md", "review", { result: "面談完了・PRIVATE_OLD_TASK" });
  const progress = calendarProgress(event(privateContext), [privateContext]);
  assert.equal(progress.recordedResult, "面談完了・PRIVATE_OLD_TASK");
  assert.doesNotMatch(progress.detail, /PRIVATE_OLD_TASK/, "默认提示不暴露旧事项或私人条件");
  assert.equal(progress.code, "recorded-meeting-completed");
});

test("明确关联的现行正本优先于复盘当轮结果，self不会自动变成必做动作", () => {
  const source = note("20_求職/テスト/复盘.md", "review", { case_id: "test-case", result: "不採用" });
  const waiting = calendarProgress(event(source), [source, job()]);
  assert.equal(waiting.code, "waiting-case");
  assert.equal(waiting.ownerKey, "case:test-case");
  assert.equal(isCalendarHistoricalProgress(waiting), false);
  const rejected = calendarProgress(event({ ...source, frontmatter: { ...source.frontmatter, result: "通過" } }),
    [source, job(undefined, { status: "不採用" })]);
  assert.equal(rejected.code, "rejected");
  const self = calendarProgress(event(source), [source, job(undefined, { waiting_for: "self" })]);
  assert.equal(self.code, "active-self");
  assert.match(self.detail, /已核实待办/);
  assert.doesNotMatch(self.detail, /下一步由本人处理|必须/);
});

test("明确坏链和冲突不借当轮结果伪装归属，结果仅保留为历史上下文", () => {
  const first = job();
  const duplicate = job("20_求職/テスト/重复.md");
  for (const [fields, notes, code, tone] of [
    [{ case: "[[不存在的正本]]" }, [first], "association-missing", "neutral"],
    [{ case_id: "不存在" }, [first], "association-missing", "neutral"],
    [{ case_id: "test-case" }, [first, duplicate], "association-conflict", "unknown"],
    [{ case: "[[案件]]", meeting: "[[独立面谈]]" }, [first], "association-conflict", "unknown"],
  ]) {
    const source = note("20_求職/テスト/旧复盘.md", "review", { date: "2026-08-10", result: "不採用", ...fields });
    const progress = calendarProgress(event(source), [...notes, source]);
    assert.equal(progress.code, code);
    assert.equal(progress.tone, tone);
    assert.equal(progress.recordedResult, "不採用");
    assert.equal(isCalendarHistoricalProgress(progress), code !== "association-conflict");
  }
});

test("同一正本的多版准备稿能补足旧复盘归属，异案和显式坏链仍不回退", () => {
  const owner = job(undefined, { status: "不採用" });
  const prep = note("20_求職/テスト/准备v1.md", "interview-prep", {
    case: "[[20_求職/テスト/案件]]", date: "2026-08-10", round: "一次面接", time: "10:00",
  });
  const next = { ...prep, path: "20_求職/テスト/准备v2.md" };
  const review = note("20_求職/テスト/旧复盘.md", "review", { date: "2026-08-10", result: "通過" });
  const notes = [owner, prep, next, review];
  const progress = calendarProgress(event(review), notes);
  assert.equal(progress.code, "rejected");
  assert.equal(progress.ownerKey, "case:test-case");
  const another = job("20_求職/テスト/別案件.md", { case_id: "test-other" });
  const conflicting = { ...next, frontmatter: { ...next.frontmatter, case: "[[20_求職/テスト/別案件]]" } };
  assert.equal(calendarProgress(event(review), [owner, another, prep, conflicting, review]).code, "recorded-passed");
  const broken = { ...review, frontmatter: { ...review.frontmatter, case: "[[不存在的正本]]" } };
  assert.equal(calendarProgress(event(broken), [...notes, broken]).code, "association-missing");
});

test("独立面谈的明确ownerKey可供汇总去重，完了任务不等于选考结束", () => {
  const meeting = note("20_求職/テスト/独立面谈.md", "todo", { status: "完了", selection_status: "waiting" });
  const prep = note("20_求職/テスト/准备.md", "interview-prep", { meeting: "[[独立面谈]]" });
  const progress = calendarProgress(event(prep), [meeting, prep]);
  assert.equal(progress.code, "meeting-waiting");
  assert.equal(progress.ownerKey, `meeting:${meeting.path}`);
  const missing = { ...meeting, frontmatter: { ...meeting.frontmatter, selection_status: undefined } };
  assert.equal(calendarProgress(event(prep), [missing, prep]).code, "meeting-unrecorded");
});
