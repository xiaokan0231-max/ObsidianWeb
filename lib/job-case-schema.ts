/**
 * job-case frontmatter の **唯一の schema**。
 *
 * これを作った理由：同じ規約が「人が読む `_数据字典.md`」「書く側の vault-check」
 * 「読む側の lib/jobs.ts」の3箇所に散っていて、片方だけ直すと静かにズレた。
 * 2026-08-04 の事故はその典型で、frontmatter が壊れているのに vault:check は
 * 「✅ 問題なし」を出し、Obsidian 側だけがキー0個になって案件が Web から消えた。
 *
 * ここには **frontmatter の形** だけを置く。case_id の一意性や owns の重複といった
 * 「ノートを跨いで初めて分かる」検査は vault-check 側に残す。
 */
import {
  CHANNEL_REQUIRED_FROM,
  JOB_STATUSES,
  KNOWN_CHANNELS,
  normalizeJobStatus,
  // 拡張子を省くと Node が直接 .ts を実行する時（tests / scripts）に解決できない。
  // 逆に .mjs 側から .ts を import すると Vite のブラウザ変換で消える。
  // 「.ts が葉の .mjs を明示拡張子で読む」だけが両方で通る（lib/jobs.ts と同じ形）。
} from "./job-status.mjs";
import { JOB_CASE_ORIGINS } from "./vault-boundary.mjs";

type FieldRule = {
  required?: boolean;
  enum?: readonly string[];
  requiredWhenStatusIn?: readonly string[];
  date?: boolean;
  dateTime?: boolean;
  intRange?: readonly [number, number];
  requiresField?: string;
};

type Frontmatter = Record<string, unknown> | null | undefined;

export type JobCaseVerification = "verified" | "warned" | "unchecked";

export const WAITING_FOR_VALUES = ["self", "company", "agent", "platform"];

export const FIT_BANDS = ["A", "B", "C", "D"];
export const HARD_GATE_VALUES = ["pass", "hold", "reject"];
export const PRIMARY_COHORT_VALUES = [
  "modernization_governance",
  "data_ai_platform",
  "modern_data_platform",
  "unclassified",
];
export const EXACT_EVIDENCE_VALUES = ["present", "absent"];
export const ROLE_FAMILY_VALUES = [
  "senior_data_platform",
  "data_platform_lead",
  "data_ai_platform_lead",
  "modernization_lead",
  "first_data_engineer",
  "data_heavy_backend",
  "data_infra_sre",
  "other",
];
export const CLIENT_FRONTLOAD_VALUES = ["low", "medium", "high", "unknown"];
export const SALARY_RANGE_CLASS_VALUES = [
  "high_only",
  "high_possible",
  "mid_only",
  "below_floor",
  "undisclosed",
];
export const ACCESS_STATE_VALUES = ["company_selected", "direct", "company_received", "not_sent", "agent_only"];

/**
 * Web の詳細カードが読む節の名前。**lib/jobs.ts はここを import する**ので、
 * 見出しを変えるならこの1箇所だけ直せばよい（以前は書く側と読む側に別々に書いてあった）。
 */
export const JOB_CASE_SECTION = {
  reason: "推荐理由",
  reasonAlias: "推荐理由（技術面）",
  matches: "匹配点",
  caution: "注意点",
  materials: "主打材料",
};

export const JOB_CASE_WEB_SECTIONS = [
  { heading: JOB_CASE_SECTION.reason, aliases: [JOB_CASE_SECTION.reasonAlias] },
  { heading: JOB_CASE_SECTION.matches, aliases: [] },
  { heading: JOB_CASE_SECTION.caution, aliases: [] },
  { heading: JOB_CASE_SECTION.materials, aliases: [] },
];

/** 「選考が動いている」状態。ここに居るなら採点も原文核対も済んでいるはず。 */
export const IN_PROGRESS_STATUSES = ["応募済", "書類通過", "面接中", "内定"];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^(\d{4}-\d{2}-\d{2})(?: ([01]\d|2[0-3]):([0-5]\d))?$/;

function realDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * 各フィールドの規約。`requiredWhenStatusIn` は「その status なら必須」で、
 * 例えば「保留」は日付が定まらない状態なので status_updated を要求しない
 * （無い日付を作らせないため）。
 */
export const JOB_CASE_FIELDS: Record<string, FieldRule> = {
  case_id: { required: true },
  company: { required: true },
  status: { required: true },
  origin: { required: true, enum: JOB_CASE_ORIGINS },
  channel: { enum: KNOWN_CHANNELS, requiredWhenStatusIn: CHANNEL_REQUIRED_FROM },
  status_updated: { date: true, requiredWhenStatusIn: CHANNEL_REQUIRED_FROM },
  waiting_for: { enum: WAITING_FOR_VALUES },
  follow_up_at: { date: true, requiresField: "waiting_for" },
  next_event_at: { dateTime: true },
  rating: { intRange: [0, 10] },
  rating_version: { enum: ["v2"] },
  document_gap_waived: { enum: ["yes", "no"] },
  fit_score_100: { intRange: [0, 100] },
  fit_rating_raw: { intRange: [0, 10] },
  fit_band_raw: { enum: FIT_BANDS },
  fit_band_final: { enum: FIT_BANDS },
  fit_band: { enum: FIT_BANDS },
  hard_gate: { enum: HARD_GATE_VALUES },
  salary_feasibility: { enum: HARD_GATE_VALUES },
  gate_employment_visa: { enum: HARD_GATE_VALUES },
  gate_salary: { enum: HARD_GATE_VALUES },
  gate_english: { enum: HARD_GATE_VALUES },
  gate_role_center: { enum: HARD_GATE_VALUES },
  gate_japanese_client: { enum: HARD_GATE_VALUES },
  gate_original: { enum: HARD_GATE_VALUES },
  score_technical_value: { intRange: [0, 25] },
  score_document_match: { intRange: [0, 10] },
  score_transferability: { intRange: [0, 15] },
  score_org_legibility: { intRange: [0, 20] },
  score_client_deployability: { intRange: [0, 20] },
  score_role_coherence: { intRange: [0, 10] },
  primary_cohort: { enum: PRIMARY_COHORT_VALUES },
  exact_evidence: { enum: EXACT_EVIDENCE_VALUES },
  role_family: { enum: ROLE_FAMILY_VALUES },
  client_frontload_current: { enum: CLIENT_FRONTLOAD_VALUES },
  salary_min: { intRange: [0, 10000] },
  salary_max: { intRange: [0, 10000] },
  salary_range_class: { enum: SALARY_RANGE_CLASS_VALUES },
  access_level: { intRange: [0, 3] },
  access_state: { enum: ACCESS_STATE_VALUES },
  fit_score_current: { intRange: [0, 100] },
  fit_revision_on: { date: true },
};

/**
 * frontmatter の形を検査する。返すのは**止めるべき問題**だけ。
 * 「採点されていない」のような運用上の未完了は auditJobCaseCompleteness 側。
 */
