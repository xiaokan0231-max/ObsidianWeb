import { getString, noteBasename, stripFrontmatter, type Note } from "./notes.ts";
import type { ReadModelRecord } from "./read-model.ts";

/*
 * 大学院专区的解析、校验与查询投影。
 *
 * 学校卷宗是 Vault 正本：路线、期限和学费写在 frontmatter，说明文字写在正文。
 * 页面、D1 投影和 vault:check 共用这里的同一套规则——字段一旦在一处被放宽，
 * 另一处就会把坏日期静默显示成「无期限」，招生截止被漏看的代价远大于报一次错。
 */

export const GRADUATE_SCHOOL_TYPE = "graduate-school";
export const GRADUATE_PREP_TYPE = "graduate-prep";
export const GRADUATE_REFERENCE_TYPE = "graduate-reference";
export const GRADUATE_RECORD_KIND = "graduate-catalog";
export const GRADUATE_TRACKS = ["master", "bachelor"] as const;
export const GRADUATE_TRACK_FILTERS = ["master", "bachelor", "all"] as const;
export const GRADUATE_STEP_KINDS = ["prerequisite", "application", "exam", "result", "enrollment"] as const;
export const GRADUATE_DEADLINE_TYPES = ["必着", "消印有効", "期限内必着"] as const;
export const GRADUATE_INDICATOR_KINDS = ["ranking", "deviation", "employment"] as const;
/** 正文里每条路线下的固定小节；页面按这几个名字取说明文字。 */
export const GRADUATE_ROUTE_SECTIONS = ["出愿资格与匹配", "出愿与材料", "学位与费用", "考试与备考"] as const;

export type GraduateTrack = typeof GRADUATE_TRACKS[number];
export type GraduateTrackFilter = typeof GRADUATE_TRACK_FILTERS[number];
export type GraduateStepKind = typeof GRADUATE_STEP_KINDS[number];
export type GraduateDeadlineType = typeof GRADUATE_DEADLINE_TYPES[number];
export type GraduateIndicatorKind = typeof GRADUATE_INDICATOR_KINDS[number];

export type GraduateLink = { label: string; url?: string };
export type GraduateStep = {
  id: string;
  kind: GraduateStepKind;
  label: string;
  round?: string;
  start?: string;
  due?: string;
  on?: string;
  deadlineType?: GraduateDeadlineType;
  optional?: boolean;
  doneOn?: string;
  method?: string;
  note?: string;
  url?: string;
  materials: GraduateLink[];
};
export type GraduateFees = { firstYear: number; annual: number; basis: string; url?: string };
export type GraduateRoute = {
  id: string;
  label: string;
  labelZh: string;
  track: GraduateTrack;
  degree: string;
  years: number;
  entry: string;
  exams: string[];
  fees: GraduateFees;
  /** 备考笔记的双链目标（不含方括号）；路径在投影阶段解析。 */
  prep?: string;
  steps: GraduateStep[];
};
export type GraduateIndicator = { kind: GraduateIndicatorKind; label: string; value: string; scope: string; url?: string };
/** 学校是什么性质、多大、多老：帮助没有日本升学经验的人先建立概念。 */
export type GraduateProfile = { kind: string; founded: string; size: string; url?: string };
/** 河合塾ボーダー偏差値：focus 是与路线最接近的学部，school 是全校各学部的范围。 */
export type GraduateLevel = { focus: string; focusLow: number; focusHigh: number; schoolLow: number; schoolHigh: number; url?: string };
export type GraduateSchool = {
  path: string;
  id: string;
  name: string;
  nameZh: string;
  sort: number;
  checkedOn: string;
  location: string;
  profile?: GraduateProfile;
  level?: GraduateLevel;
  indicators: GraduateIndicator[];
  routes: GraduateRoute[];
};
export type GraduateBand = { min: number; label: string; analogy: string };
export type GraduateAnchor = { name: string; note: string; low: number; high: number; url?: string };
/** 层次对照：参照校的偏差值是事实，档位与国内批次的类比是署名的 AI 判断。 */
export type GraduateReference = {
  path: string; checkedOn: string; sourceLabel: string; sourceUrl?: string; analogyAuthor: string;
  bands: GraduateBand[]; anchors: GraduateAnchor[]; notes: string[];
};

