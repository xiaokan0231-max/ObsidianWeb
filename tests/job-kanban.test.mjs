import assert from "node:assert/strict";
import test from "node:test";
import { kanbanAcceptsDrop, kanbanDropDecision } from "../lib/job-kanban.ts";

// 看板拖拽直接改真实案件：落到哪一列写什么，全部在这里钉住；浏览器里只验同列落下。
const card = (status, extra = {}) => ({ status, statusNote: "", channel: "", ...extra });

test("同列落下与自定义状态列都忽略，且不当作可落下的目标", () => {
  assert.deepEqual(kanbanDropDecision(card("未応募"), "未応募"), { kind: "ignore", reason: "same-column" });
  assert.deepEqual(kanbanDropDecision(card("未応募"), "検討中"), { kind: "ignore", reason: "custom-column" });
  assert.equal(kanbanAcceptsDrop(card("面接中", { channel: "Green" }), "面接中"), false);
  assert.equal(kanbanAcceptsDrop(card("未応募"), "検討中"), false);
  // 自定义状态的卡可以拖回枚举列（它的 status 不是枚举，所以不算同列）。
  assert.deepEqual(kanbanDropDecision(card("検討中"), "保留"), { kind: "write", status: "保留", statusNote: "" });
});

test("応募済以降需要 channel：没有就不写，交给详情选渠道；已有 channel 就直接写", () => {
  for (const status of ["応募済", "書類通過", "面接中", "内定", "不採用"]) {
    assert.deepEqual(kanbanDropDecision(card("未応募"), status), { kind: "need-channel", status }, status);
  }
  assert.deepEqual(
    kanbanDropDecision(card("応募済", { channel: "Green" }), "書類通過"),
    { kind: "write", status: "書類通過", statusNote: "" },
  );
  // 不需要 channel 的状态（未応募・保留）对没有 channel 的案件照常写。
  assert.deepEqual(kanbanDropDecision(card("未応募"), "保留"), { kind: "write", status: "保留", statusNote: "" });
  assert.equal(kanbanAcceptsDrop(card("未応募"), "応募済"), true, "缺 channel 仍是可落下的列（落下后打开详情）");
});

test("拖到不採用先确认；跨列带上原括号注记，不合法的注记丢掉而不是让写入被拒", () => {
  const job = card("面接中", { channel: "Green", statusNote: "2026-09-25・一次面接" });
  assert.deepEqual(kanbanDropDecision(job, "不採用"), { kind: "confirm", status: "不採用", statusNote: "2026-09-25・一次面接" });
  assert.deepEqual(kanbanDropDecision(job, "内定"), { kind: "write", status: "内定", statusNote: "2026-09-25・一次面接" });
  const broken = card("応募済", { channel: "Green", statusNote: "x".repeat(200) });
  assert.deepEqual(kanbanDropDecision(broken, "書類通過"), { kind: "write", status: "書類通過", statusNote: "" });
});