export function validateJobCaseFrontmatter(frontmatter: Frontmatter): string[] {
  const problems: string[] = [];
  const fm: Record<string, unknown> = frontmatter ?? {};
  const rawStatus = String(fm.status ?? "");
  const base = rawStatus ? (normalizeJobStatus(rawStatus) ?? "") : "";

  if (rawStatus && !base) {
    problems.push(
      `status "${rawStatus}" は列挙に無い。使えるのは ${JOB_STATUSES.join(" / ")}（後ろに（補足）は可）`,
    );
  }

  for (const [key, rule] of Object.entries(JOB_CASE_FIELDS)) {
    const value = fm[key];
    const missing = value === undefined || value === null || value === "";

    if (missing) {
      if (rule.required) problems.push(`frontmatter に \`${key}\` が無い`);
      else if (rule.requiredWhenStatusIn?.includes(base)) {
        const hint = rule.enum ? `（${rule.enum.join(" / ")}）` : "（YYYY-MM-DD）";
        problems.push(`status が「${base}」なら \`${key}\` が要る${hint}`);
      }
      continue;
    }

    const text = String(value);
    if (rule.enum && !rule.enum.includes(text)) {
      problems.push(`${key} "${text}" は未知。既知は ${rule.enum.join(" / ")}`);
    }
    if (rule.date && !realDate(text)) {
      problems.push(`${key} "${text}" が実在する YYYY-MM-DD ではない`);
    }
    if (rule.dateTime) {
      const matched = text.match(DATE_TIME);
      if (!matched || !realDate(matched[1])) {
        problems.push(`${key} "${text}" は YYYY-MM-DD または YYYY-MM-DD HH:MM ではない`);
      }
    }
    if (rule.intRange) {
      const number = Number(text);
      const [min, max] = rule.intRange;
      if (!Number.isFinite(number) || number < min || number > max) {
        problems.push(`${key} "${text}" が ${min}〜${max} の数値ではない`);
      }
    }
    if (rule.requiresField && !fm[rule.requiresField]) {
      problems.push(`${key} があるなら ${rule.requiresField} も必要`);
    }
  }

  if (String(fm.rating_version ?? "") === "v2") {
    const requiredV2 = [
      "fit_score_100",
      "fit_rating_raw",
      "fit_band_raw",
      "fit_band_final",
      "fit_band",
      "cap_reasons",
      "document_gap_waived",
      "application_decision",
      "hard_gate",
      "salary_feasibility",
      "gate_employment_visa",
      "gate_salary",
      "gate_english",
      "gate_role_center",
      "gate_japanese_client",
      "gate_original",
      "score_technical_value",
      "score_document_match",
      "score_transferability",
      "score_org_legibility",
      "score_client_deployability",
      "score_role_coherence",
      "primary_cohort",
      "problem_families",
      "exact_evidence",
      "role_family",
      "client_frontload_current",
      "salary_range_class",
      "access_level",
      "access_state",
      "fit_score_current",
      "fit_revision_on",
    ];
    for (const key of requiredV2) {
      const value = fm[key];
      if (value === undefined || value === null || value === "") {
        problems.push(`rating_version v2 なら \`${key}\` が要る`);
      }
    }

    const scoreKeys = [
      "score_technical_value",
      "score_document_match",
      "score_transferability",
      "score_org_legibility",
      "score_client_deployability",
      "score_role_coherence",
    ];
    const scores = scoreKeys.map((key) => Number(fm[key]));
    const fitScore = Number(fm.fit_score_100);
    if (scores.every(Number.isFinite) && Number.isFinite(fitScore)) {
      const total = scores.reduce((sum, score) => sum + score, 0);
      if (total !== fitScore) {
        problems.push(`v2の6軸合計 ${total} と fit_score_100 ${fitScore} が一致しない`);
      }
      const rawRating = Number(fm.fit_rating_raw);
      if (!Number.isFinite(rawRating) || Math.abs(rawRating - fitScore / 10) > 0.0001) {
        problems.push(`fit_rating_raw は fit_score_100 ÷ 10 である必要がある`);
      }
      const rawBand = fitScore >= 80 ? "A" : fitScore >= 70 ? "B" : fitScore >= 50 ? "C" : "D";
      if (String(fm.fit_band_raw ?? "") !== rawBand) {
        problems.push(`fit_score_100 ${fitScore} の fit_band_raw は ${rawBand}`);
      }
    }

    if (String(fm.fit_band ?? "") !== String(fm.fit_band_final ?? "")) {
      problems.push(`fit_band は fit_band_final と同じ値にする`);
    }
    const bandCaps: Record<string, number> = { A: 10, B: 7.9, C: 6.9, D: 4.9 };
    const bandRank: Record<string, number> = { A: 3, B: 2, C: 1, D: 0 };
    const finalBand = String(fm.fit_band_final ?? "");
    const rawRating = Number(fm.fit_rating_raw);
    const rating = Number(fm.rating);
    const cap = bandCaps[finalBand];
    if (Number.isFinite(rawRating) && Number.isFinite(rating) && cap !== undefined) {
      const expected = Math.min(rawRating, cap);
      if (Math.abs(rating - expected) > 0.0001) {
        problems.push(`rating ${rating} は raw ${rawRating} と ${finalBand} capから ${expected} にする`);
      }
    }

    const technicalValue = Number(fm.score_technical_value);
    const documentMatch = Number(fm.score_document_match);
    const clientDeployability = Number(fm.score_client_deployability);
    const capReasons = String(fm.cap_reasons ?? "");
    let maximumBand = "A";
    if (Number.isFinite(technicalValue) && technicalValue < 15) maximumBand = "C";
    if (
      Number.isFinite(documentMatch) &&
      documentMatch <= 3 &&
      String(fm.document_gap_waived ?? "") !== "yes"
    ) {
      maximumBand = "C";
    }
    if (Number.isFinite(clientDeployability) && clientDeployability >= 1 && clientDeployability <= 5) {
      maximumBand = "C";
    }
    if (maximumBand === "A" && capReasons.includes("org_legibility_unknown")) maximumBand = "B";
    if (finalBand in bandRank && bandRank[finalBand] > bandRank[maximumBand]) {
      problems.push(`v2の軸・cap_reasonsから fit_band_final は最大${maximumBand}`);
    }

    const gateKeys = [
      "gate_employment_visa",
      "gate_salary",
      "gate_english",
      "gate_role_center",
      "gate_japanese_client",
      "gate_original",
    ];
    const gateRank: Record<string, number> = { pass: 0, hold: 1, reject: 2 };
    const gates = gateKeys.map((key) => String(fm[key] ?? ""));
    if (gates.every((gate) => gate in gateRank)) {
      const worstRank = Math.max(...gates.map((gate) => gateRank[gate]));
      const expected = Object.keys(gateRank).find((gate) => gateRank[gate] === worstRank);
      if (String(fm.hard_gate ?? "") !== expected) {
        problems.push(`hard_gate は各Gateの最悪値 ${expected} にする`);
      }
    }
    if (String(fm.salary_feasibility ?? "") !== String(fm.gate_salary ?? "")) {
      problems.push(`salary_feasibility は gate_salary と同じ値にする`);
    }
    if (String(fm.hard_gate ?? "") === "reject") {
      if (finalBand !== "D" || !Number.isFinite(rating) || rating > 4.9) {
        problems.push(`hard_gate reject なら fit_band_final は D、rating は4.9以下にする`);
      }
    }

    const accessLevelByState: Record<string, number> = {
      company_selected: 3,
      direct: 2,
      company_received: 1,
      not_sent: 0,
      agent_only: 0,
    };
    const accessState = String(fm.access_state ?? "");
    if (accessState in accessLevelByState && Number(fm.access_level) !== accessLevelByState[accessState]) {
      problems.push(`access_state ${accessState} の access_level は ${accessLevelByState[accessState]}`);
    }

    const salaryMin = Number(fm.salary_min);
    const salaryMax = Number(fm.salary_max);
    const salaryClass = String(fm.salary_range_class ?? "");
    const hasSalaryMin = fm.salary_min !== undefined && fm.salary_min !== null && fm.salary_min !== "";
    const hasSalaryMax = fm.salary_max !== undefined && fm.salary_max !== null && fm.salary_max !== "";
    if (salaryClass === "undisclosed") {
      if (hasSalaryMin || hasSalaryMax) {
        problems.push(`salary_range_class が undisclosed なら salary_min/max は省略する`);
      }
    } else if (!hasSalaryMin || !hasSalaryMax) {
      problems.push(`salary_range_class ${salaryClass} なら salary_min/max が要る`);
    } else if (Number.isFinite(salaryMin) && Number.isFinite(salaryMax)) {
      if (salaryMin > salaryMax) problems.push(`salary_min は salary_max 以下にする`);
      const expectedClass =
        salaryMax < 700
          ? "below_floor"
          : salaryMin >= 1000
            ? "high_only"
            : salaryMax >= 1000
              ? "high_possible"
              : "mid_only";
      if (salaryClass !== expectedClass) {
        problems.push(`salary_min/maxから salary_range_class は ${expectedClass}`);
      }
    }
  }

  return problems;
}

