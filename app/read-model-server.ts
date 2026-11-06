import { createReadModel, readModelHash } from "@/lib/server/read-model";
import type { ReadModelBatch, ReadModelManifest, ReadModelStatus } from "@/lib/read-model";
import type { Note } from "@/lib/notes";
import { fetchSealedPublishedAsset, publishedAssetSecrets } from "@/lib/server/sealed-assets";

type PublishedIndex = { revision?: string; manifestFile: string; batches: string[]; bodyIndexFile: string };
type PublishedRoot = { publishedAt: string; readModel: PublishedIndex; readModels?: PublishedIndex[] };
type PublishedPolicy = { root: PublishedRoot; indexes: PublishedIndex[]; asset<T>(file: string): Promise<T>; digest: string };
type Source = { manifest: ReadModelManifest; publishedAt: string; batch(index: number): Promise<ReadModelBatch>; note(path: string): Promise<Note | null> };
type Model = ReturnType<typeof createReadModel>;
const models = new WeakMap<D1Database, Model>();
const flights = new WeakMap<Model, Map<string, Promise<void>>>();
const publishedPolicies = new WeakMap<Fetcher, { secret: string | undefined; pending: Promise<PublishedPolicy> }>();
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

/** 发布清单是访问边界；D1 中还存在的旧版本不代表仍获准公开。 */
export async function publishedReadModelPolicy(fresh = false): Promise<PublishedPolicy> {
  const { env } = await import("cloudflare:workers");
  const assets = env.ASSETS;
  if (!assets) throw new ReadModelError("发布资料索引不可用");
  const secrets = publishedAssetSecrets(env as { SITE_ASSET_SECRET?: string; SITE_ASSET_SECRET_NEXT?: string });
  const secret = secrets.join(":");
  const previous = publishedPolicies.get(assets);
  if (!fresh && previous && previous.secret === secret) return previous.pending;
  const pending = (async () => {
    async function asset<T>(file: string): Promise<T> {
      if (file !== "manifest.json" && !assetName.test(file)) throw new ReadModelError("发布索引路径无效");
      const response = await fetchSealedPublishedAsset(assets!, new Request(`http://localhost/_published-vault/${file}`), secrets);
      if (!response.ok) throw new ReadModelError("发布资料尚未准备完成");
      if (file.endsWith(".gz")) {
        if (!response.body) throw new ReadModelError("发布资料内容不完整");
        return new Response(response.body.pipeThrough(new DecompressionStream("gzip"))).json() as Promise<T>;
      }
      return response.json() as Promise<T>;
    }
    const root = await asset<PublishedRoot>("manifest.json");
    if (!root.readModel?.revision || !Array.isArray(root.readModel.batches)) throw new ReadModelError("此发布版本尚未包含资料索引");
    const indexes = [root.readModel, ...(root.readModels ?? [])].filter((item, index, all) =>
      item?.revision && all.findIndex(other => other?.revision === item.revision) === index);
    if (indexes.some(item => !assetName.test(item.manifestFile) || !assetName.test(item.bodyIndexFile)
      || !Array.isArray(item.batches) || item.batches.some(file => !assetName.test(file)))) throw new ReadModelError("发布资料清单无效");
    return { root, indexes, asset, digest: await readModelHash(JSON.stringify(root)) };
  })();
  publishedPolicies.set(assets, { secret, pending });
  try { return await pending; }
  catch (error) { if (publishedPolicies.get(assets)?.pending === pending) publishedPolicies.delete(assets); throw error; }
}

async function source(requestedRevision?: string, baseRevision?: string, selectedPolicy?: PublishedPolicy): Promise<Source> {
  if (process.env.OBSIDIAN_DATA_SOURCE !== "published") {
    const manifest = await bridge<ReadModelManifest>(`/read-model/manifest${baseRevision ? `?${new URLSearchParams({ baseRevision })}` : ""}`);
    return { manifest, publishedAt: "",
      batch: (index) => bridge(`/read-model/batch?${new URLSearchParams({ revision: manifest.revision, index: String(index) })}`),
      note: async (path) => (await bridge<{ note: Note }>(`/read-model/note?${new URLSearchParams({ revision: manifest.revision, path })}`)).note,
    };
  }
  const policy = selectedPolicy ?? await publishedReadModelPolicy();
  const index = requestedRevision ? policy.indexes.find(item => item.revision === requestedRevision) : policy.root.readModel;
  if (!index) throw new ReadModelError("资料版本已过期，请重新读取", 409);
  const { env } = await import("cloudflare:workers");
  const assets = env.ASSETS!;
  let cached = publishedSources.get(assets);
  if (!cached) { cached = new Map(); publishedSources.set(assets, cached); }
  const cacheKey = `${policy.digest}:${index.revision}`;
  const previous = cached.get(cacheKey);
  if (previous) return previous;
  const pending = (async (): Promise<Source> => {
    const manifest = await policy.asset<ReadModelManifest>(index.manifestFile);
    if (manifest.revision !== index.revision || manifest.batchCount !== index.batches.length) throw new ReadModelError("发布资料版本不一致");
    let bodyIndex: Promise<Record<string, string>> | undefined;
    return { manifest, publishedAt: policy.root.publishedAt,
      batch: (position) => policy.asset(index.batches[position]),
      note: async (path) => {
        bodyIndex ??= policy.asset<Record<string, string>>(index.bodyIndexFile).catch((error) => { bodyIndex = undefined; throw error; });
        const bodies = await bodyIndex;
        return bodies[path] ? policy.asset<Note>(bodies[path]) : null;
      },
    };
  })().catch((error) => { cached!.delete(cacheKey); throw error; });
  // 同一部署的资源不可变；仅缓存小清单，正文和批次仍按需读取。
  cached.set(cacheKey, pending);
  while (cached.size > 4) cached.delete(cached.keys().next().value!);
  return pending;
}

