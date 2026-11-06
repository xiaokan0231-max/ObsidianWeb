/** 维护只回收当前发布清单明确撤回的派生资料；业务请求不触发物理删除。 */
type Database = Pick<D1Database, "prepare" | "batch">;
export type MaintenancePolicy = { revision: string; digest: string; allowed: string[] };
type MaintenanceEnv = { DB?: Database; SITE_MAINTENANCE_SECRET?: string };
const tables = ["read_model_catalog", "read_model_aliases", "read_model_links", "read_model_records", "read_model_batches", "read_model_content_refs", "calendar_projection_summaries"] as const;
const LIMIT = 1000;
class MaintenanceError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { "Cache-Control": "private, no-store", ...(status === 503 ? { "Retry-After": "1" } : {}) } }); }
async function authorized(request: Request, secret: string) {
  const header = request.headers.get("Authorization") ?? "";
  if (!header.startsWith("Bearer ") || header.length > 1024) return false;
  const bytes = new TextEncoder();
  const [a, b] = await Promise.all([header.slice(7), secret].map(value => crypto.subtle.digest("SHA-256", bytes.encode(value))));
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}
async function rows<T>(db: Database, sql: string, values: unknown[] = []): Promise<T[]> {
  const [result] = await db.batch([db.prepare(sql).bind(...values)]);
  if (!result.success) throw new MaintenanceError(503, "维护存储暂不可用");
  return result.results as T[];
}
async function inputBody(request: Request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("Content-Type") ?? "")) throw new MaintenanceError(415, "需要 JSON 请求");
  const reader = request.body?.getReader();
  if (!reader) throw new MaintenanceError(400, "缺少维护参数");
  const parts: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 16_384) { await reader.cancel(); throw new MaintenanceError(413, "维护参数过大"); }
    parts.push(value);
  }
  const buffer = new Uint8Array(size); let offset = 0;
  for (const part of parts) { buffer.set(part, offset); offset += part.byteLength; }
  try {
    const value = JSON.parse(new TextDecoder().decode(buffer));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as { dryRun?: boolean; expectedRevision?: string; manifestDigest?: string; revisions?: unknown };
  } catch { throw new MaintenanceError(400, "维护参数无效"); }
}
export async function handleReadModelMaintenance(request: Request, env: MaintenanceEnv, readPolicy: () => Promise<MaintenancePolicy>) {
  try {
    if (request.method !== "POST") throw new MaintenanceError(405, "只允许 POST");
    if (!env.DB || !env.SITE_MAINTENANCE_SECRET || env.SITE_MAINTENANCE_SECRET.length < 32) throw new MaintenanceError(503, "维护入口未启用");
    if (!await authorized(request, env.SITE_MAINTENANCE_SECRET)) throw new MaintenanceError(403, "维护凭据无效");
    const origin = request.headers.get("Origin");
    if (request.headers.get("Sec-Fetch-Site") === "cross-site" || (origin && origin !== new URL(request.url).origin)) throw new MaintenanceError(403, "维护来源无效");
    const input = await inputBody(request), policy = await readPolicy(), db = env.DB;
    const protectedRevisions = [...new Set([policy.revision, ...policy.allowed])];
    const [current] = await rows<{ state: string; created_at: number }>(db, "SELECT state,created_at FROM read_model_revisions WHERE revision=?", [policy.revision]);
    if (current?.state !== "ready") throw new MaintenanceError(409, "当前发布索引必须先完成预热");
    const candidates = await rows<{ revision: string }>(db, `SELECT revision FROM read_model_revisions
      WHERE created_at<=? AND revision NOT IN (SELECT value FROM json_each(?)) ORDER BY created_at,revision LIMIT 100`, [current.created_at, JSON.stringify(protectedRevisions)]);
    if (input.dryRun === true) return json({ revision: policy.revision, manifestDigest: policy.digest, revisions: candidates.map(item => item.revision), dryRun: true });
    if (input.dryRun !== false || input.expectedRevision !== policy.revision || input.manifestDigest !== policy.digest) throw new MaintenanceError(409, "发布版本已变动，请重新预检");
    if (!Array.isArray(input.revisions) || input.revisions.length > 100 || input.revisions.some(value => typeof value !== "string" || !value || value.length > 240)) throw new MaintenanceError(400, "清理版本无效");
    const selected = [...new Set(input.revisions as string[])];
    // 已删版本允许幂等重试，但不接受白名单内或晚于当前部署的版本。
    for (const revision of selected) {
      if (protectedRevisions.includes(revision)) throw new MaintenanceError(409, "不能清理仍获准的资料");
      const [existing] = await rows<{ created_at: number }>(db, "SELECT created_at FROM read_model_revisions WHERE revision=?", [revision]);
      if (existing && !candidates.some(item => item.revision === revision)) throw new MaintenanceError(409, "清理集合已变动，请重新预检");
    }
    const fresh = await readPolicy();
    if (fresh.digest !== policy.digest || fresh.revision !== policy.revision
      || JSON.stringify([...new Set(fresh.allowed)].sort()) !== JSON.stringify([...new Set(policy.allowed)].sort())) throw new MaintenanceError(409, "发布清单已变动，请重新预检");
    // 一轮只删有限行；所有语句同一事务，引用尚存时不会删除共享正文块。
    const statements: D1PreparedStatement[] = [];
    for (const revision of selected.filter(value => candidates.some(item => item.revision === value)).slice(0, 1)) {
      // 校验与事务之间可能有另一个部署重建同名版本；删除时再次限制创建时刻。
      const eligible = "EXISTS (SELECT 1 FROM read_model_revisions WHERE revision=?1 AND created_at<=?2)";
      for (const table of tables) statements.push(db.prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE revision=?1 AND ${eligible} LIMIT ${LIMIT})`).bind(revision, current.created_at));
      statements.push(db.prepare(`DELETE FROM read_model_revisions WHERE revision=?1 AND created_at<=?2 AND ${tables.map(table => `NOT EXISTS (SELECT 1 FROM ${table} WHERE revision=?1)`).join(" AND ")}`).bind(revision, current.created_at));
    }
    statements.push(db.prepare(`DELETE FROM read_model_chunks WHERE id IN (SELECT c.id FROM read_model_chunks c WHERE NOT EXISTS (SELECT 1 FROM read_model_content_refs r WHERE r.hash=c.hash) LIMIT ${LIMIT})`));
    if (statements.length && (await db.batch(statements)).some(result => !result.success)) throw new MaintenanceError(503, "清理尚未完成，请重试");
    const remaining = await rows<{ revision: string }>(db, "SELECT revision FROM read_model_revisions WHERE revision IN (SELECT value FROM json_each(?))", [JSON.stringify(selected)]);
    const [orphans] = await rows<{ count: number }>(db, "SELECT COUNT(*) count FROM read_model_chunks c WHERE NOT EXISTS (SELECT 1 FROM read_model_content_refs r WHERE r.hash=c.hash)");
    return json({ revision: policy.revision, remaining: remaining.map(item => item.revision), orphanChunks: orphans.count, complete: remaining.length === 0 && orphans.count === 0 });
  } catch (error) {
    return error instanceof MaintenanceError ? json({ error: error.message }, error.status) : json({ error: "维护操作暂未完成，请重试" }, 503);
  }
}
