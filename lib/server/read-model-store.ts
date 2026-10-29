import { GROUPS, type GroupKey, type LibraryScope } from "../memory-atlas-data.ts";
import { compareRelevance, type LibraryHits } from "../library-search.ts";
import type { Note } from "../notes.ts";
import { noteDecisionMeta } from "../read-model-decision.ts";
import { highlightTerms, searchSnippet, splitByTerms } from "../search-snippet.ts";
import { tokyoParts } from "../dojo/utils.ts";
import type { BacklinksPage, LibraryPage, LibraryQuery, LibraryResult, LibrarySort, NoteCard, NoteResolution,
  ReadModelArtifact, ReadModelBatch, ReadModelCatalogRow, ReadModelChunkRow, ReadModelManifest, ReadModelRecord, ReadModelStatus, SearchPage } from "../read-model.ts";
import { buildReadModelArtifact, READ_MODEL_BATCH_BYTES, READ_MODEL_SCOPES, readModelHash } from "./read-model-build.ts";

type Database = Pick<D1Database, "prepare" | "batch">;
type CatalogRow = ReadModelCatalogRow & { revision: string };
type RevisionRow = { revision: string; state: "building" | "ready"; manifest_json: string; source_updated_at: number; indexed_at: number; completed: number };

export class ReadModelError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 503, code = "index-unavailable") { super(message); this.status = status; this.code = code; }
}
function rows<T>(result: D1Result<unknown>): T[] {
  if (!result?.success || !Array.isArray(result.results)) throw new ReadModelError("资料索引读取失败");
  return result.results as T[];
}
function revisionKey(revision: string) {
  if (!revision || revision.length > 240) throw new ReadModelError("资料版本无效", 400, "invalid-revision");
}
function manifestCore(manifest: ReadModelManifest) { return JSON.stringify({ ...manifest, indexedAt: 0 }); }
function validateManifest(manifest: ReadModelManifest) {
  revisionKey(manifest.revision);
  if (manifest.schemaVersion !== 1 || !Number.isSafeInteger(manifest.noteCount) || manifest.noteCount < 0
    || !Number.isSafeInteger(manifest.batchCount) || manifest.batchCount < 0 || manifest.batchDigests.length !== manifest.batchCount
    || manifest.counts.catalog !== manifest.noteCount || Object.values(manifest.counts).some((value) => !Number.isSafeInteger(value) || value < 0)
    || Object.values(manifest.hashes).some((value) => !Number.isSafeInteger(value) || value < 1)) throw new ReadModelError("资料索引清单无效", 400);
}
function joinChunks(chunks: ReadModelChunkRow[]) {
  return chunks.sort((a, b) => a.ordinal - b.ordinal).map((chunk, index) => {
    if (chunk.ordinal !== index) throw new ReadModelError("资料索引分块不完整");
    return chunk.text.slice(chunk.prefix);
  }).join("");
}
function countIn(text: string, terms: string[]) {
  const lower = text.toLocaleLowerCase();
  let count = 0;
  for (const term of terms) {
    const needle = term.toLocaleLowerCase();
    if (needle) for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + needle.length)) count++;
  }
  return count;
}
function cardOf(row: CatalogRow): NoteCard {
  const card = JSON.parse(row.card_json) as NoteCard;
  if (card.kind !== "note-card" || card.path !== row.path || card.bodyHash !== row.hash) throw new ReadModelError("资料卡片索引无效");
  // 日期敏感的行动标记由同一个纯函数重算，不必为了过午夜重建全部正文索引。
  const source = JSON.parse(row.decision_json) as Note;
  return { ...card, decision: noteDecisionMeta(source, tokyoParts().date) };
}
function decodeCursor(cursor: string | null | undefined, revision: string, query: string) {
  if (!cursor) return 0;
  try {
    const value = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(cursor), (c) => c.charCodeAt(0)))) as { revision: string; query: string; offset: number };
    if (value.revision !== revision) throw new ReadModelError("资料版本已更新，请重新开始翻页", 409, "revision-expired");
    if (value.query !== query || !Number.isSafeInteger(value.offset) || value.offset < 0) throw new Error();
    return value.offset;
  } catch (error) {
    if (error instanceof ReadModelError) throw error;
    throw new ReadModelError("分页位置无效", 400, "invalid-cursor");
  }
}
function encodeCursor(revision: string, query: string, offset: number) {
  return btoa(Array.from(new TextEncoder().encode(JSON.stringify({ revision, query, offset })), (byte) => String.fromCharCode(byte)).join(""));
}
function normalizedQuery(input: LibraryQuery) {
  const hasTerms = highlightTerms(input.query ?? "").length > 0;
  const sort: LibrarySort = !input.sort || input.sort === "auto" || (input.sort === "relevance" && !hasTerms)
    ? (hasTerms ? "relevance" : "recent") : input.sort;
  return { query: input.query ?? "", group: input.group ?? "all", scope: input.scope ?? "all", tags: [...new Set(input.tags ?? [])], sort };
}

