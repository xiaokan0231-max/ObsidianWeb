import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadIntakeModule() {
  const source = await readFile(new URL("../lib/job-intake.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

test("pads a hand-written date so lexicographic order stays chronological", async () => {
  const { normalizeDay } = await loadIntakeModule();
  assert.equal(normalizeDay("2026-7-5"), "2026-07-05");
  assert.equal(normalizeDay("2026/07/05"), "2026-07-05");
  assert.equal(normalizeDay("2026-07-20（本人応募）"), "2026-07-20");
  assert.ok(normalizeDay("2026-7-5") < normalizeDay("2026-12-01"));
});

test("treats a missing date as unknown instead of crashing", async () => {
  const { normalizeDay, jobIntake, intakeLabel, daysBetween } = await loadIntakeModule();
  assert.equal(normalizeDay(""), null);
  assert.equal(jobIntake("", "2026-07-22"), "unknown");
  assert.equal(intakeLabel("", "2026-07-22"), "不明");
  assert.equal(daysBetween("", "2026-07-22"), null);
});

test("buckets are exclusive so the chip counts add up to the total", async () => {
  const { jobIntake } = await loadIntakeModule();
  const today = "2026-07-22";
  assert.equal(jobIntake("2026-07-22", today), "today");
  assert.equal(jobIntake("2026-07-21", today), "d3");
  assert.equal(jobIntake("2026-07-19", today), "d3");
  assert.equal(jobIntake("2026-07-18", today), "d7");
  assert.equal(jobIntake("2026-07-15", today), "d7");
  assert.equal(jobIntake("2026-07-14", today), "older");
  // 先に起票した未来日付は「最新」側。専用の档は作らない。
  assert.equal(jobIntake("2026-07-23", today), "today");
});

test("counts days in local time, not UTC", async () => {
  const { daysBetween, jobIntake } = await loadIntakeModule();
  // JST は UTC+9。`new Date("2026-07-22")` を挟むと日本の日中はまるごと前日に落ち、
  // 「今日入库」が一日中点かないというのが、この関数が文字列で日を持っている理由。
  assert.equal(daysBetween("2026-07-22", "2026-07-22"), 0);
  assert.equal(daysBetween("2026-07-21", "2026-07-22"), 1);
  // 月またぎ・年またぎ・DST（1日が23/25時間になる地域）でも丸め込みで1日ちょうどになる。
  assert.equal(daysBetween("2026-06-30", "2026-07-01"), 1);
  assert.equal(daysBetween("2025-12-31", "2026-01-01"), 1);
  assert.equal(daysBetween("2026-03-07", "2026-03-09"), 2);
  assert.equal(jobIntake("2026-06-18", "2026-07-22"), "older");
});

test("labels keep the note's own date and only derive the relative half", async () => {
  const { intakeLabel, intakeRelative } = await loadIntakeModule();
  assert.equal(intakeLabel("2026-07-22", "2026-07-22"), "7/22 · NEW");
  assert.equal(intakeLabel("2026-07-19", "2026-07-22"), "7/19 · 3日前");
  assert.equal(intakeRelative("2026-07-22", "2026-07-22"), "NEW");
  assert.equal(intakeRelative("", "2026-07-22"), "");
});

test("every bucket the filter can show has a label and a hint", async () => {
  const { JOB_INTAKES } = await loadIntakeModule();
  assert.deepEqual(
    JOB_INTAKES.map((bucket) => bucket.id),
    ["today", "d3", "d7", "older", "unknown"],
  );
  assert.ok(JOB_INTAKES.every((bucket) => bucket.label && bucket.hint));
});
