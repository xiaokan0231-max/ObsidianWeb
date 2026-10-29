import { createReadModel, readModelHash } from "@/lib/server/read-model";
import type { ReadModelBatch, ReadModelManifest } from "@/lib/read-model";
import type { Note } from "@/lib/notes";

type PublishedIndex = { revision?: string; manifestFile: string; batches: string[]; bodyIndexFile: string };
type Source = { manifest: ReadModelManifest; publishedAt: string; batch(index: number): Promise<ReadModelBatch>; note(path: string): Promise<Note | null> };
type Model = ReturnType<typeof createReadModel>;
const models = new WeakMap<D1Database, Model>();
const flights = new Map<string, Promise<void>>();
const publishedSources = new WeakMap<Fetcher, Map<string, Promise<Source>>>();
const assetName = /^[a-f0-9]{24}\.json(?:\.gz)?$/;

export class ReadModelError extends Error {
  readonly status: number;
  readonly building: boolean;
  constructor(message: string, status = 503, building = false) { super(message); this.status = status; this.building = building; }
}

async function bridge<T>(path: string, init?: RequestInit): Promise<T> {
  const token = process.env.CODEX_BRIDGE_TOKEN;
  if (!token) throw new ReadModelError("本地资料索引未连接，请使用 npm run dev 启动");
  const response = await fetch(`${process.env.CODEX_BRIDGE_URL ?? "http://127.0.0.1:43127"}${path}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, cache: "no-store", signal: AbortSignal.timeout(90_000),
  });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new ReadModelError(data.error || "资料索引来源读取失败", response.status);
  return data;
}

async function source(requestedRevision?: string, baseRevision?: string): Promise<Source> {
  if (process.env.OBSIDIAN_DATA_SOURCE !== "published") {
    const manifest = await bridge<ReadModelManifest>(`/read-model/manifest${baseRevision ? `?${new URLSearchParams({ baseRevision })}` : ""}`);
    return { manifest, publishedAt: "",
      batch: (index) => bridge(`/read-model/batch?${new URLSearchParams({ revision: manifest.revision, index: String(index) })}`),
      note: async (path) => (await bridge<{ note: Note }>(`/read-model/note?${new URLSearchParams({ revision: manifest.revision, path })}`)).note,
    };
  }
  const { env } = await import("cloudflare:workers");
  const assets = env.ASSETS;
  if (!assets) throw new ReadModelError("发布资料索引不可用");
  let cached = publishedSources.get(assets);
  if (!cached) { cached = new Map(); publishedSources.set(assets, cached); }
  const cacheKey = requestedRevision || "current";
  const previous = cached.get(cacheKey);
  if (previous) return previous;
  const pending = (async (): Promise<Source> => {
  async function asset<T>(file: string): Promise<T> {
    if (file !== "manifest.json" && !assetName.test(file)) throw new ReadModelError("发布索引路径无效");
    const response = await assets!.fetch(new Request(`http://localhost/_published-vault/${file}`, file.endsWith(".gz") ? { headers: { "Accept-Encoding": "identity" } } : undefined));
    if (!response.ok) throw new ReadModelError("发布资料尚未准备完成");
    // 索引批次与单篇正文直接以 gzip 存盘，避免部署归档保存多份膨胀的 JSON。
    if (file.endsWith(".gz")) {
      if (!response.body) throw new ReadModelError("发布资料内容不完整");
      return new Response(response.body.pipeThrough(new DecompressionStream("gzip"))).json() as Promise<T>;
    }
    return response.json() as Promise<T>;
  }
  const published = await asset<{ publishedAt: string; readModel?: PublishedIndex; readModels?: PublishedIndex[] }>("manifest.json");
  const index = requestedRevision ? [published.readModel, ...(published.readModels ?? [])].find((item) => item?.revision === requestedRevision) : published.readModel;
  if (requestedRevision && !index) throw new ReadModelError("资料版本已过期，请重新读取", 409);
  if (!index) throw new ReadModelError("此发布版本尚未包含资料索引");
  const manifest = await asset<ReadModelManifest>(index.manifestFile);
  let bodyIndex: Promise<Record<string, string>> | undefined;
  return { manifest, publishedAt: published.publishedAt,
    batch: (position) => asset(index.batches[position]),
    note: async (path) => {
      bodyIndex ??= asset<Record<string, string>>(index.bodyIndexFile).catch((error) => { bodyIndex = undefined; throw error; });
      const bodies = await bodyIndex;
      return bodies[path] ? asset<Note>(bodies[path]) : null;
    },
  };
  })().catch((error) => { cached!.delete(cacheKey); throw error; });
  // 同一部署的资源不可变；只缓存目录清单，不把完整正文或索引批次留在 Worker 内存。
  cached.set(cacheKey, pending);
  while (cached.size > 4) cached.delete(cached.keys().next().value!);
  return pending;
}

async function model() {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new ReadModelError("资料查询数据库尚未连接");
  let current = models.get(env.DB);
  if (!current) { current = createReadModel(env.DB); models.set(env.DB, current); }
  return current;
}