const HEADING = /^##\s+(.*)$/gm;

function headings(content: unknown): string[] {
  return Array.from(String(content ?? "").matchAll(HEADING), (m) => m[1].trim());
}

/**
 * 原文を核対したかの判定。**行頭の ✅ だけ**が「確認済」になる。
 * 見出しの末尾に ✅ を付けても効かない（2026-07-28：ワークポート10件が
 * これで全部「未核对」表示になった）。
 * リスク側を先に見るのは、古い「✅ 確認済」と新しい「⚠️ 要確認」が同居した時に
 * 後者を勝たせるため——さもないと残骸の結論でカードが「確認済」に化ける。
 */
export function detectVerification(content: unknown): JobCaseVerification {
  const text = String(content ?? "");
  const found = headings(text);
  if (found.some((h) => /^⚠️/.test(h)) || /未検証/.test(text)) return "warned";
  if (found.some((h) => /^✅/.test(h))) return "verified";
  // 🔴 `## 必須要件（求人原文・逐語）` の節そのものが「原文を開いて読んだ」の証拠。
  // ✅ 見出しだけを見ていた頃、**38件**が「未核对」と表示されていた——実際には
  // 全件が逐語ブロックを持っており、確認していないのではなく**世代が違った**。
  // ✅ を持つのは 07-20 頃の retrofit ノート（二次情報で先に起票し、後から原文で追検証した）で、
  // 07-22 以降 job-posting-review が起票したものは逐語ブロックが native の証拠形式。
  // 逐語ブロックには貼り付けの指紋（全角開き括弧に半角閉じ括弧、途中で切れた文、
  // 項目内の改行）が残っており、要約では再現しない＝二次情報では書けない。
  if (found.some((h) => /求人原文/.test(h) && /逐語/.test(h))) return "verified";
  return "unchecked";
}

