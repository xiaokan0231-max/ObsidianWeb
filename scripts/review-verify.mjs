// 整理稿・批注の構造検査。AI（Claude/Codex どちらでも）が整理稿を書いた後の受け入れゲート。
// Web の実際のパーサ（lib/review.ts）で読めるか＝契約そのものを検査するので、
// ここを通れば Web 側で必ず表示できる。規則の正本は vault の _整理稿スペック。
//
// 使い方:
//   npm run review:verify -- <整理稿.md> [批注.md]
//   パスは絶対パスでも vault 相対（20_求職/...）でもよい。批注は省略時 _整理稿→_批注 で探す。

import { readFile, access } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
  computeStats,
  latestListeningMarks,
  parseAnnotations,
  parseSeirikou,
} from "../lib/review.ts";

const VAULT = process.env.OBSIDIAN_VAULT_PATH ?? "/Users/kanxiao/obsidian/xiaokan";

function resolvePath(input) {
  return isAbsolute(input) ? input : join(VAULT, input);
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const seirikouArg = process.argv[2];
if (!seirikouArg) {
  console.error("使い方: npm run review:verify -- <整理稿.md> [批注.md]");
  process.exit(2);
}

const seirikouPath = resolvePath(seirikouArg);
const annotationPath = process.argv[3]
  ? resolvePath(process.argv[3])
  : seirikouPath.replace(/_整理稿\.md$/, "_批注.md");

const errors = [];
const warnings = [];

const content = await readFile(seirikouPath, "utf8");
const parsed = parseSeirikou(content);

// --- 構造検査（違反＝Web で壊れる or スペックの凍結事項に反する） ---

if (parsed.blocks.length === 0) {
  errors.push("質問ブロック（## qNN）が1つも読めない");
}

const blockIds = new Set();
for (const block of parsed.blocks) {
  if (blockIds.has(block.id)) errors.push(`ブロックID重複: ${block.id}`);
  blockIds.add(block.id);
  if (!block.summary) warnings.push(`${block.id}: 概:: が無い`);
}

const sentenceIds = new Set();
for (const sentence of parsed.sentences) {
  if (sentenceIds.has(sentence.id)) errors.push(`文ID重複: ${sentence.id}`);
  sentenceIds.add(sentence.id);

  if (!sentence.sei) errors.push(`${sentence.id}: 正:: が無い`);
  if (!sentence.yaku) errors.push(`${sentence.id}: 訳:: が無い`);

  // «»マークと span 持ち誤りの数が合わないと、Web で下線とパネルの対応がずれる
  const markCount = (sentence.sei.match(/«[^»]+»/g) ?? []).length;
  const spanErrorCount = sentence.errors.filter((error) => error.span).length;
  if (markCount > spanErrorCount) {
    warnings.push(`${sentence.id}: «»マーク ${markCount} 個に対し span 持ち誤りが ${spanErrorCount} 件`);
  }

  for (const error of sentence.errors) {
    if (!/学習者|転写|疑/.test(error.raw)) {
      warnings.push(`${sentence.id} 誤${error.index}: 種別（学習者/転写/疑）が明示されていない → 疑として扱われる`);
    }
  }
}

// --- 批注（あれば） ---

let annotations = [];
if (await exists(annotationPath)) {
  annotations = parseAnnotations(await readFile(annotationPath, "utf8"));
  const annotationIds = new Set();
  for (const annotation of annotations) {
    if (annotationIds.has(annotation.id)) errors.push(`批注ID重複: ${annotation.id}`);
    annotationIds.add(annotation.id);
    if (!sentenceIds.has(annotation.sentenceId)) {
      errors.push(`批注 ${annotation.id} が存在しない文 ${annotation.sentenceId} を指している`);
    }
    if (!annotation.mine) warnings.push(`批注 ${annotation.id}: 我:: が空`);
  }
} else {
  warnings.push(`批注ファイルが無い: ${annotationPath}`);
}

// --- 集計表示 ---

const stats = computeStats(parsed.sentences);
const patterns = [...stats.patterns.entries()]
  .sort((a, b) => b[1].learner + b[1].uncertain - (a[1].learner + a[1].uncertain))
  .slice(0, 8)
  .map(([slug, bucket]) => `${slug}×${bucket.learner + bucket.uncertain}`)
  .join("・");
const open = annotations.filter((annotation) => annotation.status === "open").length;

console.log(`整理稿: ${seirikouPath}`);
console.log(
  `  ブロック ${parsed.blocks.length}・文 ${stats.sentenceTotal}（面 ${stats.bySpeaker["面"]}／私 ${stats.bySpeaker["私"]}）`,
);
console.log(
  `  学習者誤り ${stats.learnerErrors}・疑 ${stats.uncertainErrors}・話者疑 ${stats.uncertainSpeakers}・語注 ${stats.goCount}`,
);
if (patterns) console.log(`  型: ${patterns}`);
console.log(
  `  批注 ${annotations.length} 件（open ${open}）・聴解マーク ${latestListeningMarks(annotations).size} 文`,
);

for (const warning of warnings) console.log(`⚠️  ${warning}`);
for (const problem of errors) console.log(`❌ ${problem}`);

if (errors.length > 0) {
  console.log(`\n❌ 構造エラー ${errors.length} 件。修正してから再実行すること。`);
  process.exit(1);
}
console.log(`\n✅ 構造OK${warnings.length ? `（警告 ${warnings.length} 件）` : ""}`);