/** 目录只带比较和算期限要用的字段；材料链接、说明和出处随学校正文按需读取。 */
export type GraduateCatalogStep = Pick<GraduateStep, "id" | "kind" | "label" | "round" | "start" | "due" | "on" | "deadlineType" | "optional" | "doneOn">;
export type GraduateCatalogRoute = Pick<GraduateRoute, "id" | "label" | "labelZh" | "track" | "degree" | "years" | "entry" | "exams"> & {
  fees: Pick<GraduateFees, "firstYear" | "annual">;
  prepPath: string | null;
  steps: GraduateCatalogStep[];
};
export type GraduateCatalogSchool = Pick<GraduateSchool, "path" | "id" | "name" | "nameZh" | "sort" | "checkedOn" | "level"> & { routes: GraduateCatalogRoute[] };
export type GraduateIssue = { path: string; message: string };
export type GraduateCatalog = { schemaVersion: 1; schools: GraduateCatalogSchool[]; reference: GraduateReference | null; issues: GraduateIssue[] };
export type GraduateCatalogPage = GraduateCatalog & {
  syncState?: "ready" | "building" | "failed";
  revision: string;
  today: string;
  /** 资料版本早于大学院投影时为 false：不能把「索引里还没有」显示成「没有候选学校」。 */
  indexed: boolean;
  sourceUpdatedAt: number;
  indexedAt: number;
};

export function emptyGraduateCatalog(): GraduateCatalog {
  return { schemaVersion: 1, schools: [], reference: null, issues: [] };
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown) {
  return getString(value).trim();
}

/** YAML 写法不同的解析器可能把日期读成 Date；统一回到 JST 日历日字符串再校验。 */
export function graduateDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const raw = text(value);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]) ? raw : null;
}

function optionalDate(value: unknown, field: string, where: string, issues: string[]) {
  if (value === undefined || value === null || value === "") return undefined;
  const date = graduateDate(value);
  if (!date) issues.push(`${where} の ${field} は "YYYY-MM-DD" の実在日付にする（今: ${text(value) || String(value)}）`);
  return date ?? undefined;
}

function optionalUrl(value: unknown, where: string, issues: string[]) {
  const url = text(value);
  if (!url) return undefined;
  if (!/^https?:\/\//.test(url)) issues.push(`${where} の url は http(s):// で始める（今: ${url}）`);
  return url;
}

function wikiTarget(value: unknown) {
  const raw = text(value);
  const match = raw.match(/^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]$/);
  return match ? match[1].trim() : raw || undefined;
}

