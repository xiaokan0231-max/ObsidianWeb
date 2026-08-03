#!/usr/bin/env node
// 台帳と数据字典の generated 区块を上流データから計算し直して差し替える。
// 数字・表・列挙を手で書かないための本体。`npm run vault:stats [--check]`
//
// 上流は3つ:
//   1) job_search_rejections.csv（175社・2026-07-20 で凍結した過去分）
//   2) 20_求職 配下の type: job-case frontmatter（凍結後の応募はここが唯一の記録先）
//   3) vault-lib.mjs の列挙定数（status / channel の正）
// CSV に既にある会社は 2) 側を無視する（二重計上を避ける）。

import { readFile, stat, writeFile } from "node:fs/promises";
import {
  APPLIED_LEDGER,
  CHANNEL_REQUIRED_FROM,
  DICTIONARY,
  JOB_CASE_ROOT,
  JOB_STATUSES,
  KNOWN_CHANNELS,
  LEDGER,
  PREP_LIBRARY,
  QUEUE,
  REJECTIONS_CSV,
  TRENDS,
  VAULT,
  baseStatus,
  listMarkdownFiles,
  parseCsv,
  parseFrontmatter,
  readJobCases,
  replaceGenerated,
} from "./vault-lib.mjs";
import { isGeneratedNote, JOB_CASE_ORIGINS } from "../lib/vault-boundary.mjs";
import { buildKnowledgeGraph, graphHealth } from "../lib/knowledge-graph.ts";
import { parseQueue, queueStats } from "../lib/job-queue.mjs";
import { parseInterviewAnswerReview } from "../lib/review-deep.ts";
import {
  buildCardCoverage,
  buildInterviewTrends,
  interviewKeyFromNoteName,
  renderInterviewTrends,
} from "../lib/interview-trends.mjs";
import {
  buildStatsPayload,
  buildTimeline,
  parseAppliedKnownFrom,
  parseAppliedLedger,
  renderStatsBlock,
} from "../lib/job-stats.mjs";

const checkOnly = process.argv.includes("--check");

/** CSV の channel 表記ゆれを frontmatter 側の表記に寄せる。 */
const CHANNEL_ALIAS = { "企业直投/ATS": "企業直投/ATS" };
const normalizeChannel = (value) => CHANNEL_ALIAS[value] ?? (value || "その他");
const isDocStage = (stage) => stage.includes("书类") || stage.includes("書類");

// 上流が欠けたまま派生を書き換えない——欠測は 0 件ではなく「計算不能」。
// CSV は凍結済み 175社＝台帳の数字のほぼ全部を占める。読めないまま続行すると
// 「CSV 0 件」で集計し、181社を 10社で、2025年の月別推移ごと上書きしてしまう。
// 2026-07-25 実際に踏んだ：iCloud のフルディスクアクセスが外れて読めなくなり、
// 旧実装は warning だけ出して続行 → --check が「台帳がずれている、vault:stats を実行せよ」と
// 破壊的な指示を出した（Stop hook 経由で AI に届く）。中止が正しい。
let csvRows;
try {
  csvRows = parseCsv(await readFile(REJECTIONS_CSV, "utf8"));
} catch (error) {
  console.error(`❌ CSV を読めなかったので中止した: ${REJECTIONS_CSV}`);
  console.error(`   理由: ${error.code ?? error.message}`);
  console.error("   台帳の数字の大半はこの CSV 由来。読めないまま集計すると過去分が消える。");
  console.error("   macOS: システム設定 → プライバシーとセキュリティ → フルディスクアクセス を確認する");
  console.error("   （iCloud Drive 配下はアクセス権が外れると stat だけ通り read が EPERM になる）");
  // 3 = 上流にアクセスできない（環境の問題）。データ不整合の 1 と区別する。
  // Stop hook はこれをブロック理由にしない——別マシンや権限切れで毎ターン止まると、
  // 防線そのものが無視されるようになる（hook 側の設計方針と揃えている）。
  process.exit(3);
}

