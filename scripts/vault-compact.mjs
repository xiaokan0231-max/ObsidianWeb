#!/usr/bin/env node
// 生成物の旧版を 90_归档 へ移す。既定は完全な dry-run、--apply の時だけ書く。

import { execFileSync } from "node:child_process";
import { access, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { applyCompactFrontmatter, planVaultCompaction } from "../lib/vault-compact.mjs";
import { buildKnowledgeGraph } from "../lib/knowledge-graph.ts";
import { VAULT, listMarkdownFiles, parseFrontmatter } from "./vault-lib.mjs";

const apply = process.argv.includes("--apply");
const json = process.argv.includes("--json");

const notes = await Promise.all((await listMarkdownFiles()).map(async (path) => {
  const content = await readFile(path, "utf8");
  const fileStat = await stat(path);
  return {
    absolutePath: path,
    relativePath: relative(VAULT, path),
    content,
    frontmatter: parseFrontmatter(content),
    size: fileStat.size,
  };
}));

const plan = planVaultCompaction(notes);
const noteByPath = new Map(notes.map((note) => [note.relativePath, note]));
const candidatePaths = new Set(plan.candidates.map((candidate) => candidate.path));
const affectedPaths = [...new Set([...plan.updates.keys(), ...candidatePaths])];
const archivedBytes = plan.candidates.reduce(
  (sum, candidate) => sum + (noteByPath.get(candidate.path)?.size ?? 0),
  0,
);

// 「まだ誰かが指しているか」は正文の [[…]] だけでは答えにならない。source_note /
// related / evidence_inputs / reviews のような frontmatter の関係フィールドからも
// 引かれる。手でフィールドを並べると必ず取り零すので、判定は vault:check と同じ
// buildKnowledgeGraph に訊く。候補同士のリンクはまとめて出ていくので許す。
const incomingLinks = candidatePaths.size === 0 ? [] : [...new Set(
  buildKnowledgeGraph(notes.map((note) => ({
    path: note.relativePath,
    stat: { ctime: 0, mtime: 0, size: note.size },
    tags: [],
    frontmatter: note.frontmatter,
    content: note.content,
  }))).edges
    .filter((edge) => candidatePaths.has(edge.target) && !candidatePaths.has(edge.source))
    .map((edge) => {
      const field = edge.sourceField ? `(${edge.sourceField})` : "";
      return `${edge.source} --${edge.relation}${field}→ ${edge.target}`;
    }),
)];

const output = {
  mode: apply ? "apply" : "dry-run",
  keep: plan.keep,
  candidates: plan.candidates,
  metadataUpdates: [...plan.updates.entries()].map(([path, fields]) => ({ path, fields })),
  archivedBytes,
  incomingLinks,
  activeFingerprints: plan.activeFingerprints,
};

if (json) {
  console.log(JSON.stringify(output, null, 2));
} else {
  console.log(`Vault compact ${apply ? "APPLY" : "dry-run"}`);
  console.log(`保留 ${plan.keep.length} 件・归档候选 ${plan.candidates.length} 件・元数据更新 ${plan.updates.size} 件`);
  console.log(`预计移出运行区 ${(archivedBytes / 1024 / 1024).toFixed(1)} MB`);
  for (const candidate of plan.candidates) console.log(`  ARCHIVE ${candidate.path} — ${candidate.reason}`);
  for (const kept of plan.keep) console.log(`  KEEP    ${kept.path} — ${kept.reason}`);
  for (const link of incomingLinks) console.log(`  ⚠️ LINKED ${link}`);
  if (!apply) console.log("\n未写入任何文件。确认后运行: npm run vault:compact -- --apply");
}

if (!apply) process.exit(0);

if (incomingLinks.length) {
  console.error("❌ 运行区仍有笔记链接到归档候选，移走会让 vault:check 报未解析引用:");
  for (const link of incomingLinks) console.error(`  ${link}`);
  process.exit(1);
}

if (affectedPaths.length) {
  let dirty = "";
  try {
    dirty = execFileSync(
      "git",
      ["-C", VAULT, "status", "--porcelain=v1", "--untracked-files=all", "--", ...affectedPaths],
      { encoding: "utf8" },
    ).trim();
  } catch (error) {
    console.error(`❌ 候选文件的 git 状态无法确认，拒绝写入: ${error.message}`);
    process.exit(1);
  }
  if (dirty) {
    console.error("❌ 以下候选或元数据文件有未提交修改，拒绝 compact:");
    console.error(dirty);
    process.exit(1);
  }
}

for (const candidate of plan.candidates) {
  const target = join(VAULT, "90_归档", candidate.path);
  try {
    await access(target);
    console.error(`❌ 归档目标已存在，拒绝覆盖: ${target}`);
    process.exit(1);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

for (const [relativePath, fields] of plan.updates) {
  const note = noteByPath.get(relativePath);
  if (!note) throw new Error(`compact 计划引用了不存在的文件: ${relativePath}`);
  const next = applyCompactFrontmatter(note.content, fields);
  if (next !== note.content) await writeFile(note.absolutePath, next, "utf8");
}

for (const candidate of plan.candidates) {
  const note = noteByPath.get(candidate.path);
  if (!note) throw new Error(`compact 候选不存在: ${candidate.path}`);
  const target = join(VAULT, "90_归档", candidate.path);
  await mkdir(dirname(target), { recursive: true });
  await rename(note.absolutePath, target);
}

if (!json) {
  console.log(`\n✅ 已归档 ${plan.candidates.length} 件，元数据已更新。没有删除文件。`);
}
