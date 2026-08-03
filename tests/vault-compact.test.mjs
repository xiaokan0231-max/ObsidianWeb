import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  applyCompactFrontmatter,
  planVaultCompaction,
} from "../lib/vault-compact.mjs";

function note(relativePath, type, body, frontmatter = {}) {
  return {
    relativePath,
    content: `---\ntype: ${type}\n---\n# fixture\n\n${body}`,
    frontmatter: { type, ...frontmatter },
    size: body.length,
  };
}

function marker(start, end, value) {
  return `${start}\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\`\n${end}`;
}

const curriculumMarker = (value) => marker(
  "<!-- language-curriculum-json:start -->",
  "<!-- language-curriculum-json:end -->",
  value,
);
const bankMarker = (value) => marker(
  "<!-- language-bank-json:start -->",
  "<!-- language-bank-json:end -->",
  value,
);
const batchMarker = (value) => marker(
  "<!-- language-batch-json:start -->",
  "<!-- language-batch-json:end -->",
  value,
);

test("compact keeps latest and active fingerprints while archiving unreferenced versions", () => {
  const notes = [
    note("80_AI分析/日本語訓練/old-active.md", "language-curriculum", curriculumMarker({
      generatedAt: "2026-01-01T00:00:00Z",
      sourceFingerprint: "source-a",
      contentFingerprint: "content-active",
      items: [],
    })),
    note("80_AI分析/日本語訓練/old-unused.md", "language-curriculum", curriculumMarker({
      generatedAt: "2026-01-02T00:00:00Z",
      sourceFingerprint: "source-b",
      contentFingerprint: "content-unused",
      items: [],
    })),
    note("80_AI分析/日本語訓練/latest.md", "language-curriculum", curriculumMarker({
      generatedAt: "2026-01-03T00:00:00Z",
      sourceFingerprint: "source-c",
      contentFingerprint: "content-latest",
      items: [],
    })),
    note("30_日本語学習/集中訓練ログ/draft.md", "language-batch-log", batchMarker({
      phase: "compile",
      curriculumFingerprint: "content-active",
    }), { status: "draft" }),
    note("80_AI分析/日本語訓練/bank-old.md", "language-bank", bankMarker({
      generatedAt: "2026-01-01T00:00:00Z",
      sourceFingerprint: "bank-source",
      units: [],
      questionBank: [],
    })),
    note("80_AI分析/日本語訓練/bank-latest.md", "language-bank", bankMarker({
      generatedAt: "2026-01-02T00:00:00Z",
      sourceFingerprint: "bank-source",
      units: [{ id: "u1", canonicalKey: "one", category: "grammar", targetJa: "x" }],
      questionBank: [],
    })),
  ];

  const plan = planVaultCompaction(notes, { now: new Date("2026-08-01T00:00:00Z") });
  assert.deepEqual(
    plan.candidates.map((candidate) => candidate.path).sort(),
    [
      "80_AI分析/日本語訓練/bank-old.md",
      "80_AI分析/日本語訓練/old-unused.md",
    ],
  );
  assert.ok(plan.keep.some((entry) => entry.path.endsWith("old-active.md")));
  assert.equal(plan.updates.get("80_AI分析/日本語訓練/latest.md").lifecycle, "current");
  assert.equal(plan.updates.get("80_AI分析/日本語訓練/old-active.md").lifecycle, "historical");
});

test("historical reports honor age, authority backlinks and keep flag", () => {
  const notes = [
    note("10_关于我/事实.md", "self", "[[被引用报告]]"),
    note("80_AI分析/被引用报告.md", "ai-report", "", { date: "2025-01-01" }),
    note("80_AI分析/旧报告.md", "ai-report", "", { date: "2025-01-01" }),
    note("80_AI分析/保留报告.md", "ai-report", "", { date: "2025-01-01", keep: "true" }),
    note("80_AI分析/新报告.md", "ai-report", "", { date: "2026-07-20" }),
  ];
  const plan = planVaultCompaction(notes, { now: new Date("2026-08-01T00:00:00Z") });
  assert.deepEqual(plan.candidates.map((entry) => entry.path), ["80_AI分析/旧报告.md"]);
  const reportUpdate = plan.updates.get("80_AI分析/旧报告.md");
  assert.equal(reportUpdate.lifecycle, "historical");
  assert.equal(reportUpdate.schema_version, 2);
  assert.match(reportUpdate.source_fingerprint, /^aireportsrc_/u);
  assert.match(reportUpdate.content_fingerprint, /^aireportcontent_/u);
  assert.ok(plan.keep.some((entry) => entry.path.endsWith("被引用报告.md")));
  assert.ok(plan.keep.some((entry) => entry.path.endsWith("保留报告.md")));
  assert.ok(plan.keep.some((entry) => entry.path.endsWith("新报告.md")));
});

