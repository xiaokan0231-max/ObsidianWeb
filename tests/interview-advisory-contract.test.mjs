import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ADVISORY_OUTPUT_SCHEMA, INSIGHTS_OUTPUT_SCHEMA, INSIGHT_MODULE_KEYS, interviewAdvisoryOutputSchema } from "../lib/interview-advisory-contract.mjs";

test("independent advisory contracts cannot return scores or redefine source identity", () => {
  for (const schema of [ADVISORY_OUTPUT_SCHEMA, INSIGHTS_OUTPUT_SCHEMA]) {
    assert.equal(schema.additionalProperties, false);
    assert.equal(Object.hasOwn(schema.properties, "overallScore"), false);
    assert.equal(Object.hasOwn(schema.properties, "generatedAt"), false);
  }
  const ref = ADVISORY_OUTPUT_SCHEMA.properties.observations.items.properties.evidence.items;
  assert.deepEqual(ref.required, ["sourcePath", "blockId", "sentenceIds"]);
  assert.equal(ref.additionalProperties, false);
  assert.equal(ADVISORY_OUTPUT_SCHEMA.properties.evidence.minItems, 1);
  assert.equal(ADVISORY_OUTPUT_SCHEMA.properties.nextSteps.items.properties.evidence.minItems, 1);
  assert.equal(ref.properties.sentenceIds.minItems, 1);
  assert.deepEqual(INSIGHTS_OUTPUT_SCHEMA.properties.modules.items.properties.key.enum, INSIGHT_MODULE_KEYS);
});

test("每个顾问来源引用从已读取整理稿路径精确选择，不能拼接或借背景路径", () => {
  const path = "20_求職/株式会社テスト/2026-01-01_一次面接_整理稿.md";
  const schema = interviewAdvisoryOutputSchema({evidenceSources:[{sourcePath:path,blocks:[{blockId:"q01",sentenceIds:["s001"]}]}],contextPaths:[]});
  for (const ref of [schema.properties.evidence.items, ...["observations", "answerOptions", "nextSteps"].map(key => schema.properties[key].items.properties.evidence.items)]) {
    assert.equal(ref.$ref, "#/$defs/evidenceReference");
    assert.deepEqual(schema.$defs.evidenceReference.anyOf[0].properties.sourcePath.enum, [path]);
    assert.deepEqual(schema.$defs.evidenceReference.anyOf[0].properties.blockId.enum, ["q01"]);
  }
  assert.equal(ADVISORY_OUTPUT_SCHEMA.properties.evidence.items.properties.sourcePath.enum, undefined);
  assert.throws(() => interviewAdvisoryOutputSchema({}), /来源清单/);
  assert.throws(() => interviewAdvisoryOutputSchema({evidenceSources:[{sourcePath:"一次面接_整理稿.md",blocks:[]}]}), /来源清单/);
});

test("consultant tasks use shared contracts with raw evidence, stage boundaries and versioned feedback", async () => {
  const bridge = await readFile("scripts/codex-bridge.mjs", "utf8");
  assert.match(bridge, /review_interview_advisory: ADVISORY_OUTPUT_SCHEMA/);
  assert.match(bridge, /review_interview_insights: INSIGHTS_OUTPUT_SCHEMA/);
  assert.match(bridge, /只能使用 INPUT_JSON/);
  assert.match(bridge, /target\.snapshot和target\.revision/);
  assert.match(bridge, /每条finding必须引用至少两份不同sourcePath/);
  assert.match(bridge, /不能把没问到当改善/);
  assert.match(bridge, /只有日期不推断同日先后/);
});
