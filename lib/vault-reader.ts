import { mergePendingWrites, type PendingWrite } from "./memory-atlas-data.ts";
import type { Note } from "./notes.ts";
import { mergeScopedNotes } from "./vault-merge.ts";
import { noteInVaultScope, type VaultScope } from "./vault-scope.ts";

export type VaultReaderState = {
  notes: Note[];
  readyScopes: ReadonlySet<VaultScope>;
  loadingScopes: ReadonlySet<VaultScope>;
  loading: boolean;
  requestCount: number;
  errors: ReadonlyMap<VaultScope, string>;
  checkedAt: ReadonlyMap<VaultScope, number>;
  fetchedAt: number | null;
};

export type VaultReadOptions = { scope?: VaultScope; fresh?: boolean };
export type VaultReadResult = {
  status: "accepted" | "superseded" | "error";
  scope: VaultScope;
  notes: Note[];
  error?: string;
};

type ScopeSnapshot = {
  scope: VaultScope;
  sequence: number;
  notes: Note[];
  paths?: ReadonlySet<string>;
  etag: string | null;
  checkedAt: number;
};

type ReadRequest = {
  id: number;
  epoch: number;
  scope: VaultScope;
  fresh: boolean;
  controller: AbortController;
  promise: Promise<VaultReadResult>;
  resolve: (result: VaultReadResult) => void;
  settled: boolean;
};

type VaultPayload = {
  connected: boolean;
  notes: Note[];
  paths?: string[];
  error?: string;
};

/**
 * 不同 scope 含有共同笔记，却也各有独有资料。不能用一个全局 latestRequestId 丢整批：
 * 逐路径取较新的快照，而较新 scope 的完整 paths 缺项也是证据，能阻止旧响应复活删除项。
 */
function projectSnapshots(snapshots: Iterable<ScopeSnapshot>): Note[] {
  const ordered = [...snapshots].sort((left, right) => right.sequence - left.sequence);
  const chosen = new Map<string, Note>();
  const decided = new Set<string>();
  const newer: ScopeSnapshot[] = [];
  for (const snapshot of ordered) {
    for (const note of snapshot.notes) {
      if (decided.has(note.path)) continue;
      // 已被较新快照删除的路径也要记住；更旧版本曾属于另一种 type 不能让它复活。
      decided.add(note.path);
      const deleted = newer.some((later) => later.paths
        && noteInVaultScope(note, later.scope) && !later.paths.has(note.path));
      if (!deleted) chosen.set(note.path, note);
    }
    newer.push(snapshot);
  }
  return [...chosen.values()].sort((left, right) => right.stat.mtime - left.stat.mtime);
}

