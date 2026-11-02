#!/usr/bin/env node
// 台帳と数据字典の generated 区块を上流データから計算し直して差し替える。
// 数字・表・列挙を手で書かないための本体。`npm run vault:stats [--check]`
//
// 上流は3つ:
//   1) job_search_rejections.csv（ある時点で凍結した過去分。件数は CSV が持つ）
//   2) 20_求職 配下の type: job-case frontmatter（凍結後の応募はここが唯一の記録先）
//   3) vault-lib.mjs の列挙定数（status / channel の正）
// CSV と同じ出来事を記録したノートは CSV 行に畳む（二重計上を避ける）。
// 会社が同じでも経路が違えば別の応募として数える——詳細は records の組み立てを見ること。

import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { load as loadYaml, JSON_SCHEMA } from "js-yaml";
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
import {
  buildCardCoverage,
  buildInterviewTrends,
  renderInterviewTrends,
  reviewTrendEntry,
} from "../lib/interview-trends.mjs";
import { resolveInterviewOutcomes } from "../lib/interview-outcome.ts";
import { reviewSourcePath } from "../lib/review-paths.ts";
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
// CSV は凍結済みの過去分＝台帳の数字のほぼ全部を占める。読めないまま続行すると
// 「CSV 0 件」で集計し、全期間の合計を直近ノート分だけの数で、過去の月別推移ごと
// 上書きしてしまう。
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

/** 株式会社の位置・空白・全半角の表記ゆれだけを吸収し、同じ会社の二重計上を防ぐ。 */
const companyKey = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/株式会社|有限会社|合同会社|\(株\)|[\s　・･_]/g, "");

// ── 到達段階 ──────────────────────────────────────────────────────────────
// 不採用になるまでに企業とどこまで接点があったか。値が大きいほど深い。
// 以前は「面接か、それ以外か」の二値で、カジュアル面談・人事面談を経てから書類で落ちた案件も、
// エージェントが企業に出さずに終わった案件も、全部「書類終了」に押し込んでいた。
// 2026-11-02 本人が「ビズリーチ 0/21 は実態と違う」と指摘して判明——数字の欠落ではなく口径の問題。
const STAGE = { unsubmitted: 0, document: 1, meeting: 2, interview: 3 };
const STAGE_LABEL = {
  [STAGE.unsubmitted]: "未提出（企業に届かず終了）",
  [STAGE.document]: "書類不採用",
  [STAGE.meeting]: "面談後の書類不採用",
  [STAGE.interview]: "面接後不採用",
};
// status の補足文から段階を読む。書き手は人と AI の両方で、面談を経たのに「書類選考」としか書かない
// 例が実在するため、ここで拾えない分は会社フォルダの逐字稿で補う（下の sessionsByFolder）。
//   未提出：エージェント推薦不可・面談前終了・掲載／募集終了＝企業に書類が届いていない
//   面談  ：「面談後」「面談実施」「面談を経て」。「面談前」「面談見送り」は面談していないので含めない
//   面接  ：一次〜最終面接（「一次選考」は書類なので除く）
const UNSUBMITTED_STATUS = /推薦不可|未提出|面談前|掲載終了|募集終了/;
const MEETING_STATUS = /面談(?:後|実施|を経て|済)/;
const INTERVIEW_STATUS = /面接(?!前)|最終|[一二三]次(?!選考)/;
const stageFromStatus = (status) => {
  if (INTERVIEW_STATUS.test(status)) return STAGE.interview;
  if (MEETING_STATUS.test(status)) return STAGE.meeting;
  if (UNSUBMITTED_STATUS.test(status)) return STAGE.unsubmitted;
  return STAGE.document;
};