// 読めても 0 行なら、空ファイル・iCloud のプレースホルダ・破損のいずれか。
// 「本当に 0 社」はあり得ない（凍結済みの過去分が入っている）ので同じく中止する。
if (csvRows.length === 0) {
  console.error(`❌ CSV は読めたが 0 行だったので中止した: ${REJECTIONS_CSV}`);
  console.error("   凍結済みの過去分が入っているはずのファイル。空＝取得失敗か破損を疑うこと。");
  process.exit(3);
}

const records = csvRows.map((row) => ({
  company: row.company,
  channel: normalizeChannel(row.channel),
  reachedInterview: !isDocStage(row.stage),
  month: (row.last_rejection_date ?? "").slice(0, 7),
  // 応募↔不採用の突き合わせは日単位で行うので、月だけでなく通知日そのものを持たせる。
  // ここを月初で代用すると「応募より前に不採用」になり、同月の応募が結び付かなくなる。
  notifiedOn: row.last_rejection_date ?? "",
  reason: row.reason_category || "未分類",
  source: "csv",
}));

/** 株式会社の位置・空白・全半角の表記ゆれだけを吸収し、同じ会社の二重計上を防ぐ。 */
const companyKey = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/株式会社|有限会社|合同会社|\(株\)|[\s　・･_]/g, "");

const seen = new Set(records.map((r) => companyKey(r.company)));

for (const note of await readJobCases()) {
  const fm = note.frontmatter;
  if (baseStatus(fm.status) !== "不採用") continue;
  const company = String(fm.company ?? "").trim();
  const key = companyKey(company);
  if (!company || seen.has(key)) continue;
  seen.add(key);
  records.push({
    company,
    channel: normalizeChannel(String(fm.channel ?? "")),
    // 面接まで行ったかは status の補足文から拾う。書類段階で終わったものが既定。
    reachedInterview: /面接|最終|一次|二次/.test(String(fm.status)),
    month: String(fm.status_updated ?? "").slice(0, 7),
    reason: String(fm.reason_category ?? "") || "未披露/模板拒绝",
    source: "note",
    notifiedOn: String(fm.status_updated ?? ""),
    position: String(fm.position ?? ""),
  });
}

const total = records.length;
const reached = records.filter((r) => r.reachedInterview).length;

const byChannel = new Map();
for (const record of records) {
  const entry = byChannel.get(record.channel) ?? { total: 0, reached: 0 };
  entry.total += 1;
  if (record.reachedInterview) entry.reached += 1;
  byChannel.set(record.channel, entry);
}

const byMonth = new Map();
for (const record of records) {
  if (!record.month) continue;
  byMonth.set(record.month, (byMonth.get(record.month) ?? 0) + 1);
}

const pct = (part, whole) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : "—");
// セルに | が混ざると Markdown の列がずれるので全角に逃がす
const cell = (value) => String(value || "—").replaceAll("|", "｜");

const summary = [
  "| 項目 | 値 |",
  "|---|---|",
  `| **不採用企業数** | **${total}社** |`,
  `| 書類選考で終了 | ${total - reached}社（${pct(total - reached, total)}） |`,
  `| 面接まで到達 | ${reached}社（${pct(reached, total)}） |`,
].join("\n");

const channelTable = [
  "| 経路 | 不採用 | 書類終了 | 面接到達 | 到達率 |",
  "|---|---|---|---|---|",
  ...[...byChannel.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(
      ([name, s]) =>
        `| ${name} | ${s.total} | ${s.total - s.reached} | ${s.reached} | ${pct(s.reached, s.total)} |`,
    ),
].join("\n");

const monthList = [...byMonth.entries()]
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([month, count]) => `- ${month}: ${count}社`)
  .join("\n");

const byReason = new Map();
for (const record of records) {
  byReason.set(record.reason, (byReason.get(record.reason) ?? 0) + 1);
}
const reasonList = [...byReason.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([reason, count]) => `- ${reason}: ${count}社`)
  .join("\n");

