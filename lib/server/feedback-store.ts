import type { FeedbackContext, FeedbackIdentity, FeedbackMessage, FeedbackState, FeedbackThread, FeedbackSummary, FeedbackSummaryPage, FeedbackUnread } from "../feedback.ts";
import { feedbackRevision } from "../feedback.ts";

export class FeedbackError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export type FeedbackSettings = { accessCode: string; version: string };
type Stored<T> = { value: T; etag: string };
type ThreadMeta = {
  id: string; context: FeedbackContext; createdAt: string; createdBy: FeedbackIdentity;
  state: FeedbackState; hidden: boolean;
  revision?: number; committed?: { id: string; authorId: string; createdAt: string }[]; applied?: string[];
};
type ReadRecord = { ids: string[] };
const ROOT = "feedback/v1/";
export function validId(value: unknown): value is string { return typeof value === "string" && /^[a-zA-Z0-9_-]{8,80}$/.test(value) && !["__proto__", "prototype", "constructor"].includes(value); }
async function stored<T>(bucket: R2Bucket, key: string): Promise<Stored<T> | null> {
  const object = await bucket.get(key);
  return object ? { value: await object.json<T>(), etag: object.etag } : null;
}
async function save<T>(bucket: R2Bucket, key: string, value: T, current: Stored<T> | null) {
  return bucket.put(key, JSON.stringify(value), {
    onlyIf: current ? { etagMatches: current.etag } : { etagDoesNotMatch: "*" },
    httpMetadata: { contentType: "application/json", cacheControl: "private, no-store" },
  });
}
async function update<T>(bucket: R2Bucket, key: string, transform: (value: T | null) => T): Promise<T> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const before = await stored<T>(bucket, key);
    const next = transform(before?.value ?? null);
    if (await save(bucket, key, next, before)) return next;
  }
  throw new FeedbackError(409, "処理が重なりました。もう一度お試しください。");
}
async function keys(bucket: R2Bucket, prefix: string): Promise<string[]> {
  const result: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor });
    result.push(...page.objects.map(object => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return result;
}
const threadKey = (id: string) => `${ROOT}threads/${id}.json`;
const messagePrefix = (id: string) => `${ROOT}messages/${id}/`;
const readKey = (threadId: string, participantId: string) => `${ROOT}reads/${participantId}/${threadId}.json`;
export async function settings(bucket: R2Bucket, initialCode?: string): Promise<FeedbackSettings> {
  const key = `${ROOT}settings.json`;
  const existing = await stored<FeedbackSettings>(bucket, key);
  if (existing) return existing.value;
  if (!initialCode || initialCode.length < 8) throw new FeedbackError(503, "コメントの準備がまだ完了していません。");
  const initial = { accessCode: initialCode, version: crypto.randomUUID() };
  if (await save(bucket, key, initial, null)) return initial;
  const winner = await stored<FeedbackSettings>(bucket, key);
  if (!winner) throw new FeedbackError(503, "コメントを読み込めませんでした。");
  return winner.value;
}
export async function rotateCode(bucket: R2Bucket, accessCode: string): Promise<FeedbackSettings> {
  if (accessCode.length < 8 || accessCode.length > 100) throw new FeedbackError(400, "アクセスコードは8〜100文字で入力してください。");
  return update<FeedbackSettings>(bucket, `${ROOT}settings.json`, () => ({ accessCode, version: crypto.randomUUID() }));
}
// 把次数保存在共享存储中；只用 Worker 内存会让并发请求绕过限制。
export async function loginAttempt(bucket: R2Bucket, clientKey: string): Promise<void> {
  const window = Math.floor(Date.now() / (15 * 60_000));
  const record = await update<{ count: number }>(bucket, `${ROOT}limits/${window}/${clientKey}.json`, old => ({ count: (old?.count ?? 0) + 1 }));
  if (record.count > 20) throw new FeedbackError(429, "入力が続いています。15分ほど待ってから、もう一度お試しください。");
}
function plain(value: unknown, max: number, required = false): string {
  if (typeof value !== "string") {
    if (!required && value == null) return "";
    throw new FeedbackError(400, "入力内容を確認してください。");
  }
  const text = value.trim();
  if ((required && !text) || text.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new FeedbackError(400, "入力内容が長すぎるか、使用できない文字が含まれています。");
  return text;
}
export function messageText(value: unknown): string { return plain(value, 6000, true); }
export function participantName(value: unknown): string { return plain(value, 80, true); }
export function feedbackContext(value: unknown): FeedbackContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new FeedbackError(400, "関連する資料を確認してください。");
  const body = value as Record<string, unknown>;
  const pagePath = plain(body.pagePath, 2000, true);
  let url: URL;
  let decoded: string;
  try { url = new URL(pagePath, "https://feedback.invalid"); decoded = decodeURIComponent(pagePath); }
  catch { throw new FeedbackError(400, "資料のリンクを確認してください。"); }
  if (!pagePath.startsWith("/") || pagePath.startsWith("//") || /[\\\r\n]/.test(pagePath) || /(?:^|\/)\.\.(?:\/|$|[?#])/.test(decoded) || url.origin !== "https://feedback.invalid" || url.pathname.startsWith("/api/") || /(?:token|secret|password|accesscode|ownerkey|authorization)/i.test([...url.searchParams.keys()].join(" ")) || /[\r\n\\]/.test(decoded)) throw new FeedbackError(400, "資料のリンクを確認してください。");
  const context: FeedbackContext = { pagePath, title: plain(body.title, 300, true) };
  for (const [key, max] of [["company", 200], ["sessionId", 160], ["blockId", 160], ["turnId", 160], ["quote", 12000], ["revision", 160]] as const) {
    const field = plain(body[key], max);
    if (field) context[key] = key === "quote" ? body[key] as string : field;
  }
  if (body.quoteStart !== undefined || body.quoteEnd !== undefined) {
    if (!Number.isSafeInteger(body.quoteStart) || !Number.isSafeInteger(body.quoteEnd) || Number(body.quoteStart) < 0 || Number(body.quoteEnd) <= Number(body.quoteStart) || Number(body.quoteEnd) > 1_000_000 || Number(body.quoteEnd) - Number(body.quoteStart) !== context.quote?.length) throw new FeedbackError(400, "引用する文章を選び直してください。");
    context.quoteStart = Number(body.quoteStart); context.quoteEnd = Number(body.quoteEnd);
  }
  return context;
}
async function meta(bucket: R2Bucket, id: string, participant: FeedbackIdentity): Promise<ThreadMeta> {
  const entry = await stored<ThreadMeta>(bucket, threadKey(id));
  if (!entry || (entry.value.hidden && participant.role !== "owner")) throw new FeedbackError(404, "このコメントは見つかりませんでした。");
  return entry.value;
}
async function messages(bucket: R2Bucket, id: string): Promise<FeedbackMessage[]> {
  const messageKeys = await keys(bucket, messagePrefix(id));
  const result: FeedbackMessage[] = [];
  for (let offset = 0; offset < messageKeys.length; offset += 16) {
    const batch = await Promise.all(messageKeys.slice(offset, offset + 16).map(key => stored<FeedbackMessage>(bucket, key)));
    result.push(...batch.filter((entry): entry is Stored<FeedbackMessage> => Boolean(entry)).map(entry => entry.value));
  }
  return result.sort((a, b) => a.id === id ? -1 : b.id === id ? 1 : a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}
async function present(bucket: R2Bucket, entry: ThreadMeta, participant: FeedbackIdentity): Promise<FeedbackThread> {
  const [all, read] = await Promise.all([messages(bucket, entry.id), stored<ReadRecord>(bucket, readKey(entry.id, participant.id))]);
  const committed = entry.committed && new Set(entry.committed.map(item => item.id));
  const items = committed ? all.filter(item => committed.has(item.id)) : all;
  const seen = new Set(read?.value.ids ?? []);
  const { id, context, createdAt, createdBy, state, hidden } = entry;
  return { id, context, createdAt, createdBy, state, hidden, messages: items, updatedAt: items.at(-1)?.createdAt ?? entry.createdAt, unread: items.some(message => message.author.id !== participant.id && !seen.has(message.id)) };
}
async function rawThread(bucket: R2Bucket, id: string, participant: FeedbackIdentity): Promise<FeedbackThread> { return present(bucket, await meta(bucket, id, participant), participant); }
async function rawListThreads(bucket: R2Bucket, participant: FeedbackIdentity): Promise<FeedbackThread[]> {
  const all = await keys(bucket, `${ROOT}threads/`);
  const result: FeedbackThread[] = [];
  for (let offset = 0; offset < all.length; offset += 12) {
    const entries = await Promise.all(all.slice(offset, offset + 12).map(key => stored<ThreadMeta>(bucket, key)));
    const visible = entries.filter((entry): entry is Stored<ThreadMeta> => Boolean(entry && (!entry.value.hidden || participant.role === "owner")));
    result.push(...await Promise.all(visible.map(entry => present(bucket, entry.value, participant))));
  }
  return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
}
async function createCanonical(bucket: R2Bucket, participant: FeedbackIdentity, input: Record<string, unknown>): Promise<FeedbackThread> {
  if (!validId(input.id)) throw new FeedbackError(400, "送信内容を確認してください。");
  const context = feedbackContext(input.context);
  const text = messageText(input.text);
  const createdAt = new Date().toISOString();
  const next: ThreadMeta = { id: input.id, context, createdAt, createdBy: participant, state: "open", hidden: false, revision: 1, committed: [] };
  await save(bucket, threadKey(input.id), next, null);
  const existing = await meta(bucket, input.id, owner);
  if (existing.createdBy.id !== participant.id || JSON.stringify(existing.context) !== JSON.stringify(context)) throw new FeedbackError(409, "同じ送信番号が使われています。内容を確認してください。");
  await appendMessage(bucket, participant, input.id, input.id, text, existing.createdAt);
  return rawThread(bucket, input.id, owner);
}
async function appendMessage(bucket: R2Bucket, participant: FeedbackIdentity, threadId: string, id: string, text: string, createdAt = new Date().toISOString()) {
  const key = `${messagePrefix(threadId)}${id}.json`;
  const next: FeedbackMessage = { id, threadId, author: participant, text, createdAt };
  if (!await save(bucket, key, next, null)) {
    const existing = await stored<FeedbackMessage>(bucket, key);
    if (!existing || existing.value.author.id !== participant.id || existing.value.text !== text) throw new FeedbackError(409, "同じ送信番号が使われています。内容を確認してください。");
  }
  const saved = (await stored<FeedbackMessage>(bucket, key))!.value;
  await update<ThreadMeta>(bucket, threadKey(threadId), old => {
    if (!old?.committed) throw new FeedbackError(503, "コメントを準備しています。少し待ってからお試しください。");
    if (old.committed.some(item => item.id === id)) return old;
    return { ...old, revision: (old.revision ?? 0) + 1, committed: [...old.committed, { id, authorId: saved.author.id, createdAt: saved.createdAt }] };
  });
}
async function replyCanonical(bucket: R2Bucket, participant: FeedbackIdentity, id: string, input: Record<string, unknown>): Promise<FeedbackThread> {
  await meta(bucket, id, owner);
  if (!validId(input.id)) throw new FeedbackError(400, "送信内容を確認してください。");
  await appendMessage(bucket, participant, id, input.id, messageText(input.text));
  return rawThread(bucket, id, owner);
}
async function changeCanonical(bucket: R2Bucket, participant: FeedbackIdentity, id: string, input: Record<string, unknown>): Promise<FeedbackThread> {
  if (participant.role !== "owner") throw new FeedbackError(403, "この操作は本人のみ利用できます。");
  await meta(bucket, id, participant);
  if (input.state !== undefined && !["open", "working", "done"].includes(String(input.state))) throw new FeedbackError(400, "対応状況を確認してください。");
  if (input.hidden !== undefined && typeof input.hidden !== "boolean") throw new FeedbackError(400, "表示設定を確認してください。");
  await update<ThreadMeta>(bucket, threadKey(id), old => {
    if (!old) throw new FeedbackError(404, "このコメントは見つかりませんでした。");
    if (old.applied?.includes(input.operationId as string)) return old;
    return { ...old, revision: (old.revision ?? 0) + 1, applied: [...(old.applied ?? []), input.operationId as string], ...(input.state !== undefined ? { state: input.state as FeedbackState } : {}), ...(input.hidden !== undefined ? { hidden: input.hidden as boolean } : {}) };
  });
  return rawThread(bucket, id, participant);
}
async function readCanonical(bucket: R2Bucket, participant: FeedbackIdentity, id: string, input: Record<string, unknown>): Promise<void> {
  await meta(bucket, id, owner);
  const ids = Array.isArray(input.messageIds) ? input.messageIds : [input.messageId];
  if (!ids.length || ids.length > 2000 || !ids.every(validId)) throw new FeedbackError(400, "表示したコメントを確認してください。");
  const exists = new Set((await messages(bucket, id)).map(item => item.id));
  if (ids.some(item => !exists.has(item))) throw new FeedbackError(400, "表示したコメントを確認してください。");
  // 只记录实际显示过的 ID；不能把延迟保存或同一毫秒的新回复误标为已读。
  await update<ReadRecord>(bucket, readKey(id, participant.id), old => ({ ids: [...new Set([...(old?.ids ?? []), ...ids])] }));
}

type IndexedSummary = Omit<FeedbackSummary, "unread"> & { threadRevision: number; messageRefs: { id: string; authorId: string }[] };
type SummaryIndex = { version: 2; revision: number; items: Record<string, IndexedSummary> };
type ReadSummary = { revision: number; threads: Record<string, string[]> };
type Pending = { kind: "create" | "reply" | "change" | "read"; id: string; participant: FeedbackIdentity; input: Record<string, unknown> };
const INDEX = "feedback/v2/summary-index.json";
const PENDING = "feedback/v2/pending/";
const readSummaryKey = (id: string) => `feedback/v2/read-summary/${id}.json`;
const owner: FeedbackIdentity = { id: "owner", name: "本人", role: "owner" };

async function indexEntry(bucket: R2Bucket, id: string): Promise<IndexedSummary> {
  const entry = await meta(bucket, id, owner);
  const thread = await present(bucket, entry, owner);
  return {
    id, context: { ...thread.context, ...(thread.context.quote ? { quote: thread.context.quote.slice(0, 65) } : {}) },
    createdAt: thread.createdAt, updatedAt: thread.updatedAt, createdBy: thread.createdBy,
    state: thread.state, hidden: thread.hidden, preview: thread.messages[0]?.text.slice(0, 100) ?? "",
    quoteLength: thread.context.quote?.length ?? 0, quoteRevision: feedbackRevision(thread.context.quote ?? ""),
    messageCount: thread.messages.length, authors: [...new Map(thread.messages.map(item => [item.author.id, item.author])).values()],
    lastAuthor: thread.messages.at(-1)?.author ?? thread.createdBy,
    threadRevision: entry.revision ?? 1, messageRefs: thread.messages.map(item => ({ id: item.id, authorId: item.author.id })),
  };
}

async function initializeIndex(bucket: R2Bucket): Promise<SummaryIndex> {
  const existing = await stored<SummaryIndex>(bucket, INDEX);
  if (existing) return existing.value;
  const items: Record<string, IndexedSummary> = Object.create(null);
  for (const key of await keys(bucket, `${ROOT}threads/`)) {
    const current = await stored<ThreadMeta>(bucket, key);
    if (!current) continue;
    {
      const all = await messages(bucket, current.value.id);
      await update<ThreadMeta>(bucket, key, old => {
        if (!old) throw new FeedbackError(503, "コメントを準備しています。");
        const known = new Set(old.committed?.map(item => item.id) ?? []);
        const extra = all.filter(item => !known.has(item.id)).map(item => ({ id: item.id, authorId: item.author.id, createdAt: item.createdAt }));
        return old.committed && !extra.length ? old : { ...old, revision: (old.revision ?? 0) + 1, committed: [...(old.committed ?? []), ...extra] };
      });
    }
    items[current.value.id] = await indexEntry(bucket, current.value.id);
  }
  const initial: SummaryIndex = { version: 2, revision: 1, items };
  if (await save(bucket, INDEX, initial, null)) return initial;
  const winner = await stored<SummaryIndex>(bucket, INDEX);
  if (!winner) throw new FeedbackError(503, "コメントを準備しています。");
  return winner.value;
}

async function readSummary(bucket: R2Bucket, participantId: string): Promise<ReadSummary> {
  const key = readSummaryKey(participantId);
  const existing = await stored<ReadSummary>(bucket, key);
  if (existing) return existing.value;
  const threads: Record<string, string[]> = Object.create(null);
  for (const recordKey of await keys(bucket, `${ROOT}reads/${participantId}/`)) {
    const record = await stored<ReadRecord>(bucket, recordKey);
    if (record) threads[recordKey.split("/").at(-1)!.replace(/\.json$/u, "")] = record.value.ids;
  }
  const initial = { revision: 1, threads };
  if (await save(bucket, key, initial, null)) return initial;
  return (await stored<ReadSummary>(bucket, key))!.value;
}

async function projectThread(bucket: R2Bucket, id: string) {
  const item = await indexEntry(bucket, id);
  await update<SummaryIndex>(bucket, INDEX, old => {
    if (!old) throw new FeedbackError(503, "コメントを準備しています。");
    // 较慢的请求不能把较新回复或状态覆盖回去。
    if ((old.items[id]?.threadRevision ?? 0) >= item.threadRevision) return old;
    return { ...old, revision: old.revision + 1, items: { ...old.items, [id]: item } };
  });
}

async function finishPending(bucket: R2Bucket, key: string, operation: Pending) {
  const { kind, id, participant, input } = operation;
  try {
    if (kind === "create") await createCanonical(bucket, participant, input);
    else if (kind === "reply") await replyCanonical(bucket, participant, id, input);
    else if (kind === "change") await changeCanonical(bucket, participant, id, input);
    else await readCanonical(bucket, participant, id, input);
  } catch (error) {
    // 并发占用同一消息 ID 的失败操作没有可重试写入，不能永久阻塞整个信箱。
    if (error instanceof FeedbackError && [400, 404].includes(error.status)) await bucket.delete(key);
    if (error instanceof FeedbackError && error.status === 409 && error.message.includes("送信番号")) await bucket.delete(key);
    throw error;
  }
  if (kind === "read") {
    await readSummary(bucket, participant.id);
    const canonical = (await stored<ReadRecord>(bucket, readKey(id, participant.id)))!.value;
    await update<ReadSummary>(bucket, readSummaryKey(participant.id), old => {
      const before = old ?? { revision: 1, threads: {} };
      const ids = [...new Set([...(before.threads[id] ?? []), ...canonical.ids])];
      if (ids.length === before.threads[id]?.length) return before;
      return { revision: before.revision + 1, threads: { ...before.threads, [id]: ids } };
    });
  }
  if (kind !== "read") await projectThread(bucket, id);
  await bucket.delete(key);
}

async function readyIndex(bucket: R2Bucket): Promise<SummaryIndex> {
  let index = await initializeIndex(bucket);
  // 先恢复持久日志，再向读者宣布版本；失败保留日志并返回可重试错误，不能伪装成空信箱。
  const pending = await bucket.list({ prefix: PENDING, limit: 20 });
  for (const item of pending.objects) {
    const operation = await stored<Pending>(bucket, item.key);
    if (operation) await finishPending(bucket, item.key, operation.value);
  }
  if (pending.truncated) throw new FeedbackError(503, "コメントを復元しています。少し待ってからお試しください。");
  if (pending.objects.length) index = (await stored<SummaryIndex>(bucket, INDEX))!.value;
  return index;
}

async function commitOperation(bucket: R2Bucket, operation: Pending, operationId: string) {
  const key = `${PENDING}${operation.kind}-${operation.id}-${operationId}.json`;
  const previous = await stored<Pending>(bucket, key);
  if (previous && JSON.stringify(previous.value) !== JSON.stringify(operation)) throw new FeedbackError(409, "同じ送信番号が使われています。内容を確認してください。");
  if (!previous && !await save(bucket, key, operation, null)) {
    const winner = await stored<Pending>(bucket, key);
    if (!winner || JSON.stringify(winner.value) !== JSON.stringify(operation)) throw new FeedbackError(409, "同じ送信番号が使われています。");
  }
  await finishPending(bucket, key, operation);
}

export async function getThread(bucket: R2Bucket, id: string, participant: FeedbackIdentity): Promise<FeedbackThread> {
  await readyIndex(bucket);
  return rawThread(bucket, id, participant);
}
export async function listThreads(bucket: R2Bucket, participant: FeedbackIdentity): Promise<FeedbackThread[]> {
  await readyIndex(bucket);
  return rawListThreads(bucket, participant);
}
export async function createThread(bucket: R2Bucket, participant: FeedbackIdentity, input: Record<string, unknown>): Promise<FeedbackThread> {
  if (!validId(input.id)) throw new FeedbackError(400, "送信内容を確認してください。");
  const validated = { id: input.id, context: feedbackContext(input.context), text: messageText(input.text) };
  await readyIndex(bucket);
  // 冲突先拒绝，避免留下永远无法恢复的日志。
  const existing = await stored<ThreadMeta>(bucket, threadKey(input.id));
  if (existing && (existing.value.createdBy.id !== participant.id || JSON.stringify(existing.value.context) !== JSON.stringify(validated.context))) throw new FeedbackError(409, "同じ送信番号が使われています。");
  await validateDuplicateMessage(bucket, input.id, input.id, participant, validated.text);
  await commitOperation(bucket, { kind: "create", id: input.id, participant, input: validated }, input.id);
  return rawThread(bucket, input.id, participant);
}
async function validateDuplicateMessage(bucket: R2Bucket, threadId: string, id: string, participant: FeedbackIdentity, text: string) {
  const existing = await stored<FeedbackMessage>(bucket, `${messagePrefix(threadId)}${id}.json`);
  if (existing && (existing.value.author.id !== participant.id || existing.value.text !== text)) throw new FeedbackError(409, "同じ送信番号が使われています。");
}
export async function reply(bucket: R2Bucket, participant: FeedbackIdentity, id: string, input: Record<string, unknown>): Promise<FeedbackThread> {
  if (!validId(input.id)) throw new FeedbackError(400, "送信内容を確認してください。");
  const validated = { id: input.id, text: messageText(input.text) };
  await readyIndex(bucket); await meta(bucket, id, participant);
  await validateDuplicateMessage(bucket, id, input.id, participant, validated.text);
  await commitOperation(bucket, { kind: "reply", id, participant, input: validated }, input.id);
  return rawThread(bucket, id, participant);
}
export async function changeThread(bucket: R2Bucket, participant: FeedbackIdentity, id: string, input: Record<string, unknown>): Promise<FeedbackThread> {
  if (participant.role !== "owner") throw new FeedbackError(403, "この操作は本人のみ利用できます。");
  if (input.state !== undefined && !["open", "working", "done"].includes(String(input.state))) throw new FeedbackError(400, "対応状況を確認してください。");
  if (input.hidden !== undefined && typeof input.hidden !== "boolean") throw new FeedbackError(400, "表示設定を確認してください。");
  if (input.operationId !== undefined && !validId(input.operationId)) throw new FeedbackError(400, "送信内容を確認してください。");
  const operationId = input.operationId as string | undefined ?? crypto.randomUUID();
  const validated = { ...(input.state !== undefined ? { state: input.state } : {}), ...(input.hidden !== undefined ? { hidden: input.hidden } : {}), operationId };
  await readyIndex(bucket); await meta(bucket, id, participant);
  await commitOperation(bucket, { kind: "change", id, participant, input: validated }, operationId);
  return rawThread(bucket, id, participant);
}
export async function markRead(bucket: R2Bucket, participant: FeedbackIdentity, id: string, input: Record<string, unknown>): Promise<void> {
  const ids = Array.isArray(input.messageIds) ? input.messageIds : [input.messageId];
  if (!ids.length || ids.length > 2000 || !ids.every(validId)) throw new FeedbackError(400, "表示したコメントを確認してください。");
  await readyIndex(bucket);
  const entry = await meta(bucket, id, participant);
  const exists = new Set(entry.committed!.map(item => item.id));
  if (ids.some(item => !exists.has(item))) throw new FeedbackError(400, "表示したコメントを確認してください。");
  await commitOperation(bucket, { kind: "read", id, participant, input: { messageIds: ids } }, crypto.randomUUID());
}

function summaryFor(item: IndexedSummary, reads: ReadSummary, participant: FeedbackIdentity): FeedbackSummary {
  const { threadRevision: _revision, messageRefs, ...summary } = item;
  void _revision;
  const seen = new Set(reads.threads[item.id] ?? []);
  return { ...summary, unread: messageRefs.some(message => message.authorId !== participant.id && !seen.has(message.id)) };
}
export async function unreadSummary(bucket: R2Bucket, participant: FeedbackIdentity): Promise<FeedbackUnread> {
  const index = await readyIndex(bucket), reads = await readSummary(bucket, participant.id);
  const unreadThreads = Object.values(index.items).filter(item => !item.hidden && summaryFor(item, reads, participant).unread).length;
  return { revision: index.revision, readRevision: reads.revision, unreadThreads };
}

export async function listSummaries(bucket: R2Bucket, participant: FeedbackIdentity, params: URLSearchParams): Promise<FeedbackSummaryPage> {
  const index = await readyIndex(bucket), reads = await readSummary(bucket, participant.id);
  const limit = params.has("limit") ? Number(params.get("limit")) : 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new FeedbackError(400, "表示件数を確認してください。");
  const filters = Object.fromEntries(["filter", "company", "page", "author", "q", "sessionId", "blockId"].map(name => [name, (params.get(name) ?? "").trim()]));
  if (Object.values(filters).some(value => value.length > 2000)) throw new FeedbackError(400, "検索内容が長すぎます。");
  const visible = Object.values(index.items).filter(item => participant.role === "owner" || !item.hidden).map(item => summaryFor(item, reads, participant));
  const facets = { companies: [...new Set(visible.flatMap(item => item.context.company ? [item.context.company] : []))].sort(),
    pages: [...new Map(visible.map(item => [item.context.pagePath, item.context.title])).entries()],
    authors: [...new Map(visible.flatMap(item => item.authors.map(author => [author.id, author.name] as [string, string]))).entries()] };
  let items = visible.filter(item => (filters.filter === "hidden" ? item.hidden : !item.hidden)
    && (filters.filter !== "unread" || item.unread)
    && (!["open", "working", "done"].includes(filters.filter) || item.state === filters.filter)
    && (!filters.company || item.context.company === filters.company) && (!filters.page || item.context.pagePath === filters.page)
    && (!filters.sessionId || item.context.sessionId === filters.sessionId) && (!filters.blockId || item.context.blockId === filters.blockId)
    && (!filters.author || item.authors.some(author => author.id === filters.author)));
  if (filters.q) {
    // 全文检索保留原有语义，只在明确输入搜索词时按需读取正文。
    const matches = new Set<string>();
    for (const item of items) {
      const thread = await rawThread(bucket, item.id, participant);
      const text = `${thread.context.title} ${thread.context.company ?? ""} ${thread.context.quote ?? ""} ${thread.messages.map(message => `${message.author.name} ${message.text}`).join(" ")}`;
      if (text.toLocaleLowerCase().includes(filters.q.toLocaleLowerCase())) matches.add(item.id);
    }
    items = items.filter(item => matches.has(item.id));
  }
  items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
  const total = items.length;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({ participant: participant.id, filters, limit }))));
  const binding = [...digest].map(value => value.toString(16).padStart(2, "0")).join("");
  const cursor = params.get("cursor");
  if (cursor) {
    try {
      if (cursor.length > 20000) throw new Error("cursor");
      const value = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(cursor), char => char.charCodeAt(0))));
      if (value.binding !== binding) throw new Error("cursor");
      if (value.revision !== index.revision || value.readRevision !== reads.revision) throw new FeedbackError(409, "新しいコメントがあります。一覧を更新してください。");
      const position = items.findIndex(item => item.id === value.id && item.updatedAt === value.updatedAt);
      if (position < 0) throw new Error("cursor");
      items = items.slice(position + 1);
    } catch (error) { if (error instanceof FeedbackError) throw error; throw new FeedbackError(400, "一覧を最初から開き直してください。"); }
  }
  const page = items.slice(0, limit), last = page.at(-1);
  const nextCursor = items.length > limit && last ? btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({ binding, revision: index.revision, readRevision: reads.revision, id: last.id, updatedAt: last.updatedAt })))) : null;
  return { items: page, nextCursor, revision: index.revision, total, facets };
}
