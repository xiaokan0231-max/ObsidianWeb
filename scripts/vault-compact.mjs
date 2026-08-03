#!/usr/bin/env node
// 生成物の旧版を 90_归档 へ移す。既定は完全な dry-run、--apply の時だけ書く。

import { execFileSync } from "node:child_process";
import { access, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { applyCompactFrontmatter, planVaultCompaction, wikiTargets } from "../lib/vault-compact.mjs";
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

// 90_归档 は listMarkdownFiles の対象外。運用区から張られたリンクは移した瞬間に切れ、
// vault:check の未解決参照が赤くなる＝Stop hook が毎回止まる。候補同士のリンクは
// まとめて出ていくので許し、それ以外から引かれていたら apply を拒む。
const candidateNames = new Map(
  plan.candidates.map((candidate) => [basename(candidate.path).replace(/\.md$/iu, ""), candidate.path]),
);
const incomingLinks = candidateNames.size === 0 ? [] : notes.flatMap((note) => {
  if (candidatePaths.has(note.relativePath)) return [];
  return wikiTargets(note.content).flatMap((target) => {
    const archived = candidateNames.get(basename(target).replace(/\.md$/iu, ""));
    return archived ? [`${note.relativePath} → ${archived}`] : [];
  });
});

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
