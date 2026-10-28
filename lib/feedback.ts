export type FeedbackRole = "teacher" | "owner";
export type FeedbackIdentity = { id: string; name: string; role: FeedbackRole };
export type FeedbackState = "open" | "working" | "done";
export type FeedbackContext = {
  pagePath: string; title: string; company?: string; sessionId?: string;
  blockId?: string; turnId?: string; quote?: string; revision?: string;
  quoteStart?: number; quoteEnd?: number;
};
export type FeedbackMessage = {
  id: string; threadId: string; author: FeedbackIdentity; text: string; createdAt: string;
};
export type FeedbackThread = {
  id: string; context: FeedbackContext; createdAt: string; updatedAt: string;
  createdBy: FeedbackIdentity; state: FeedbackState; hidden: boolean;
  messages: FeedbackMessage[]; unread: boolean;
};
export type FeedbackSession = { identity: FeedbackIdentity | null; configured: boolean };

// 同一句原文发布后可能变动；只在版本相同的情况下定位，避免把旧建议挂到另一句话。
export function feedbackRevision(value: string): string {
  let hash = 2166136261;
  for (const char of value.replace(/\r\n/g, "\n")) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619);
  return (hash >>> 0).toString(36);
}

export function feedbackContextKey(context: FeedbackContext): string {
  return `${context.pagePath}|${context.blockId ?? ""}|${context.turnId ?? ""}|${context.quote ?? ""}`;
}
