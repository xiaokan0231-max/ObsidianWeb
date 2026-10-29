import { createVaultCache } from "../lib/server/vault-cache.ts";
import { isOperationalPath } from "../lib/vault-boundary.mjs";

/** 宿主 Node 构建索引，避免在 128MB Worker 内复制、解析整库正文。 */
export function createLocalReadModelSource({ base, key, build, fetcher = fetch }) {
  const snapshots = new Map();
  let current = null;
  let pending = null;
  let generation = 0;
  const get = async (path, init = {}) => {
    const response = await fetcher(`${base.replace(/\/$/, "")}${path}`, { ...init,
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json", ...init.headers }, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`资料索引来源读取失败（${response.status}）`);
    return response.json();
  };
  const readNote = (path) => get(`/vault/${encodeURIComponent(path)}`, { headers: { Accept: "application/vnd.olrapi.note+json" } });
  async function list(prefix = "") {
    const listing = await get(`/vault/${encodeURIComponent(prefix)}`);
    const paths = [];
    for (const entry of listing.files ?? []) {
      const path = prefix + entry;
      if (!isOperationalPath(path)) continue;
      if (entry.endsWith("/")) paths.push(...await list(path));
      else if (entry.toLowerCase().endsWith(".md")) paths.push(path);
    }
    return paths;
  }
  const cache = createVaultCache({ readNote,
    statAllNotes: async () => {
      try {
        const rows = await get("/search/", { method: "POST", headers: { "Content-Type": "application/vnd.olrapi.jsonlogic+json" }, body: JSON.stringify({ var: "stat.mtime" }) });
        return new Map(rows.filter((row) => row.filename?.toLowerCase().endsWith(".md") && isOperationalPath(row.filename) && typeof row.result === "number").map((row) => [row.filename, row.result]));
      } catch { return null; }
    },
    crawlAllNotes: async () => {
      const paths = await list();
      const notes = new Array(paths.length); let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(8, paths.length) }, async () => { while (cursor < paths.length) { const index = cursor++; notes[index] = await readNote(paths[index]); } }));
      return notes;
    },
  });
  async function manifest(force = false, baseRevision) {
    if (pending) return pending;
    pending = (async () => {
      // 写入通知可能在索引生成途中到达；发布本次结果前再核对世代，不能固定旧正文。
      for (;;) {
        const started = generation;
        const notes = await cache.readAll({ force });
        const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
        if (started !== generation) continue;
        const base = baseRevision ? snapshots.get(baseRevision) : null;
        if (current && current.today === today && current.notes.length === notes.length && current.notes.every((note, index) => note === notes[index])) {
          if (base?.datasetRevision === current.datasetRevision) return base.artifact.manifest;
          const variant = [...snapshots.values()].find((entry) => entry.datasetRevision === current.datasetRevision && entry.artifact.manifest.baseRevision === (base ? baseRevision : undefined));
          if (variant) return variant.artifact.manifest;
        }
        // 只从宿主仍保留、且调用端声明已就绪的基版借用内容块；Bridge 重启后自动回到全量批次。
        const artifact = await build(notes, today, undefined, base ? { baseRevision, skipContentHashes: new Set(Object.keys(base.artifact.manifest.hashes)) } : {});
        if (started !== generation) continue;
        const datasetRevision = artifact.manifest.revision.replace(/-from-[a-f0-9]{64}$/, "");
        const entry = { today, notes: [...notes], datasetRevision, artifact, byPath: new Map(notes.map((note) => [note.path, note])) };
        snapshots.delete(artifact.manifest.revision);
        snapshots.set(artifact.manifest.revision, entry);
        current = entry;
        while (snapshots.size > 3) snapshots.delete(snapshots.keys().next().value);
        return artifact.manifest;
      }
    })().finally(() => { pending = null; });
    return pending;
  }
  return { manifest,
    batch(revision, index) { return snapshots.get(revision)?.artifact.batches[index] ?? null; },
    note(revision, path) { return snapshots.get(revision)?.byPath.get(path) ?? null; },
    notes(revision) { return snapshots.get(revision)?.notes ?? null; },
    invalidate(paths) { for (const path of paths) if (isOperationalPath(path)) { cache.invalidate(path); generation++; } },
  };
}

export async function buildApplicationReadModel(notes, today, publishedAt, options = {}) {
  const [{ buildReadModelArtifact, readModelHash }, { buildInterviewReadModelRecords }, { buildCalendarReadModelRecords }] = await Promise.all([
    import("../lib/server/read-model-build.ts"), import("../lib/interview-read-model.ts"), import("../lib/calendar-query-model.ts"),
  ]);
  const records = [...buildCalendarReadModelRecords(notes, today), ...buildInterviewReadModelRecords(notes, { today })];
  const artifact = await buildReadModelArtifact(notes, { records, publishedAt, skipContentHashes: options.skipContentHashes });
  artifact.manifest.revision = `rm-v2-${artifact.manifest.revision}`;
  if (options.baseRevision) { artifact.manifest.baseRevision = options.baseRevision; artifact.manifest.revision += `-from-${await readModelHash(options.baseRevision)}`; }
  return artifact;
}