// 会社フォルダ（20_求職/<会社>/）に置かれた逐字稿・整理稿は「その回が実際にあった」物証。
// ファイル名は `YYYY-MM-DD_<回>_逐字稿.md`／`_整理稿.md`（数据字典の規約）なので、回名で面談／面接を分ける。
// エージェント面談・媒体のユーザーサクセス面談は応募先企業との接点ではないので数えない。
const companyFolders = [];
const sessionsByFolder = new Map();
for (const entry of await readdir(JOB_CASE_ROOT, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
  companyFolders.push(entry.name);
  const sessions = [];
  for (const file of await readdir(join(JOB_CASE_ROOT, entry.name))) {
    const parsed = file.match(/^(\d{4}-\d{2}-\d{2})_(.+?)_(?:逐字稿|整理稿)/);
    if (!parsed || /エージェント|ユーザーサクセス/.test(parsed[2])) continue;
    const stage = /面接/.test(parsed[2]) ? STAGE.interview : /面談/.test(parsed[2]) ? STAGE.meeting : null;
    if (stage !== null) sessions.push({ date: parsed[1], stage });
  }
  if (sessions.length) sessionsByFolder.set(entry.name, sessions);
}
// 案件ノートがどの会社フォルダに属するか。会社フォルダ直下ならそのフォルダ。
// `_AI推薦/` 配下は会社フォルダを持たない代わりに、ファイル名が `<会社フォルダ名>_<求人>` で始まる規約
// （`INSIGHT_LAB_…` のようにフォルダ名自体が _ を含むので最長一致）。英字ファイル名とカナのフォルダ名の
// ような割れは会社名キーで拾う。
const companyFolderOf = (note) => {
  const segments = relative(JOB_CASE_ROOT, note.path).split("/");
  if (segments.length < 2) return null;
  if (!segments[0].startsWith("_")) return segments[0];
  const base = note.name.replace(/\.md$/i, "");
  const byPrefix = companyFolders
    .filter((folder) => base === folder || base.startsWith(`${folder}_`))
    .sort((a, b) => b.length - a.length)[0];
  return byPrefix ?? companyFolders.find((folder) => companyKey(folder) === companyKey(note.frontmatter.company)) ?? null;
};

const records = csvRows.map((row) => ({
  company: row.company,
  channel: normalizeChannel(row.channel),
  // 凍結 CSV の stage 列は「書類で終了か、面接後か」の二値で、面談の有無は持っていない。
  stage: isDocStage(row.stage) ? STAGE.document : STAGE.interview,
  month: (row.last_rejection_date ?? "").slice(0, 7),
  // 応募↔不採用の突き合わせは日単位で行うので、月だけでなく通知日そのものを持たせる。
  // ここを月初で代用すると「応募より前に不採用」になり、同月の応募が結び付かなくなる。
  notifiedOn: row.last_rejection_date ?? "",
  reason: row.reason_category || "未分類",
  source: "csv",
}));

const jobCases = await readJobCases();
for (const note of jobCases) {
  const fm = note.frontmatter;
  if (baseStatus(fm.status) !== "不採用") continue;
  const company = String(fm.company ?? "").trim();
  if (!company) continue;
  const channel = normalizeChannel(String(fm.channel ?? ""));
  const notifiedOn = String(fm.status_updated ?? "");
  // 通知日より後の回は別の応募のもの（同じ会社へ後から応募し直した等）なので、この案件の証拠にしない。
  const sessions = (sessionsByFolder.get(companyFolderOf(note)) ?? []).filter(
    (session) => !notifiedOn || session.date <= notifiedOn,
  );
  const stage = Math.max(stageFromStatus(String(fm.status)), ...sessions.map((session) => session.stage));
  // CSV と同じ出来事の二重記録（同じ会社・同じ経路で、通知日が CSV の通知日以前）は CSV 行に畳む。
  // 以前は「CSV にある会社のノートは全部無視」だったため、CSV で RA 書類落ちの会社に後日 Green で
  // 応募して一次面接まで行った記録が丸ごと消えていた。
  const twin = records.find(
    (r) =>
      r.source === "csv" &&
      r.channel === channel &&
      companyKey(r.company) === companyKey(company) &&
      notifiedOn &&
      notifiedOn <= r.notifiedOn,
  );
  if (twin) {
    twin.stage = Math.max(twin.stage, stage);
    continue;
  }
  records.push({
    company,
    channel,
    stage,
    month: notifiedOn.slice(0, 7),
    reason: String(fm.reason_category ?? "") || "未披露/模板拒绝",
    source: "note",
    notifiedOn,
    position: String(fm.position ?? ""),
  });
}

// ── 集計単位：会社×経路 ───────────────────────────────────────────────────
// 同じ会社に同じ経路で複数求人へ応募した分は 1 件に畳み、最も深い段階を採る。1 回の人事面談と 1 通の
// 通知で 4 求人が同時に終わった例があり、求人ごとに数えると母数が二桁の経路でその 1 社が率を支配する。
// 逆に同じ会社でも経路が違えば別の応募（RA で書類落ち → 半年後に Green で一次面接）なので会社では畳まない。
// 進行中の案件（応募済・面接中）はそもそも入っていない。ここが答えるのは
// 「不採用になった案件は、断られる前にどこまで行ったか」であって、応募→面接の率ではない。
const groups = new Map();
for (const record of records) {
  const key = `${companyKey(record.company)}\t${record.channel}`;
  const group = groups.get(key);
  if (!group) groups.set(key, { ...record });
  else if (record.stage > group.stage) Object.assign(group, record, { company: group.company });
}
// 企業に書類が届かないまま終わったもの（推薦不可・面談前終了 等）は母数に入れず、別枠で数える。
const submitted = [...groups.values()].filter((group) => group.stage !== STAGE.unsubmitted);

// 会社単位の集計（サマリ・照合リスト）。経路が違っても同じ会社は 1 社、段階は最も深いもの。
const companies = new Map();
for (const group of groups.values()) {
  const key = companyKey(group.company);
  const entry = companies.get(key);
  if (!entry) companies.set(key, { company: group.company, stage: group.stage });
  else entry.stage = Math.max(entry.stage, group.stage);
}
const submittedCompanies = [...companies.values()].filter((entry) => entry.stage !== STAGE.unsubmitted);
const countStage = (list, stage) => list.filter((entry) => entry.stage === stage).length;
const total = submittedCompanies.length;
const reachedInterview = countStage(submittedCompanies, STAGE.interview);
const reachedMeeting = countStage(submittedCompanies, STAGE.meeting);
const documentOnly = countStage(submittedCompanies, STAGE.document);
const unsubmittedCompanies = companies.size - total;

const byChannel = new Map();
for (const group of groups.values()) {
  const entry = byChannel.get(group.channel) ?? { total: 0, reached: 0, meeting: 0, unsubmitted: 0 };
  if (group.stage === STAGE.unsubmitted) entry.unsubmitted += 1;
  else {
    entry.total += 1;
    if (group.stage === STAGE.interview) entry.reached += 1;
    if (group.stage === STAGE.meeting) entry.meeting += 1;
  }
  byChannel.set(group.channel, entry);
}

const byMonth = new Map();
for (const group of submitted) {
  if (!group.month) continue;
  byMonth.set(group.month, (byMonth.get(group.month) ?? 0) + 1);
}

const pct = (part, whole) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : "—");
// セルに | が混ざると Markdown の列がずれるので全角に逃がす
const cell = (value) => String(value || "—").replaceAll("|", "｜");

