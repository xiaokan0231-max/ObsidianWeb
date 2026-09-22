import assert from "node:assert/strict";
import test from "node:test";
import { resolveCalendarInterview } from "../lib/calendar-interview.ts";

function note(path, type, frontmatter = {}) {
  return {
    path, frontmatter: { type, ...frontmatter }, content: "", tags: [],
    stat: { ctime: 0, mtime: 0, size: 0 },
  };
}

const SOURCE = note("20_求職/テスト/案件.md", "job-case", { company: "株式会社テスト", case_id: "test-case" });
function event(overrides = {}) {
  return {
    id: "test-event", kind: "event", note: SOURCE, company: "株式会社テスト",
    date: "2026-09-14", time: "", label: "第一次面试", phase: "upcoming",
    caseId: "test-case", prepPath: "", ...overrides,
  };
}

function material(path, type = "interview-prep", frontmatter = {}) {
  return note(path, type, {
    company: "テスト", date: "2026-09-14", round: "一次面接", ...frontmatter,
  });
}

test("只有面试、面谈事件跳转；行动、跟进和招聘说明会仍打开原笔记", () => {
  for (const variant of [{ kind: "action" }, { kind: "follow-up" }, { label: "招聘说明会" }, { label: "締切" }]) {
    assert.equal(resolveCalendarInterview(event(variant), []), null);
  }
  assert.equal(resolveCalendarInterview(event({ label: "猎头面谈" }), []).view, "session");
});

test("精确定位当轮准备稿，不使用按 case_id 覆盖的 prepPath", () => {
  const first = material("20_求職/テスト/一次准备.md", "interview-prep", { case_id: "test-case" });
  const final = material("20_求職/テスト/最终准备.md", "interview-prep", { case_id: "test-case", date: "2026-09-21", round: "最終面接" });
  assert.deepEqual(resolveCalendarInterview(event({ prepPath: final.path }), [SOURCE, first, final]), {
    view: "session", path: first.path, company: "株式会社テスト", date: "2026-09-14",
    label: "第一次面试", sourcePath: SOURCE.path, caseId: "test-case", time: undefined,
  });
});

test("过去面试定位整理稿，复盘或批注的路径不能代替 UI 使用的整理稿键", () => {
  const study = material("20_求職/テスト/整理稿.md", "transcript-study");
  const deep = material("20_求職/テスト/回答品質復盤.md", "interview-answer-review");
  const result = resolveCalendarInterview(event({ phase: "past" }), [deep, study]);
  assert.equal(result.view, "review");
  assert.equal(result.path, study.path);
  assert.equal(resolveCalendarInterview(event({ phase: "past" }), [deep]).path, null);
});

test("当天开始时间已过仍进入准备，完成状态或实际逐字稿才进入复盘", () => {
  const prep = material("准备.md");
  assert.equal(resolveCalendarInterview(event({ time: "00:01" }), [prep]).view, "session");
  const completed = material("完成准备.md", "interview-prep", { session_status: "completed" });
  const completedResult = resolveCalendarInterview(event(), [completed]);
  assert.equal(completedResult.view, "review");
  assert.equal(completedResult.path, null);
  const raw = material("逐字稿.md", "transcript");
  const rawResult = resolveCalendarInterview(event(), [prep, raw]);
  assert.equal(rawResult.view, "review");
  assert.equal(rawResult.path, null);
  const wrongRound = material("二次逐字稿.md", "transcript", { round: "二次面接" });
  assert.equal(resolveCalendarInterview(event(), [prep, wrongRound]).view, "session");
});

test("同社同日的多轮按中日轮次名称识别，已知不同轮次不能命中", () => {
  const first = material("一次.md");
  const second = material("二次.md", "interview-prep", { round: "二次面接" });
  const final = material("最终.md", "interview-prep", { round: "最終面接" });
  const casual = material("轻松.md", "interview-prep", { round: "カジュアル面談" });
  const notes = [second, final, casual, first];
  for (const [label, path] of [["第一次面试", first.path], ["第二次面试", second.path], ["最终面试", final.path], ["轻松面谈", casual.path]]) {
    assert.equal(resolveCalendarInterview(event({ label }), notes).path, path);
  }
  assert.equal(resolveCalendarInterview(event(), [second]).path, null);
  assert.equal(resolveCalendarInterview(event({ label: "面谈" }), notes).path, null);
});

test("同日同轮有多个时间时按时间匹配，缺少信息则保留歧义", () => {
  const morning = material("上午.md", "interview-prep", { time: "9:00〜10:00" });
  const afternoon = material("下午.md", "interview-prep", { time: "15:00" });
  assert.equal(resolveCalendarInterview(event({ time: "09:00" }), [morning, afternoon]).path, morning.path);
  assert.equal(resolveCalendarInterview(event({ time: "12:00" }), [morning, afternoon]).path, null);
  assert.equal(resolveCalendarInterview(event(), [morning, afternoon]).path, null);
});

