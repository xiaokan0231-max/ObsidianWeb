import { getString, getTitle, stripMarkdown, type Note } from "./notes.ts";
import { jobSectionBody } from "./job-sections.ts";
import { daysBetween, intakeSortKey } from "./job-intake.ts";
import {
  DEFAULT_JOB_STATUS,
  jobStatusNote,
  normalizeJobStatus,
} from "./job-status.ts";
import { JOB_CASE_TYPE } from "./vault-boundary.mjs";
import {
  ACCESS_STATE_VALUES, FIT_BANDS, HARD_GATE_VALUES, JOB_CASE_SECTION, PRIMARY_COHORT_VALUES, ROLE_FAMILY_VALUES,
  SALARY_RANGE_CLASS_VALUES, detectVerification,
} from "./job-case-schema.ts";

export {
  composeJobStatus,
  DEFAULT_JOB_STATUS,
  IN_FLIGHT_STATUSES,
  IN_PROGRESS_STATUSES,
  isJobStatus,
  JOB_STATUSES,
  SELECTION_STATUSES,
  TERMINAL_STATUSES,
  JOB_STATUS_NOTE_MAX,
  jobStatusNote,
  jobStatusNoteError,
  KNOWN_CHANNELS,
  normalizeJobStatus,
  statusRequiresChannel,
  type JobStatus,
} from "./job-status.ts";

export {
  daysBetween,
  intakeLabel,
  intakeRelative,
  jobIntake,
  JOB_INTAKES,
  normalizeDay,
  type JobIntake,
} from "./job-intake.ts";

/** 応募案件は発見経路に関係なく 20_求職 配下に置く。 */
export const JOB_CASE_ROOT = "20_求職/";
export { JOB_CASE_TYPE };

// 10点満点（2026-07-19 に5点満点から移行。ノート側の rating も全件変換済み）
export function jobRating(note: Note) {
  const raw = Number(getString(note.frontmatter.rating));
  return Number.isFinite(raw) ? Math.max(0, Math.min(10, raw)) : 0;
}

/**
 * 採点済みかどうか。**「0点」と「未採点」は違う。**
 *
 * `jobRating()` は欠損を 0 に丸めるので、そのまま表示すると
 * ra-batch（広撒網応募・採点は job-posting-review の工程）が起票した未採点の案件が
 * 「0/10＝見込みなし」に見える。実際は「まだ誰も読んでいない」。
 * 表示側はこの関数で分岐する。並び順は 0 のままで良い（未読を上に押し上げる根拠が無い）。
 */
export function jobRated(note: Note) {
  const raw = getString(note.frontmatter.rating);
  return raw !== "" && Number.isFinite(Number(raw));
}

/**
 * 採点の帯。**閾値（7+ / 8+）ではなく単独の帯**にしてあるのは、
 * 「5〜6 点だけを見たい」が閾値式では表現できないから（7+ を選ぶと 5-6 が消える）。
 * チップは多選の和集合なので、7・8・9 を全部押せば従来の「7+」と同じ結果になる。
 * 8.5 や 7.5 のような小数は切り捨てて下の帯に入れる（8.5 → 8 の帯）。
 */
export type JobRatingBand = "7plus" | "9" | "8" | "7" | "6" | "5" | "low";

export const JOB_RATING_BANDS: { id: JobRatingBand; label: string; hint: string }[] = [
  { id: "7plus", label: "7+", hint: "7点以上をまとめて・応募すべき帯" },
  { id: "9", label: "9", hint: "9点以上・今週応募すべき" },
  { id: "8", label: "8", hint: "8点台・応募すべき" },
  { id: "7", label: "7", hint: "7点台・応募すべき" },
  { id: "6", label: "6", hint: "6点台・応募可だが優先度低" },
  { id: "5", label: "5", hint: "5点台・応募可だが優先度低" },
  { id: "low", label: "4以下", hint: "4点以下・要確認事項が解消すれば上がる" },
];

/**
 * `7+` だけは排他バンドではなく**しきい値のショートカット**（9/8/7 を3回押す代わりの1クリック）。
 * `jobRatingBand()` には混ぜない —— 混ぜると1件が2つの帯に属することになり、
 * 帯ごとの件数が二重計上される。しきい値はこの表で分離して持つ。
 */
const RATING_THRESHOLDS: Partial<Record<JobRatingBand, number>> = { "7plus": 7 };

