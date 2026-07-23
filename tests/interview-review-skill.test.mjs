import assert from "node:assert/strict";
import { mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const SKILL = ".agents/skills/review-interview-answers";

function fixture(overallScore = 80) {
  const dimension = {
    score: 80,
    rationaleZh: "依据 q01，回答整体稳定。",
    evidenceBlockIds: ["q01"],
  };
  return {
    generatedAt: "2026-07-22T00:00:00.000Z",
    model: "fixture",
    overallScore,
    dimensions: {
      questionUnderstanding: dimension,
      coverage: dimension,
      directness: dimension,
      evidenceCredibility: dimension,
      riskControl: dimension,
    },
    summaryZh: "整体稳定。",
    strengths: ["q01 直接回答。"],
    weaknesses: [],
    priorityBlockIds: ["q01"],
    blocks: [{
      blockId: "q01",
      questionTitle: "复合问题",
      interviewerIntentZh: "确认三个方向。",
      askedPoints: ["AI", "MCP", "DDD"],
      answeredPoints: ["DDD"],
      missedPoints: ["AI", "MCP"],
      comprehension: "likely_missed",
      relevance: "partial",
      quality: "weak",
      strategyTags: ["compound-question-miss"],
      evidenceSentenceIds: ["s001", "s002"],
      evaluationZh: "现场只回答 DDD。",
      improvementZh: "逐项作答。",
      improvedAnswerJa: "三つに分けてお答えします。",
    }],
  };
}

test("Codex and Claude Code discover one shared review skill", async () => {
  const [skill, bridge, link] = await Promise.all([
    readFile(`${SKILL}/SKILL.md`, "utf8"),
    readFile("scripts/codex-bridge.mjs", "utf8"),
    readlink(".claude/skills/review-interview-answers"),
  ]);
  assert.match(skill, /^name: review-interview-answers$/m);
  assert.doesNotMatch(skill, /TODO/);
  assert.equal(link, "../../.agents/skills/review-interview-answers");
  assert.match(bridge, /Use \$review-interview-answers in Bridge mode/);
});

test("review skill validator checks evidence ownership and the five-dimension total", async () => {
  const directory = await mkdtemp(join(tmpdir(), "review-skill-"));
  try {
    const sourcePath = join(directory, "整理稿.md");
    const validPath = join(directory, "valid.json");
    const invalidPath = join(directory, "invalid.json");
    await Promise.all([
      writeFile(sourcePath, "## q01 AI・MCP・DDD\n- **s001｜面**\n- **s002｜私**\n", "utf8"),
      writeFile(validPath, JSON.stringify(fixture()), "utf8"),
      writeFile(invalidPath, JSON.stringify(fixture(68)), "utf8"),
    ]);
    const script = `${SKILL}/scripts/validate-review.mjs`;
    const valid = spawnSync(process.execPath, [script, "--review", validPath, "--source", sourcePath], {
      encoding: "utf8",
    });
    assert.equal(valid.status, 0, valid.stderr || valid.stdout);
    assert.equal(JSON.parse(valid.stdout).computedOverallScore, 80);

    const invalid = spawnSync(process.execPath, [script, "--review", invalidPath, "--source", sourcePath], {
      encoding: "utf8",
    });
    assert.equal(invalid.status, 1);
    assert.match(invalid.stdout, /does not equal five-dimension average 80/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