// 応募日台帳（Gmail の受理メールから起こした事実）を月別に畳む。
// 走査していない期間は「0件」ではなく「不明」——buildTimeline が null で表現する。
let appliedRows = [];
let appliedKnownFrom = null;
try {
  const appliedNote = await readFile(APPLIED_LEDGER, "utf8");
  appliedRows = parseAppliedLedger(appliedNote);
  appliedKnownFrom = parseAppliedKnownFrom(appliedNote);
} catch {
  // 台帳がまだ無くてもよい（その場合タイムラインは全月「不明」になる）。
}
const appliedByMonth = new Map();
for (const row of appliedRows) {
  const month = row.appliedOn.slice(0, 7);
  appliedByMonth.set(month, (appliedByMonth.get(month) ?? 0) + 1);
}

// 応募 ↔ 不採用 を会社名で突き合わせて「いつ結果が出たか」を付ける。
// 見つからなければ resolvedOn = null（まだ待っている）。
// ⚠️ エージェント経由（ワークポート＝ミドルの転職、GEEKLY＝日経転職版 等）は
// メール上の社名が紹介会社なので、実際の応募先とは永久に一致しない。
// それらは「待機中」として残るが、実態は不明——台帳の「既知の穴」に明記してある。
const rejectionByCompany = new Map();
for (const record of records) {
  const key = companyKey(record.company);
  const date = record.notifiedOn || `${record.month}-01`;
  // 同じ会社で複数回あるなら最も早い通知日を採る
  if (!rejectionByCompany.has(key) || date < rejectionByCompany.get(key)) {
    rejectionByCompany.set(key, date);
  }
}
const appliedPairs = appliedRows.map((row) => {
  const resolved = rejectionByCompany.get(companyKey(row.matchName));
  // 応募より前の不採用は別件（同じ会社の過去の応募）なので結び付けない
  return { appliedOn: row.appliedOn, resolvedOn: resolved && resolved >= row.appliedOn ? resolved : null };
});

// 同じ集計を機械可読でも出す。Web は台帳の markdown 表ではなくこちらを読む
// （表のパースは脆いため）。形の正本は lib/job-stats.mjs。
const statsJson = renderStatsBlock(
  buildStatsPayload({
    total,
    reached,
    byChannel,
    byMonth,
    byReason,
    timeline: buildTimeline(byMonth, appliedByMonth, appliedKnownFrom, appliedPairs),
  }),
);

// CSV に無い不採用（job-case 由来）だけの明細。凍結後の新規分だけでなく、
// 移行時に判明した CSV 欠落もここへ入る。かつては手書き表で、
// status と二重管理になっていた（改一处不等于改完 の第2落点）。いまはここで生成する。
const additions = records
  .filter((r) => r.source === "note")
  .sort(
    (a, b) =>
      a.notifiedOn.localeCompare(b.notifiedOn) || a.company.localeCompare(b.company, "ja"),
  );
const additionsTable = additions.length
  ? [
      "| 通知日 | 会社 | ポジション | 経路 | 結果・理由 |",
      "|---|---|---|---|---|",
      ...additions.map(
        (r) =>
          `| ${cell(r.notifiedOn)} | ${cell(r.company)} | ${cell(r.position)} | ${cell(r.channel)} | ${cell(`${r.reachedInterview ? "面接後不採用" : "書類不採用"}・${r.reason}`)} |`,
      ),
    ].join("\n")
  : "（CSV 凍結後の不採用ノートはまだ無い）";

// 推薦・応募前の照合リスト。CSV とノートの和集合。
const companyList = [
  `全${total}社（CSV ${csvRows.length} + ノート ${additions.length}）：`,
  "",
  ...records
    .map((r) => r.company)
    .sort((a, b) => a.localeCompare(b, "ja"))
    .map((name) => `- ${name}`),
].join("\n");

