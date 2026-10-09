import assert from "node:assert/strict";
import test from "node:test";
import {
  buildJobStatusUndo,
  JOB_STATUS_RESTORE_KEYS,
  JOB_STATUS_RESTORE_VALUE_MAX,
  validateJobStatusRestore,
} from "../lib/job-status-restore.ts";

// 看板「撤销」的写回表。撤销只许把状态写入动过的那几个键放回去，其余一律拒绝。
const rejects = (raw, pattern, label) => {
  assert.throws(() => validateJobStatusRestore(raw), (error) => {
    assert.equal(error.status, 400, `${label}：应当是 400（请求本身有问题，不必重试）`);
    assert.match(error.message, pattern, label);
    return true;
  });
};

test("允许的键原样通过，值会 trim；null 表示删掉这个键", () => {
  assert.deepEqual(
    validateJobStatusRestore({ status: " 未応募 ", status_updated: "2026-09-20", channel: null, applied_on: null }),
    { status: "未応募", status_updated: "2026-09-20", channel: null, applied_on: null },
  );
  assert.deepEqual(validateJobStatusRestore({ status: null }), { status: null }, "原本没有 status 时撤销＝删除");
  assert.deepEqual(
    validateJobStatusRestore({ waiting_for: "company", follow_up_at: "2026-10-01", follow_up_action: "催促する", next_event_at: "2026-10-02 10:00" }),
    { waiting_for: "company", follow_up_at: "2026-10-01", follow_up_action: "催促する", next_event_at: "2026-10-02 10:00" },
    "终结时清掉的等待字段可以放回",
  );
  assert.equal(JOB_STATUS_RESTORE_KEYS.length, 8);
});

test("带括号注记的状态也算合法；不在 7 个枚举里的状态拒绝", () => {
  assert.deepEqual(validateJobStatusRestore({ status: "不採用（2026-09-20・書類選考）" }), { status: "不採用（2026-09-20・書類選考）" });
  rejects({ status: "検討中" }, /不是 7 个应募状态之一/, "自造状态");
  rejects({ status: "" }, /不是 7 个应募状态之一/, "空状态");
});

test("白名单以外的键拒绝", () => {
  rejects({ rating: "9" }, /撤销不能改动字段「rating」/, "rating");
  rejects({ status: "未応募", type: "note" }, /撤销不能改动字段「type」/, "type 混在合法键里也拒绝");
});

test("超长・多行・非文本的值拒绝", () => {
  rejects({ follow_up_action: "あ".repeat(JOB_STATUS_RESTORE_VALUE_MAX + 1) }, /超过 300 字/, "超长");
  assert.doesNotThrow(() => validateJobStatusRestore({ follow_up_action: "あ".repeat(JOB_STATUS_RESTORE_VALUE_MAX) }), "恰好 300 字可以");
  rejects({ follow_up_action: "一行目\n二行目" }, /单行/, "多行");
  rejects({ status_updated: 20260920 }, /必须是文本或 null/, "数字");
  rejects({ waiting_for: ["company"] }, /必须是文本或 null/, "数组");
});

test("空表・非对象拒绝", () => {
  rejects({}, /至少要有一个字段/, "空对象");
  rejects(null, /必须是/, "null");
  rejects("status=未応募", /必须是/, "字符串");
  rejects([["status", "未応募"]], /必须是/, "数组");
});

test("撤销表：按这次动过的键取旧值，没有的键记 null，数字转文本", () => {
  const previous = { type: "job-case", status: "未応募", rating: 8, status_updated: 20260901, waiting_for: "company" };
  assert.deepEqual(
    buildJobStatusUndo(previous, ["status", "status_updated", "channel", "applied_on", "waiting_for"]),
    { status: "未応募", status_updated: "20260901", channel: null, applied_on: null, waiting_for: "company" },
  );
});

