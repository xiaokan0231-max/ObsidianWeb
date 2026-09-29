import { companyIdentity, getString, getType, type Note } from "./notes.ts";
import { parseAnnotations, parseSeirikou, reviewDecisionTasks, uniqueAnnotations } from "./review.ts";
import { parseReviewFeedback, uniqueReviewFeedback } from "./review-feedback.ts";
import { parseInterviewAnswerReview } from "./review-deep.ts";
import { reviewSiblingPath } from "./review-paths.ts";
import type { AdvisoryValidationContext, InterviewAdvisory } from "./interview-advisory.ts";

export const INSIGHTS_PATH = "20_求職/_素材/面接横断_顧問分析.md";
export const INSIGHTS_FEEDBACK_PATH = "20_求職/_素材/面接横断_顧問批注.md";
export const ADVISORY_STATE_PATH = "20_求職/_素材/面接顧問_更新状態.md";
export const ADVISORY_INPUT_VERSION = 1;

export type AdvisoryContextNote = {
  path: string;
  type: string;
  date: string;
  provenance: string;
  content: string;
};

// 公司资料可能混有分析，输入里保留出处，避免旧AI判断覆盖本人最新补充。
export function advisoryContextNotes(notes: Note[], source: Note): AdvisoryContextNote[] {
  const company = companyIdentity(getString(source.frontmatter.company));
  const folder = source.path.slice(0, source.path.lastIndexOf("/") + 1);
  return notes.filter((note) => {
    const type = getType(note);
    if (type === "self") return note.frontmatter.lifecycle !== "archived";
    if (type === "policy") {
      return note.frontmatter.lifecycle === "current" &&
        (Array.isArray(note.frontmatter.owns) && note.frontmatter.owns.some((id) => String(id).startsWith("SEARCH-")));
    }
    if (type === "interview-prep") {
      const session = getString(source.frontmatter.session_id);
      return Boolean(session && session === getString(note.frontmatter.session_id));
    }
    if (!["company", "job-case", "todo"].includes(type)) return false;
    const identity = companyIdentity(getString(note.frontmatter.company));
    return Boolean(company && identity === company) || note.path.startsWith(folder);
  }).sort((a, b) => a.path.localeCompare(b.path)).map((note) => ({
    path: note.path,
    type: getType(note),
    date: getString(note.frontmatter.updated) || getString(note.frontmatter.status_updated) || getString(note.frontmatter.date),
    provenance: [note.frontmatter.source, note.frontmatter.confidence, note.frontmatter.layer, note.frontmatter.ai_author].filter(Boolean).join(" / "),
    // 不把派生数字当新证据，避免统计更新反过来触发分析的循环。
    content: note.content.replace(/<!-- generated:[\s\S]*?<!-- \/generated -->/g, "〔派生集計は省略〕"),
  }));
}

