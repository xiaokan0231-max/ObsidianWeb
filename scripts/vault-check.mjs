#!/usr/bin/env node
// vault の job-case frontmatter を検証する。壊れた値は Web 側で静かに無視されて
// 気づけないため、ここで落とす。`npm run vault:check`

import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import {
  CHANNEL_REQUIRED_FROM,
  JOB_STATUSES,
  KNOWN_CHANNELS,
  VAULT,
  baseStatus,
  listMarkdownFiles,
  parseFrontmatter,
  parseOwns,
  readJobCases,
} from "./vault-lib.mjs";
import { JOB_CASE_ORIGINS } from "../lib/vault-boundary.mjs";
import { listEmbeds, listHeadings, sliceSection, stripFrontmatter } from "../lib/interview-prep-embed.mjs";

const REQUIRED = ["case_id", "company", "status", "origin"];
const PREP_REQUIRED = ["company", "date", "round", "format", "interviewers", "case"];

const problems = [];
const notes = await readJobCases();
const caseIds = new Map();

for (const note of notes) {
  const fm = note.frontmatter;
  const at = (message) => problems.push(`${note.name}: ${message}`);

  for (const key of REQUIRED) {
    if (!fm[key]) at(`frontmatter に \`${key}\` が無い`);
  }

  if (fm.case_id) {
    const files = caseIds.get(fm.case_id) ?? [];
    files.push(note.name);
    caseIds.set(fm.case_id, files);
  }
  if (fm.origin && !JOB_CASE_ORIGINS.includes(String(fm.origin))) {
    at(`origin "${fm.origin}" は未知。既知は ${JOB_CASE_ORIGINS.join(" / ")}`);
  }

  const status = String(fm.status ?? "");
  const base = baseStatus(status);
  if (status && !base) {
    at(`status "${status}" は列挙に無い。使えるのは ${JOB_STATUSES.join(" / ")}（後ろに（補足）は可）`);
  }

  if (base && CHANNEL_REQUIRED_FROM.includes(base)) {
    if (!fm.channel) at(`status が「${base}」なら \`channel\` が要る（${KNOWN_CHANNELS.join(" / ")}）`);
    else if (!KNOWN_CHANNELS.includes(String(fm.channel)))
      at(`channel "${fm.channel}" は未知。既知は ${KNOWN_CHANNELS.join(" / ")}`);
  }

  // 「保留」は日付の定まらない状態なので必須にしない（無い日付を作らせないため）。
  if (base && CHANNEL_REQUIRED_FROM.includes(base) && !fm.status_updated) {
    at(`status が「${base}」なら \`status_updated\` が要る（YYYY-MM-DD）`);
  }
  if (fm.status_updated && !/^\d{4}-\d{2}-\d{2}$/.test(String(fm.status_updated))) {
    at(`status_updated "${fm.status_updated}" が YYYY-MM-DD ではない`);
  }

  const rating = Number(fm.rating);
  if (fm.rating !== undefined && (!Number.isFinite(rating) || rating < 0 || rating > 10)) {
    at(`rating "${fm.rating}" が 0〜10 の数値ではない`);
  }
}

for (const [caseId, files] of caseIds) {
  if (files.length > 1) problems.push(`case_id「${caseId}」が重複: ${files.join(" と ")}`);
}

// 規則IDの正本は1ファイルだけ（vault AGENTS.md「同じ規範を2箇所に書かない」）。
// 2つの正本が同じIDを持つと「どちらが現行か」が壊れたまま残り続けるので、ここで落とす。
const ownersById = new Map();
// 埋め込みの解決に使うため、ノート名 → 本文 を先に集める。
// basename が重複していると Obsidian 側も参照が曖昧になるので、その事実も持っておく。
const bodyByName = new Map();
const frontmatterByName = new Map();
const duplicateNames = new Set();
let prepCount = 0;
let prepEmbedCount = 0;
const files = await listMarkdownFiles();
const contents = new Map();
for (const path of files) {
  const content = await readFile(path, "utf8");
  contents.set(path, content);
  const name = path.split("/").pop().replace(/\.md$/i, "");
  if (bodyByName.has(name)) duplicateNames.add(name);
  else {
    bodyByName.set(name, stripFrontmatter(content));
    frontmatterByName.set(name, parseFrontmatter(content));
  }
}