function parseStep(value: unknown, where: string, issues: string[]): GraduateStep | null {
  const source = record(value);
  if (!source) { issues.push(`${where} が対象（id・kind・label を持つ項目）になっていない`); return null; }
  const id = text(source.id), label = text(source.label), kind = text(source.kind) as GraduateStepKind;
  if (!ID_PATTERN.test(id)) issues.push(`${where} の id は英小文字・数字・ハイフンにする（今: ${id || "空"}）`);
  if (!label) issues.push(`${where} に label が無い`);
  if (!GRADUATE_STEP_KINDS.includes(kind)) issues.push(`${where} の kind は ${GRADUATE_STEP_KINDS.join(" / ")} のいずれか（今: ${kind || "空"}）`);
  const at = `${where}（${id || label}）`;
  const start = optionalDate(source.start, "start", at, issues);
  const due = optionalDate(source.due, "due", at, issues);
  const on = optionalDate(source.on, "on", at, issues);
  const doneOn = optionalDate(source.done_on, "done_on", at, issues);
  if (start && due && start > due) issues.push(`${at} の start ${start} が due ${due} より後`);
  const deadlineRaw = text(source.deadline_type);
  const deadlineType = deadlineRaw ? deadlineRaw as GraduateDeadlineType : undefined;
  if (deadlineType && !GRADUATE_DEADLINE_TYPES.includes(deadlineType)) issues.push(`${at} の deadline_type は ${GRADUATE_DEADLINE_TYPES.join(" / ")} のいずれか（今: ${deadlineRaw}）`);
  // 必着と消印有効は締切の意味が一日以上ずれる。期限付きの手続きで種別を省くと、郵送の判断を誤る。
  if (due && !deadlineType && (kind === "prerequisite" || kind === "application")) issues.push(`${at} に due があるのに deadline_type（必着・消印有効など）が無い`);
  const materials: GraduateLink[] = [];
  if (source.materials !== undefined && !Array.isArray(source.materials)) issues.push(`${at} の materials は配列にする`);
  for (const [index, item] of (Array.isArray(source.materials) ? source.materials : []).entries()) {
    const material = record(item);
    const materialLabel = text(material?.label);
    if (!materialLabel) { issues.push(`${at} の materials[${index}] に label が無い`); continue; }
    const url = optionalUrl(material?.url, `${at} の materials[${index}]`, issues);
    materials.push(url ? { label: materialLabel, url } : { label: materialLabel });
  }
  return {
    id, kind, label, materials,
    ...(text(source.round) ? { round: text(source.round) } : {}),
    ...(start ? { start } : {}), ...(due ? { due } : {}), ...(on ? { on } : {}),
    ...(deadlineType && GRADUATE_DEADLINE_TYPES.includes(deadlineType) ? { deadlineType } : {}),
    ...(source.optional === true || source.optional === "true" ? { optional: true } : {}),
    ...(doneOn ? { doneOn } : {}),
    ...(text(source.method) ? { method: text(source.method) } : {}),
    ...(text(source.note) ? { note: text(source.note) } : {}),
    ...(optionalUrl(source.url, at, issues) ? { url: text(source.url) } : {}),
  };
}

/** 河合塾按 2.5 一档公布，最低显示 35.0（=37.4 以下）、最高 72.5。不在刻度上的数多半是手抄错。 */
function deviation(value: unknown, where: string, issues: string[]) {
  const number = typeof value === "number" ? value : Number(text(value));
  if (!Number.isFinite(number) || number < 35 || number > 72.5 || Math.round(number * 2) % 5 !== 0) {
    issues.push(`${where} は河合塾の偏差値帯（35.0〜72.5、2.5 刻み）にする（今: ${text(value) || "空"}）`);
    return null;
  }
  return number;
}

function parseLevel(value: unknown, issues: string[]): GraduateLevel | undefined {
  if (value === undefined) return undefined;
  const source = record(value);
  if (!source) { issues.push("level は対象（focus・focus_low・focus_high・school_low・school_high）にする"); return undefined; }
  const focus = text(source.focus);
  if (!focus) issues.push("level.focus に比べる学部を書く");
  const focusLow = deviation(source.focus_low, "level.focus_low", issues), focusHigh = deviation(source.focus_high, "level.focus_high", issues);
  const schoolLow = deviation(source.school_low, "level.school_low", issues), schoolHigh = deviation(source.school_high, "level.school_high", issues);
  if (focusLow === null || focusHigh === null || schoolLow === null || schoolHigh === null) return undefined;
  if (focusLow > focusHigh || schoolLow > schoolHigh) issues.push("level の low が high より大きい");
  if (focusLow < schoolLow || focusHigh > schoolHigh) issues.push("level.focus の範囲が school の範囲を超えている");
  const url = optionalUrl(source.url, "level", issues);
  return { focus, focusLow, focusHigh, schoolLow, schoolHigh, ...(url ? { url } : {}) };
}

function parseProfile(value: unknown, issues: string[]): GraduateProfile | undefined {
  if (value === undefined) return undefined;
  const source = record(value);
  const kind = text(source?.kind), founded = text(source?.founded), size = text(source?.size);
  if (!kind || !founded || !size) { issues.push("profile は kind・founded・size が必須"); return undefined; }
  const url = optionalUrl(source?.url, "profile", issues);
  return { kind, founded, size, ...(url ? { url } : {}) };
}