test("泛称事件跨准备稿和逐字稿一起消歧，另一轮的唯一逐字稿不等于本场已结束", () => {
  const first = material("一次准备.md");
  const second = material("二次准备.md", "interview-prep", { round: "二次面接" });
  const study = material("一次整理稿.md", "transcript-study");
  const generic = event({ label: "面试" });
  const ambiguous = resolveCalendarInterview(generic, [first, second, study]);
  assert.equal(ambiguous.view, "session");
  assert.equal(ambiguous.path, null);
  assert.equal(resolveCalendarInterview(event(), [first, second, study]).path, study.path);

  const morning = material("上午准备.md", "interview-prep", { time: "09:00" });
  const afternoon = material("下午逐字稿.md", "transcript", { time: "15:00" });
  assert.equal(resolveCalendarInterview(generic, [morning, afternoon]).view, "session");
  assert.equal(resolveCalendarInterview(generic, [morning, afternoon]).path, null);
  assert.equal(resolveCalendarInterview(event({ time: "09:00" }), [morning, afternoon]).path, morning.path);
});

test("明确案件关联确定当轮后，无关联的其他轮逐字稿不能触发复盘", () => {
  const prep = material("明确准备.md", "interview-prep", { case_id: "test-case", round: "二次面接" });
  const study = material("旧整理稿.md", "transcript-study");
  const result = resolveCalendarInterview(event({ label: "面试" }), [SOURCE, prep, study]);
  assert.equal(result.view, "session");
  assert.equal(result.path, prep.path);
});

test("案件 ID 和明确链接优先于旧稿，但已知的不同案件必须排除", () => {
  const legacy = material("旧稿.md");
  const linked = material("关联稿.md", "interview-prep", { case: "[[案件#日程|该案件]]" });
  const different = material("其他案件稿.md", "interview-prep", { case_id: "test-other" });
  assert.equal(resolveCalendarInterview(event(), [SOURCE, legacy, linked, different]).path, linked.path);
  assert.equal(resolveCalendarInterview(event(), [SOURCE, different]).path, null);
  const differentOwner = note("20_求職/テスト/另一案件.md", "job-case", { case_id: "test-other" });
  const explicitDifferent = material("明确其他案件.md", "interview-prep", { case: "[[另一案件]]" });
  assert.equal(resolveCalendarInterview(event(), [SOURCE, differentOwner, explicitDifferent]).path, null);
  const brokenDifferent = material("失效关联稿.md", "interview-prep", { case: "[[不存在的其他案件]]" });
  assert.equal(resolveCalendarInterview(event(), [SOURCE, brokenDifferent]).path, null);
});

test("独立面谈通过 meeting 链接定位，同公司案件及另一场面谈不混入", () => {
  const meeting = note("20_求職/テスト/面谈记录.md", "todo", { company: "テスト" });
  const sourceEvent = event({ note: meeting, caseId: "", label: "猎头面谈" });
  const prep = material("面谈准备.md", "interview-prep", { round: "エージェント面談", meeting: "[[面谈记录]]" });
  const other = material("其他面谈准备.md", "interview-prep", { round: "エージェント面談", meeting: "[[其他面谈]]" });
  const casePrep = material("案件准备.md", "interview-prep", { round: "エージェント面談", case: "[[案件]]" });
  assert.equal(resolveCalendarInterview(sourceEvent, [SOURCE, meeting, other, prep, casePrep]).path, prep.path);
  assert.equal(resolveCalendarInterview(sourceEvent, [SOURCE, meeting, other, casePrep]).path, null);
});

test("局部资料缺少案件正本时，case_id 仍足以防止串入独立面谈", () => {
  const meeting = note("20_求職/テスト/独立面谈.md", "todo", { company: "テスト" });
  const prep = material("另案准备.md", "interview-prep", { round: "カジュアル面談", case_id: "test-other" });
  const sourceEvent = event({ note: meeting, caseId: "", label: "轻松面谈" });
  assert.equal(resolveCalendarInterview(sourceEvent, [meeting, prep]).path, null);
  const sameCasePrep = material("同案准备.md", "interview-prep", { case_id: "test-case" });
  assert.equal(resolveCalendarInterview(event(), [sameCasePrep]).path, sameCasePrep.path);
});

test("不跨公司或日期兜底；无法消除的歧义和重名链接显示空状态", () => {
  const wrongCompany = material("另一公司.md", "interview-prep", { company: "株式会社サンプル" });
  const wrongDate = material("另一日期.md", "interview-prep", { date: "2026-09-15" });
  assert.equal(resolveCalendarInterview(event(), [wrongCompany, wrongDate]).path, null);
  const first = material("准备A.md");
  const second = material("准备B.md");
  assert.equal(resolveCalendarInterview(event(), [first, second]).path, null);
  const duplicateSource = note("20_求職/其他/案件.md", "job-case", { case_id: "test-duplicate" });
  const ambiguous = material("重名关联.md", "interview-prep", { case: "[[案件]]" });
  assert.equal(resolveCalendarInterview(event(), [SOURCE, duplicateSource, ambiguous]).path, null);
});

test("全角、法人格和分隔符差异使用共享公司归一化", () => {
  const prep = material("准备.md", "interview-prep", { company: "Sample_Test" });
  assert.equal(resolveCalendarInterview(event({ company: "株式会社Ｓａｍｐｌｅ Ｔｅｓｔ" }), [prep]).path, prep.path);
});
