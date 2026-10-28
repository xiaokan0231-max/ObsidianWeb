import type { ConsultationTranscript } from "./consultation-library.ts";
import { feedbackRevision, type FeedbackContext } from "./feedback.ts";

export function consultationBlockText(block: ConsultationTranscript["blocks"][number]): string {
  return block.turns.map(turn => turn.text).join("\n");
}

export function consultationContextText(transcript: ConsultationTranscript, context: FeedbackContext): string | null {
  if (context.sessionId !== transcript.id) return null;
  if (!context.blockId) return null;
  if (context.blockId === "raw") return transcript.raw;
  if (context.blockId.startsWith("raw-line-")) {
    const line = Number(context.blockId.slice(9));
    return Number.isInteger(line) && line >= 0 ? transcript.raw.split("\n")[line] ?? null : null;
  }
  const block = transcript.blocks.find(item => item.id === context.blockId);
  if (!block) return null;
  return context.turnId ? block.turns.find(turn => turn.id === context.turnId)?.text ?? null : consultationBlockText(block);
}

// 重复语句只靠文字查找会误挂；新批注带准确偏移，旧批注仅在唯一匹配时定位。
export function feedbackQuoteRange(text: string, context: FeedbackContext): { start: number; end: number } | null {
  if (!context.quote || context.revision !== feedbackRevision(text)) return null;
  if (context.quoteStart !== undefined || context.quoteEnd !== undefined) {
    const start = context.quoteStart;
    const end = context.quoteEnd;
    if (start === undefined || end === undefined || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > text.length) return null;
    return text.slice(start, end) === context.quote ? { start, end } : null;
  }
  const start = text.indexOf(context.quote);
  if (start < 0 || text.indexOf(context.quote, start + 1) !== -1) return null;
  return { start, end: start + context.quote.length };
}

export function consultationContextIsCurrent(transcript: ConsultationTranscript, context: FeedbackContext): boolean {
  if (context.sessionId !== transcript.id) return false;
  if (!context.blockId) return true;
  const text = consultationContextText(transcript, context);
  return text !== null && feedbackQuoteRange(text, context) !== null;
}

export function consultationFeedbackContext(
  transcript: ConsultationTranscript,
  view: "readable" | "raw",
  target?: { blockId: string; turnId?: string; text: string; start?: number; end?: number },
): FeedbackContext {
  const params = new URLSearchParams({ session: transcript.id, view });
  const context: FeedbackContext = {
    pagePath: `/consultation?${params}`,
    title: `${transcript.date} · ${transcript.round} · ${view === "raw" ? "原始転写" : "可読整理稿"}`,
    company: transcript.company, sessionId: transcript.id,
  };
  if (!target) return context;
  const start = target.start ?? 0;
  const end = Math.min(target.end ?? target.text.length, start + 2000);
  return { ...context, blockId: target.blockId, ...(target.turnId ? { turnId: target.turnId } : {}),
    quote: target.text.slice(start, end), quoteStart: start, quoteEnd: end, revision: feedbackRevision(target.text) };
}