function integerYen(value: unknown) {
  const number = typeof value === "number" ? value : Number(text(value));
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function parseRoute(value: unknown, index: number, issues: string[]): GraduateRoute | null {
  const source = record(value);
  const where = `routes[${index}]`;
  if (!source) { issues.push(`${where} が対象になっていない`); return null; }
  const id = text(source.id), label = text(source.label), track = text(source.track) as GraduateTrack;
  if (!ID_PATTERN.test(id)) issues.push(`${where} の id は英小文字・数字・ハイフンにする（今: ${id || "空"}）`);
  if (!label) issues.push(`${where} に label が無い（正文の ## 見出しと一致させる）`);
  if (!GRADUATE_TRACKS.includes(track)) issues.push(`${where} の track は master / bachelor（今: ${track || "空"}）`);
  const years = typeof source.years === "number" ? source.years : Number(text(source.years));
  if (!Number.isInteger(years) || years < 1 || years > 6) issues.push(`${where} の years は 1〜6 の整数（今: ${text(source.years) || "空"}）`);
  const fees = record(source.fees);
  const firstYear = integerYen(fees?.first_year), annual = integerYen(fees?.annual);
  // 合計は画面で計算する。円の整数でない値は「概算の手書き」と区別できなくなる。
  if (firstYear === null) issues.push(`${where} の fees.first_year は円の整数`);
  if (annual === null) issues.push(`${where} の fees.annual は円の整数`);
  const exams = Array.isArray(source.exams) ? source.exams.map(text).filter(Boolean) : [];
  if (!Array.isArray(source.steps) || source.steps.length === 0) issues.push(`${where} に steps が無い`);
  const steps = (Array.isArray(source.steps) ? source.steps : []).map((step, stepIndex) => parseStep(step, `${where}.steps[${stepIndex}]`, issues)).filter((step): step is GraduateStep => Boolean(step));
  const seen = new Set<string>();
  for (const step of steps) {
    if (seen.has(step.id)) issues.push(`${where} の steps に id「${step.id}」が重複`);
    seen.add(step.id);
  }
  const prep = wikiTarget(source.prep);
  const feesUrl = optionalUrl(fees?.url, `${where}.fees`, issues);
  return {
    id, label, labelZh: text(source.label_zh) || label, track, degree: text(source.degree), years, entry: text(source.entry), exams,
    fees: { firstYear: firstYear ?? 0, annual: annual ?? 0, basis: text(fees?.basis), ...(feesUrl ? { url: feesUrl } : {}) },
    ...(prep ? { prep } : {}), steps,
  };
}

/** 学校卷宗 → 结构化数据和问题清单。问题不为空时不能进入候选表。 */
export function parseGraduateSchool(note: Note): { school: GraduateSchool | null; issues: string[] } {
  const frontmatter = note.frontmatter ?? {};
  const issues: string[] = [];
  if (text(frontmatter.type) !== GRADUATE_SCHOOL_TYPE) return { school: null, issues: [`type が ${GRADUATE_SCHOOL_TYPE} ではない`] };
  // 学费・个人适合度判断都只属于本机；漏标一篇就会进公开快照。
  if (frontmatter.publish !== false && frontmatter.publish !== "false") issues.push("publish: false が必須（大学院資料は公開スナップショットに入れない）");
  const id = text(frontmatter.school_id), name = text(frontmatter.school);
  if (!ID_PATTERN.test(id)) issues.push(`school_id は英小文字・数字・ハイフンにする（今: ${id || "空"}）`);
  if (!name) issues.push("school が無い");
  const checkedOn = graduateDate(frontmatter.checked_on);
  if (!checkedOn) issues.push(`checked_on は "YYYY-MM-DD"（今: ${text(frontmatter.checked_on) || "空"}）`);
  const sortValue = typeof frontmatter.sort === "number" ? frontmatter.sort : Number(text(frontmatter.sort) || "99");
  const indicators: GraduateIndicator[] = [];
  for (const [index, item] of (Array.isArray(frontmatter.indicators) ? frontmatter.indicators : []).entries()) {
    const source = record(item);
    const kind = text(source?.kind) as GraduateIndicatorKind;
    const where = `indicators[${index}]`;
    if (!GRADUATE_INDICATOR_KINDS.includes(kind)) { issues.push(`${where} の kind は ${GRADUATE_INDICATOR_KINDS.join(" / ")} のいずれか`); continue; }
    const label = text(source?.label), value = text(source?.value), scope = text(source?.scope);
    // 排名・偏差値・就職は口径がないと比較できない。年・対象・分母を書かせる。
    if (!label || !value || !scope) { issues.push(`${where} は label・value・scope（年・対象・分母などの口径）が必須`); continue; }
    const url = optionalUrl(source?.url, where, issues);
    indicators.push({ kind, label, value, scope, ...(url ? { url } : {}) });
  }
  if (!Array.isArray(frontmatter.routes) || frontmatter.routes.length === 0) issues.push("routes が無い");
  const routes = (Array.isArray(frontmatter.routes) ? frontmatter.routes : []).map((route, index) => parseRoute(route, index, issues)).filter((route): route is GraduateRoute => Boolean(route));
  const routeIds = new Set<string>();
  for (const route of routes) {
    if (routeIds.has(route.id)) issues.push(`routes の id「${route.id}」が重複`);
    routeIds.add(route.id);
  }
  const profile = parseProfile(frontmatter.profile, issues);
  const level = parseLevel(frontmatter.level, issues);
  const school: GraduateSchool = {
    path: note.path, id, name, nameZh: text(frontmatter.school_zh) || name,
    sort: Number.isFinite(sortValue) ? sortValue : 99, checkedOn: checkedOn ?? "", location: text(frontmatter.location),
    ...(profile ? { profile } : {}), ...(level ? { level } : {}), indicators, routes,
  };
  return { school: issues.length ? null : school, issues };
}

/** 备考笔记只校验能否回到学校卷宗；正文是自由书写的阅读材料。 */
export function graduatePrepIssues(note: Note) {
  const issues: string[] = [];
  if (note.frontmatter.publish !== false && note.frontmatter.publish !== "false") issues.push("publish: false が必須（大学院資料は公開スナップショットに入れない）");
  if (!ID_PATTERN.test(text(note.frontmatter.route))) issues.push("route に対象路線の id を書く");
  if (!wikiTarget(note.frontmatter.source_note)) issues.push("source_note に学校卷宗への双链を書く");
  return issues;
}

/** 层次对照笔记：档位从高到低、参照校偏差值必须在河合塾刻度上。 */
export function parseGraduateReference(note: Note): { reference: GraduateReference | null; issues: string[] } {
  const frontmatter = note.frontmatter ?? {};
  const issues: string[] = [];
  if (frontmatter.publish !== false && frontmatter.publish !== "false") issues.push("publish: false が必須（大学院資料は公開スナップショットに入れない）");
  const checkedOn = graduateDate(frontmatter.checked_on);
  if (!checkedOn) issues.push(`checked_on は "YYYY-MM-DD"（今: ${text(frontmatter.checked_on) || "空"}）`);
  const analogyAuthor = text(frontmatter.analogy_author);
  // 与国内批次的对应没有官方口径，必须看得出是谁的判断。
  if (!analogyAuthor || analogyAuthor === "AI") issues.push("analogy_author に類比を書いた AI の具体名（Claude / Codex など）を書く");
  const bands: GraduateBand[] = [];
  for (const [index, item] of (Array.isArray(frontmatter.bands) ? frontmatter.bands : []).entries()) {
    const source = record(item);
    const min = deviation(source?.min, `bands[${index}].min`, issues), label = text(source?.label), analogy = text(source?.analogy);
    if (!label || !analogy) { issues.push(`bands[${index}] は label・analogy が必須`); continue; }
    if (min !== null) bands.push({ min, label, analogy });
  }
  if (!bands.length) issues.push("bands が無い");
  if (bands.some((band, index) => index > 0 && band.min >= bands[index - 1].min)) issues.push("bands は min の高い順に並べる");
  if (bands.length && bands.at(-1)!.min !== 35) issues.push("最後の band の min は 35（最低帯）にする");
  const anchors: GraduateAnchor[] = [];
  for (const [index, item] of (Array.isArray(frontmatter.anchors) ? frontmatter.anchors : []).entries()) {
    const source = record(item);
    const name = text(source?.name), anchorNote = text(source?.note);
    const low = deviation(source?.low, `anchors[${index}].low`, issues), high = deviation(source?.high, `anchors[${index}].high`, issues);
    if (!name) { issues.push(`anchors[${index}] に name が無い`); continue; }
    if (low === null || high === null) continue;
    if (low > high) issues.push(`anchors[${index}]（${name}）の low が high より大きい`);
    const url = optionalUrl(source?.url, `anchors[${index}]`, issues);
    anchors.push({ name, note: anchorNote, low, high, ...(url ? { url } : {}) });
  }
  const notes = Array.isArray(frontmatter.notes) ? frontmatter.notes.map(text).filter(Boolean) : [];
  const sourceUrl = optionalUrl(frontmatter.source_url, "source_url", issues);
  const reference: GraduateReference = { path: note.path, checkedOn: checkedOn ?? "", sourceLabel: text(frontmatter.source_label), ...(sourceUrl ? { sourceUrl } : {}),
    analogyAuthor, bands, anchors, notes };
  return { reference: issues.length ? null : reference, issues };
}

/** 偏差值落在哪一档：档位按 min 从高到低，取第一个不高于该值的。 */
export function graduateBand(bands: readonly GraduateBand[], value: number) {
  return bands.find((band) => value >= band.min) ?? null;
}

/** 河合塾把 37.4 以下统一显示成 35.0；页面照录数字，但说清它是「最低一档」。 */
export function graduateDeviationRange(low: number, high: number) {
  return low === high ? low.toFixed(1) : `${low.toFixed(1)}–${high.toFixed(1)}`;
}

function catalogStep(step: GraduateStep): GraduateCatalogStep {
  const { id, kind, label, round, start, due, on, deadlineType, optional, doneOn } = step;
  return { id, kind, label, ...(round ? { round } : {}), ...(start ? { start } : {}), ...(due ? { due } : {}), ...(on ? { on } : {}),
    ...(deadlineType ? { deadlineType } : {}), ...(optional ? { optional } : {}), ...(doneOn ? { doneOn } : {}) };
}

function resolvePrepPath(target: string | undefined, notes: Note[]) {
  if (!target) return null;
  const key = target.replace(/\.md$/i, "");
  const matches = notes.filter((note) => note.frontmatter.type === GRADUATE_PREP_TYPE
    && (note.path.replace(/\.md$/i, "") === key || noteBasename(note.path) === key));
  return matches.length === 1 ? matches[0].path : null;
}

/** 候选表投影：一份目录记录，按 sort 与文件路径固定顺序。 */
export function buildGraduateCatalog(notes: Note[]): GraduateCatalog {
  const issues: GraduateIssue[] = [];
  const schools: GraduateCatalogSchool[] = [];
  const schoolIds = new Map<string, string>(), routeIds = new Map<string, string>();
  let reference: GraduateReference | null = null;
  for (const note of notes) {
    if (note.frontmatter?.type === GRADUATE_REFERENCE_TYPE) {
      const parsed = parseGraduateReference(note);
      for (const message of parsed.issues) issues.push({ path: note.path, message });
      // 对照表全库只认一份：两份并存时页面无法判断该用哪套档位。
      if (parsed.reference && reference) issues.push({ path: note.path, message: `graduate-reference は全庫で1件だけ（既に ${reference.path}）` });
      else if (parsed.reference) reference = parsed.reference;
      continue;
    }
    if (note.frontmatter?.type === GRADUATE_PREP_TYPE) {
      for (const message of graduatePrepIssues(note)) issues.push({ path: note.path, message });
      continue;
    }
    if (note.frontmatter?.type !== GRADUATE_SCHOOL_TYPE) continue;
    const parsed = parseGraduateSchool(note);
    if (!parsed.school) { for (const message of parsed.issues) issues.push({ path: note.path, message }); continue; }
    const school = parsed.school;
    // 稳定链接按 id 定位；同 id 两份时宁可都报错，也不能让链接悄悄指到另一所学校。
    const duplicateSchool = schoolIds.get(school.id);
    if (duplicateSchool) { issues.push({ path: note.path, message: `school_id「${school.id}」が ${duplicateSchool} と重複` }); continue; }
    schoolIds.set(school.id, note.path);
    const routes: GraduateCatalogRoute[] = [];
    for (const route of school.routes) {
      const duplicateRoute = routeIds.get(route.id);
      if (duplicateRoute) { issues.push({ path: note.path, message: `路線 id「${route.id}」が ${duplicateRoute} と重複` }); continue; }
      routeIds.set(route.id, note.path);
      const prepPath = resolvePrepPath(route.prep, notes);
      if (route.prep && !prepPath) issues.push({ path: note.path, message: `${route.id} の prep [[${route.prep}]] が備考ノートに解決できない` });
      routes.push({ id: route.id, label: route.label, labelZh: route.labelZh, track: route.track, degree: route.degree, years: route.years, entry: route.entry, exams: route.exams,
        fees: { firstYear: route.fees.firstYear, annual: route.fees.annual }, prepPath, steps: route.steps.map(catalogStep) });
    }
    schools.push({ path: school.path, id: school.id, name: school.name, nameZh: school.nameZh, sort: school.sort, checkedOn: school.checkedOn,
      ...(school.level ? { level: school.level } : {}), routes });
  }
  schools.sort((left, right) => left.sort - right.sort || left.path.localeCompare(right.path));
  return { schemaVersion: 1, schools, reference, issues };
}

export function buildGraduateReadModelRecords(notes: Note[]): ReadModelRecord[] {
  return [{ kind: GRADUATE_RECORD_KIND, key: "root", value: buildGraduateCatalog(notes) }];
}

/** 毕业前预计合计：首年＋之后每年×剩余年数。正本只存整数日元，合计永远由这里算。 */
export function graduateTotalFee(route: Pick<GraduateRoute, "years"> & { fees: Pick<GraduateFees, "firstYear" | "annual"> }) {
  return route.fees.firstYear + route.fees.annual * Math.max(0, route.years - 1);
}

/** 万日元保留一位小数，用于并排比较；明细仍按整数日元显示。 */
export function graduateManYen(yen: number) {
  return (Math.round(yen / 1000) / 10).toFixed(1);
}

export function graduateDaysUntil(date: string, today: string) {
  return Math.round((Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) - Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10))) / 86_400_000);
}

