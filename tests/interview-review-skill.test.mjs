import assert from "node:assert/strict";
import { mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { REVIEW_LIMITS } from "../lib/review-contract.mjs";

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

// 扣分明細つきの雛形。count 条の minor（各 2 点）を一つの維度に積む。
function ledgerFixture(count) {
  const deduction = {
    blockId: "q01",
    severity: "minor",
    points: 2,
    labelZh: "证据只有一句。",
    detailZh: "只举了一句就下结论，面试官无法确认。",
    fixZh: "补一个可核对的数字。",
    evidenceSentenceIds: ["s001"],
  };
  const clean = { score: 100, rationaleZh: "依据 q01，未发现可举证的扣分点。", evidenceBlockIds: ["q01"], deductions: [] };
  const loaded = {
    score: Math.max(0, 100 - 2 * count),
    rationaleZh: "依据 q01，证据强度不足。",
    evidenceBlockIds: ["q01"],
    deductions: Array.from({ length: count }, () => ({ ...deduction })),
  };
  const review = fixture();
  review.dimensions = {
    questionUnderstanding: { ...clean },
    coverage: { ...clean },
    directness: { ...clean },
    evidenceCredibility: loaded,
    riskControl: { ...clean },
  };
  review.overallScore = Math.round((100 * 4 + loaded.score) / 5);
  return review;
}

// 上限超えは正本側で黙って切られ、切られた後の JSON は score = 100 − Σ(残り) で
// 自洽してしまう——落ちた後からは検出できない種類の失点。だから校验器で赤くする。
// 上限ちょうどまでは通ることも一緒に釘付けする（境界を片側だけ見ても意味がない）。
test("review skill validator rejects a dimension with more deductions than the contract allows", async () => {
  const limit = REVIEW_LIMITS.deductionsPerDimension;
  const directory = await mkdtemp(join(tmpdir(), "review-skill-limit-"));
  try {
    const sourcePath = join(directory, "整理稿.md");
    const atLimitPath = join(directory, "at-limit.json");
    const overLimitPath = join(directory, "over-limit.json");
    await Promise.all([
      writeFile(sourcePath, "## q01 AI・MCP・DDD\n- **s001｜面**\n- **s002｜私**\n", "utf8"),
      writeFile(atLimitPath, JSON.stringify(ledgerFixture(limit)), "utf8"),
      writeFile(overLimitPath, JSON.stringify(ledgerFixture(limit + 1)), "utf8"),
    ]);
    const script = `${SKILL}/scripts/validate-review.mjs`;

    const atLimit = spawnSync(process.execPath, [script, "--review", atLimitPath, "--source", sourcePath], {
      encoding: "utf8",
    });
    assert.equal(atLimit.status, 0, atLimit.stderr || atLimit.stdout);

    const overLimit = spawnSync(process.execPath, [script, "--review", overLimitPath, "--source", sourcePath], {
      encoding: "utf8",
    });
    assert.equal(overLimit.status, 1);
    assert.deepEqual(JSON.parse(overLimit.stdout).errors, [
      `dimensions.evidenceCredibility.deductions has ${limit + 1} entries, `
        + `more than the ${limit} allowed (merge duplicates instead of listing them)`,
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

// bridge 模式下模型读不到 references/*.md，上限只能从 prompt 里知道。
// prompt から上限が消えると、モデルは黙って超過し、正本が黙って切る。
test("bridge prompt states the per-dimension deduction cap", async () => {
  const bridge = await readFile("scripts/codex-bridge.mjs", "utf8");
  assert.match(bridge, /每维 deductions 最多\$\{REVIEW_LIMITS\.deductionsPerDimension\}条/);
  assert.match(bridge, /这是上限不是目标/);
});

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
