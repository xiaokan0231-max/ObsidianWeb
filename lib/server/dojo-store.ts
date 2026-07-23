// 面试道场 UI 已下线。这个文件保留下来只为日语训练服务：
// loadDojoState 把 vault 里既有的道场画像/考试历史解析成上下文（language rebuild・expand 用），
// buildSourceContext 是全库资料打包器（language-store 复用）。
import type {
  ExamReport,
  TrainingEvent,
  TrainingProfile,
} from "@/lib/dojo/types";
import { includeAiSourceNote } from "@/lib/vault-boundary.mjs";
import { deriveDojoState } from "@/lib/dojo/state";
import { stableId } from "@/lib/dojo/utils";
import { readAllNotes, type ObsidianNote } from "@/lib/server/obsidian";

const PROFILE_START = "<!-- dojo-profile-json:start -->";
const PROFILE_END = "<!-- dojo-profile-json:end -->";
const EXAM_START = "<!-- dojo-exam-report:start -->";
const EXAM_END = "<!-- dojo-exam-report:end -->";
const TRAINING_PREFIX = "<!-- dojo-training-event:";

function markerJson<T>(content: string, start: string, end: string): T | undefined {
  const startIndex = content.indexOf(start);
  const endIndex = content.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) return undefined;
  const section = content
    .slice(startIndex + start.length, endIndex)
    .replace(/^\s*```json\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  try {
    return JSON.parse(section) as T;
  } catch {
    return undefined;
  }
}

function trainingEvents(content: string) {
  const result: TrainingEvent[] = [];
  for (const line of content.split("\n")) {
    const index = line.indexOf(TRAINING_PREFIX);
    if (index < 0) continue;
    const raw = line.slice(index + TRAINING_PREFIX.length).replace(/-->.*$/, "").trim();
    try {
      result.push(JSON.parse(raw) as TrainingEvent);
    } catch {
      // A malformed historical log entry is ignored; the readable log remains intact.
    }
  }
  return result;
}

function latestProfile(notes: ObsidianNote[]) {
  for (const note of notes) {
    if (
      note.path.startsWith("80_AI分析/面接道場/") ||
      note.frontmatter.type === "training-profile"
    ) {
      const profile = markerJson<TrainingProfile>(
        note.content,
        PROFILE_START,
        PROFILE_END,
      );
      if (profile) return profile;
    }
  }
  return undefined;
}

export async function loadDojoState(notes?: ObsidianNote[]) {
  const allNotes = notes ?? (await readAllNotes());
  const profile = latestProfile(allNotes);
  const events = allNotes.flatMap((note) =>
    note.path.startsWith("30_日本語学習/訓練ログ/")
      ? trainingEvents(note.content)
      : [],
  );
  const reports = allNotes.flatMap((note) => {
    if (!note.path.startsWith("30_日本語学習/試験ログ/")) return [];
    const report = markerJson<ExamReport>(note.content, EXAM_START, EXAM_END);
    return report ? [report] : [];
  });
  return deriveDojoState(profile, events, reports);
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function typeOf(note: ObsidianNote) {
  return asString(note.frontmatter.type) || "note";
}

function trustOf(type: string) {
  if (type === "self") return "authority";
  if (
    [
      "transcript",
      "review",
      "company",
      "job-case",
      "mail",
      "application_log",
      "application_documents",
      "job_platform_sync",
      "deep-thought-evidence",
      "policy",
    ].includes(type)
  ) return "evidence";
  if (["ai-report", "analysis"].includes(type)) return "hypothesis";
  return "reference";
}

export function buildSourceContext(notes: ObsidianNote[]) {
  const sorted = notes
    .filter(includeAiSourceNote)
    .sort((left, right) => {
      const weights: Record<string, number> = {
        self: 0,
        transcript: 1,
        review: 2,
        company: 3,
        policy: 4,
        study: 5,
        material: 6,
        "ai-report": 7,
      };
      return (weights[typeOf(left)] ?? 8) - (weights[typeOf(right)] ?? 8);
    });
  const chunks: string[] = [];
  let length = 0;
  for (const note of sorted) {
    const content = note.content.slice(0, 80_000);
    const chunk = `\n<note path=${JSON.stringify(note.path)} type=${JSON.stringify(
      typeOf(note),
    )} trust=${JSON.stringify(trustOf(typeOf(note)))}>\n${content}\n</note>`;
    if (length + chunk.length > 1_800_000) break;
    chunks.push(chunk);
    length += chunk.length;
  }
  const fingerprintSource = sorted
    .map((note) => `${note.path}:${note.stat.mtime}:${note.stat.size}`)
    .join("|");
  return {
    sourceContext: chunks.join("\n"),
    sourceFingerprint: stableId("src", fingerprintSource),
    sourceCount: chunks.length,
  };
}