export function jobRatingBand(rating: number): JobRatingBand {
  if (rating >= 9) return "9";
  if (rating >= 8) return "8";
  if (rating >= 7) return "7";
  if (rating >= 6) return "6";
  if (rating >= 5) return "5";
  return "low";
}

/** 選択された帯（排他バンドとしきい値が混在しうる）に該当するか。未選択なら全件通す。 */
export function jobMatchesRatingBands(rating: number, selected: JobRatingBand[]): boolean {
  if (selected.length === 0) return true;
  return selected.some((band) => {
    const threshold = RATING_THRESHOLDS[band];
    return threshold === undefined ? jobRatingBand(rating) === band : rating >= threshold;
  });
}

export function jobStatus(note: Note): string {
  const raw = getString(note.frontmatter.status);
  return normalizeJobStatus(raw) ?? (raw || DEFAULT_JOB_STATUS);
}

/**
 * `position` 是 Obsidian metadata cache 的保留键，Local REST API 会把它从 frontmatter 里剥掉，
 * 所以笔记里写了也读不到。改从 H1 的 `会社 — 職位` 或文件名 `会社_職位.md` 兜底取。
 */
export function jobPosition(note: Note): string {
  const declared = getString(note.frontmatter.position);
  if (declared) return declared;

  const heading = note.content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "";
  const fromHeading = heading.split(/\s[—–-]\s/).slice(1).join(" — ").trim();
  if (fromHeading) return fromHeading;

  const basename = note.path.split("/").pop()?.replace(/\.md$/i, "") ?? "";
  const fromFilename = basename.split("_").slice(1).join("_").trim();
  return fromFilename;
}

export function jobStack(note: Note): string[] {
  const value = note.frontmatter.stack;
  if (Array.isArray(value)) return value.map((item) => getString(item)).filter(Boolean);
  const raw = getString(value);
  return raw ? raw.split(/[,、]/).map((item) => item.trim()).filter(Boolean) : [];
}

export function jobSection(note: Note, heading: string) {
  return stripMarkdown(jobSectionBody(note.content, heading)).trim();
}

/** `## 匹配点` / `## 主打材料` 这类小节按条目切开，供详情和对比使用。 */
export function jobSectionItems(note: Note, heading: string): string[] {
  return jobSectionBody(note.content, heading)
    .split("\n")
    .map((line) => line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)$/)?.[1] ?? "")
    .map((line) => stripMarkdown(line).trim())
    .filter(Boolean);
}

export type SalaryRange = {
  /** 年収下限（万円）。无法解析时为 null。 */
  min: number | null;
  /** 年収上限（万円）。只有单侧数字时与 min 相同。 */
  max: number | null;
  /** 由月給换算而来，数字只是估算。 */
  estimated: boolean;
};

const EMPTY_SALARY: SalaryRange = { min: null, max: null, estimated: false };

/**
 * 把 `年俸 750万〜1,200万円` / `月給 50.0万〜81.7万円` / `月給 53.3万円〜（年収換算 640万〜）`
 * 之类的自由文本解析成年収区间（万円）。月給按 ×12 估算。
 */
