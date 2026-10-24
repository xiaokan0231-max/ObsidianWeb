import assert from "node:assert/strict";
import test from "node:test";
import { buildRecentProgress } from "../lib/recent-progress.ts";

const TODAY = "2026-10-05";
function note(path, type, fields = {}, content = "") {
  return { path, frontmatter: { type, ...fields }, content, tags: [], stat: { ctime: 0, mtime: 0, size: 0 } };
}
function job(fields = {}, path = "20_求職/テスト/案件.md") {
  return note(path, "job-case", { case_id: "test-case", company: "株式会社テスト", position: "データエンジニア",
    status: "応募済", status_updated: "2026-10-03", channel: "Green", ...fields });
}
function todo(fields = {}, path = "20_求職/_TODO/本人確認.md") {
  return note(path, "todo", { status: "未着手", case_id: "test-case", action_owner: "user", action_kind: "required",
    action_reviewed_at: TODAY, action: "提出内容を確認する", action_reason: "企業から追加内容の確認を求められている",
    action_source: "https://example.com/messages/1", action_next_owner: "ai", ...fields });
}
function work(fields = {}, path = "20_求職/_応募書類/内部作業記録.md", type = "application_log") {
  return note(path, type, { status: "completed", date: "2026-10-03", ai_author: "Example Assistant", ...fields },
    "# INTERNAL_NOTE_TITLE\n操作指示 SECRET_BODY\n送信済みと推測しない。2026-10-05新規返信。https://example.com/internal");
}
function build(notes) { return buildRecentProgress(notes, TODAY); }

test("状态使用明确事件日，updated、mtime、正文和日期文件名不生成新事件", () => {
  const original = job({ updated: TODAY, date: TODAY }, "20_求職/テスト/2026-10-05_案件.md");
  original.stat.mtime = Date.parse(`${TODAY}T00:00:00Z`);
  original.content = "## 2026-10-05 同步\n刚收到回复（正文不解析）";
  const first = build([original]).entries;
  assert.equal(first.length, 1);
  assert.equal(first[0].date, "2026-10-03");
  assert.equal(first[0].dateBasis, "event");
  assert.equal(first[0].state, "応募済");
  const changed = structuredClone(original);
  changed.frontmatter.updated = "2026-10-06";
  changed.content += "\n内部更新";
  changed.stat.mtime += 86400000;
  assert.deepEqual(build([changed]).entries, first);
  const missing = build([job({ status_updated: undefined, updated: TODAY, date: TODAY })]);
  assert.equal(missing.entries.length, 0);
  assert.equal(missing.gaps.undated, 1);
});

test("当前状态只取枚举，不把括号、下一步或受理文案当通过与历史变迁", () => {
  const entry = build([job({ status: "応募済（自動受理。SECRET_STATUS_DETAIL）", next_action: "書類通過予定" })]).entries[0];
  assert.equal(entry.state, "応募済");
  assert.equal(entry.kind, "status");
  assert.equal(JSON.stringify(entry).includes("SECRET_STATUS_DETAIL"), false);
  assert.equal(build([job({ status: "新しいステージ" })]).entries.length, 0);
  assert.equal(build([job({ status: "未応募", status_updated: TODAY })]).entries.length, 0);
});

test("确认过的AI申请复用日历事实，去掉同日応募済重复而保留后续拒绝", () => {
  const applied = job({ applied_on: "2026-10-03", application_actor: "ai", application_agent: "Example Assistant" });
  const duplicate = job(applied.frontmatter, "20_求職/テスト/同一案件副本.md");
  const one = build([duplicate, applied, applied]).entries;
  assert.equal(one.length, 1);
  assert.equal(one[0].kind, "application");
  assert.equal(one[0].date, "2026-10-03");
  assert.equal(one[0].state, "application-submitted");
  assert.equal(one[0].actor, "Example Assistant");
  const rejected = build([job({ ...applied.frontmatter, status: "不採用", status_updated: "2026-10-05" })]).entries;
  assert.deepEqual(rejected.map((entry) => [entry.kind, entry.date]), [["status", TODAY], ["application", "2026-10-03"]]);
  for (const fields of [{ application_actor: undefined, ai_author: "Example Assistant" },
    { application_agent: undefined }, { applied_on: undefined }, { status: "未応募" }, { applied_on: "2026-10-06" }]) {
    assert.equal(build([job({ ...applied.frontmatter, ...fields })]).entries.some((entry) => entry.kind === "application"), false);
  }
});

test("同案件的相同状态记录去重并保留安全来源，不合并不同岗位", () => {
  const entries = build([job(), job({}, "20_求職/テスト/副本.md"), job({ case_id: "another-case" }, "20_求職/テスト/別岗位.md")]).entries;
  assert.equal(entries.length, 2);
  const merged = entries.find((entry) => entry.caseId === "test-case");
  assert.equal(merged.sourceCount, 2);
  assert.equal(merged.sourcePaths.length, 2);
});