// 列挙の正はコード側（vault-lib.mjs）。数据字典にはここから転記する。
const tick = (value) => `\`${value}\``;
const enumTable = [
  "| 項目 | 値 |",
  "|---|---|",
  `| \`status\` の列挙（後ろに（補足）可） | ${JOB_STATUSES.map(tick).join("・")} |`,
  `| \`origin\` の列挙 | ${JOB_CASE_ORIGINS.map(tick).join("・")} |`,
  `| \`channel\` の列挙 | ${KNOWN_CHANNELS.map(tick).join("・")} |`,
  `| \`channel\`・\`status_updated\` が必須になる status | ${CHANNEL_REQUIRED_FROM.map(tick).join("・")} |`,
].join("\n");

// vault 全体の type 分布。90_归档・99_系统/模板 の除外は listMarkdownFiles 側の責務。
const typeCounts = new Map();
const operationalFiles = await listMarkdownFiles();
const graphNotes = [];
let generatedBytes = 0;
for (const path of operationalFiles) {
  const content = await readFile(path, "utf8");
  const frontmatter = parseFrontmatter(content);
  const type = frontmatter.type;
  if (typeof type === "string" && type) typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
  if (isGeneratedNote({ frontmatter })) generatedBytes += (await stat(path)).size;
  graphNotes.push({
    path: path.slice(VAULT.length + 1),
    stat: { ctime: 0, mtime: 0, size: content.length },
    tags: [],
    frontmatter,
    content,
  });
}
const censusTable = [
  "| type | 件数 |",
  "|---|---|",
  ...[...typeCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([type, count]) => `| \`${type}\` | ${count} |`),
].join("\n");
const health = graphHealth(buildKnowledgeGraph(graphNotes));
const graphHealthTable = [
  "| 項目 | 値 |",
  "|---|---|",
  `| 语义节点 | ${health.semanticNodes} |`,
  `| 强类型关系 | ${health.semanticEdges} |`,
  `| 普通双链关系 | ${health.referenceEdges} |`,
  `| 无法解析的关系 | ${health.unresolved} |`,
  `| 默认语义图孤点 | ${health.defaultIsolates} |`,
  `| operational 生成物体积 | ${(generatedBytes / 1024 / 1024).toFixed(1)} MB |`,
].join("\n");

// 探索キューの残数。「見つけただけ」と「精読して起票済み」を混ぜないための進捗表示。
// 精読済みかどうかはキューに書かず、job-case / excluded-job ノートの有無から導出する。
const reviewedNotes = [];
for (const path of await listMarkdownFiles(JOB_CASE_ROOT)) {
  const fm = parseFrontmatter(await readFile(path, "utf8"));
  if (fm.type !== "job-case" && fm.type !== "excluded-job") continue;
  reviewedNotes.push({
    company: String(fm.company ?? ""),
    // 照合の一次キー。媒体一覧と求人票でタイトルが揃わないので求人IDで突き合わせる。
    url: String(fm.url ?? ""),
    // position は Obsidian の予約キーで剥がされることがあるのでファイル名から兜底する。
    position:
      String(fm.position ?? "") ||
      (path.split("/").pop() ?? "").replace(/\.md$/i, "").split("_").slice(1).join("_"),
    kind: fm.type,
  });
}