async function model() {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new ReadModelError("资料查询数据库尚未连接");
  let current = models.get(env.DB);
  if (!current) { current = createReadModel(env.DB, { retention: process.env.OBSIDIAN_DATA_SOURCE !== "published" }); models.set(env.DB, current); }
  return current;
}

type Runtime = { revision: string; model: Model; sourceUpdatedAt: number; indexedAt: number; syncState: "ready" | "building" | "failed" };
function runtimeState(store: Model, state: ReadModelStatus, syncState: Runtime["syncState"] = "ready"): Runtime {
  return { revision: state.revision, model: store, sourceUpdatedAt: state.sourceUpdatedAt, indexedAt: state.indexedAt, syncState };
}
async function eligibleReady(store: Model, policy?: PublishedPolicy) {
  if (!policy) return store.latest();
  for (const index of policy.indexes) {
    const state = await store.status(index.revision!);
    if (state?.state === "ready") return state;
  }
  return null;
}

/** HTML 只读已有汇总，不为了一个计数启动本机整库同步。 */
export async function readModelReady(): Promise<Runtime | null> {
  const store = await model();
  const policy = process.env.OBSIDIAN_DATA_SOURCE === "published" ? await publishedReadModelPolicy() : undefined;
  const state = await eligibleReady(store, policy);
  return state ? runtimeState(store, state, policy && state.revision !== policy.root.readModel.revision ? "building" : "ready") : null;
}

async function warmSource(store: Model, input: Source, limit: number) {
  const revision = input.manifest.revision;
  const existing = await store.status(revision);
  if (existing?.state === "ready") return { ...existing, publishedAt: input.publishedAt };
  let running = flights.get(store);
  if (!running) { running = new Map(); flights.set(store, running); }
  let pending = running.get(revision);
  if (!pending) {
    pending = (async () => {
      await store.begin(input.manifest);
      // 完成数量不能作为续传位置；乱序批次可能在中间留下缺口。
      for (let count = 0; count < Math.max(1, Math.min(limit, 2)); count++) {
        const index = await store.firstMissingBatch(revision);
        if (index >= input.manifest.batchCount) break;
        await store.importBatch(revision, await input.batch(index), index);
      }
      if (await store.firstMissingBatch(revision) >= input.manifest.batchCount) await store.finish(revision);
    })().finally(() => { running.delete(revision); });
    running.set(revision, pending);
  }
  await pending;
  return { ...(await store.status(revision))!, publishedAt: input.publishedAt };
}

/** 同一次预热沿用已选清单，不能再次读来源后把新版本状态贴到旧版本上。 */
export async function warmReadModel(limit = 2) {
  const store = await model();
  const input = await source(undefined, process.env.OBSIDIAN_DATA_SOURCE === "published" ? undefined : (await store.latest())?.revision);
  return warmSource(store, input, limit);
}

export async function readModelRuntime(requestedRevision?: string | null): Promise<Runtime> {
  const store = await model();
  const published = process.env.OBSIDIAN_DATA_SOURCE === "published";
  // 线上即使 D1 已 ready，也必须先验证部署清单；读取失败时不能回退泄露撤回资料。
  const policy = published ? await publishedReadModelPolicy() : undefined;
  if (requestedRevision) {
    if (policy && !policy.indexes.some(index => index.revision === requestedRevision)) throw new ReadModelError("资料版本已过期，请重新读取", 409);
    const fixed = await store.status(requestedRevision);
    if (fixed?.state === "ready") return runtimeState(store, fixed);
    if ((!published && !fixed) || (policy && requestedRevision !== policy.root.readModel.revision)) throw new ReadModelError("资料版本已过期，请重新读取", 409);
  }
  let input: Source;
  try { input = await source(undefined, published ? undefined : (await store.latest())?.revision, policy); }
  catch (error) {
    const previous = requestedRevision ? null : await eligibleReady(store, policy);
    if (previous?.state === "ready") return runtimeState(store, previous, "failed");
    throw error;
  }
  if (requestedRevision && requestedRevision !== input.manifest.revision) throw new ReadModelError("资料版本已过期，请重新读取", 409);
  const state = await store.status(input.manifest.revision);
  if (state?.state === "ready") return runtimeState(store, state);
  let warmed;
  try { warmed = await warmSource(store, input, 2); }
  catch (error) {
    const previous = requestedRevision ? null : await eligibleReady(store, policy);
    if (previous?.state === "ready") return runtimeState(store, previous, "failed");
    throw error;
  }
  if (warmed.state !== "ready") {
    const previous = requestedRevision ? null : await eligibleReady(store, policy);
    if (previous?.state === "ready") return runtimeState(store, previous, "building");
    throw new ReadModelError("资料索引正在同步，请稍候", 503, true);
  }
  return runtimeState(store, warmed);
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