const ACTIONABLE: ReadonlySet<GraduateStepKind> = new Set(["prerequisite", "application"]);

/** 下一道截止：还没办、日期未过的前置手续或出愿。同一天按正本顺序。 */
export function nextGraduateDeadline<T extends GraduateCatalogStep>(steps: readonly T[], today: string): T | null {
  return steps.filter((step) => ACTIONABLE.has(step.kind) && step.due && !step.doneOn && step.due >= today)
    .sort((left, right) => left.due!.localeCompare(right.due!))[0] ?? null;
}

/** 期限已过却没有完成记录的必需前置手续。可选步骤（建议做的确认）过期不算缺口。 */
export function overdueGraduatePrerequisites<T extends GraduateCatalogStep>(steps: readonly T[], today: string): T[] {
  return steps.filter((step) => step.kind === "prerequisite" && !step.optional && step.due && step.due < today && !step.doneOn);
}

/** 没有截止可追时，退而显示下一项考试、发表或缴费日程。 */
export function nextGraduateEvent<T extends GraduateCatalogStep>(steps: readonly T[], today: string): T | null {
  return steps.filter((step) => !step.doneOn && (step.on ?? step.due ?? "") >= today && (step.on || step.due))
    .sort((left, right) => (left.on ?? left.due)!.localeCompare((right.on ?? right.due)!))[0] ?? null;
}