// 回答品質復盤の横断集計。どの弱点が「癖」かは1本ずつ読んでも見えないので機械で出す。
// カードとの対応は標準回答集の「证据」に実在する `整理稿#qNN` 出典だけから作る（推測しない）。
let cardCoverage = new Map();
try {
  cardCoverage = buildCardCoverage(await readFile(PREP_LIBRARY, "utf8"));
} catch (error) {
  // 上流が読めないまま「対応カード無し」と書くと、実在するカードを見落として
  // 「新カードを起こせ」と誤った指示を出してしまう。欠測は 0 件ではなく計算不能。
  console.error(`❌ 面接標準回答集が読めない: ${error.message}`);
  process.exit(1);
}
const reviewEntries = [];
for (const path of await listMarkdownFiles(JOB_CASE_ROOT)) {
  const content = await readFile(path, "utf8");
  const fm = parseFrontmatter(content);
  if (fm.type !== "interview-answer-review") continue;
  const name = (path.split("/").pop() ?? "").replace(/\.md$/i, "");
  reviewEntries.push({
    key: interviewKeyFromNoteName(name),
    company: String(fm.company ?? ""),
    date: String(fm.date ?? ""),
    round: String(fm.round ?? ""),
    review: parseInterviewAnswerReview(content),
  });
}
const trendsBlock = renderInterviewTrends(buildInterviewTrends(reviewEntries, cardCoverage));

let queueRows = [];
try {
  queueRows = parseQueue(await readFile(QUEUE, "utf8"));
} catch {
  // キューはまだ無くてもよい（探索を一度も走らせていない状態）。
}
const queue = queueStats(queueRows, reviewedNotes);
const queueTable = queueRows.length
  ? [
      `**未精読 ${queue.pending} 件**（キュー全${queue.total}件・精読済み${queue.reviewed}件`
        + `${queue.withdrawn ? `・取下げ${queue.withdrawn}件` : ""}`
        + `${queue.lastFound ? `・最終探索 ${queue.lastFound}` : ""}）`,
      "",
      "| 媒体 | 未精読 |",
      "|---|---|",
      ...queue.byMedia.map(([media, count]) => `| ${media} | ${count} |`),
    ].join("\n")
  : "探索キューは空（まだ探索を実行していない）。";

const targets = [
  {
    path: QUEUE,
    label: "探索キュー",
    blocks: { "queue-stats": queueTable },
    optional: true,
  },
  {
    path: LEDGER,
    label: "台帳",
    blocks: {
      summary,
      "channel-stats": channelTable,
      "month-stats": monthList,
      "reason-stats": reasonList,
      "post-csv-additions": additionsTable,
      "company-list": companyList,
      "stats-json": statsJson,
    },
  },
  {
    path: DICTIONARY,
    label: "数据字典",
    blocks: {
      "field-enums": enumTable,
      "type-census": censusTable,
      "graph-health": graphHealthTable,
    },
  },
  {
    path: TRENDS,
    label: "面接傾向_横断",
    blocks: { "interview-trends": trendsBlock },
  },
];

console.log(
  `集計: ${total}社（CSV ${csvRows.length} + ノート ${total - csvRows.length}）／面接到達 ${reached}社`,
);

const drifted = [];
for (const target of targets) {
  let before;
  try {
    before = await readFile(target.path, "utf8");
  } catch {
    // optional な対象（まだ作っていないキュー等）は無ければ黙って飛ばす。
    if (target.optional) continue;
    console.error(`❌ ${target.label}が見つからない: ${target.path}`);
    process.exit(1);
  }

  let after = before;
  const missing = [];
  for (const [id, body] of Object.entries(target.blocks)) {
    const next = replaceGenerated(after, id, body);
    if (next === null) missing.push(id);
    else after = next;
  }

  if (missing.length) {
    console.error(`❌ ${target.label}に generated マーカーが無い: ${missing.join(", ")}`);
    console.error(
      `   ${target.path} に <!-- generated:<id> --> … <!-- /generated --> を置くこと。`,
    );
    process.exit(1);
  }

  if (after === before) {
    console.log(`✅ ${target.label}は最新（変更なし）`);
  } else if (checkOnly) {
    drifted.push(target.label);
  } else {
    await writeFile(target.path, after);
    console.log(`✅ ${target.label}の generated 区块を更新した`);
  }
}

if (drifted.length) {
  console.error(
    `❌ ${drifted.join("・")}の generated 区块が上流とずれている。\`npm run vault:stats\` を実行すること。`,
  );
  process.exit(1);
}
