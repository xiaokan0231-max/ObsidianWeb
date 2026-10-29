type CollectionPage = { revision: string; items: unknown[]; nextCursor?: string | null };
export type ReadModelFetcher = (url: string, options: RequestInit) => Promise<Response>;
export type ReadModelSyncState = "ready" | "building" | "failed";
export type ReadModelReadOptions = { retryBudgetMs?: number; pollDelayMs?: number };

export function readModelSyncState(page: unknown): ReadModelSyncState {
  const value = page && typeof page === "object" ? (page as { syncState?: unknown }).syncState : null;
  return value === "building" || value === "failed" ? value : "ready";
}

function waitForRetry(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

export async function fetchReadModelReady(target: string, signal: AbortSignal, fetcher: ReadModelFetcher = fetch, retryBudgetMs = 60_000) {
  const deadline = Date.now() + retryBudgetMs;
  while (true) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const response = await fetcher(target, { signal, cache: "no-store" });
    const retryAfter = response.headers.get("Retry-After");
    if (response.status !== 503 || retryAfter === null) return response;
    const seconds = Number(retryAfter);
    const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
    const remaining = deadline - Date.now();
    if (!Number.isFinite(delay) || delay < 0 || remaining <= 0) return response;
    // 初次构建可能分批导入；等待期间保留上一完整目录，换查询或关闭时立即取消。
    await waitForRetry(Math.min(Math.max(1, delay), remaining), signal);
    if (Date.now() >= deadline) return response;
  }
}

export class ReadModelFetchError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.name = "ReadModelFetchError"; this.status = status; }
}

/** 更新分批进行时先展示完整旧版；后续请求推动导入，最多等待一分钟。 */
export async function readReadModelJSON<T>(target: string, signal: AbortSignal, fetcher: ReadModelFetcher = fetch, onProgress?: (page: T) => void, { retryBudgetMs = 60_000, pollDelayMs = 1000 }: ReadModelReadOptions = {}): Promise<T> {
  const deadline = Date.now() + retryBudgetMs;
  while (true) {
    const response = await fetchReadModelReady(target, signal, fetcher, Math.max(0, deadline - Date.now()));
    const body = await response.json() as T & { error?: unknown };
    if (!response.ok) throw new ReadModelFetchError(typeof body?.error === "string" ? body.error : `资料读取失败（${response.status}）`, response.status);
    if (readModelSyncState(body) !== "building") return body;
    onProgress?.(body);
    const remaining = deadline - Date.now();
    if (remaining <= 0) return body;
    await waitForRetry(Math.min(pollDelayMs, remaining), signal);
    if (Date.now() >= deadline) return body;
  }
}

export type ReadModelResourceState<T extends CollectionPage> = {
  page: T | null;
  items: T["items"];
  loading: boolean;
  error: string;
  syncState: ReadModelSyncState | null;
};

/** 目录和正文使用不同缓存：这里仅接收显式的卡片 DTO，不接受精简 Note 混进正文集合。 */
export function createReadModelResource<T extends CollectionPage>(fetcher: ReadModelFetcher = fetch, options: ReadModelReadOptions = {}) {
  const initial: ReadModelResourceState<T> = { page: null, items: [], loading: false, error: "", syncState: null };
  let state = initial;
  let address = "";
  let generation = 0;
  let pending: Promise<void> | null = null;
  let controller: AbortController | null = null;
  const subscribers = new Set<() => void>();
  const publish = (next: ReadModelResourceState<T>) => { state = next; subscribers.forEach((notify) => notify()); };

  function request(cursor?: string): Promise<void> {
    const id = ++generation;
    controller?.abort();
    controller = new AbortController();
    const active = controller;
    publish({ ...state, loading: true, error: "" });
    const params = new URLSearchParams(address.split("?")[1] ?? "");
    if (cursor) params.set("cursor", cursor);
    const target = `${address.split("?")[0]}?${params.toString()}`;
    const previousItems = state.items;
    const previousRevision = state.page?.revision;
    const accept = (body: T) => {
      if (!body || typeof body.revision !== "string" || !Array.isArray(body.items)
        || body.items.some((item) => !item || typeof item !== "object" || (item as { kind?: unknown }).kind !== "note-card")) throw new Error("资料目录格式无效");
      if (id !== generation || active.signal.aborted || cursor && previousRevision !== body.revision) return;
      publish({ page: body, items: cursor ? [...previousItems, ...body.items] : body.items, loading: false, error: "", syncState: readModelSyncState(body) });
    };
    const task = (async () => {
      try {
        const body = await readReadModelJSON<T>(target, active.signal, fetcher, accept, options);
        if (id !== generation) return;
        if (cursor && previousRevision !== body.revision) { await request(); return; }
        accept(body);
      } catch (error) {
        if (id !== generation || active.signal.aborted) return;
        // 翻页时旧版本已回收：回到同一筛选的第一页，不能将两版目录拼接。
        if (error instanceof ReadModelFetchError && error.status === 409 && cursor) { await request(); return; }
        publish({ ...state, loading: false, error: error instanceof Error ? error.message : "资料读取失败" });
      }
    })().finally(() => { if (id === generation) pending = null; });
    pending = task;
    return task;
  }

  return {
    subscribe(notify: () => void) { subscribers.add(notify); return () => { subscribers.delete(notify); }; },
    getState: () => state,
    getServerState: () => initial,
    query(url: string, force = false) {
      if (address !== url) {
        address = url;
        publish({ ...initial });
      } else if (!force) {
        if (pending) return pending;
        if (state.page) return Promise.resolve();
      }
      return request();
    },
    more() { return state.loading ? pending ?? Promise.resolve() : state.page?.nextCursor ? request(state.page.nextCursor) : pending ?? Promise.resolve(); },
    retry() { return request(); },
    dispose() { generation++; controller?.abort(); controller = null; pending = null; },
  };
}