/** 每次请求只导入少量已生成批次；整库构建不在 Worker 中执行。 */
export async function warmReadModel(limit = 2) {
  const store = await model();
  const input = await source(undefined, process.env.OBSIDIAN_DATA_SOURCE === "published" ? undefined : (await store.latest())?.revision);
  const revision = input.manifest.revision;
  const existing = await store.status(revision);
  if (existing?.state === "ready") return { ...existing, publishedAt: input.publishedAt };
  let pending = flights.get(revision);
  if (!pending) {
    pending = (async () => {
      await store.begin(input.manifest);
      const state = await store.status(revision);
      const start = state?.completedBatches ?? 0;
      for (let index = start; index < Math.min(input.manifest.batchCount, start + Math.max(1, Math.min(limit, 2))); index++) {
        await store.importBatch(revision, await input.batch(index), index);
      }
      if (start + Math.max(1, Math.min(limit, 2)) >= input.manifest.batchCount) await store.finish(revision);
    })().finally(() => { flights.delete(revision); });
    flights.set(revision, pending);
  }
  await pending;
  return { ...(await store.status(revision))!, publishedAt: input.publishedAt };
}

export async function readModelRuntime(requestedRevision?: string | null) {
  const store = await model();
  let input: Source;
  try { input = await source(undefined, process.env.OBSIDIAN_DATA_SOURCE === "published" ? undefined : (await store.latest())?.revision); }
  catch (error) {
    const previous = requestedRevision ? await store.status(requestedRevision) : await store.latest();
    if (previous?.state === "ready") return { revision: previous.revision, model: store, sourceUpdatedAt: previous.sourceUpdatedAt, indexedAt: previous.indexedAt, syncState: "failed" };
    throw error;
  }
  const revision = requestedRevision || input.manifest.revision;
  const state = await store.status(revision);
  if (state?.state === "ready") return { revision, model: store, sourceUpdatedAt: state.sourceUpdatedAt, indexedAt: state.indexedAt, syncState: "ready" };
  if (revision !== input.manifest.revision) throw new ReadModelError("资料版本已过期，请重新读取", 409);
  let warmed;
  try { warmed = await warmReadModel(); }
  catch (error) {
    const previous = requestedRevision ? null : await store.latest();
    if (previous?.state === "ready") return { revision: previous.revision, model: store, sourceUpdatedAt: previous.sourceUpdatedAt, indexedAt: previous.indexedAt, syncState: "failed" };
    throw error;
  }
  if (warmed.state !== "ready") {
    const previous = requestedRevision ? null : await store.latest();
    if (previous?.state === "ready") return { revision: previous.revision, model: store, sourceUpdatedAt: previous.sourceUpdatedAt, indexedAt: previous.indexedAt, syncState: "building" };
    throw new ReadModelError("资料索引正在同步，请稍候", 503, true);
  }
  return { revision, model: store, sourceUpdatedAt: warmed.sourceUpdatedAt, indexedAt: warmed.indexedAt, syncState: "ready" };
}

export async function readModelSource() {
  if (process.env.OBSIDIAN_DATA_SOURCE === "published") throw new ReadModelError("公网查询只读取已发布投影");
  const input = await source();
  // 仅索引构建和迁移适配使用，普通查询不能读取整库。
  const { readAllNotes } = await import("@/lib/server/obsidian");
  return { revision: input.manifest.revision, notes: await readAllNotes(), publishedAt: input.publishedAt };
}

export async function readModelNote(path: string, revision: string) {
  if (process.env.OBSIDIAN_DATA_SOURCE !== "published") {
    try { return (await bridge<{ note: Note }>(`/read-model/note?${new URLSearchParams({ revision, path })}`)).note; }
    catch (error) {
      if (!(error instanceof ReadModelError) || error.status !== 409) throw error;
      // Bridge 重启会丢失内存中的旧正文，但 D1 仍有完整旧版。只有正文和元数据哈希完全相同才可恢复。
      const store = await model();
      const card = await store.getCard(revision, path);
      if (!card) throw error;
      const current = await source(undefined, (await store.latest())?.revision);
      const note = await current.note(path);
      if (!note || await readModelHash(JSON.stringify({ path: note.path, content: note.content, frontmatter: note.frontmatter })) !== card.bodyHash) throw error;
      return note;
    }
  }
  const input = await source(revision);
  if (input.manifest.revision !== revision) throw new ReadModelError("资料版本已更新，请重新读取", 409);
  const note = await input.note(path);
  if (!note) throw new ReadModelError("找不到这篇资料", 404);
  return note;
}

export function readModelFailure(error: unknown) {
  const candidate = error as { status?: number } | null;
  const status = candidate && [400, 404, 409, 503].includes(candidate.status ?? 0) ? candidate.status! : 503;
  return Response.json({ error: error instanceof Error ? error.message : "资料查询失败", ...(error instanceof ReadModelError && error.building ? { state: "building" } : {}) },
    { status, headers: { "Cache-Control": "no-store", ...(status === 503 ? { "Retry-After": "1" } : {}) } });
}