export function parseSalary(raw: string): SalaryRange {
  const text = raw.replace(/[,，]/g, "");
  if (!text.trim()) return EMPTY_SALARY;

  const conversion = text.match(/年収換算[^\d]*([\s\S]*)$/)?.[1];
  // 括号里常见的是「別求人は600万〜」这类旁注，会把区间拉歪，先切掉。
  const primary = conversion ?? text.split(/[（(]/)[0];
  const monthly = !conversion && /月給|月収/.test(primary);

  const numbers = Array.from(primary.matchAll(/(\d+(?:\.\d+)?)\s*万/g), (match) => Number(match[1]))
    .filter((value) => Number.isFinite(value));
  if (numbers.length === 0) return EMPTY_SALARY;

  const scale = monthly ? 12 : 1;
  const min = Math.round(numbers[0] * scale);
  const max = Math.round(numbers[numbers.length - 1] * scale);
  return { min: Math.min(min, max), max: Math.max(min, max), estimated: monthly };
}

/** v2 の salary_min / salary_max（万円）。両方揃って順序が正しい時だけ採用する。 */
function structuredSalary(note: Note): SalaryRange | null {
  const min = Number(note.frontmatter.salary_min);
  const max = Number(note.frontmatter.salary_max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min) return null;
  return { min, max, estimated: false };
}

/** 从 `東京都港区三田・一部在宅` 里取出「東京都」这类可筛选的行政区划。 */
export function jobRegions(location: string): string[] {
  const matches = Array.from(location.matchAll(/([^\s／/・（(]{2,4}?[都道府県])/g), (match) => match[1]);
  return Array.from(new Set(matches));
}

export function jobRemote(note: Note) {
  const location = getString(note.frontmatter.location);
  return /リモート|在宅|フルリモート|remote/i.test(location);
}

/**
 * 笔记里由本人加的求人原文核对标记。AI 打分本身不是权威事实，
 * 所以这一层要在卡片上单独显示出来，避免拿未验证的分数去做决定。
 */
export type JobVerification = "verified" | "warned" | "unchecked";

export type OfficialApplyStatus = "exact" | "related" | "careers" | "unavailable";

export const OFFICIAL_APPLY_LABEL: Record<OfficialApplyStatus, string> = {
  exact: "同职位官网直投",
  related: "官网相近职位",
  careers: "官网招聘入口",
  unavailable: "未找到公开直投",
};

export function officialApplyStatus(note: Note): OfficialApplyStatus {
  const value = getString(note.frontmatter.official_apply_status);
  return value === "exact" || value === "related" || value === "careers" || value === "unavailable"
    ? value
    : "unavailable";
}

export function jobVerification(note: Note): JobVerification {
  // 判定そのものは lib/job-case-schema.ts に置く。vault:check（書く側）と
  // ここ（読む側）が同じ関数を見ていないと、「check は通ったのにカードは未核对」が起きる。
  return detectVerification(note.content) as JobVerification;
}

export const VERIFICATION_LABEL: Record<JobVerification, string> = {
  verified: "原文確認済",
  warned: "要確認",
  unchecked: "未核对",
};

/**
 * source（求人票在哪发现的）的筛选用主值。frontmatter 原文允许带括号补充
 * （「公式採用（ATS 名）」「エージェント（担当者のおすすめメール）」），
 * 但筛选器若按整串聚合，同一来源会裂成一堆只有 1 件的选项——
 * 所以截掉括号取主值，再吸收英日别名。详情抽屉仍显示原文。
 */
const SOURCE_ALIASES: Record<string, string> = {
  "Recruit Agent": "リクルートエージェント",
  RA: "リクルートエージェント",
};

export function normalizeJobSource(raw: string): string {
  const main = raw.split(/[（(]/)[0].trim();
  if (!main) return "";
  return SOURCE_ALIASES[main] ?? main;
}

/**
 * 応募日。**`date`（入库日）とも `status_updated` とも別物**——
 * `date` は AI がキューに載せた日、`status_updated` は最後の状態変化日で、
 * 不採用になった瞬間に応募日は拒否日で上書きされて消える（`_応募日台帳` の冒頭に同じ警告がある）。
 *
 * 正本は `20_求職/_応募日台帳.md` だが、台帳は手動更新で追従が遅れる（2026-07-29 時点で
 * 07-23 までしか無く、応募済 37 件のうち載っているのは 7 件だけ）。
 * そこで **status 文字列の先頭の日付**で補う——`応募済（2026-07-20・リクルートエージェント経由）`
 * のように、括弧内の1つ目の日付が応募日という書式が全件で守られている（残り30件を全部拾えた）。
 *
 * 台帳が育ったらそちらが優先される作りにしてあるので、二重管理にはならない。
 */
export function jobAppliedOn(note: Note, statusText: string): string {
  const explicit = getString(note.frontmatter.applied_on);
  if (/^\d{4}-\d{2}-\d{2}$/.test(explicit)) return explicit;

  // 🔴 status 内の1つ目の日付が応募日と言えるのは **`応募済` の時だけ**。
  // 先へ進むと同じ位置がその段階の日付に置き換わる：
  //   不採用（2026-07-28・書類選考…）      ← 拒否日
  //   面接中（2026-07-29 選考進行確定…）    ← 面接段階に入った日
  // ここを一律に拾うと「応募 7/28・1日経過」（実際は 7/20 応募・8日で終了）のようにずれる。
  // 分からないものは**出さない**。空欄なら「記録が無い」と読めるが、
  // 嘘の日付は「そこから何日経ったか」の判断ごと壊す。
  if (!/^応募済/.test(statusText)) return "";
  return statusText.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1] ?? "";
}

/** v2 採点（rating_version: v2）の六軸と Gate。vault:check が交差検証している値を画面でも使う。 */
export type JobFit = {
  /** 六軸合計（0–100）。 */
  score: number;
  /** cap 適用後の最終 Band（A–D）。 */
  band: string;
  /** 各 Gate の最悪値：pass / hold / reject。 */
  hardGate: string;
  gates: Record<"employmentVisa" | "salary" | "english" | "roleCenter" | "japaneseClient" | "original", string>;
  scores: Record<"technicalValue" | "documentMatch" | "transferability" | "orgLegibility" | "clientDeployability" | "roleCoherence", number>;
  /** 企業への到達摩擦（Fit とは別軸）。 */
  accessState: string;
  salaryRangeClass: string;
  roleFamily: string;
  primaryCohort: string;
};

export const JOB_FIT_SCORE_LABEL: Record<keyof JobFit["scores"], { label: string; max: number }> = {
  technicalValue: { label: "技術価値", max: 25 },
  documentMatch: { label: "書類一致", max: 10 },
  transferability: { label: "転用性", max: 15 },
  orgLegibility: { label: "組織可読性", max: 20 },
  clientDeployability: { label: "客先配置", max: 20 },
  roleCoherence: { label: "役割整合", max: 10 },
};
/** 六軸の表示順（skill の採点表と同じ）。 */
export const JOB_FIT_AXES: readonly (keyof JobFit["scores"])[] = ["technicalValue", "documentMatch", "transferability", "orgLegibility", "clientDeployability", "roleCoherence"];
export const JOB_FIT_GATE_LABEL: Record<keyof JobFit["gates"], string> = {
  employmentVisa: "在留資格", salary: "年収", english: "英語", roleCenter: "役割中心", japaneseClient: "日本客先", original: "原文",
};
export const HARD_GATE_LABEL: Record<string, string> = { pass: "通过", hold: "保留", reject: "拒否" };
/** rating_version が v2 でない、または六軸が揃わない案件の表示。0 と区別するため文言で出す。 */
export const UNRATED_V2_LABEL = "未採点（v2）";
export const ACCESS_STATE_LABEL: Record<string, string> = {
  company_selected: "企业已筛选", direct: "直投", company_received: "企业已收", not_sent: "未发送", agent_only: "仅代理",
};

const oneOf = (value: unknown, allowed: readonly string[]) => (allowed.includes(String(value ?? "")) ? String(value) : "");
/** 空欄は「未記入」であって 0 点ではない——Number("") が 0 になる罠を先に塞ぐ。 */
const intIn = (value: unknown, max: number) => {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= max ? number : null;
};

/**
 * v2 の採点欄を読む。rating_version が v2 でない、または六軸のどれかが欠ける／範囲外なら null——
 * 「未採点（v2）」と「0 点」は別物で、片方だけ数字にすると絞り込みが嘘をつく。
 */
export function jobFit(note: Note): JobFit | null {
  const fm = note.frontmatter;
  if (getString(fm.rating_version) !== "v2") return null;
  const scores = {
    technicalValue: intIn(fm.score_technical_value, 25),
    documentMatch: intIn(fm.score_document_match, 10),
    transferability: intIn(fm.score_transferability, 15),
    orgLegibility: intIn(fm.score_org_legibility, 20),
    clientDeployability: intIn(fm.score_client_deployability, 20),
    roleCoherence: intIn(fm.score_role_coherence, 10),
  };
  if (Object.values(scores).some((value) => value === null)) return null;
  const filled = scores as JobFit["scores"];
  const band = oneOf(fm.fit_band_final, FIT_BANDS) || oneOf(fm.fit_band, FIT_BANDS);
  const hardGate = oneOf(fm.hard_gate, HARD_GATE_VALUES);
  if (!band || !hardGate) return null;
  return {
    score: intIn(fm.fit_score_100, 100) ?? Object.values(filled).reduce((sum, value) => sum + value, 0),
    band,
    hardGate,
    gates: {
      employmentVisa: oneOf(fm.gate_employment_visa, HARD_GATE_VALUES),
      salary: oneOf(fm.gate_salary, HARD_GATE_VALUES),
      english: oneOf(fm.gate_english, HARD_GATE_VALUES),
      roleCenter: oneOf(fm.gate_role_center, HARD_GATE_VALUES),
      japaneseClient: oneOf(fm.gate_japanese_client, HARD_GATE_VALUES),
      original: oneOf(fm.gate_original, HARD_GATE_VALUES),
    },
    scores: filled,
    accessState: oneOf(fm.access_state, ACCESS_STATE_VALUES),
    salaryRangeClass: oneOf(fm.salary_range_class, SALARY_RANGE_CLASS_VALUES),
    roleFamily: oneOf(fm.role_family, ROLE_FAMILY_VALUES),
    primaryCohort: oneOf(fm.primary_cohort, PRIMARY_COHORT_VALUES),
  };
}

/** 卡片、抽屉、对比都用这一份派生数据，避免每处各解析一遍。 */
export type JobCard = {
  note: Note;
  path: string;
  company: string;
  caseId: string;
  origin: string;
  position: string;
  rating: number;
  /** rating が実際に書かれているか。false＝未採点（0点ではない）。 */
  rated: boolean;
  status: string;
  /**
   * status の括弧内注記。`status` は 7 枚举に正規化されるので、
   * 「募集終了で応募機会なし」のような**死因**はここにしか残らない。
   */
  statusNote: string;
  /** 最近一次状态变化日（frontmatter `status_updated`）。未応募的笔记通常没有。 */
  statusUpdated: string;
  /** 応募日（jobAppliedOn 参照）。未応募なら空。 */
  appliedOn: string;
  /** 実際の投递渠道（frontmatter `channel`）。応募済以降の状態はこれが必須（台帳が経路別に集計する）。 */
  channel: string;
  nextAction: string;
  waitingFor: string;
  followUpAt: string;
  nextEventAt: string;
  salaryText: string;
  /** v2 の salary_min/max が揃っていればそれ（vault:check が range_class と突き合わせ済み）、無ければ自由文 salary の解析。 */
  salary: SalaryRange;
  /** v2 採点。無ければ null（「未採点（v2）」であって 0 ではない）。 */
  fit: JobFit | null;
  location: string;
  regions: string[];
  remote: boolean;
  employment: string;
  source: string;
  /** normalizeJobSource(source)。筛选/facet 用这个，卡片详情仍显示 source 原文。 */
  sourceGroup: string;
  url: string;
  officialApplyUrl: string;
  officialApplyStatus: OfficialApplyStatus;
  officialApplyNote: string;
  /** 入库日（frontmatter `date`）＝ AI 推薦がキューに乗った日。応募日でも更新日でもない。 */
  date: string;
  stack: string[];
  reason: string;
  caution: string;
  matches: string[];
  materials: string[];
  verification: JobVerification;
  updatedAt: number;
  haystack: string;
};

// 看板・分析・首页・画像ヘッダーが同じノートを各自 toJobCard していた（stripMarkdown 全文込み）。
// Note オブジェクトは差し替え式（書込後は新しいオブジェクト）なので、オブジェクト単位で憶えれば古い値は残らない。
const cardCache = new WeakMap<Note, JobCard>();

export function toJobCard(note: Note): JobCard {
  const cached = cardCache.get(note);
  if (cached) return cached;
  const card = buildJobCard(note);
  cardCache.set(note, card);
  return card;
}

function buildJobCard(note: Note): JobCard {
  const company = getString(note.frontmatter.company) || getTitle(note).split(/\s[—–-]\s/)[0].trim();
  const position = jobPosition(note);
  const salaryText = getString(note.frontmatter.salary);
  const location = getString(note.frontmatter.location);
  const source = getString(note.frontmatter.source);
  const stack = jobStack(note);
  const reason =
    jobSection(note, JOB_CASE_SECTION.reason) || jobSection(note, JOB_CASE_SECTION.reasonAlias);
  const caution = jobSection(note, JOB_CASE_SECTION.caution);

  return {
    note,
    path: note.path,
    company,
    caseId: getString(note.frontmatter.case_id),
    origin: getString(note.frontmatter.origin),
    position,
    rating: jobRating(note),
    rated: jobRated(note),
    status: jobStatus(note),
    statusNote: jobStatusNote(getString(note.frontmatter.status)),
    statusUpdated: getString(note.frontmatter.status_updated),
    appliedOn: jobAppliedOn(note, getString(note.frontmatter.status)),
    channel: getString(note.frontmatter.channel),
    nextAction: getString(note.frontmatter.next_action),
    waitingFor: getString(note.frontmatter.waiting_for),
    followUpAt: getString(note.frontmatter.follow_up_at),
    nextEventAt: getString(note.frontmatter.next_event_at),
    salaryText,
    salary: structuredSalary(note) ?? parseSalary(salaryText),
    fit: jobFit(note),
    location,
    regions: jobRegions(location),
    remote: jobRemote(note),
    employment: getString(note.frontmatter.employment),
    source,
    sourceGroup: normalizeJobSource(source),
    url: getString(note.frontmatter.url),
    officialApplyUrl: getString(note.frontmatter.official_apply_url),
    officialApplyStatus: officialApplyStatus(note),
    officialApplyNote: getString(note.frontmatter.official_apply_note),
    date: getString(note.frontmatter.date),
    stack,
    reason,
    caution,
    matches: jobSectionItems(note, JOB_CASE_SECTION.matches),
    materials: jobSectionItems(note, JOB_CASE_SECTION.materials),
    verification: jobVerification(note),
    updatedAt: note.stat.mtime,
    haystack: [company, position, salaryText, location, source, stack.join(" "), stripMarkdown(note.content)]
      .join("\n")
      .toLowerCase(),
  };
}

export type JobSort = "rating" | "fit" | "salary" | "date" | "applied" | "updated" | "company";

export const JOB_SORTS: { id: JobSort; label: string }[] = [
  { id: "rating", label: "応募优先度" },
  { id: "fit", label: "v2 採点（Fit）" },
  { id: "salary", label: "年収上限" },
  { id: "date", label: "入库时间" },
  { id: "applied", label: "応募日（古い順）" },
  { id: "updated", label: "更新时间" },
  { id: "company", label: "公司名" },
];

export function compareJobs(left: JobCard, right: JobCard, sort: JobSort) {
  if (sort === "fit") {
    // 未採点（null）は最下位。0 点扱いにすると D バンドの案件と混ざる。
    const diff = (right.fit?.score ?? -1) - (left.fit?.score ?? -1);
    if (diff !== 0) return diff;
  } else if (sort === "salary") {
    const diff = (right.salary.max ?? -1) - (left.salary.max ?? -1);
    if (diff !== 0) return diff;
  } else if (sort === "date") {
    // 入库日（`date`）と更新时间（ファイル mtime）は別物。
    // 拒信一通で mtime は動くが入库日は動かない —— 「いつ入ってきたか」はこちらでしか出せない。
    const diff = intakeSortKey(right.date).localeCompare(intakeSortKey(left.date));
    if (diff !== 0) return diff;
  } else if (sort === "applied") {
    // 他の並びと違って**昇順**（古い応募が先頭）。この並びを使う理由は
    // 「どれが一番待たされているか」＝催促・見切りの判断で、新しい応募は当然まだ待つ時間ではない。
    // 応募日が分からない案件（書類通過以降で台帳に無いもの）は末尾へ。
    // 先頭に来ると「最も古い」が空欄で埋まり、この並びの意味が消える。
    const l = left.appliedOn || "9999-99-99";
    const r = right.appliedOn || "9999-99-99";
    const diff = l.localeCompare(r);
    if (diff !== 0) return diff;
  } else if (sort === "updated") {
    const diff = right.updatedAt - left.updatedAt;
    if (diff !== 0) return diff;
  } else if (sort === "company") {
    const diff = left.company.localeCompare(right.company, "ja");
    if (diff !== 0) return diff;
  }
  const byRating = right.rating - left.rating;
  if (byRating !== 0) return byRating;
  return left.company.localeCompare(right.company, "ja");
}

/** 搜索按空格切词后 AND 匹配，`公司名 kafka` 这类组合查询才有用。 */
export function jobMatchesQuery(job: JobCard, rawQuery: string) {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return true;
  return query.split(/\s+/).every((token) => job.haystack.includes(token));
}

/*
 * 下面几个是看板与公司画像头部共用的显示格式。原来只在 app/jobs-view.tsx 里，
 * 头部要用时复制了一份 shortDay——两份规则迟早漂移，所以搬到这里让两处 import 同一个。
 */

/** `800〜1200万` / `800万〜` / `…（月給換算）`。解析不出区间时退回笔记原文。 */
export function salaryLabel(job: Pick<JobCard, "salary" | "salaryText">) {
  const { min, max, estimated } = job.salary;
  if (min === null) return job.salaryText || "薪资未记录";
  const range = max !== null && max !== min ? `${min}〜${max}万` : `${min}万〜`;
  return estimated ? `${range}（月給換算）` : range;
}

/** バッジに出す文字。未採点は 0 ではなく「—」——「読んでいない」と「見込みなし」は別。 */
export function rateText(job: { rating: number; rated: boolean }) {
  return job.rated ? String(job.rating) : "—";
}

/** 応募优先度色阶：9+ 橙 / 7+ 绿 / 5+ 琥珀 / 其余灰。 */
export function rateTone(rating: number) {
  if (rating >= 9) return "high";
  if (rating >= 7) return "good";
  if (rating >= 5) return "mid";
  return "low";
}

/**
 * `2026-07-20` → `7/20`。年は今の運用（数か月単位）では邪魔なだけなので落とす。
 * 先頭が日付なら後ろに時刻が付いていてもよい（`2026-07-20 10:00` → `7/20`）。
 * 読めない時は `fallback`（既定＝原文）を返す——表では「—」、本文では原文をそのまま出したい。
 */
export function shortDay(day: string, fallback?: string) {
  const match = day.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\b|$)/);
  return match ? `${Number(match[2])}/${Number(match[3])}` : fallback ?? day;
}