const summary = [
  "| 項目 | 値 |",
  "|---|---|",
  `| **不採用企業数** | **${total}社**（企業へ書類が届いた会社。経路が違っても同じ会社は 1 社） |`,
  `| 書類選考で終了（面談なし） | ${documentOnly}社（${pct(documentOnly, total)}） |`,
  `| 面談（カジュアル・人事等）を経て書類で終了 | ${reachedMeeting}社（${pct(reachedMeeting, total)}） |`,
  `| 面接まで到達 | ${reachedInterview}社（${pct(reachedInterview, total)}） |`,
  `| （母数外）企業へ未提出のまま終了 | ${unsubmittedCompanies}社（推薦不可・面談前終了・掲載終了など。照合リストには載せる） |`,
].join("\n");

const channelTable = [
  "| 経路 | 提出済 | 書類終了 | 面談到達 | 面接到達 | 面接到達率 | 面談以上率 | 未提出（母数外） |",
  "|---|---|---|---|---|---|---|---|",
  ...[...byChannel.entries()]
    .sort((a, b) => b[1].total - a[1].total || b[1].unsubmitted - a[1].unsubmitted)
    .map(
      ([name, s]) =>
        `| ${name} | ${s.total} | ${s.total - s.reached - s.meeting} | ${s.meeting} | ${s.reached} | ${pct(s.reached, s.total)} | ${pct(s.reached + s.meeting, s.total)} | ${s.unsubmitted} |`,
    ),
  "",
  "口径：1 件＝会社×経路。同じ会社の複数求人は最も深い段階で 1 件に畳み、経路が違えば別件。進行中の案件は含まない——この表は「不採用になった案件が、断られる前にどこまで行ったか」であり、応募→面接の率ではない。",
  "- **未提出**：エージェント推薦不可・面談前終了・掲載／募集終了など、企業に書類が届いていないもの。母数（提出済）に入れない。",
  "- **面談到達**：カジュアル面談・人事面談などを経てから書類選考で終了。status の補足文（「面談後」等）と、会社フォルダの逐字稿／整理稿（通知日以前の回）の両方から判定。",
  "- **面接到達**：一次〜最終面接を受けてから不採用。面談以上率＝（面談到達＋面接到達）÷提出済。",
].join("\n");