test("阻碍只取已审核current，审核日期不冒充来信日，也不输出内部正文", () => {
  const action = todo();
  action.content = "内部推理 SECRET_TODO_BODY";
  const result = build([job(), action, todo({ action_reviewed_at: undefined }, "20_求職/_TODO/未审核.md"),
    todo({ action_owner: "company", action_kind: "waiting" }, "20_求職/_TODO/等待.md"),
    todo({ action_owner: "ai" }, "20_求職/_TODO/AI资料.md"),
    todo({ action_kind: "optional" }, "20_求職/_TODO/任意.md")]);
  const blockers = result.entries.filter((entry) => entry.kind === "blocker");
  assert.equal(blockers.length, 1);
  const entry = blockers[0];
  assert.equal(entry.dateBasis, "reviewed");
  assert.equal(entry.date, TODAY);
  assert.equal(entry.action, action.frontmatter.action);
  assert.equal(entry.summary, action.frontmatter.action_reason);
  assert.equal(entry.actionPath, action.path);
  assert.deepEqual(entry.externalSources, ["https://example.com/messages/1"]);
  assert.equal(result.gaps.unreviewed, 1);
  assert.equal(JSON.stringify(result).includes("SECRET_TODO_BODY"), false);
  assert.equal(build([job({ status: "不採用" }), action]).entries.some((entry) => entry.kind === "blocker"), false);
});

test("阻碍期限仅使用已核实due与原文相对说明，建议日期不进入进展投影", () => {
  const dated = build([job(), todo({ due: "2026-10-06", due_text: "企業原文の期限", suggested_due: "2026-10-05" })])
    .entries.find((entry) => entry.kind === "blocker");
  assert.equal(dated.due, "2026-10-06");
  assert.equal(dated.dueText, "企業原文の期限");
  assert.equal(dated.suggested_due, undefined);
  assert.equal(dated.suggestedDue, undefined);
  const relative = build([job(), todo({ due_text: "本日から1週間以内", suggested_due: "2026-10-06" })])
    .entries.find((entry) => entry.kind === "blocker");
  assert.equal(relative.due, undefined);
  assert.equal(relative.dueText, "本日から1週間以内");
  assert.equal(build([job(), todo({ due: "2026-02-30" })]).entries.some((entry) => entry.kind === "blocker"), false);
  assert.equal(build([job({ due: TODAY, due_text: "案件の日付" })]).entries[0].due, undefined);
  assert.equal(build([work({ due: TODAY })]).entries[0].due, undefined);
});