for (const path of files) {
  const content = contents.get(path);
  const frontmatter = parseFrontmatter(content);
  const relativePath = relative(VAULT, path);
  if (frontmatter.type === "company" && frontmatter.status) {
    problems.push(`${relativePath}: company は応募 status を持てない。対応する job-case へ移す`);
  }
  if (frontmatter.type === "policy" && frontmatter.lifecycle !== "current") {
    problems.push(`${relativePath}: 現行 policy には lifecycle: current が要る`);
  }
  if (frontmatter.type === "policy-change" && frontmatter.owns) {
    problems.push(`${relativePath}: policy-change は規則IDを owns できない`);
  }

  // 面接準備ノートは共通資産を ![[…]] で参照する形にしているので、参照が切れると
  // Web と当日用 HTML から章がまるごと消える。しかも「空の章」は目視で気づきにくい。
  if (frontmatter.type === "interview-prep") {
    prepCount += 1;
    for (const key of PREP_REQUIRED) {
      if (!frontmatter[key]) problems.push(`${relativePath}: frontmatter に \`${key}\` が無い`);
    }
    if (frontmatter.date && !/^\d{4}-\d{2}-\d{2}$/.test(String(frontmatter.date))) {
      problems.push(`${relativePath}: date "${frontmatter.date}" が YYYY-MM-DD ではない`);
    }
    if (frontmatter.case) {
      const rawCase = String(frontmatter.case).trim().replace(/^["']|["']$/g, "");
      const innerCase = rawCase.match(/^\[\[([^\]]+)\]\]$/)?.[1] ?? rawCase;
      const caseTarget = innerCase.split("|")[0].split("#")[0].trim();
      const targetFrontmatter = frontmatterByName.get(caseTarget);
      if (!targetFrontmatter) {
        problems.push(`${relativePath}: case の参照先が無い [[${caseTarget}]]`);
      } else if (duplicateNames.has(caseTarget)) {
        problems.push(`${relativePath}: case の参照先「${caseTarget}」が同名複数あり曖昧`);
      } else if (targetFrontmatter.type !== "job-case") {
        problems.push(`${relativePath}: case [[${caseTarget}]] は type: job-case ではない`);
      }
    }
    for (const embed of listEmbeds(content)) {
      prepEmbedCount += 1;
      const target = bodyByName.get(embed.target);
      if (!target) {
        problems.push(`${relativePath}: 埋め込み先が無い ${embed.raw}`);
        continue;
      }
      if (duplicateNames.has(embed.target)) {
        problems.push(`${relativePath}: 埋め込み先「${embed.target}」が同名複数あり参照が曖昧 ${embed.raw}`);
      }
      if (embed.section && !sliceSection(target, embed.section)) {
        const available = listHeadings(target).slice(0, 8).join(" / ");
        problems.push(
          `${relativePath}: 埋め込み先に「${embed.section}」の節が無い ${embed.raw}` +
            (available ? `（その ノート の見出し: ${available}）` : ""),
        );
      }
    }
  }
  for (const id of parseOwns(frontmatter.owns)) {
    const files = ownersById.get(id) ?? [];
    files.push(relativePath);
    ownersById.set(id, files);
  }
}
for (const [id, files] of ownersById) {
  if (files.length > 1) {
    problems.push(`規則ID「${id}」を複数の正本が持っている: ${files.join(" と ")}`);
  }
}

console.log(
  `job-case ノート ${notes.length} 件・owns 規則ID ${ownersById.size} 件・` +
    `面接準備ノート ${prepCount} 件（埋め込み ${prepEmbedCount} 件）を検査`,
);

if (problems.length) {
  console.error(`\n❌ ${problems.length} 件の問題:\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error("");
  process.exit(1);
}

console.log("✅ 問題なし");