/** 页面读取的协调器；没有 React 依赖，测试可以控制响应到达次序。 */
export function createVaultReader({
  fetcher = fetch,
  now = Date.now,
  timeoutMs = 20_000,
}: {
  fetcher?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
} = {}) {
  const snapshots = new Map<VaultScope, ScopeSnapshot>();
  const active = new Map<number, ReadRequest>();
  const pendingWrites = new Map<string, PendingWrite>();
  const errors = new Map<VaultScope, string>();
  const listeners = new Set<() => void>();
  let sequence = 0;
  let epoch = 0;
  let notes: Note[] = [];
  let state: VaultReaderState = {
    notes, readyScopes: new Set(), loadingScopes: new Set(), loading: false,
    requestCount: 0, errors: new Map(), checkedAt: new Map(), fetchedAt: null,
  };

  function publish() {
    const checkedAt = new Map([...snapshots].map(([scope, snapshot]) => [scope, snapshot.checkedAt]));
    state = {
      notes,
      readyScopes: new Set(snapshots.keys()),
      loadingScopes: new Set([...active.values()].map((request) => request.scope)),
      loading: active.size > 0,
      requestCount: active.size,
      errors: new Map(errors),
      checkedAt,
      fetchedAt: checkedAt.size ? Math.max(...checkedAt.values()) : null,
    };
    for (const listener of listeners) listener();
  }

  function current(request: ReadRequest) {
    return !request.settled && request.epoch === epoch && active.get(request.id) === request;
  }

  function finish(request: ReadRequest, status: VaultReadResult["status"], error?: string, notify = true) {
    if (request.settled) return;
    request.settled = true;
    active.delete(request.id);
    if (notify) publish();
    request.resolve({ status, scope: request.scope, notes, ...(error ? { error } : {}) });
  }

  function supersedeAll() {
    epoch += 1;
    for (const request of [...active.values()]) {
      // 共享 Promise 立即告诉所有等待者被替代；不依赖 fetch 实现何时处理 abort。
      finish(request, "superseded", undefined, false);
      request.controller.abort();
    }
  }

  function accept(request: ReadRequest, snapshot: ScopeSnapshot) {
    if (!current(request)) return;
    if (request.scope === "all") {
      snapshots.clear();
      errors.clear();
    } else errors.delete(request.scope);
    snapshots.set(request.scope, snapshot);
    // 乐观写入最后叠加，旧 paths 不能删掉请求开始以后才创建的笔记。
    const merged = mergePendingWrites(projectSnapshots(snapshots.values()), pendingWrites, now());
    notes = merged.notes;
    for (const path of merged.settled) pendingWrites.delete(path);
    finish(request, "accepted");
  }

  async function run(request: ReadRequest) {
    const previous = snapshots.get(request.scope);
    const etag = request.fresh ? null : previous?.etag;
    const params = new URLSearchParams({ scope: request.scope });
    if (request.fresh) params.set("refresh", "1");
    const signal = AbortSignal.any([request.controller.signal, AbortSignal.timeout(timeoutMs)]);
    const read = (validator?: string | null) => fetcher(`/api/vault?${params}`, {
      cache: "no-store", headers: validator ? { "If-None-Match": validator } : {}, signal,
    });
    try {
      let response = await read(etag);
      if (!current(request)) return;
      if (response.status === 304 && (!etag || !previous)) {
        // 没有与验证器对应的原始快照，304 就没有可重用的数据；无条件重试一次。
        response = await read();
        if (!current(request)) return;
        if (response.status === 304) throw new Error("服务端返回了没有本地快照可用的 304 响应");
      }
      if (response.status === 304 && previous) {
        accept(request, { ...previous, sequence: request.id, checkedAt: now() });
        return;
      }
      const payload = await response.json() as VaultPayload;
      if (!current(request)) return;
      if (!response.ok || !payload.connected || !Array.isArray(payload.notes)) {
        throw new Error(payload.error || "无法连接 Obsidian");
      }
      const paths = payload.paths
        ? new Set(payload.paths)
        : request.scope === "all" ? new Set(payload.notes.map((note) => note.path)) : undefined;
      accept(request, {
        scope: request.scope,
        sequence: request.id,
        // 兼容没有 paths 的旧接口：只更新、不推断 scope 内的删除。
        notes: mergeScopedNotes(previous?.notes ?? [], payload.notes, request.scope, payload.paths),
        paths,
        etag: response.headers.get("ETag"),
        checkedAt: now(),
      });
    } catch (error) {
      if (!current(request)) return;
      const message = error instanceof Error ? error.message : "无法连接 Obsidian";
      errors.set(request.scope, message);
      finish(request, "error", message);
    }
  }

  function request(options: VaultReadOptions = {}): Promise<VaultReadResult> {
    const scope = options.fresh ? "all" : options.scope ?? "all";
    if (!options.fresh) {
      const shared = [...active.values()].find((item) => item.scope === "all" || item.scope === scope);
      if (shared) return shared.promise;
    }
    if (scope === "all") supersedeAll();
    // R 是「以服务端为准」；之后发生的 patchNote 会重新登记，不会被这次清理波及。
    if (options.fresh) pendingWrites.clear();
    errors.delete(scope);
    let resolve!: ReadRequest["resolve"];
    const promise = new Promise<VaultReadResult>((done) => { resolve = done; });
    const next: ReadRequest = {
      id: ++sequence, epoch, scope, fresh: options.fresh ?? false,
      controller: new AbortController(), promise, resolve, settled: false,
    };
    active.set(next.id, next);
    publish();
    void run(next);
    return promise;
  }

  return {
    request,
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    patchNote(note: Note) {
      pendingWrites.set(note.path, { note, at: now() });
      const byPath = new Map(notes.map((item) => [item.path, item]));
      byPath.set(note.path, note);
      notes = [...byPath.values()].sort((left, right) => right.stat.mtime - left.stat.mtime);
      publish();
    },
    dispose() {
      // StrictMode 会清理后重放 effect，因此只取消读取，不永久关闭实例或清掉订阅者。
      supersedeAll();
      publish();
    },
  };
}