/**
 * 「形は正しいが中身が未完了」を拾う。**止めない**——止めると既存の
 * 未採点ノートで Stop hook が固まり、他の作業が全部できなくなる。
 *
 * ここが無かったせいで、一次面接が確定している案件が3週間ぶん
 * rating も評価節も空のまま Web に並んでいた（2026-08-04 発覚）。
 * 形式検査は全部通っていた——通るように書いてあったのではなく、
 * **誰も「中身があるか」を見ていなかった**。
 */
export function auditJobCaseCompleteness(
  frontmatter: Frontmatter,
  content: unknown,
  { today }: { today?: string } = {},
): string[] {
  const warnings: string[] = [];
  const fm: Record<string, unknown> = frontmatter ?? {};
  const base = normalizeJobStatus(String(fm.status ?? "")) ?? "";
  if (!IN_PROGRESS_STATUSES.includes(base)) return warnings;

  const rating = Number(fm.rating);
  if (fm.rating === undefined || fm.rating === "" || !Number.isFinite(rating) || rating === 0) {
    warnings.push(`status が「${base}」なのに rating が無い（Web で 0/10 と表示される）`);
  }

  const found = headings(content);
  const missing = JOB_CASE_WEB_SECTIONS.filter(
    (section) => !found.some((h) => h === section.heading || section.aliases.includes(h)),
  ).map((section) => section.heading);
  if (missing.length) {
    warnings.push(`Web 詳細用の節が無い: ${missing.join("・")}（カードが空欄になる）`);
  }

  if (detectVerification(content) === "unchecked") {
    warnings.push("`## ✅` で始まる見出しが無い（Web で「未核对」と表示される）");
  }

  const scheduled = String(fm.next_event_at ?? "").match(DATE_TIME)?.[1];
  if (scheduled && today && scheduled < today) {
    warnings.push(`next_event_at ${scheduled} が過ぎている（進行中なら次の予定へ更新するか消す）`);
  }

  return warnings;
}