export function buildAdvisoryInput(notes: Note[], sourcePath: string) {
  const source = notes.find((note) => note.path === sourcePath);
  if (!source || getType(source) !== "transcript-study") throw new Error("面试整理稿不存在。");
  const parsed = parseSeirikou(source.content);
  const annotation = notes.find((note) => note.path === reviewSiblingPath(sourcePath, "annotation"));
  const feedback = notes.find((note) => note.path === reviewSiblingPath(sourcePath, "answerFeedback"));
  const reviewNote = notes.find((note) => note.path === reviewSiblingPath(sourcePath, "answerReview"));
  const review = reviewNote ? parseInterviewAnswerReview(reviewNote.content) : null;
  const annotations = uniqueAnnotations(parseAnnotations(annotation?.content ?? ""));
  const unresolved = reviewDecisionTasks(parsed.sentences, annotations).filter((task) => !task.resolvedBy);
  const humanFeedback = uniqueReviewFeedback(parseReviewFeedback(feedback?.content ?? ""));
  const contextNotes = advisoryContextNotes(notes, source);
  const reason = !parsed.blocks.length ? "整理稿缺少可引用的问题块。"
    : unresolved.length ? `还有 ${unresolved.length} 项原文或话者裁定未完成。`
    : !review ? "回答质量复盘尚未生成。"
    : source.frontmatter.source_conflict === true ? "来源冲突尚未解决。" : "";
  const payload = {
    inputVersion: ADVISORY_INPUT_VERSION,
    sourcePath,
    company: getString(source.frontmatter.company),
    date: getString(source.frontmatter.date),
    round: getString(source.frontmatter.round),
    ...(source.frontmatter.reconstruction !== undefined || source.frontmatter.verbatim !== undefined ? {
      provenance: { reconstruction: source.frontmatter.reconstruction ?? null, verbatim: source.frontmatter.verbatim ?? null,
        boundary: "记忆重构只支持主题与本人记忆的分析，不作逐字原话、语速或措辞证据。" },
    } : {}),
    blocks: parsed.blocks.map((block) => ({
      id: block.id, title: block.title,
      sentences: block.sentences.map((sentence) => ({
        id: sentence.id, speaker: sentence.speaker, text: sentence.sei,
        original: sentence.gen ?? "", translationZh: sentence.yaku ?? "", notes: sentence.notes,
        annotations: annotations.filter((item) => item.sentenceId === sentence.id),
      })),
    })),
    humanFeedback,
    contextNotes,
    evidencePolicy: "原话与本人裁定优先。背景资料可含AI分析，需按来源区别；当前偏好不倒写为面试当时的偏好。后续结果单独说明时间，不推定不明的拒绝原因。",
  };
  return { source, parsed, payload, review, reviewNote, reason, contextNotes };
}

export function advisoryValidationContext(inputs: ReturnType<typeof buildAdvisoryInput>[]): AdvisoryValidationContext {
  return {
    sources: new Map(inputs.map(({ source, parsed }) => [source.path,
      new Map(parsed.blocks.map((block) => [block.id, new Set(block.sentences.map((sentence) => sentence.id))])),
    ])),
    contextPaths: new Set(inputs.flatMap((input) => input.contextNotes.map((note) => note.path))),
  };
}

export async function advisoryFingerprint(value: unknown) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function crossInterviewInput(input: ReturnType<typeof buildAdvisoryInput>, advisory: InterviewAdvisory) {
  // 横向只携带被引用的实际问答，仍保留问题→回答→反应供独立核对。
  const refs = [
    ...advisory.evidence,
    ...advisory.observations.flatMap((item) => item.evidence),
    ...advisory.answerOptions.flatMap((item) => item.evidence),
    ...advisory.nextSteps.flatMap((item) => item.evidence),
  ];
  const used = new Set(refs.filter((ref) => ref.sourcePath === input.source.path).map((ref) => ref.blockId));
  return {
    sourcePath: input.source.path, company: input.payload.company, date: input.payload.date,
    round: input.payload.round, stage: advisory.stage,
    ...(input.payload.provenance ? { provenance: input.payload.provenance } : {}),
    advisory: {
      commentaryZh: advisory.commentaryZh, fitZh: advisory.fitZh,
      recommendationZh: advisory.recommendationZh, changeConditionsZh: advisory.changeConditionsZh,
      observations: advisory.observations.map(({ id, titleZh, observationZh, interpretationZh, alternativeZh, implicationZh, evidence, contextPaths }) =>
        ({ id, titleZh, observationZh, interpretationZh, alternativeZh, implicationZh, evidence, contextPaths })),
      answerOptions: advisory.answerOptions.map(({ id, titleZh, situationZh, whyZh, scope, evidence }) =>
        ({ id, titleZh, situationZh, whyZh, scope, evidence })),
    },
    blocks: input.payload.blocks.filter((block) => used.has(block.id)).map((block) => ({
      id: block.id, title: block.title,
      sentences: block.sentences.map(({ id, speaker, text, annotations }) => ({ id, speaker, text, annotations })),
    })),
    humanFeedback: input.payload.humanFeedback,
  };
}