export type GraduateStepState = "done" | "closed" | "open" | "upcoming" | "undated";

/** 时间轴上每一步的状态；日期一律按 JST 日历日比较。 */
export function graduateStepState(step: GraduateCatalogStep, today: string): GraduateStepState {
  if (step.doneOn) return "done";
  const end = step.due ?? step.on;
  if (!end) return "undated";
  if (end < today) return "closed";
  if (step.start) return step.start <= today ? "open" : "upcoming";
  // 只写截止日的前置手续和出愿，截止前随时可办；考试、发表、缴费要等到当天或开始日。
  if (!step.on && ACTIONABLE.has(step.kind)) return "open";
  return (step.on ?? step.due)! <= today ? "open" : "upcoming";
}

export type GraduateCatalogEntry = { school: GraduateCatalogSchool; route: GraduateCatalogRoute };

/** 候选表的行：按学校 sort，再按正本里路线的顺序。 */
export function graduateCatalogEntries(catalog: Pick<GraduateCatalog, "schools">, track: GraduateTrackFilter): GraduateCatalogEntry[] {
  return catalog.schools.flatMap((school) => school.routes.filter((route) => track === "all" || route.track === track).map((route) => ({ school, route })));
}

export type GraduateNoteSections = { school: Map<string, string>; routes: Map<string, Map<string, string>> };