/** 文中用の月日：`2026-08-02` → `8月2日`。表は shortDay、文は monthDay——書式は二つでも実装は一つずつ。 */
export function monthDay(day: string, fallback?: string) {
  const match = day.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\b|$)/);
  return match ? `${Number(match[2])}月${Number(match[3])}日` : fallback ?? day;
}

/** `target` まであと何日（未来が正、過去が負）。daysBetween の向きを逆にしただけ。 */
export function daysUntil(target: string, today: string): number | null {
  const days = daysBetween(target, today);
  return days === null ? null : -days;
}

/** 応募案件の状態→配色。7 状態と自定义値をこの 1 箇所で色に落とし、看板・首页・切換面板・画像ヘッダーが同じ表を読む。 */
export type JobStatusTone = "interview" | "progress" | "offer" | "pending" | "reject" | "neutral" | "meeting";

export function statusTone(status: string): JobStatusTone {
  if (status === "面接中") return "interview";
  if (status === "応募済" || status === "書類通過") return "progress";
  if (status === "内定") return "offer";
  if (status === "未応募") return "pending";
  if (status === "不採用") return "reject";
  return "neutral";
}

/**
 * 「已经动过手，但还没形成応募」的机会。
 *
 * Findy 的「いいかも」、媒体上的スカウト回信这类动作，本人做完了但企业没回应，
 * 求人票也没提交出去——按 7 枚举只能是 `未応募`。可是它和「还没看过的推荐」
 * 完全不是一回事：前者球在对方手里，本人现在做不了任何事。
 * 看板和首页都要用同一条规则把两者分开，否则「待判断」的数字两处对不上。
 */
export function awaitingCounterpart(job: Pick<JobCard, "status" | "waitingFor">) {
  return job.status === "未応募" && Boolean(job.waitingFor) && job.waitingFor !== "self";
}

/**
 * 応募からの経過。**「何日待っているか」は催促の判断に直結する**ので、
 * 相対表示だけにして絶対日付は title に回す（一覧をスキャンしている時に効くのは日数のほう）。
 */
export function elapsedLabel(appliedOn: string, today: string) {
  const days = daysBetween(appliedOn, today);
  if (days === null) return "";
  if (days <= 0) return "今日";
  return `${days}日経過`;
}

/** 案件如何进入 vault 的显示词。看板卡片、详情抽屉、公司画像头部共用，别再各写一份。 */
export const JOB_ORIGIN_LABEL: Record<string, string> = {
  "ai-reco": "AI 发现",
  manual: "本人录入",
  agent: "中介推荐",
  scout: "Scout",
  legacy: "历史导入",
  "ra-batch": "RA 批量投递",
};

/** waiting_for 的显示词（球在谁手里）。看板的下拉选项与公司画像头部共用。 */
export const WAITING_FOR_LABEL: Record<string, string> = {
  self: "本人",
  company: "企业",
  agent: "中介",
  platform: "平台",
};
