import { basename } from "node:path";
import { bankContentFingerprint } from "./language-bank-fingerprint.mjs";
import { stableId } from "./dojo/utils.ts";

const CURRICULUM_START = "<!-- language-curriculum-json:start -->";
const CURRICULUM_END = "<!-- language-curriculum-json:end -->";
const BANK_START = "<!-- language-bank-json:start -->";
const BANK_END = "<!-- language-bank-json:end -->";
const BATCH_START = "<!-- language-batch-json:start -->";
const BATCH_END = "<!-- language-batch-json:end -->";

const REPORT_SOURCE_TYPES = new Set(["self", "policy", "job-case", "material", "moc"]);

export const GENERATED_LIFECYCLES = ["current", "superseded", "historical"];

export function markerJson(content, start, end) {
  const from = content.indexOf(start);
  const to = content.indexOf(end, from + start.length);
  if (from < 0 || to < 0) return null;
  const block = content.slice(from + start.length, to);
  const raw = block.match(/```json\s*([\s\S]*?)```/u)?.[1]?.trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function applyCompactFrontmatter(content, fields) {
  const matched = content.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/u);
  if (!matched) throw new Error("没有 frontmatter，无法安全更新生成物元数据");
  const lines = matched[1].split(/\r?\n/u);
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === "") continue;
    const rendered = `${key}: ${value}`;
    const index = lines.findIndex((line) => line.startsWith(`${key}:`));
    if (index >= 0) lines[index] = rendered;
    else lines.push(rendered);
  }
  return `---\n${lines.join("\n")}\n---${matched[2] || "\n"}${content.slice(matched[0].length)}`;
}

function noteName(path) {
  return basename(path).replace(/\.md$/iu, "");
}