test("来源只接受明确http链接和case/todo路径，工作来源不能打开内部记录", () => {
  const internal = work();
  const blocked = todo({ action_source: `[[${internal.path}]]` });
  const result = build([job({ url: "https://example.com/jobs/1" }), blocked, internal]);
  const serialized = JSON.stringify(result.entries);
  for (const secret of [internal.path, "INTERNAL_NOTE_TITLE", "SECRET_BODY", "https://example.com/internal"]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
  const record = result.entries.find((entry) => entry.kind === "work");
  assert.deepEqual(record.sourcePaths, []);
  assert.deepEqual(record.externalSources, []);
  assert.equal(record.sourceCount, 1);
  assert.equal(record.actor, undefined, "作者不能推断为操作执行者");
  assert.equal(record.summary, undefined);
  assert.equal(record.title, undefined);
  assert.equal(record.content, undefined);
  assert.equal(record.note, undefined);
  for (const source of ["javascript:alert(1)", "file:///tmp/private", "https://user:password@example.com/a", "原文 https://example.com/a"]) {
    const entry = build([job(), todo({ action_source: source })]).entries.find((item) => item.kind === "blocker");
    assert.deepEqual(entry.externalSources, []);
  }
  const linked = build([job(), todo({ action_source: "[[20_求職/テスト/案件]]" })]).entries.find((entry) => entry.kind === "blocker");
  assert.deepEqual(new Set(linked.sourcePaths), new Set([job().path, todo().path]));
});

test("工作状态必须明示，完成记录不等于外部已发送，active不表示正在执行", () => {
  const result = build([
    work(), work({ status: "active" }, "20_求職/active.md"), work({ status: "pending" }, "20_求職/pending.md", "profile_sync"),
    work({ status: undefined, execution_status: "complete" }, "20_求職/execution.md"),
    work({ status: "pending", execution_status: "complete" }, "20_求職/conflict.md"),
    work({ status: "completed", execution_status: "failed" }, "20_求職/failure.md"),
    work({ status: "completed", execution_status: "in-progress" }, "20_求職/unfinished.md"),
    work({ status: "prepared" }, "20_求職/prepared.md"), work({ status: "awaiting_approval" }, "20_求職/approval.md"),
    work({ status: "saved" }, "20_求職/saved.md"), work({ status: "completed" }, "20_求職/sync.md", "job_platform_sync"),
  ]);
  assert.equal(result.entries.filter((entry) => entry.state === "work-completed").length, 3);
  assert.equal(result.entries.filter((entry) => entry.state === "saved").length, 2);
  assert.equal(result.entries.some((entry) => entry.state === "work-in-progress" || entry.state === "sent"), false);
  assert.equal(result.entries.some((entry) => entry.state === "prepared"), true);
  assert.equal(result.entries.some((entry) => entry.state === "awaiting-approval"), true);
  assert.equal(result.entries.every((entry) => entry.dateBasis === "recorded"), true);
  assert.equal(result.gaps.unsupportedRecords, 4);
});

test("发送日、草稿记录日和AI作者分开，明确未发送不能晋升", () => {
  const cases = [
    [{ sent: true, sent_at: "2026-09-09", date: "2026-09-08" }, "sent", "event", "2026-09-09"],
    [{ sent: "2026-09-09", status: "送信済み", date: "2026-09-08" }, "sent", "event", "2026-09-09"],
    [{ sent: true, date: "2026-09-08" }, "sent", "recorded", "2026-09-08"],
    [{ status: "送信済", date: "2026-09-08" }, "sent", "recorded", "2026-09-08"],
    [{ sent: false, date: "2026-09-08" }, "not-sent", "recorded", "2026-09-08"],
    [{ status: "未送信", date: "2026-09-08" }, "not-sent", "recorded", "2026-09-08"],
    [{ date: "2026-09-08" }, "draft", "recorded", "2026-09-08"],
  ];
  for (const [fields, state, dateBasis, day] of cases) {
    const entry = build([work({ status: undefined, ...fields }, "20_求職/下書き.md", "outbound-draft")]).entries[0];
    assert.equal(entry.kind, "draft");
    assert.equal(entry.state, state);
    assert.equal(entry.dateBasis, dateBasis);
    assert.equal(entry.date, day);
    assert.equal(entry.actor, undefined);
  }
  for (const fields of [{ sent: false, status: "送信済" }, { sent: true, status: "未送信" },
    { sent: false, sent_at: "2026-09-09" }, { status: "awaiting-approval", sent_at: "2026-10-04" },
    { status: "prepared", sent: true }, { status: "saved", sent: true, date: "2026-10-04" }]) {
    const result = build([work(fields, "20_求職/下書き.md", "outbound-draft")]);
    assert.equal(result.entries.length, 0);
    assert.equal(result.gaps.unsupportedRecords, 1);
  }
});

test("缺日期、非法/未来日期不借updated补位，非法发送日不能降级到草稿日期", () => {
  const result = build([
    work({ date: undefined, updated: TODAY }), job({ status_updated: "2026-02-30" }),
    job({ case_id: "future", status_updated: "2026-10-06" }, "20_求職/未来.md"),
    work({ date: "2026-2-3" }, "20_求職/不正.md"),
    work({ status: "送信済", sent_at: "2026-02-30" }, "20_求職/下書き.md", "outbound-draft"),
    work({ status: undefined, execution_status: "complete", date: undefined, updated: TODAY }, "20_求職/記録日なし.md"),
  ]);
  assert.deepEqual(result.entries, []);
  assert.equal(result.gaps.undated, 2);
  assert.equal(result.gaps.invalidDates, 3);
  assert.equal(result.gaps.futureDates, 1);
  assert.equal(buildRecentProgress([job()], "2026-02-30").entries.length, 0);
  assert.equal(build([job({ applied_on: "0000-01-01", application_actor: "ai", application_agent: "Example Assistant" })])
    .entries.some((entry) => entry.kind === "application"), false);
});

test("只读取允许范围的现有事实，结果稳定、不写任何笔记或创建义务", () => {
  const inputs = [job(), todo(), work(), note("10_关于我/内部.md", "policy", { date: TODAY, status: "completed" }),
    job({}, ".hidden/案件.md"), job({}, "90_归档/案件.md"), job({ private: true }, "20_求職/private.md"),
    work({ visibility: "internal" }, "20_求職/internal.md")];
  const before = structuredClone(inputs);
  for (const item of inputs) Object.freeze(item.frontmatter);
  Object.freeze(inputs);
  const result = build(inputs);
  assert.deepEqual(inputs, before);
  assert.deepEqual(result, build([...inputs].reverse()));
  assert.equal(result.entries.length, 3);
  assert.equal(result.entries.filter((entry) => entry.kind === "blocker").length, 1);
});
