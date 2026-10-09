import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  annotationCountLabel,
  changedToLabel,
  INTERVIEW_LIST_BACK_LABEL,
  OPEN_NOTE_LABEL, practiceStatusLabel, PRACTICE_STATUS_LABEL } from "../lib/ui-labels.ts";

// 同一个操作在不同画面叫不同名字，利用者就得每次确认「是不是另一个功能」。
// 旧说法一旦有人照着老代码复制回来，这里会先红。
const RETIRED_LITERALS = [
  "打开 Obsidian 原笔记",
  "在记忆库中打开",
  "查看完整案件笔记",
  "← 面接一覧",
  "面接进行中",
  "${open} open",
];

test("app/*.tsx 里不再出现已统一掉的旧文言", () => {
  const appDir = new URL("../app/", import.meta.url);
  const hits = [];
  for (const name of readdirSync(appDir).filter((file) => file.endsWith(".tsx"))) {
    const source = readFileSync(new URL(name, appDir), "utf8");
    for (const literal of RETIRED_LITERALS) {
      if (source.includes(literal)) hits.push(`${name}: ${literal}`);
    }
  }
  assert.deepEqual(hits, []);
});

test("共通文言的正本", () => {
  assert.equal(OPEN_NOTE_LABEL, "打开原笔记");
  assert.equal(INTERVIEW_LIST_BACK_LABEL, "← 面试一览");
  assert.equal(changedToLabel("書類通過"), "已改为「書類通過」");
});

test("批注件数：有未结的出未结数，全部结清只出总数", () => {
  assert.equal(annotationCountLabel(2, 5), "2 条未结");
  assert.equal(annotationCountLabel(0, 5), "5");
  assert.equal(annotationCountLabel(0, 0), "0");
});

test("回答重练的状态显示中文；键与数据里的英文枚举一一对应，认不出的值原样显示", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../lib/review-practice.ts", import.meta.url), "utf8");
  const union = source.match(/export type InterviewPracticeStatus = ([^;]+);/)?.[1] ?? "";
  const statuses = [...union.matchAll(/"([a-z]+)"/g)].map((match) => match[1]);
  assert.ok(statuses.length >= 4, "从类型定义里读到状态枚举");
  assert.deepEqual(Object.keys(PRACTICE_STATUS_LABEL).sort(), [...statuses].sort(), "每个状态都有中文，没有多余的键");
  assert.equal(practiceStatusLabel("queued"), "待练");
  assert.equal(practiceStatusLabel("unknown"), "unknown");
  const view = await readFile(new URL("../app/interview-practice.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(view, /· \{item\.status\}/, "列表不再直接露出英文状态");
});
