import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { IN_FLIGHT_STATUSES, IN_PROGRESS_STATUSES, SELECTION_STATUSES, TERMINAL_STATUSES, JOB_STATUSES, statusTone } from "../lib/jobs.ts";
import { IN_PROGRESS_STATUSES as SCHEMA_IN_PROGRESS } from "../lib/job-case-schema.ts";
import { statusTone as pickerTone } from "../lib/context-picker.ts";
import { careerStatus } from "../lib/memory-atlas-data.ts";
import { TODO_STATUSES } from "../lib/todo-status.mjs";

// 同一事实只许有一份口径：状态集合、状态配色、TODO 状态都从 lib 的契约模块读。
// 这个测试钉住的是「不再各写一份」——以前 5 份「进行中」集合里内定时含时不含，首页与切換面板的件数对不上。

async function sources(dir) {
  const names = (await readdir(dir)).filter((name) => /\.(ts|tsx|mjs)$/.test(name));
  return Promise.all(names.map(async (name) => [`${dir}/${name}`, await readFile(`${dir}/${name}`, "utf8")]));
}

test("状态子集互相一致：进行中 = 结果待ち + 内定；終结与进行中不相交；都只含七态", () => {
  assert.deepEqual([...IN_FLIGHT_STATUSES, "内定"], [...IN_PROGRESS_STATUSES]);
  assert.deepEqual(SELECTION_STATUSES, ["書類通過", "面接中", "内定"]);
  for (const status of [...IN_PROGRESS_STATUSES, ...SELECTION_STATUSES, ...TERMINAL_STATUSES]) assert.ok(JOB_STATUSES.includes(status), status);
  assert.deepEqual(TERMINAL_STATUSES.filter((status) => IN_PROGRESS_STATUSES.includes(status)), []);
  assert.strictEqual(SCHEMA_IN_PROGRESS, IN_PROGRESS_STATUSES, "schema 侧引用同一个数组对象");
  assert.deepEqual(TODO_STATUSES, ["未着手", "進行中", "保留", "完了"]);
});

test("七态各自只有一种颜色，三处入口读同一张表", () => {
  const expected = { "未応募": "pending", "応募済": "progress", "書類通過": "progress", "面接中": "interview", "内定": "offer", "保留": "neutral", "不採用": "reject" };
  for (const status of JOB_STATUSES) {
    assert.equal(statusTone(status), expected[status], status);
    assert.equal(pickerTone(status), expected[status], `切換面板 ${status}`);
    assert.equal(careerStatus(`${status}（2026-09-01・備考）`).tone, expected[status], `首页 ${status}`);
  }
  assert.equal(statusTone("選考辞退"), "neutral");
});

test("app 与 lib 里不再有第二份状态数组或状态配色", async () => {
  const files = [...(await sources("app")), ...(await sources("lib"))].filter(([path]) => !/lib\/job-status\.(mjs|ts)$|lib\/todo-status\.mjs$|lib\/jobs\.ts$/.test(path));
  // 三个及以上进行中状态连写才算「又抄了一份集合」；两个状态的筛选口径（如分析页「结果等待」）是页面自己的定义。
  const statusArray = /\[\s*"(応募済|書類通過|面接中|内定)"\s*,\s*"(応募済|書類通過|面接中|内定)"\s*,\s*"(応募済|書類通過|面接中|内定)"/;
  const toneFunction = /function (statusTone|eventTone|careerTone)\s*\(/;
  for (const [path, source] of files) {
    assert.doesNotMatch(source, statusArray, `${path} 自带了一份状态集合`);
    assert.doesNotMatch(source, toneFunction, `${path} 自带了一份状态配色`);
    assert.doesNotMatch(source, /TODO_STATUS(ES)? = \[/, `${path} 自带了一份 TODO 状态表`);
  }
  const check = await readFile("scripts/vault-check.mjs", "utf8");
  assert.match(check, /from "\.\.\/lib\/todo-status\.mjs"/, "vault-check 读同一份 TODO 契约");
  assert.doesNotMatch(check, /TODO_STATUSES = \[/);
});