const monthList = [
  "1 件＝会社×経路（企業へ提出済みの不採用のみ。未提出は含めない）",
  ...[...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, count]) => `- ${month}: ${count}件`),
].join("\n");

const byReason = new Map();
for (const group of submitted) {
  byReason.set(group.reason, (byReason.get(group.reason) ?? 0) + 1);
}
const reasonList = [
  "1 件＝会社×経路（企業へ提出済みの不採用のみ）",
  ...[...byReason.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => `- ${reason}: ${count}件`),
].join("\n");

// 応募日台帳（Gmail の受理メールから起こした事実）を月別に畳む。
// 走査していない期間は「0件」ではなく「不明」——buildTimeline が null で表現する。
let appliedRows = [];
let appliedKnownFrom = null;
let appliedLedgerText = "";
try {
  appliedLedgerText = await readFile(APPLIED_LEDGER, "utf8");
  appliedRows = parseAppliedLedger(appliedLedgerText);
  appliedKnownFrom = parseAppliedKnownFrom(appliedLedgerText);
} catch {
  // 台帳がまだ無くてもよい（その場合タイムラインは全月「不明」になる）。
}

// 応募日台帳の「追記分」：案件ノートの applied_on（Web が応募済にした瞬間に書く／skill も書く）から起こす。
// 台帳は手書きの歴史行を残したまま、この generated 区块だけを script が持つ——
// 「台帳不再手写任何行」（AGENTS.md）をこの台帳にも当てる。手書き行と同じ会社・同じ応募日、
// または証拠列に同じ求人URL／case_id を含む行は既に載っているので出さない。
const appliedDate = (fm) => {
  const explicit = String(fm.applied_on ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(explicit)) return explicit;
  const status = String(fm.status ?? "");
  return baseStatus(status) === "応募済" ? (status.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1] ?? "") : "";
};
const handwrittenText = appliedLedgerText.replace(/<!--\s*generated:applied-from-cases[\s\S]*?<!--\s*\/generated\s*-->/, "");
const handwrittenRows = parseAppliedLedger(handwrittenText);
const handwrittenKeys = new Set(handwrittenRows.flatMap((row) => [
  `${companyKey(row.company)}@${row.appliedOn}`,
  `${companyKey(row.matchName)}@${row.appliedOn}`,
]));
const generatedApplied = jobCases
  .map((note) => {
    const fm = note.frontmatter;
    const appliedOn = appliedDate(fm);
    const company = String(fm.company ?? "").trim();
    if (!appliedOn || !company) return null;
    const url = String(fm.url ?? "").trim();
    const caseId = String(fm.case_id ?? "").trim();
    if (handwrittenKeys.has(`${companyKey(company)}@${appliedOn}`)) return null;
    if ((url && handwrittenText.includes(url)) || (caseId && handwrittenText.includes(caseId))) return null;
    return {
      appliedOn,
      company,
      matchName: "",
      position: String(fm.position ?? "").replace(/\|/g, "／").trim() || "（職種名未記入）",
      channel: normalizeChannel(String(fm.channel ?? "")),
      evidence: [`job-case ${caseId || note.name}`, url].filter(Boolean).join(" · "),
    };
  })
  .filter(Boolean)
  .sort((a, b) => a.appliedOn.localeCompare(b.appliedOn) || a.company.localeCompare(b.company, "ja"));
// このスクリプト内の集計にも今回生成する行を含める（次回起動を待たない）。
appliedRows = [...handwrittenRows, ...generatedApplied.map((row) => ({ appliedOn: row.appliedOn, company: row.company, matchName: row.company, channel: row.channel }))];
const appliedFromCasesTable = generatedApplied.length
  ? [
      `${generatedApplied.length} 件（案件ノートの applied_on から起こした行。手書き行と重複するものは除外済み）`,
      "",
      "| 応募日 | 会社名 | 照合名 | 職種名 | 経路 | 証拠 |",
      "|---|---|---|---|---|---|",
      ...generatedApplied.map((row) => `| ${row.appliedOn} | ${row.company} | ${row.matchName} | ${row.position} | ${row.channel} | ${row.evidence} |`),
    ].join("\n")
  : "案件ノートの applied_on から起こす行はまだ無い（手書き行に無い応募済案件が出たらここに載る）。";
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
    reachedInterview,
    reachedMeeting,
    unsubmitted: unsubmittedCompanies,
    byChannel,
    byMonth,
    byReason,
    timeline: buildTimeline(byMonth, appliedByMonth, appliedKnownFrom, appliedPairs),
  }),
);