test("frontmatter update preserves body and is idempotent", () => {
  const before = "---\ntype: language-bank\nlifecycle: current\n---\n# 正文\n";
  const once = applyCompactFrontmatter(before, {
    lifecycle: "superseded",
    schema_version: 2,
    content_fingerprint: "fp",
  });
  const twice = applyCompactFrontmatter(once, {
    lifecycle: "superseded",
    schema_version: 2,
    content_fingerprint: "fp",
  });
  assert.equal(once, twice);
  assert.match(once, /lifecycle: superseded/u);
  assert.match(once, /# 正文/u);
});

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: "utf8", ...options });
}

function bankFile(generatedAt, unitId) {
  const value = {
    generatedAt,
    sourceFingerprint: "bank-source",
    units: [{
      id: unitId,
      canonicalKey: unitId,
      category: "grammar",
      targetJa: unitId,
      priority: 1,
    }],
    questionBank: [],
  };
  return `---\ntype: language-bank\n---\n# ${unitId}\n\n${bankMarker(value)}\n`;
}

async function fixtureVault() {
  const root = await mkdtemp(join(tmpdir(), "vault-compact-"));
  const generated = join(root, "80_AI分析/日本語訓練");
  await mkdir(generated, { recursive: true });
  await writeFile(join(generated, "old.md"), bankFile("2026-01-01T00:00:00Z", "old"));
  await writeFile(join(generated, "latest.md"), bankFile("2026-01-02T00:00:00Z", "latest"));
  await writeFile(join(root, "unrelated.md"), "---\ntype: material\n---\n# unrelated\n");
  assert.equal(run("git", ["init", "-q", root]).status, 0);
  assert.equal(run("git", ["-C", root, "config", "user.email", "compact@example.invalid"]).status, 0);
  assert.equal(run("git", ["-C", root, "config", "user.name", "Compact Test"]).status, 0);
  assert.equal(run("git", ["-C", root, "add", "."]).status, 0);
  assert.equal(run("git", ["-C", root, "commit", "-qm", "fixture"]).status, 0);
  return root;
}

function runCompact(root, ...args) {
  return run(process.execPath, ["scripts/vault-compact.mjs", ...args], {
    cwd: process.cwd(),
    env: { ...process.env, OBSIDIAN_VAULT_PATH: root },
  });
}

test("compact dry-run is zero-write and apply ignores unrelated dirty files", async (t) => {
  const root = await fixtureVault();
  t.after(() => rm(root, { recursive: true, force: true }));
  const old = join(root, "80_AI分析/日本語訓練/old.md");
  const before = await readFile(old, "utf8");
  const dryRun = runCompact(root, "--json");
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.equal(await readFile(old, "utf8"), before);
  await assert.rejects(access(join(root, "90_归档/80_AI分析/日本語訓練/old.md")));

  await appendFile(join(root, "unrelated.md"), "dirty but unrelated\n");
  const applied = runCompact(root, "--apply", "--json");
  assert.equal(applied.status, 0, applied.stderr);
  await assert.rejects(access(old));
  assert.match(
    await readFile(join(root, "90_归档/80_AI分析/日本語訓練/old.md"), "utf8"),
    /lifecycle: superseded/u,
  );
  assert.match(await readFile(join(root, "unrelated.md"), "utf8"), /dirty but unrelated/u);
});

test("compact apply refuses a dirty candidate", async (t) => {
  const root = await fixtureVault();
  t.after(() => rm(root, { recursive: true, force: true }));
  const old = join(root, "80_AI分析/日本語訓練/old.md");
  await appendFile(old, "dirty candidate\n");
  const applied = runCompact(root, "--apply");
  assert.notEqual(applied.status, 0);
  assert.match(applied.stderr, /拒绝 compact/u);
  await access(old);
  await assert.rejects(access(join(root, "90_归档/80_AI分析/日本語訓練/old.md")));
});

test("compact apply refuses while an operational note still links to a candidate", async (t) => {
  const root = await fixtureVault();
  t.after(() => rm(root, { recursive: true, force: true }));
  // 90_归档 は走査対象外なので、移した瞬間このリンクは vault:check の未解決参照になる。
  await appendFile(join(root, "unrelated.md"), "まだ [[old]] を引いている。\n");
  const applied = runCompact(root, "--apply");
  assert.notEqual(applied.status, 0);
  assert.match(applied.stderr, /未解析引用/u);
  await access(join(root, "80_AI分析/日本語訓練/old.md"));
  await assert.rejects(access(join(root, "90_归档/80_AI分析/日本語訓練/old.md")));
});

test("compact apply refuses an existing archive target before writing metadata", async (t) => {
  const root = await fixtureVault();
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, "90_归档/80_AI分析/日本語訓練/old.md");
  await mkdir(join(root, "90_归档/80_AI分析/日本語訓練"), { recursive: true });
  await writeFile(target, "do not overwrite\n");
  const latest = join(root, "80_AI分析/日本語訓練/latest.md");
  const before = await readFile(latest, "utf8");
  const applied = runCompact(root, "--apply");
  assert.notEqual(applied.status, 0);
  assert.match(applied.stderr, /归档目标已存在/u);
  assert.equal(await readFile(target, "utf8"), "do not overwrite\n");
  assert.equal(await readFile(latest, "utf8"), before);
});