/**
 * 正文按「## 二级标题」切块：与某条路线 label 相同的块再按「### 三级标题」切成小节，其余块属于学校。
 * 只按标题行切，不改写正文，阅读器拿到的仍是作者写下的 Markdown。
 */
export function graduateNoteSections(content: string, routeLabels: readonly string[]): GraduateNoteSections {
  const school = new Map<string, string>(), routes = new Map<string, Map<string, string>>();
  const labels = new Set(routeLabels);
  let fence = false;
  // 第一个二级标题之前是导语（核对日、署名说明），以空键保存；一级标题本身不重复显示。
  const blocks: { heading: string; lines: string[] }[] = [{ heading: "", lines: [] }];
  for (const line of stripFrontmatter(content).split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const heading = !fence && line.match(/^##\s+(.+?)\s*#*\s*$/);
    if (heading) { blocks.push({ heading: heading[1], lines: [] }); continue; }
    if (!fence && blocks.length === 1 && /^#\s/.test(line)) continue;
    blocks.at(-1)!.lines.push(line);
  }
  for (const block of blocks) {
    if (!labels.has(block.heading)) { school.set(block.heading, block.lines.join("\n").trim()); continue; }
    const sections = new Map<string, string>();
    let current = "", buffer: string[] = [], innerFence = false;
    const flush = () => { if (current) sections.set(current, buffer.join("\n").trim()); };
    for (const line of block.lines) {
      if (/^\s*(```|~~~)/.test(line)) innerFence = !innerFence;
      const sub = !innerFence && line.match(/^###\s+(.+?)\s*#*\s*$/);
      if (sub) { flush(); current = sub[1]; buffer = []; continue; }
      buffer.push(line);
    }
    flush();
    routes.set(block.heading, sections);
  }
  return { school, routes };
}

export type GraduateLocation = { track: GraduateTrackFilter; school: string; route: string };

/** 稳定链接：/graduate?track=…&school=…&route=…。修士是首页默认，不写进地址，链接保持最短。 */
export function graduateLocationFromSearch(search: string): GraduateLocation {
  const params = new URLSearchParams(search);
  const track = params.get("track");
  return {
    track: GRADUATE_TRACK_FILTERS.includes(track as GraduateTrackFilter) ? track as GraduateTrackFilter : "master",
    school: ID_PATTERN.test(params.get("school") ?? "") ? params.get("school")! : "",
    route: ID_PATTERN.test(params.get("route") ?? "") ? params.get("route")! : "",
  };
}

/** 只改本区的三个键，外壳的 note 等参数原样保留（关原笔记时要回到同一位置）。 */
export function graduateSearch(location: GraduateLocation, current = "") {
  const params = new URLSearchParams(current);
  for (const key of ["track", "school", "route"]) params.delete(key);
  if (location.track !== "master") params.set("track", location.track);
  if (location.school) params.set("school", location.school);
  if (location.school && location.route) params.set("route", location.route);
  return params;
}

const WEEKDAYS = { "zh-CN": ["日", "一", "二", "三", "四", "五", "六"], ja: ["日", "月", "火", "水", "木", "金", "土"] } as const;

/** 2026-11-30 → 「2026/11/30（一）」；同一年省略年份。日期本身已是 JST 日历日，不再换算时区。 */
export function graduateDateLabel(date: string, locale: "zh-CN" | "ja", today?: string) {
  const day = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10))).getUTCDay();
  const body = `${today && today.slice(0, 4) === date.slice(0, 4) ? "" : `${date.slice(0, 4)}/`}${+date.slice(5, 7)}/${+date.slice(8, 10)}`;
  return `${body}（${WEEKDAYS[locale][day]}）`;
}
