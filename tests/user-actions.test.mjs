import assert from "node:assert/strict";
import test from "node:test";
import { actionableTodoForCase, buildUserActions, reviewTodoForCase, userActionForCase } from "../lib/user-actions.ts";

const TODAY = "2026-10-05";
function note(path, type, fields = {}) {
  return { path, frontmatter: { type, ...fields }, content: "", tags: [], stat: { ctime: 0, mtime: 0, size: 0 } };
}
function job(fields = {}, path = "20_求職/テスト/案件.md") {
  return note(path, "job-case", { case_id: "test-case", company: "株式会社テスト", status: "面接中", ...fields });
}
function todo(fields = {}, path = "20_求職/_TODO/回答.md") {
  return note(path, "todo", {
    status: "未着手", action_owner: "user", action_kind: "required", action_reviewed_at: TODAY,
    action: "確認した候補日時を回答する", action_reason: "本人の空き時間の確認が必要", action_source: "https://example.com/messages/1",
    action_next_owner: "company", ...fields,
  });
}
function category(entry, cases = []) {
  const groups = buildUserActions([...cases, entry], TODAY);
  return Object.entries(groups).find(([, values]) => values.length)?.[0];
}

test("审核后的required本人动作才进入current，audience保留旧缺省规则", () => {
  for (const audience of [undefined, "user"]) {
    const entry = todo({ audience });
    assert.equal(category(entry), "current");
    assert.equal(category(todo({ audience, status: "進行中" })), "current");
  }
  assert.equal(category(todo({ action_next_owner: undefined })), "current");
  const [item] = buildUserActions([todo({ action_next_owner: undefined })], TODAY).current;
  assert.equal(item.nextOwner, null);
  assert.deepEqual(item.warnings, ["missing-action-next-owner"]);
});

test("旧未审核TODO、空动作、缺理由或来源均待核，不能靠优先级/置顶晋升", () => {
  for (const key of ["action_owner", "action_kind", "action_reviewed_at", "action", "action_reason", "action_source"]) {
    assert.equal(category(todo({ [key]: undefined, priority: "high", focus: true, focus_until: TODAY })), "review", key);
  }
  const legacy = note("旧待办.md", "todo", { status: "未着手", action: "面接日程を回答する", due: TODAY });
  assert.equal(category(legacy), "review");
  assert.equal(category(todo({ action_source: "20_求職/_素材/確認記録.md" })), "current");
});

test("六类互斥，外部等待、系统维护和任意阅读不冒充本人必做", () => {
  const entries = [todo(), todo({ action_owner: "company", action_kind: "waiting" }, "等待.md"),
    todo({ action_owner: "ai" }, "AI.md"), todo({ action_kind: "optional" }, "任意.md"),
    todo({ status: "完了" }, "完成.md"), todo({ action_kind: "review" }, "待核.md")];
  const groups = buildUserActions(entries, TODAY);
  for (const items of Object.values(groups)) assert.equal(items.length, 1);
  assert.equal(new Set(Object.values(groups).flat().map((item) => item.note.path)).size, 6);
  for (const owner of ["agent", "platform"]) assert.equal(category(todo({ action_owner: owner })), "waiting");
  for (const fields of [{ action_kind: "reference" }, { action_kind: "optional" }]) assert.equal(category(todo(fields)), "optional");
  for (const fields of [{ action_owner: "system" }, { audience: "system" }]) assert.equal(category(todo(fields)), "system");
});

test("审核缺失即待核，明确非本人义务不会进入日历待核动作", () => {
  const owner = job();
  for (const fields of [{ action_owner: "ai" }, { action_owner: "company" }, { audience: "system" }, { action_kind: "optional" }, { action_kind: "reference" }]) {
    const entry = todo({ case_id: "test-case", ...fields, action_reviewed_at: undefined });
    assert.equal(category(entry, [owner]), "review");
    assert.equal(reviewTodoForCase(entry, owner, TODAY), false);
    assert.equal(actionableTodoForCase(entry, owner, TODAY), false);
  }
});

test("due是明确期限；相对说法与建议日期独立展示、不推出官方期限", () => {
  const entry = todo({ due_text: "案内から5営業日以内", suggested_due: "2026-10-08", next_action: "10/6までに回答する" });
  const [item] = buildUserActions([entry], TODAY).current;
  assert.equal(item.due, "");
  assert.equal(item.dueText, "案内から5営業日以内");
  assert.equal(item.suggestedDue, "2026-10-08");
  assert.equal(category(todo({ due: "2026-10-01" })), "current", "逾期更需要处理，不是失效");
});

test("严格校验枚举、审核日、日历有效性和字段类型，错误不得成为current", () => {
  for (const fields of [
    { action_owner: "self" }, { action_kind: "required!" }, { status: "不採用" }, { audience: "company" },
    { action_reviewed_at: "2026-10-06" }, { action_reviewed_at: "2026-02-30" }, { due: "2026-2-3" },
    { due: "2026-10-05 10:00" }, { due: "2026-02-29" }, { suggested_due: "2026-13-01" },
    { expires_at: "明日" }, { focus: "true" }, { focus: true }, { action_next_owner: "someone" },
    { action: ["回答する"] }, { action_reason: 123 }, { action_source: {} }, { due_text: ["5日"] },
    { case_id: ["test-case"] }, { due: "2026-10-07", expires_at: "2026-10-06" },
  ]) assert.equal(category(todo(fields)), "review", JSON.stringify(fields));
  assert.equal(buildUserActions([todo()], "2026-02-30").current.length, 0);
  assert.equal(category(todo({ due: "2028-02-29" })), "current");
});