export function wikiTargets(content) {
  const body = content
    .replace(/^---\r?\n[\s\S]*?\r?\n---/u, " ")
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/`[^`\n]*`/gu, " ")
    .replace(/<!--([\s\S]*?)-->/gu, " ");
  return Array.from(body.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/gu), (match) => match[1].trim());
}

function noteDate(note) {
  const value = String(note.frontmatter.date ?? note.frontmatter.generated_at ?? "").slice(0, 10);
  return /^20\d{2}-\d{2}-\d{2}$/u.test(value)
    ? value
    : note.relativePath.match(/(20\d{2}-\d{2}-\d{2})/u)?.[1] ?? "";
}

function ageDays(date, now) {
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? 0 : Math.floor((now.getTime() - parsed.getTime()) / 86_400_000);
}

function activeBatchFingerprints(notes) {
  const fingerprints = new Set();
  for (const note of notes) {
    if (note.frontmatter.type !== "language-batch-log") continue;
    const batch = markerJson(note.content, BATCH_START, BATCH_END);
    if (!batch || batch.phase === "completed" || note.frontmatter.status === "completed") continue;
    if (batch.curriculumFingerprint) fingerprints.add(String(batch.curriculumFingerprint));
  }
  return fingerprints;
}

function strongReportBacklinks(notes) {
  const backlinks = new Set();
  for (const source of notes) {
    if (!REPORT_SOURCE_TYPES.has(String(source.frontmatter.type ?? ""))) continue;
    if (source.frontmatter.type === "policy" && source.frontmatter.lifecycle !== "current") continue;
    for (const target of wikiTargets(source.content)) backlinks.add(noteName(target));
  }
  return backlinks;
}

function artifactUpdate(lifecycle, sourceFingerprint, contentFingerprint) {
  return {
    lifecycle,
    schema_version: 2,
    source_fingerprint: sourceFingerprint,
    content_fingerprint: contentFingerprint,
  };
}

function scheduleUpdate(updates, note, fields) {
  const changed = Object.entries(fields).some(
    ([key, value]) => String(note.frontmatter[key] ?? "") !== String(value),
  );
  if (changed) updates.set(note.relativePath, fields);
}

function reportFingerprints(note) {
  const sourceFingerprint = stableId("aireportsrc", JSON.stringify({
    path: note.relativePath,
    date: note.frontmatter.date ?? note.frontmatter.updated ?? "",
    company: note.frontmatter.company ?? "",
    source: note.frontmatter.source ?? "",
    related: note.frontmatter.related ?? [],
  }));
  const body = note.content
    .replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u, "")
    .replace(/\r\n/gu, "\n")
    .trim();
  return {
    sourceFingerprint,
    contentFingerprint: stableId("aireportcontent", body),
  };
}

/**
 * 何を残すかだけを決める純関数。移動と書込みは CLI 側で行うので、dry-run は完全に無変更。
 */
export function planVaultCompaction(notes, { now = new Date(), reportRetentionDays = 90 } = {}) {
  const keep = [];
  const candidates = [];
  const updates = new Map();
  const activeFingerprints = activeBatchFingerprints(notes);
  const reportBacklinks = strongReportBacklinks(notes);

  const curricula = notes.flatMap((note) => {
    if (note.frontmatter.type !== "language-curriculum") return [];
    const value = markerJson(note.content, CURRICULUM_START, CURRICULUM_END);
    if (!value) return [];
    return [{
      note,
      value,
      generatedAt: String(value.generatedAt ?? note.frontmatter.generated_at ?? ""),
      sourceFingerprint: String(value.sourceFingerprint ?? note.frontmatter.source_fingerprint ?? ""),
      contentFingerprint: String(
        value.contentFingerprint
        ?? note.frontmatter.content_fingerprint
        ?? value.sourceFingerprint
        ?? note.frontmatter.source_fingerprint
        ?? "",
      ),
    }];
  }).sort((left, right) => right.generatedAt.localeCompare(left.generatedAt));

  curricula.forEach((entry, index) => {
    const referenced = activeFingerprints.has(entry.contentFingerprint)
      || activeFingerprints.has(entry.sourceFingerprint);
    const lifecycle = index === 0 ? "current" : referenced ? "historical" : "superseded";
    scheduleUpdate(
      updates,
      entry.note,
      artifactUpdate(lifecycle, entry.sourceFingerprint, entry.contentFingerprint),
    );
    if (index === 0) keep.push({ path: entry.note.relativePath, reason: "最新课程" });
    else if (referenced) keep.push({ path: entry.note.relativePath, reason: "未完成训练批次仍在引用" });
    else candidates.push({ path: entry.note.relativePath, reason: "已被新版替代的课程", kind: "language-curriculum" });
  });

  const banks = notes.flatMap((note) => {
    if (note.frontmatter.type !== "language-bank") return [];
    const value = markerJson(note.content, BANK_START, BANK_END);
    if (!value) return [];
    const contentFingerprint = String(
      value.contentFingerprint
      ?? note.frontmatter.content_fingerprint
      ?? bankContentFingerprint(value),
    );
    return [{
      note,
      value,
      generatedAt: String(value.generatedAt ?? note.frontmatter.generated_at ?? ""),
      sourceFingerprint: String(value.sourceFingerprint ?? note.frontmatter.source_fingerprint ?? ""),
      contentFingerprint,
    }];
  }).sort((left, right) => right.generatedAt.localeCompare(left.generatedAt));

  banks.forEach((entry, index) => {
    const lifecycle = index === 0 ? "current" : "superseded";
    scheduleUpdate(
      updates,
      entry.note,
      artifactUpdate(lifecycle, entry.sourceFingerprint, entry.contentFingerprint),
    );
    if (index === 0) keep.push({ path: entry.note.relativePath, reason: "最新训练库" });
    else candidates.push({ path: entry.note.relativePath, reason: "已被新版替代的训练库", kind: "language-bank" });
  });

  for (const note of notes) {
    // ai-review も分析層の生成物なので、同じ fingerprint / lifecycle 管理に乗せる。
    const reportType = String(note.frontmatter.type ?? "");
    if (reportType !== "ai-report" && reportType !== "analysis" && reportType !== "ai-review") continue;
    const lifecycle = String(note.frontmatter.lifecycle ?? "historical");
    const fingerprints = reportFingerprints(note);
    scheduleUpdate(updates, note, artifactUpdate(
      lifecycle,
      fingerprints.sourceFingerprint,
      fingerprints.contentFingerprint,
    ));
    if (lifecycle === "current" || String(note.frontmatter.keep ?? "") === "true") {
      keep.push({ path: note.relativePath, reason: lifecycle === "current" ? "现行分析" : "keep: true" });
      continue;
    }
    const linked = reportBacklinks.has(noteName(note.relativePath));
    if (linked) {
      keep.push({ path: note.relativePath, reason: "现行权威笔记仍在引用" });
      continue;
    }
    const oldEnough = lifecycle === "superseded"
      || ageDays(noteDate(note), now) >= reportRetentionDays;
    if (oldEnough) candidates.push({ path: note.relativePath, reason: "超过保留期的历史分析", kind: note.frontmatter.type });
    else keep.push({ path: note.relativePath, reason: `未满 ${reportRetentionDays} 天保留期` });
  }

  return { keep, candidates, updates, activeFingerprints: [...activeFingerprints] };
}