/** 统一的 D1 查询层；请求只读取目录或命中候选的索引文本，不把全库 Note[] 送到浏览器。 */
export function createReadModel(db: Database) {
  const inflight = new Map<string, Promise<ReadModelStatus>>();
  const texts = new Map<string, string>();
  let textBytes = 0;
  const textBudget = 8_000_000;
  async function query<T>(sql: string, values: unknown[] = []) { return rows<T>((await db.batch([db.prepare(sql).bind(...values)]))[0]); }
  async function status(revision: string): Promise<ReadModelStatus | null> {
    revisionKey(revision);
    const result = await query<RevisionRow>(`SELECT r.*, (SELECT COUNT(*) FROM read_model_batches b WHERE b.revision = r.revision) completed FROM read_model_revisions r WHERE revision = ?`, [revision]);
    if (!result.length) return null;
    const row = result[0], manifest = JSON.parse(row.manifest_json) as ReadModelManifest;
    return { revision, state: row.state, sourceUpdatedAt: row.source_updated_at, indexedAt: row.indexed_at, completedBatches: row.completed, batchCount: manifest.batchCount };
  }
  async function ready(revision: string) {
    const value = await status(revision);
    if (!value || value.state !== "ready") throw new ReadModelError("资料索引尚未完成，请稍后重试", value ? 503 : 409, value ? "index-building" : "revision-expired");
    return value;
  }
  async function latest() {
    const result = await query<{ revision: string }>("SELECT revision FROM read_model_revisions WHERE state = 'ready' ORDER BY created_at DESC LIMIT 1");
    return result[0] ? status(result[0].revision) : null;
  }
  async function begin(manifest: ReadModelManifest) {
    validateManifest(manifest);
    const old = await query<RevisionRow>("SELECT * FROM read_model_revisions WHERE revision = ?", [manifest.revision]);
    if (old.length && manifestCore(JSON.parse(old[0].manifest_json)) !== manifestCore(manifest)) throw new ReadModelError("同版本索引清单冲突", 409, "revision-conflict");
    await db.batch([db.prepare(`INSERT OR IGNORE INTO read_model_revisions (revision,state,manifest_json,source_updated_at,indexed_at,created_at) VALUES (?,'building',?,?,?,?)`)
      .bind(manifest.revision, JSON.stringify(manifest), manifest.sourceUpdatedAt, manifest.indexedAt, Date.now()),
      // 增量版本先保护全部引用；旧版本清理不能在导入途中删除它借用的共享块。
      db.prepare("INSERT OR IGNORE INTO read_model_content_refs (revision,hash) SELECT ?,value FROM json_each(?)").bind(manifest.revision, JSON.stringify(Object.keys(manifest.hashes))),
    ]);
    return (await status(manifest.revision))!;
  }
  async function importBatch(revision: string, batch: ReadModelBatch, ordinal: number) {
    revisionKey(revision);
    const existing = (await query<RevisionRow>("SELECT * FROM read_model_revisions WHERE revision = ?", [revision]))[0];
    if (!existing) throw new ReadModelError("索引导入尚未开始", 409);
    const manifest = JSON.parse(existing.manifest_json) as ReadModelManifest;
    const serialized = JSON.stringify(batch);
    if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= manifest.batchCount
      || new TextEncoder().encode(serialized).byteLength > READ_MODEL_BATCH_BYTES) throw new ReadModelError("索引导入批次无效", 400);
    const digest = await readModelHash(serialized);
    if (digest !== manifest.batchDigests[ordinal]) throw new ReadModelError("索引导入校验不一致", 409);
    const marker = await query<{ digest: string }>("SELECT digest FROM read_model_batches WHERE revision = ? AND ordinal = ?", [revision, ordinal]);
    if (marker.length) { if (marker[0].digest !== digest) throw new ReadModelError("索引批次版本冲突", 409); return (await status(revision))!; }
    if (existing.state === "ready") throw new ReadModelError("已完成版本不能追加资料", 409);
    const statements: D1PreparedStatement[] = [];
    const guard = "NOT EXISTS (SELECT 1 FROM read_model_batches WHERE revision = ?1 AND ordinal = ?3)";
    const add = (sql: string, value: unknown) => statements.push(db.prepare(sql).bind(revision, JSON.stringify(value), ordinal));
    if (batch.chunks?.length) {
      if (batch.chunks.some((chunk) => !(chunk.hash in manifest.hashes) || new TextEncoder().encode(chunk.text).byteLength > 128_000 || !Number.isSafeInteger(chunk.prefix) || chunk.prefix < 0)) throw new ReadModelError("索引分块无效", 400);
      add(`INSERT OR IGNORE INTO read_model_chunks (id,hash,channel,ordinal,prefix,text) SELECT json_extract(value,'$.id'),json_extract(value,'$.hash'),json_extract(value,'$.channel'),json_extract(value,'$.ordinal'),json_extract(value,'$.prefix'),json_extract(value,'$.text') FROM json_each(?2) WHERE ${guard}`, batch.chunks);
      add(`INSERT OR IGNORE INTO read_model_content_refs (revision,hash) SELECT ?1,json_extract(value,'$.hash') FROM json_each(?2) WHERE ${guard}`, batch.chunks);
    }
    if (batch.catalog?.length) {
      add(`INSERT OR IGNORE INTO read_model_catalog (revision,path,ordinal,hash,card_json,decision_json,type_lower,status_lower,group_key,scopes_json,tags_json,mtime) SELECT ?1,json_extract(value,'$.path'),json_extract(value,'$.ordinal'),json_extract(value,'$.hash'),json_extract(value,'$.card_json'),json_extract(value,'$.decision_json'),json_extract(value,'$.type_lower'),json_extract(value,'$.status_lower'),json_extract(value,'$.group_key'),json_extract(value,'$.scopes_json'),json_extract(value,'$.tags_json'),json_extract(value,'$.mtime') FROM json_each(?2) WHERE ${guard}`, batch.catalog);
      add(`INSERT OR IGNORE INTO read_model_content_refs (revision,hash) SELECT ?1,json_extract(value,'$.hash') FROM json_each(?2) WHERE ${guard}`, batch.catalog);
    }
    if (batch.aliases?.length) add(`INSERT OR IGNORE INTO read_model_aliases (revision,target,path,exact) SELECT ?1,json_extract(value,'$.target'),json_extract(value,'$.path'),json_extract(value,'$.exact') FROM json_each(?2) WHERE ${guard}`, batch.aliases);
    if (batch.links?.length) add(`INSERT OR IGNORE INTO read_model_links (revision,source_path,target) SELECT ?1,json_extract(value,'$.source_path'),json_extract(value,'$.target') FROM json_each(?2) WHERE ${guard}`, batch.links);
    if (batch.records?.length) {
      add(`INSERT OR IGNORE INTO read_model_records (revision,kind,key,hash) SELECT ?1,json_extract(value,'$.kind'),json_extract(value,'$.key'),json_extract(value,'$.hash') FROM json_each(?2) WHERE ${guard}`, batch.records);
      add(`INSERT OR IGNORE INTO read_model_content_refs (revision,hash) SELECT ?1,json_extract(value,'$.hash') FROM json_each(?2) WHERE ${guard}`, batch.records);
    }
    statements.push(db.prepare("INSERT OR IGNORE INTO read_model_batches (revision,ordinal,digest) VALUES (?,?,?)").bind(revision, ordinal, digest));
    const result = await db.batch(statements);
    if (result.some((item) => !item.success)) throw new ReadModelError("索引导入失败");
    return (await status(revision))!;
  }
  async function finish(revision: string) {
    const row = (await query<RevisionRow>("SELECT * FROM read_model_revisions WHERE revision = ?", [revision]))[0];
    if (!row) throw new ReadModelError("资料索引不存在", 409);
    if (row.state === "ready") return (await status(revision))!;
    const manifest = JSON.parse(row.manifest_json) as ReadModelManifest;
    const results = await db.batch([
      db.prepare("SELECT ordinal,digest FROM read_model_batches WHERE revision = ? ORDER BY ordinal").bind(revision),
      db.prepare(`SELECT (SELECT COUNT(*) FROM read_model_catalog WHERE revision=?1) catalog,(SELECT COUNT(*) FROM read_model_aliases WHERE revision=?1) aliases,(SELECT COUNT(*) FROM read_model_links WHERE revision=?1) links,(SELECT COUNT(*) FROM read_model_records WHERE revision=?1) records`).bind(revision),
      db.prepare("SELECT r.hash,COUNT(c.id) count FROM read_model_content_refs r LEFT JOIN read_model_chunks c ON c.hash=r.hash WHERE r.revision=? GROUP BY r.hash").bind(revision),
    ]);
    const markers = rows<{ ordinal: number; digest: string }>(results[0]);
    const counts = rows<ReadModelManifest["counts"]>(results[1])[0];
    const chunks = rows<{ hash: string; count: number }>(results[2]);
    if (markers.length !== manifest.batchCount || markers.some((marker, index) => marker.ordinal !== index || marker.digest !== manifest.batchDigests[index])
      || Object.entries(manifest.counts).some(([key, value]) => counts[key as keyof typeof counts] !== value)
      || chunks.length !== Object.keys(manifest.hashes).length || chunks.some((chunk) => manifest.hashes[chunk.hash] !== chunk.count)) throw new ReadModelError("资料索引尚未完整导入", 409, "index-incomplete");
    await db.batch([db.prepare("UPDATE read_model_revisions SET state='ready' WHERE revision=?").bind(revision)]);
    // 只清理可重建投影；保留最近三份完成版本及一天内仍可续传的导入。
    const retired = await query<{ revision: string }>(`SELECT revision FROM (
      SELECT revision FROM read_model_revisions WHERE state='ready' AND revision<>?1 ORDER BY created_at DESC,revision DESC LIMIT -1 OFFSET 2
    ) UNION SELECT revision FROM read_model_revisions WHERE state='building' AND revision<>?1 AND created_at<?2`, [revision, Date.now() - 24 * 60 * 60 * 1000]);
    if (retired.length) {
      const old = JSON.stringify(retired.map((item) => item.revision));
      const tables = ["read_model_catalog", "read_model_aliases", "read_model_links", "read_model_records", "read_model_batches", "read_model_content_refs", "read_model_revisions"];
      await db.batch(tables.map((table) => db.prepare(`DELETE FROM ${table} WHERE revision IN (SELECT value FROM json_each(?))`).bind(old)));
      await db.batch([db.prepare("DELETE FROM read_model_chunks WHERE NOT EXISTS (SELECT 1 FROM read_model_content_refs r WHERE r.hash=read_model_chunks.hash)")]);
    }
    return (await status(revision))!;
  }
  async function importArtifact(revision: string, artifact: ReadModelArtifact) {
    if (artifact.manifest.revision !== revision) throw new ReadModelError("资料版本不匹配", 409);
    await begin(artifact.manifest);
    for (const [index, batch] of artifact.batches.entries()) await importBatch(revision, batch, index);
    return finish(revision);
  }
  function ensure(revision: string, load: () => Promise<Note[] | ReadModelArtifact>, publishedAt?: string): Promise<ReadModelStatus> {
    const pending = inflight.get(revision);
    if (pending) return pending;
    const task = (async () => {
      const existing = await status(revision);
      if (existing?.state === "ready") return existing;
      const value = await load();
      return importArtifact(revision, Array.isArray(value) ? await buildReadModelArtifact(value, { revision, publishedAt }) : value);
    })().finally(() => { if (inflight.get(revision) === task) inflight.delete(revision); });
    inflight.set(revision, task);
    return task;
  }
  function rememberText(key: string, value: string) {
    if (value.length > textBudget) return;
    texts.set(key, value); textBytes += value.length;
    while (textBytes > textBudget) { const oldest = texts.keys().next().value; if (oldest === undefined) break; textBytes -= texts.get(oldest)!.length; texts.delete(oldest); }
  }
  async function channelValues(hashes: string[], channel: string) {
    const values = new Map<string, string>();
    const missing = [...new Set(hashes)].filter((hash) => {
      const cached = texts.get(`${hash}:${channel}`);
      if (cached !== undefined) { values.set(hash, cached); return false; }
      return true;
    });
    // 每次只解码少量文档的文本块，长稿不会和全库正文一起占满 Worker 内存。
    for (let start = 0; start < missing.length; start += 24) {
      const group = missing.slice(start, start + 24);
      const chunks = await query<ReadModelChunkRow>("SELECT * FROM read_model_chunks WHERE channel=? AND hash IN (SELECT value FROM json_each(?)) ORDER BY hash,ordinal", [channel, JSON.stringify(group)]);
      const byHash = new Map<string, ReadModelChunkRow[]>();
      for (const chunk of chunks) { const list = byHash.get(chunk.hash) ?? []; list.push(chunk); byHash.set(chunk.hash, list); }
      for (const hash of group) { const text = joinChunks(byHash.get(hash) ?? []); values.set(hash, text); rememberText(`${hash}:${channel}`, text); }
    }
    return values;
  }
  function queryCondition(rawQuery: string) {
    const conditions: string[] = [], values: string[] = [], longTokens: string[] = [], folders: string[][] = [];
    for (const token of rawQuery.trim().toLowerCase().split(/\s+/).filter(Boolean)) {
      const [prefix, ...rest] = token.split(":"), value = rest.join(":"), alternatives = value.split("|").filter(Boolean);
      // SQLite lower 只折叠 ASCII；目录条件在小目录行上精确验证，保留 JS 的 Unicode 口径。
      if (prefix === "folder" && value && alternatives.length) { folders.push(alternatives); continue; }
      const column = prefix === "type" ? "c.type_lower" : prefix === "status" ? "c.status_lower" : null;
      if (column && value && alternatives.length) { conditions.push(`(${alternatives.map(() => `instr(${column},?)>0`).join(" OR ")})`); values.push(...alternatives); continue; }
      const anchor = [...token].slice(0, 3).join("");
      if ([...anchor].length === 3) {
        // FTS 候选集一次生成，不能对每张目录卡片重新执行同一份倒排检索。
        conditions.push("c.hash IN (SELECT x.hash FROM read_model_fts JOIN read_model_chunks x ON x.rowid=read_model_fts.rowid WHERE read_model_fts MATCH ? AND x.channel='match')");
        values.push(`"${anchor.replaceAll('"', '""')}"`);
      }
      if (token.length <= 128) { conditions.push("EXISTS (SELECT 1 FROM read_model_chunks x WHERE x.hash=c.hash AND x.channel='match' AND instr(x.text,?)>0)"); values.push(token); }
      else longTokens.push(token);
    }
    return { conditions, values, longTokens, folders };
  }
  async function candidates(revision: string, rawQuery: string) {
    const compiled = queryCondition(rawQuery);
    let result = await query<CatalogRow>(`SELECT c.* FROM read_model_catalog c WHERE c.revision=? ${compiled.conditions.map((condition) => `AND ${condition}`).join(" ")} ORDER BY c.ordinal`, [revision, ...compiled.values]);
    if (compiled.folders.length) result = result.filter((row) => compiled.folders.every((choices) => choices.some((choice) => row.path.toLowerCase().includes(choice))));
    if (compiled.longTokens.length) {
      const match = await channelValues(result.map((row) => row.hash), "match");
      result = result.filter((row) => compiled.longTokens.every((token) => match.get(row.hash)!.includes(token)));
    }
    return result;
  }
  async function hitsFor(rows: CatalogRow[], rawQuery: string) {
    const terms = highlightTerms(rawQuery), hits = new Map<string, LibraryHits>();
    if (!terms.length) return hits;
    const body = await channelValues(rows.map((row) => row.hash), "body");
    const front = await channelValues(rows.map((row) => row.hash), "front");
    for (const row of rows) {
      const title = countIn((JSON.parse(row.card_json) as NoteCard).title, terms), frontmatter = countIn(front.get(row.hash) ?? "", terms), bodyCount = countIn(body.get(row.hash) ?? "", terms);
      hits.set(row.path, { title, frontmatter, body: bodyCount, total: title + frontmatter + bodyCount });
    }
    return hits;
  }
  async function resultCards(source: CatalogRow[], rawQuery: string, hits?: Map<string, LibraryHits>, palette = false): Promise<LibraryResult[]> {
    const terms = highlightTerms(rawQuery);
    const body = terms.length || palette ? await channelValues(source.map((row) => row.hash), palette ? "palette" : "body") : new Map<string, string>();
    return source.map((row) => {
      const card = cardOf(row), parts = terms.length || palette ? searchSnippet(body.get(row.hash) ?? "", rawQuery, palette ? {} : { radius: 30, fallback: 0 }) : null;
      return { ...card, titleParts: splitByTerms(card.title, terms), snippetParts: palette || parts?.some((part) => part.hit) ? parts : null, hits: hits?.get(row.path) ?? null };
    });
  }
  async function library(revision: string, input: LibraryQuery = {}): Promise<LibraryPage> {
    const version = await ready(revision), normalized = normalizedQuery(input);
    const key = await readModelHash(JSON.stringify(normalized));
    const offset = decodeCursor(input.cursor, revision, key), limit = Math.max(1, Math.min(24, input.limit ?? 24));
    const found = await candidates(revision, normalized.query);
    const tagged = found.filter((row) => normalized.tags.every((tag) => (JSON.parse(row.tags_json) as string[]).includes(tag)));
    const inGroup = (row: CatalogRow) => normalized.group === "all" || row.group_key === normalized.group;
    const inScope = (row: CatalogRow, scope = normalized.scope) => (JSON.parse(row.scopes_json) as string[]).includes(scope);
    const filtered = tagged.filter((row) => inGroup(row) && inScope(row));
    const groups = { all: tagged.filter((row) => inScope(row)).length,
      ...Object.fromEntries(Object.keys(GROUPS).map((group) => [group, tagged.filter((row) => row.group_key === group && inScope(row)).length])) } as Record<GroupKey | "all", number>;
    const scopes = Object.fromEntries(READ_MODEL_SCOPES.map((scope) => [scope, tagged.filter((row) => inGroup(row) && inScope(row, scope)).length])) as Record<LibraryScope, number>;
    const tagCounts = new Map<string, number>();
    for (const row of found.filter((row) => inGroup(row) && inScope(row))) for (const tag of JSON.parse(row.tags_json) as string[]) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    const tags = [...tagCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN")).slice(0, 12).map(([tag]) => tag);
    for (const tag of normalized.tags) if (!tags.includes(tag)) tags.push(tag);
    const tagFacet = tags.map((tag) => ({ tag, count: filtered.filter((row) => (JSON.parse(row.tags_json) as string[]).includes(tag)).length }));
    const hits = await hitsFor(filtered, normalized.query), collator = new Intl.Collator("zh-CN");
    filtered.sort((a, b) => normalized.sort === "relevance" ? compareRelevance(hits.get(a.path)!, hits.get(b.path)!) || b.mtime - a.mtime
      : normalized.sort === "connections" ? (JSON.parse(b.card_json) as NoteCard).links - (JSON.parse(a.card_json) as NoteCard).links || b.mtime - a.mtime
      : normalized.sort === "title" ? collator.compare((JSON.parse(a.card_json) as NoteCard).title, (JSON.parse(b.card_json) as NoteCard).title) : b.mtime - a.mtime);
    const page = filtered.slice(offset, offset + limit);
    return { revision, items: await resultCards(page, normalized.query, hits), total: filtered.length,
      nextCursor: offset + limit < filtered.length ? encodeCursor(revision, key, offset + limit) : null,
      facets: { groups, scopes, tags: tagFacet }, effectiveSort: normalized.sort, sourceUpdatedAt: version.sourceUpdatedAt, indexedAt: version.indexedAt };
  }
  async function search(revision: string, rawQuery = "", limit = 8, recentPaths: string[] = []): Promise<SearchPage> {
    const version = await ready(revision);
    const found = await candidates(revision, rawQuery);
    const size = Math.max(1, Math.min(8, limit));
    let selected: CatalogRow[];
    if (!rawQuery.trim() && recentPaths.length) {
      const byPath = new Map(found.map((row) => [row.path, row]));
      selected = [...new Set(recentPaths)].flatMap((path) => byPath.has(path) ? [byPath.get(path)!] : []).slice(0, size);
      if (!selected.length) selected = found.sort((a, b) => b.mtime - a.mtime).slice(0, size);
    } else selected = (!rawQuery.trim() ? found.sort((a, b) => b.mtime - a.mtime) : found).slice(0, size);
    return { revision, items: await resultCards(selected, rawQuery, undefined, true), total: found.length, sourceUpdatedAt: version.sourceUpdatedAt, indexedAt: version.indexedAt };
  }
  async function resolve(revision: string, input: string, section?: string): Promise<NoteResolution> {
    await ready(revision);
    const inner = input.trim().replace(/^!?\[\[([\s\S]*)\]\]$/, "$1").split(/\\?\|/)[0];
    const marker = inner.indexOf("#"), target = (marker < 0 ? inner : inner.slice(0, marker)).trim().replace(/\.md$/i, "");
    const heading = section || (marker < 0 ? "" : inner.slice(marker + 1).trim());
    if (!target) return { revision, kind: "missing" };
    const matches = await query<{ path: string; exact: number }>("SELECT path,exact FROM read_model_aliases WHERE revision=? AND target=? ORDER BY exact DESC,path", [revision, target]);
    const exact = matches.filter((item) => item.exact === 1), selected = exact.length ? exact : matches;
    return selected.length === 1 ? { revision, kind: "resolved", path: selected[0].path, section: heading || null } : { revision, kind: selected.length ? "ambiguous" : "missing" };
  }
  async function backlinks(revision: string, path: string): Promise<BacklinksPage> {
    await ready(revision);
    // 完整路径优先；短链只有唯一目标才成为关系，重名来源不能串到另一份资料。
    const resolved = `WITH candidates AS (
      SELECT l.source_path,l.target,a.path,a.exact,MAX(a.exact) OVER (PARTITION BY l.source_path,l.target) priority
      FROM read_model_links l JOIN read_model_aliases a ON a.revision=l.revision AND a.target=l.target WHERE l.revision=?1
    ), resolved AS (
      SELECT source_path,target,MIN(path) path FROM candidates WHERE exact=priority GROUP BY source_path,target HAVING COUNT(*)=1
    )`;
    const source = await query<CatalogRow & { direction: string }>(`${resolved}
      SELECT c.*,'back' direction FROM read_model_catalog c WHERE c.revision=?1 AND c.path<>?2
      AND EXISTS (SELECT 1 FROM resolved r WHERE r.source_path=c.path AND r.path=?2)
      UNION ALL SELECT c.*,'out' direction FROM read_model_catalog c WHERE c.revision=?1
      AND EXISTS (SELECT 1 FROM resolved r WHERE r.source_path=?2 AND r.path=c.path) ORDER BY ordinal`, [revision, path]);
    const incoming = source.filter((row) => row.direction === "back"), outgoing = source.filter((row) => row.direction === "out");
    return { revision, items: incoming.map(cardOf), outlinks: outgoing.map(cardOf), total: incoming.length };
  }
  async function getCard(revision: string, path: string) {
    await ready(revision);
    const result = await query<CatalogRow>("SELECT * FROM read_model_catalog WHERE revision=? AND path=?", [revision, path]);
    return result[0] ? cardOf(result[0]) : null;
  }
  async function readRecords<T>(revision: string, kind: string, keys?: string[]): Promise<ReadModelRecord<T>[]> {
    await ready(revision);
    if (keys?.length === 0) return [];
    const source = await query<ReadModelChunkRow & { kind: string; key: string }>(`SELECT x.*,r.kind,r.key FROM read_model_records r JOIN read_model_chunks x ON x.hash=r.hash AND x.channel='record' WHERE r.revision=? AND r.kind=? ${keys ? "AND r.key IN (SELECT value FROM json_each(?))" : ""} ORDER BY r.key,x.ordinal`, keys ? [revision, kind, JSON.stringify(keys)] : [revision, kind]);
    const grouped = new Map<string, (ReadModelChunkRow & { kind: string; key: string })[]>();
    for (const row of source) { const list = grouped.get(row.key) ?? []; list.push(row); grouped.set(row.key, list); }
    return [...grouped].map(([key, chunks]) => ({ kind, key, value: JSON.parse(joinChunks(chunks)) as T }));
  }
  async function readRecord<T>(revision: string, kind: string, key: string): Promise<T | null> { return (await readRecords<T>(revision, kind, [key]))[0]?.value ?? null; }
  async function listRecords<T>(revision: string, kind: string) { return readRecords<T>(revision, kind); }
  return { begin, importBatch, finish, importArtifact, status, latest, ensure, library, search, resolve, backlinks, getCard, readRecord, readRecords, listRecords };
}