test("完成、取消历史、失效不自动重开；focus只覆盖失效日期", () => {
  const focused = { focus: true, focus_until: TODAY };
  assert.equal(category(todo({ expires_at: "2026-10-04" })), "history");
  assert.equal(category(todo({ expires_at: TODAY })), "current");
  assert.equal(category(todo({ expires_at: "2026-10-04", ...focused })), "current");
  assert.equal(category(todo({ expires_at: "2026-10-04", focus: false, focus_until: TODAY })), "history");
  assert.equal(category(todo({ expires_at: "2026-10-04", focus: true, focus_until: "2026-10-04" })), "history");
  assert.equal(category(todo({ status: "完了", action_owner: undefined, ...focused })), "history");
  const cancelled = todo({ status: "保留", action_kind: "history", action_resolution: "cancelled", ...focused });
  assert.equal(category(cancelled), "history");
  assert.equal(cancelled.frontmatter.status, "保留", "取消不能伪造成已完成");
  assert.equal(category(todo({ action_owner: undefined, expires_at: "2026-10-04", ...focused })), "review");
});

test("case_id必须指向唯一job-case；不以公司名、正文或case链接猜测", () => {
  const first = job();
  const entry = todo({ case_id: "test-case" });
  assert.equal(category(entry, [first]), "current");
  assert.equal(category(entry), "review");
  assert.equal(category(entry, [first, job({}, "重复.md")]), "review");
  assert.equal(category(entry, [note("公司.md", "company", { case_id: "test-case" })]), "review");
  assert.equal(category(todo({ case_id: "other-case", company: "株式会社テスト" }), [first]), "review");
  assert.equal(category(todo({ case_id: "test-case" }), [job({ status: "unknown" })]), "review");
});

test("拒绝/保留案件盖过旧required和focus；保留TODO也不催本人执行", () => {
  const entry = todo({ case_id: "test-case", focus: true, focus_until: TODAY });
  assert.equal(category(entry, [job({ status: "不採用（書類選考）" })]), "history");
  assert.equal(category(entry, [job({ status: "保留（本人判断）" })]), "waiting");
  assert.equal(category(todo({ status: "保留" })), "waiting");
  assert.equal(category(todo({ status: "保留", action_kind: "reference" })), "optional");
  assert.equal(category(todo({ status: "保留", action_reviewed_at: undefined })), "review");
  for (const status of ["不採用", "保留"]) {
    assert.equal(actionableTodoForCase(entry, job({ status }), TODAY), false);
    assert.equal(reviewTodoForCase(entry, job({ status }), TODAY), false);
    assert.equal(reviewTodoForCase(todo({ case_id: "test-case", action_reviewed_at: undefined }), job({ status }), TODAY), false);
  }
});

test("日历共享谓词与分类一致：精确关联、审核和非失效缺一不可", () => {
  const owner = job();
  const entry = todo({ case_id: "test-case" });
  assert.equal(actionableTodoForCase(entry, owner, TODAY), true);
  assert.equal(userActionForCase(entry, owner, TODAY).category, "current");
  assert.equal(actionableTodoForCase(todo(), owner, TODAY), false);
  assert.equal(actionableTodoForCase(entry, job({ case_id: "other" }), TODAY), false);
  assert.equal(userActionForCase(owner, owner, TODAY), null);
  assert.equal(userActionForCase(entry, note("公司.md", "company", { case_id: "test-case" }), TODAY), null);
  const unreviewed = todo({ case_id: "test-case", action_reviewed_at: undefined });
  assert.equal(actionableTodoForCase(unreviewed, owner, TODAY), false);
  assert.equal(reviewTodoForCase(unreviewed, owner, TODAY), true);
  assert.equal(reviewTodoForCase(todo({ case_id: "test-case", expires_at: "2026-10-04", action_reviewed_at: undefined }), owner, TODAY), false);
  assert.equal(reviewTodoForCase(todo({ case_id: "test-case", status: "完了" }), owner, TODAY), false);
});

test("纯投影不改笔记或状态，不从job-case next_action生成动作", () => {
  const owner = job({ waiting_for: "self", next_action: "本人が書類を提出する", due: TODAY });
  const entry = todo({ action_source: "[[20_求職/_素材/確認記録]]" });
  const notes = [owner, entry];
  const before = structuredClone(notes);
  Object.freeze(entry.frontmatter); Object.freeze(owner.frontmatter); Object.freeze(notes);
  const groups = buildUserActions(notes, TODAY);
  assert.equal(groups.current.length, 1);
  assert.deepEqual(notes, before);
  assert.deepEqual(buildUserActions([owner], TODAY), { current: [], waiting: [], system: [], optional: [], history: [], review: [] });
});
