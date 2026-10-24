import assert from "node:assert/strict";
import test from "node:test";
import { buildCalendarEventOrigins, calendarOriginDescription, calendarOriginLabel } from "../lib/calendar-event-origin.ts";

function note(path, type = "job-case", fields = {}) {
  return { path, tags: [], stat: { ctime: 0, mtime: 0, size: 0 }, content: "# 株式会社テスト", frontmatter: {
    type, company: "株式会社テスト", ...fields,
  } };
}
function application(fields = {}, path = "20_求職/テスト/案件.md") {
  return note(path, "job-case", { case_id: "test-case", status: "面接中", applied_on: "2026-10-07",
    application_actor: "ai", application_agent: "テストAI", channel: "企業直投/ATS", ...fields });
}
function event(source, overrides = {}) {
  return { id: "event-test", note: source, kind: "event", company: "株式会社テスト", label: "一次面接",
    date: "2026-10-21", time: "13:00", phase: "past", caseId: source.frontmatter.case_id ?? "", prepPath: "", ...overrides };
}
function origin(source, notes = [source], overrides = {}) {
  const item = event(source, overrides);
  return buildCalendarEventOrigins([item], notes).get(item.id);
}

test("明确的成功提交执行者区分 AI、自投，AI 推荐或笔记作者不能替代执行者", () => {
  const ai = application();
  assert.equal(origin(ai).kind, "ai");
  assert.equal(origin(ai).evidence, "application-ai");
  const self = application({ application_actor: "user", origin: "ai-reco", ai_author: "テストAI" });
  assert.equal(origin(self).kind, "self");
  assert.equal(origin(self).agent, "");
  for (const fields of [
    { application_actor: undefined, origin: "ai-reco", ai_author: "テストAI" },
    { application_actor: undefined, origin: "manual" },
    { application_actor: "agent", origin: "agent", channel: "Recruit Agent" },
  ]) assert.equal(origin(application(fields)).kind, "unknown");
});

test("提交日期、提交结果及执行 AI 不完整时不能给出已确认的代投或自投来源", () => {
  for (const fields of [
    { application_agent: "" }, { applied_on: "" }, { applied_on: "2026-02-30" },
    { applied_on: "2026-10-22" }, { applied_on: "2026-10-07T00:00:00+09:00" },
    { status: "未応募" }, { status: "送信未確認" }, { formal_application_status: "unverified" },
    { application_actor: "user", applied_on: "" },
  ]) assert.equal(origin(application(fields)).kind, "unknown", JSON.stringify(fields));
  assert.equal(origin(application({ status: "不採用（2026-10-24）" })).kind, "ai", "结束不改变历史提交执行者");
});

test("机会起点为 scout 时保留邀约，普通招聘媒体或中介渠道不能推为邀约", () => {
  const invited = application({ origin: "scout" });
  assert.equal(origin(invited).kind, "invited");
  assert.equal(origin(invited).evidence, "scout-origin");
  assert.equal(origin(application({ origin: "scout", application_actor: undefined, applied_on: "" })).kind, "invited");
  for (const channel of ["ビズリーチ", "Findy", "Recruit Agent", "ワークポート", "パソナ", "スカウト未確認", "scout?", "not scout"]) {
    assert.equal(origin(application({ application_actor: undefined, channel })).kind, "unknown", channel);
  }
  for (const channel of ["スカウト", "企業スカウト", "ビズリーチ（スカウト）", "Green / scout"]) {
    assert.equal(origin(application({ application_actor: undefined, channel })).kind, "invited", channel);
  }
});

test("复盘与准备稿从唯一 case 关联读来源，不以同公司另一岗位补来源", () => {
  const ai = application();
  const prep = note("20_求職/テスト/一次准备.md", "interview-prep", { case: "[[20_求職/テスト/案件]]" });
  const review = note("20_求職/テスト/一次整理稿.md", "transcript-study");
  assert.equal(origin(review, [ai, prep, review], { caseId: "test-case", prepPath: prep.path }).kind, "ai");
  const otherJob = application({ case_id: "other-case", origin: "scout" }, "20_求職/テスト/別案件.md");
  assert.equal(origin(review, [review, otherJob]).kind, "unknown");
  const wrongPrep = note("20_求職/テスト/別准备.md", "interview-prep", { case: "[[20_求職/テスト/別案件]]" });
  assert.equal(origin(review, [ai, review, otherJob, wrongPrep], { caseId: "test-case", prepPath: wrongPrep.path }).evidence, "owner-conflict");
  const duplicate = application({ application_actor: "user" }, "20_求職/テスト/重複.md");
  assert.equal(origin(ai, [ai, duplicate]).evidence, "owner-conflict");
});

test("独立中介面谈的预约或 AI 材料提交不能变成 AI 申请来源", () => {
  const meeting = note("20_求職/_TODO/テスト面談.md", "todo", { status: "進行中", next_event_at: "2026-10-21 13:00" });
  meeting.content = "# エージェント面談\n\n本人が予約。AI が職務経歴書を送信した。応募の操作者は確認できない。";
  const prep = note("20_求職/テスト/面谈准备.md", "interview-prep", { meeting: "[[20_求職/_TODO/テスト面談]]" });
  assert.equal(origin(prep, [meeting, prep]).kind, "unknown");
  assert.equal(origin(prep, [meeting, prep]).sourcePath, meeting.path);
  meeting.frontmatter.origin = "scout";
  assert.equal(origin(prep, [meeting, prep]).kind, "invited");
});

test("来源标记和完整说明同时支持中日语；未核实说明不声称已核对", () => {
  const confirmed = origin(application());
  assert.equal(calendarOriginLabel("ai", "zh-CN", true), "AI");
  assert.equal(calendarOriginLabel("self", "ja"), "本人応募");
  assert.match(calendarOriginDescription(confirmed, "zh-CN"), /テストAI.*2026-10-07/);
  assert.match(calendarOriginDescription(confirmed, "ja"), /2026-10-07.*テストAI/);
  const pending = origin(application({ application_actor: undefined }));
  assert.match(calendarOriginDescription(pending), /来源待核实/);
  assert.match(calendarOriginDescription(pending, "ja"), /提出者が未記録/);
});