// CSV に無い不採用（job-case 由来）だけの明細。凍結後の新規分だけでなく、
// 移行時に判明した CSV 欠落もここへ入る。1 行＝1 ノート（同じ会社の別求人も別行。
// 会社×経路に畳むのは上の集計の話で、明細まで畳むと求人名が消える）。かつては手書き表で、
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
          `| ${cell(r.notifiedOn)} | ${cell(r.company)} | ${cell(r.position)} | ${cell(r.channel)} | ${cell(`${STAGE_LABEL[r.stage]}・${r.reason}`)} |`,
      ),
    ].join("\n")
  : "（CSV 凍結後の不採用ノートはまだ無い）";

// 推薦・応募前の照合リスト。CSV とノートの和集合。
const csvCompanies = new Set(csvRows.map((row) => companyKey(row.company))).size;
const companyList = [
  `全${companies.size}社（CSV ${csvCompanies}社＋ノートのみ ${companies.size - csvCompanies}社。`
    + `うち企業へ未提出のまま終了した ${unsubmittedCompanies}社は集計の母数に入れないが、照合用にここには載せる）：`,
  "",
  ...[...companies.values()]
    .map((entry) => entry.company)
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
  // layer: user-action（快練ログ・専門コース進捗）は本人の解答の追記で、1組練習するたびに数 KB 増える。
  // 体積に入れると 0.1MB 丸めでも数日おきにずれ、「練習した」だけで Stop hook が止まる。
  if (isGeneratedNote({ frontmatter }) && frontmatter.layer !== "user-action") {
    generatedBytes += (await stat(path)).size;
  }
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
// 每场的选考结果要按 Web 同一套归属规则从 job-case／面谈 TODO 解析，这几类笔记和复盘本身都需要 Obsidian 同口径的 YAML：
// 简易 parseFrontmatter 会把带引号的值连引号一起读进来，「"不採用（…）"」就认不出是不採用，表里的轮次也会带着引号。
const YAML_TYPES = new Set(["interview-answer-review", "transcript-study", "interview-prep", "job-case", "todo"]);
const sessionNotes = [];
for (const path of await listMarkdownFiles(JOB_CASE_ROOT)) {
  const content = await readFile(path, "utf8");
  const simple = parseFrontmatter(content);
  if (!YAML_TYPES.has(String(simple.type ?? "").replace(/^["']|["']$/g, ""))) continue;
  let fm = simple;
  try {
    const parsed = loadYaml(content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "", { schema: JSON_SCHEMA });
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) fm = parsed;
  } catch {
    // YAML 坏掉由 vault:check 报；这里退回简易解析，不让统计整体失败。
  }
  // 场次键用 vault 相对路径：与 Web 同形，生成笔记里也不会出现本机绝对路径。
  if (fm.type === "interview-answer-review") reviewEntries.push(reviewTrendEntry(relative(VAULT, path), fm, content));
  else sessionNotes.push({ path: relative(VAULT, path), frontmatter: fm, content, tags: [], stat: { ctime: 0, mtime: 0, size: content.length } });
}
const outcomes = resolveInterviewOutcomes(sessionNotes);
for (const entry of reviewEntries) {
  const study = reviewSourcePath(`${entry.key}_回答品質復盤.md`, "answerReview");
  entry.outcome = (study && outcomes.get(study)) ?? null;
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
    path: APPLIED_LEDGER,
    label: "応募日台帳",
    blocks: { "applied-from-cases": appliedFromCasesTable },
    optional: true,
    // 台帳は元々全部手書きで generated マーカーが無い。初回だけ末尾に区块を作る（手書き行は触らない）。
    appendIfMissing: {
      "applied-from-cases": "\n\n## 追記分（案件ノートの applied_on から生成）\n\n<!-- generated:applied-from-cases 勿手改 -->\n<!-- /generated -->\n",
    },
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
  `集計: 不採用 ${total}社（面接到達 ${reachedInterview}・面談到達 ${reachedMeeting}）＋未提出のみ ${unsubmittedCompanies}社／CSV ${csvRows.length} 行・ノート ${additions.length} 件`,
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
    let next = replaceGenerated(after, id, body);
    if (next === null && target.appendIfMissing?.[id]) {
      // マーカーが無い＝この台帳にまだ generated 区块を置いたことがない。末尾に足してから差し替える。
      next = replaceGenerated(after.replace(/\s*$/, "") + target.appendIfMissing[id], id, body);
    }
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