test("撤销表：旧值是数组・对象，或写不回去（非法状态・超长）时不给撤销", () => {
  assert.equal(buildJobStatusUndo({ status: "未応募", channel: ["Green", "Findy"] }, ["status", "channel"]), null, "数组");
  assert.equal(buildJobStatusUndo({ status: { base: "未応募" } }, ["status"]), null, "对象");
  assert.equal(buildJobStatusUndo({ status: "検討中" }, ["status"]), null, "原本就是非法状态");
  assert.equal(buildJobStatusUndo({ status: "未応募", follow_up_action: "あ".repeat(301) }, ["status", "follow_up_action"]), null, "超长");
});

test("channel・applied_on 只能撤销为删除：状态写入只会补写原本没有的这两个键，不能借撤销写入任意渠道", () => {
  assert.deepEqual(validateJobStatusRestore({ channel: null, applied_on: null }), { channel: null, applied_on: null });
  rejects({ channel: "適当な経路" }, /只能撤销为「删除」/, "写入渠道");
  rejects({ applied_on: "2026-09-01" }, /只能撤销为「删除」/, "写入应募日");
});

test("不加引号写回会破坏 YAML 的旧值拒绝：「: 」・# ・YAML 起始指示符", () => {
  for (const [value, label] of [
    ["返信: 日程調整", "冒号加空格"],
    ["末尾がコロン:", "行末冒号"],
    ["#2 company", "开头 #"],
    ["company #2", "空格加 #"],
    ["'quoted'", "开头单引号"],
    ['"quoted"', "开头双引号"],
    ["&anchor", "锚点"],
    ["*alias", "别名"],
    ["- item", "序列"],
    ["[a, b]", "流式序列"],
    ["{a: b}", "流式映射"],
    ["| block", "块标量"],
    ["@at", "保留字符"],
  ]) rejects({ follow_up_action: value }, /破坏 frontmatter/, label);
  assert.doesNotThrow(() => validateJobStatusRestore({ follow_up_action: "日程調整の返信を待つ・10/1 に催促", next_event_at: "2026-10-02 10:00" }), "普通的日文与日期时刻照常通过");
});

test("撤销表：写回会破坏 YAML 或换类型的旧值不给撤销；空串按「没有」删除", () => {
  assert.equal(buildJobStatusUndo({ status: "面接中", follow_up_action: "返信: 日程調整" }, ["status", "follow_up_action"]), null, "含「: 」");
  assert.equal(buildJobStatusUndo({ status: "面接中", waiting_for: "#2 company" }, ["status", "waiting_for"]), null, "开头 #");
  assert.equal(buildJobStatusUndo({ status: "面接中", follow_up_action: "true" }, ["status", "follow_up_action"]), null, "引号里的 true 写回会变布尔");
  assert.equal(buildJobStatusUndo({ status: "面接中", follow_up_action: "123" }, ["status", "follow_up_action"]), null, "引号里的数字写回会变数字");
  assert.equal(buildJobStatusUndo({ status: "面接中", follow_up_action: "null" }, ["status", "follow_up_action"]), null, "引号里的 null");
  assert.deepEqual(buildJobStatusUndo({ status: "面接中", channel: "", applied_on: "  " }, ["status", "channel", "applied_on"]), { status: "面接中", channel: null, applied_on: null });
  assert.deepEqual(buildJobStatusUndo({ status: "面接中", follow_up_at: 3 }, ["status", "follow_up_at"]), { status: "面接中", follow_up_at: "3" }, "原本就是数字：写回仍是数字");
});

test("撤销表：YAML 会读成数字的各种写法（下划线・二/八/十六进制・指数・.inf/.nan）都不给撤销；普通日期与编号照常", () => {
  for (const value of ["0b101", "1_000", "0o17", "0x1F", "1e3", "-2.5", ".5", ".inf", "-.inf", ".nan", "+12"]) {
    assert.equal(buildJobStatusUndo({ status: "面接中", follow_up_action: value }, ["status", "follow_up_action"]), null, value);
  }
  for (const value of ["2026-10-01", "2026-10-01 10:00", "No.3", "3社目", "v2"]) {
    assert.ok(buildJobStatusUndo({ status: "面接中", follow_up_action: value }, ["status", "follow_up_action"]), value);
  }
});
