import type { FeedbackContext, FeedbackIdentity, FeedbackMessage, FeedbackState, FeedbackThread } from "../feedback.ts";

export class FeedbackError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export type FeedbackSettings = { accessCode: string; version: string };
type Stored<T> = { value: T; etag: string };
type ThreadMeta = {
  id: string; context: FeedbackContext; createdAt: string; createdBy: FeedbackIdentity;
  state: FeedbackState; hidden: boolean;
};
type ReadRecord = { ids: string[] };
const ROOT = "feedback/v1/";
export function validId(value: unknown): value is string { return typeof value === "string" && /^[a-zA-Z0-9_-]{8,80}$/.test(value); }
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
  const [items, read] = await Promise.all([messages(bucket, entry.id), stored<ReadRecord>(bucket, readKey(entry.id, participant.id))]);
  const seen = new Set(read?.value.ids ?? []);
  return { ...entry, messages: items, updatedAt: items.at(-1)?.createdAt ?? entry.createdAt, unread: items.some(message => message.author.id !== participant.id && !seen.has(message.id)) };
}
export async function getThread(bucket: R2Bucket, id: string, participant: FeedbackIdentity): Promise<FeedbackThread> { return present(bucket, await meta(bucket, id, participant), participant); }
export async function listThreads(bucket: R2Bucket, participant: FeedbackIdentity): Promise<FeedbackThread[]> {
  const all = await keys(bucket, `${ROOT}threads/`);
  const result: FeedbackThread[] = [];
  for (let offset = 0; offset < all.length; offset += 12) {
    const entries = await Promise.all(all.slice(offset, offset + 12).map(key => stored<ThreadMeta>(bucket, key)));
    const visible = entries.filter((entry): entry is Stored<ThreadMeta> => Boolean(entry && (!entry.value.hidden || participant.role === "owner")));
    result.push(...await Promise.all(visible.map(entry => present(bucket, entry.value, participant))));
  }
  return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
}
export async function createThread(bucket: R2Bucket, participant: FeedbackIdentity, input: Record<string, unknown>): Promise<FeedbackThread> {
  if (!validId(input.id)) throw new FeedbackError(400, "送信内容を確認してください。");
  const context = feedbackContext(input.context);
  const text = messageText(input.text);
  const createdAt = new Date().toISOString();
  const next: ThreadMeta = { id: input.id, context, createdAt, createdBy: participant, state: "open", hidden: false };
  await save(bucket, threadKey(input.id), next, null);
  const existing = await meta(bucket, input.id, participant);
  if (existing.createdBy.id !== participant.id || JSON.stringify(existing.context) !== JSON.stringify(context)) throw new FeedbackError(409, "同じ送信番号が使われています。内容を確認してください。");
  await appendMessage(bucket, participant, input.id, input.id, text, existing.createdAt);
  return getThread(bucket, input.id, participant);
}
async function appendMessage(bucket: R2Bucket, participant: FeedbackIdentity, threadId: string, id: string, text: string, createdAt = new Date().toISOString()) {
  const key = `${messagePrefix(threadId)}${id}.json`;
  const next: FeedbackMessage = { id, threadId, author: participant, text, createdAt };
  if (!await save(bucket, key, next, null)) {
    const existing = await stored<FeedbackMessage>(bucket, key);
    if (!existing || existing.value.author.id !== participant.id || existing.value.text !== text) throw new FeedbackError(409, "同じ送信番号が使われています。内容を確認してください。");
  }
}
export async function reply(bucket: R2Bucket, participant: FeedbackIdentity, id: string, input: Record<string, unknown>): Promise<FeedbackThread> {
  await meta(bucket, id, participant);
  if (!validId(input.id)) throw new FeedbackError(400, "送信内容を確認してください。");
  await appendMessage(bucket, participant, id, input.id, messageText(input.text));
  return getThread(bucket, id, participant);
}
export async function changeThread(bucket: R2Bucket, participant: FeedbackIdentity, id: string, input: Record<string, unknown>): Promise<FeedbackThread> {
  if (participant.role !== "owner") throw new FeedbackError(403, "この操作は本人のみ利用できます。");
  await meta(bucket, id, participant);
  if (input.state !== undefined && !["open", "working", "done"].includes(String(input.state))) throw new FeedbackError(400, "対応状況を確認してください。");
  if (input.hidden !== undefined && typeof input.hidden !== "boolean") throw new FeedbackError(400, "表示設定を確認してください。");
  await update<ThreadMeta>(bucket, threadKey(id), old => {
    if (!old) throw new FeedbackError(404, "このコメントは見つかりませんでした。");
    return { ...old, ...(input.state !== undefined ? { state: input.state as FeedbackState } : {}), ...(input.hidden !== undefined ? { hidden: input.hidden as boolean } : {}) };
  });
  return getThread(bucket, id, participant);
}
export async function markRead(bucket: R2Bucket, participant: FeedbackIdentity, id: string, input: Record<string, unknown>): Promise<void> {
  await meta(bucket, id, participant);
  const ids = Array.isArray(input.messageIds) ? input.messageIds : [input.messageId];
  if (!ids.length || ids.length > 2000 || !ids.every(validId)) throw new FeedbackError(400, "表示したコメントを確認してください。");
  const exists = new Set((await messages(bucket, id)).map(item => item.id));
  if (ids.some(item => !exists.has(item))) throw new FeedbackError(400, "表示したコメントを確認してください。");
  // 只记录实际显示过的 ID；不能把延迟保存或同一毫秒的新回复误标为已读。
  await update<ReadRecord>(bucket, readKey(id, participant.id), old => ({ ids: [...new Set([...(old?.ids ?? []), ...ids])] }));
}
