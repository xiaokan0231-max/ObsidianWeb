import assert from "node:assert/strict";
import test from "node:test";
import { ACTION_KINDS, ACTION_OWNERS, ACTION_RESOLUTIONS, todoActionMetadataIssues, validActionDate } from "../lib/todo-action-schema.ts";

function required(fields = {}) {
  return { type: "todo", status: "未着手", action_kind: "required", action_owner: "user", action_reviewed_at: "2026-10-05",
    action: "確認した日程を回答する", action_reason: "本人の都合を確認する必要がある", action_source: "https://example.com/messages/1", ...fields };
}

test("旧TODO可保留但缺审核不能被schema自动补成required", () => {
  const legacy = { type: "todo", status: "未着手", action: "必要なら原文を読む" };
  const before = structuredClone(legacy);
  assert.deepEqual(todoActionMetadataIssues(legacy), []);
  assert.deepEqual(legacy, before);
  assert.equal(legacy.action_kind, undefined);
});

test("required具备明确归属、动作、理由、源和审核日期才合法", () => {
  assert.deepEqual(todoActionMetadataIssues(required()), []);
  assert.deepEqual(todoActionMetadataIssues(required({ action_source: "20_求職/_素材/確認記録.md" })), []);
  for (const field of ["action", "action_reason", "action_source", "action_reviewed_at", "action_owner"]) {
    for (const value of [undefined, "", "  "]) {
      assert.ok(todoActionMetadataIssues(required({ [field]: value })).some((issue) => issue.includes(field)), `${field}=${value}`);
    }
  }
  for (const owner of ACTION_OWNERS) assert.deepEqual(todoActionMetadataIssues(required({ action_owner: owner })), []);
  assert.deepEqual(todoActionMetadataIssues(required({ action_owner: "ai", audience: "system" })), []);
  assert.equal(required({ action_owner: "ai", audience: "system" }).status, "未着手", "明确AI归属不代表正在执行");
});

test("所有明确枚举合法，已声明空值、拼错和错误类型均报错", () => {
  for (const action_owner of ACTION_OWNERS) assert.deepEqual(todoActionMetadataIssues({ action_owner }), []);
  for (const action_kind of ACTION_KINDS.filter((value) => value !== "required")) assert.deepEqual(todoActionMetadataIssues({ action_kind }), []);
  for (const action_resolution of ACTION_RESOLUTIONS) assert.deepEqual(todoActionMetadataIssues({ action_resolution }), []);
  for (const action_next_owner of ACTION_OWNERS) assert.deepEqual(todoActionMetadataIssues({ action_next_owner }), []);
  for (const field of ["action_owner", "action_kind", "action_resolution", "action_next_owner"]) {
    for (const value of ["wrong", "", null, 123, {}, []]) {
      assert.ok(todoActionMetadataIssues({ [field]: value }).length > 0, `${field}=${JSON.stringify(value)}`);
    }
  }
});

test("日期只接受真实YYYY-MM-DD，拒绝溢出、时间和零年", () => {
  for (const value of ["2026-10-05", "2028-02-29", "2026-12-31"]) assert.equal(validActionDate(value), true);
  for (const value of ["2026-02-29", "2026-02-30", "2026-13-01", "2026-10-32", "2026-1-1", "2026-10-05T00:00:00Z", "0000-01-01", ""]) {
    assert.equal(validActionDate(value), false, value);
  }
  for (const field of ["action_reviewed_at", "action_resolved_at", "suggested_due"]) {
    assert.deepEqual(todoActionMetadataIssues({ [field]: "2026-10-05" }), []);
    for (const value of ["bad", "2026-02-30", null, [], 123]) assert.ok(todoActionMetadataIssues({ [field]: value }).some((issue) => issue.includes(field)));
  }
});

test("说明与来源的数字/容器不能靠getString转换通过", () => {
  for (const field of ["action", "action_reason", "action_source", "due_text", "action_resolution_note"]) {
    for (const value of [123, [], {}, true]) {
      assert.ok(todoActionMetadataIssues(required({ [field]: value })).some((issue) => issue.includes(field)), `${field}=${JSON.stringify(value)}`);
    }
  }
});

test("相对官方说明和建议日期独立保存，取消历史不伪造完成", () => {
  const entry = required({ due_text: "案内から5営業日以内", suggested_due: "2026-10-07", action_next_owner: "company" });
  assert.deepEqual(todoActionMetadataIssues(entry), []);
  assert.equal(entry.due, undefined);
  const cancelled = { ...entry, status: "保留", action_kind: "history", action_resolution: "cancelled", action_resolved_at: "2026-10-05", action_resolution_note: "依頼が取り消された" };
  assert.deepEqual(todoActionMetadataIssues(cancelled), []);
  assert.equal(cancelled.status, "保留");
});
