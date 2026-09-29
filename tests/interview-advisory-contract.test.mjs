import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ADVISORY_OUTPUT_SCHEMA, INSIGHTS_OUTPUT_SCHEMA, INSIGHT_MODULE_KEYS } from "../lib/interview-advisory-contract.mjs";

test("independent advisory contracts cannot return scores or redefine source identity", () => {
  for (const schema of [ADVISORY_OUTPUT_SCHEMA, INSIGHTS_OUTPUT_SCHEMA]) {
    assert.equal(schema.additionalProperties, false);
    assert.equal(Object.hasOwn(schema.properties, "overallScore"), false);
    assert.equal(Object.hasOwn(schema.properties, "generatedAt"), false);
  }
  const ref = ADVISORY_OUTPUT_SCHEMA.properties.observations.items.properties.evidence.items;
  assert.deepEqual(ref.required, ["sourcePath", "blockId", "sentenceIds"]);
  assert.equal(ref.additionalProperties, false);
  assert.deepEqual(INSIGHTS_OUTPUT_SCHEMA.properties.modules.items.properties.key.enum, INSIGHT_MODULE_KEYS);
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
