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
type Candidate = Pick<CatalogRow, "path" | "hash" | "ordinal" | "mtime">;
type RankedCandidate = Candidate & { title: string };
type LibraryFacets = LibraryPage["facets"];
type CandidateFilter = { where: string; values: string[] };
type LibraryPlan = { facets: LibraryFacets; ranked: { path: string; hits?: LibraryHits }[] } | { facets: LibraryFacets; filter: CandidateFilter };
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
function pageSize(input: number | undefined, maximum: number) {
  return input === undefined || !Number.isFinite(input) ? maximum : Math.max(1, Math.min(maximum, Math.floor(input)));
}

/** 统一的 D1 查询层；请求只读取目录或命中候选的索引文本，不把全库 Note[] 送到浏览器。 */
export function createReadModel(db: Database, { retention = true }: { retention?: boolean } = {}) {
  const inflight = new Map<string, Promise<ReadModelStatus>>();
  const queryPlans = new Map<string, Promise<LibraryPlan>>();
  const cacheTtl = 5 * 60_000;
  const results = new Map<string, { json: string; bytes: number; expiresAt: number }>();
  let resultBytes = 0;
  const resultBudget = 8 * 1024 * 1024;
  function cachedResult<T>(key: string): T | undefined {
    const cached = results.get(key);
    if (!cached) return undefined;
    results.delete(key);
    if (cached.expiresAt <= Date.now()) { resultBytes -= cached.bytes; return undefined; }
    results.set(key, cached);
    // 缓存只保存不可变的小 DTO；调用端改动返回值也不会污染下一次查询。
    return JSON.parse(cached.json) as T;
  }
  function rememberResult(key: string, value: LibraryPage | SearchPage | LibraryPlan) {
    const json = JSON.stringify(value);
    const bytes = Math.max(json.length * 2, new TextEncoder().encode(json).byteLength) + key.length * 2 + 128;
    if (bytes > resultBudget) return;
    const previous = results.get(key);
    if (previous) { results.delete(key); resultBytes -= previous.bytes; }
    results.set(key, { json, bytes, expiresAt: Date.now() + cacheTtl }); resultBytes += bytes;
    while (results.size > 64 || resultBytes > resultBudget) {
      const oldest = results.keys().next().value;
      if (oldest === undefined) break;
      resultBytes -= results.get(oldest)!.bytes; results.delete(oldest);
    }
  }
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
  async function firstMissingBatch(revision: string) {
    revisionKey(revision);
    const result = await query<{ ordinal: number }>(`SELECT CASE WHEN NOT EXISTS (
      SELECT 1 FROM read_model_batches WHERE revision=?1 AND ordinal=0
    ) THEN 0 ELSE (
      SELECT MIN(b.ordinal+1) FROM read_model_batches b WHERE b.revision=?1 AND NOT EXISTS (
        SELECT 1 FROM read_model_batches next WHERE next.revision=?1 AND next.ordinal=b.ordinal+1
      )
    ) END ordinal`, [revision]);
    return result[0].ordinal;
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
    // 发布索引由维护入口按实际发布清单回收，普通请求只完成导入。
    if (!retention) return (await status(revision))!;
    // 只清理可重建投影；保留最近三份完成版本及一天内仍可续传的导入。
    const retired = await query<{ revision: string }>(`SELECT revision FROM (
      SELECT revision FROM read_model_revisions WHERE state='ready' AND revision<>?1 ORDER BY created_at DESC,revision DESC LIMIT -1 OFFSET 2
    ) UNION SELECT revision FROM read_model_revisions WHERE state='building' AND revision<>?1 AND created_at<?2`, [revision, Date.now() - 24 * 60 * 60 * 1000]);
    if (retired.length) {
      const old = JSON.stringify(retired.map((item) => item.revision));
      const tables = ["read_model_catalog", "read_model_aliases", "read_model_links", "read_model_records", "read_model_batches", "read_model_content_refs", "calendar_projection_summaries", "read_model_revisions"];
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
  const textKey = (hash: string, channel: string) => `${hash}:${channel}`;
  async function channelTexts(hashes: string[], channels: string[]) {
    const values = new Map<string, string>();
    const missing = [...new Set(hashes)].flatMap((hash) => channels.map((channel) => [hash, channel] as const));
    // 每次只组装少量文档的文本；相关度计算完成一组就释放这组长稿。
    for (let start = 0; start < missing.length; start += 48) {
      const pairs = missing.slice(start, start + 48);
      const chunks = await query<ReadModelChunkRow>(`SELECT x.* FROM json_each(?) p
        JOIN read_model_chunks x ON x.hash=json_extract(p.value,'$[0]') AND x.channel=json_extract(p.value,'$[1]')
        ORDER BY x.hash,x.channel,x.ordinal`, [JSON.stringify(pairs)]);
      const grouped = new Map<string, ReadModelChunkRow[]>();
      for (const chunk of chunks) { const key = textKey(chunk.hash, chunk.channel); const list = grouped.get(key) ?? []; list.push(chunk); grouped.set(key, list); }
      for (const [hash, channel] of pairs) {
        const key = textKey(hash, channel);
        const value = joinChunks(grouped.get(key) ?? []);
        values.set(key, value);
      }
    }
    return values;
  }
  function queryCondition(rawQuery: string) {
    const conditions: string[] = [], values: string[] = [], longTokens: string[] = [], folders: string[][] = [];
    for (const token of rawQuery.trim().toLowerCase().split(/\s+/).filter(Boolean)) {
      const [prefix, ...rest] = token.split(":"), value = rest.join(":"), alternatives = value.split("|").filter(Boolean);
      if (prefix === "folder" && value && alternatives.length) { folders.push(alternatives); continue; }
      const column = prefix === "type" ? "c.type_lower" : prefix === "status" ? "c.status_lower" : null;
      if (column && value && alternatives.length) {
        conditions.push(`EXISTS (SELECT 1 FROM json_each(?) term WHERE instr(${column},term.value)>0)`);
        values.push(JSON.stringify(alternatives));
        continue;
      }
      const anchor = [...token].slice(0, 3).join("");
      if ([...anchor].length === 3) {
        // 三字倒排只缩小候选，短词和跨块仍以子串检查为准。
        conditions.push("c.hash IN (SELECT x.hash FROM read_model_fts JOIN read_model_chunks x ON x.rowid=read_model_fts.rowid WHERE read_model_fts MATCH ? AND x.channel='match')");
        values.push(`"${anchor.replaceAll('"', '""')}"`);
      }
      if (token.length <= 128) { conditions.push("EXISTS (SELECT 1 FROM read_model_chunks x WHERE x.hash=c.hash AND x.channel='match' AND instr(x.text,?)>0)"); values.push(token); }
      else longTokens.push(token);
    }
    return { conditions, values, longTokens, folders };
  }
  async function candidateFilter(revision: string, rawQuery: string): Promise<CandidateFilter> {
    const { conditions, values, folders, longTokens } = queryCondition(rawQuery);
    const where = ["c.revision=?", ...conditions].join(" AND ");
    const args = [revision, ...values];
    if (!folders.length && !longTokens.length) return { where, values: args };
    // SQLite lower 只处理 ASCII；长词也可能跨出索引重叠区。先查窄列，再按原语义确认。
    const paths: string[] = [];
    const candidateRows = await query<Pick<Candidate, "path" | "hash">>(
      `SELECT c.path,c.hash FROM read_model_catalog c WHERE ${where}`, args);
    const folderMatches = candidateRows.filter(({ path }) => {
      const lower = path.toLowerCase();
      return folders.every((choices) => choices.some((choice) => lower.includes(choice)));
    });
    for (let start = 0; start < folderMatches.length; start += 24) {
      const group = folderMatches.slice(start, start + 24);
      const text = longTokens.length ? await channelTexts(group.map((row) => row.hash), ["match"]) : null;
      for (const row of group) if (!text || longTokens.every((token) => text.get(textKey(row.hash, "match"))!.includes(token))) paths.push(row.path);
    }
    return { where: "c.revision=? AND c.path IN (SELECT value FROM json_each(?))", values: [revision, JSON.stringify(paths)] };
  }
  function libraryPredicate(input: ReturnType<typeof normalizedQuery>) {
    return {
      group: "(?='all' OR c.group_key=?)",
      scope: "EXISTS (SELECT 1 FROM json_each(c.scopes_json) scope WHERE scope.value=?)",
      tags: `NOT EXISTS (SELECT 1 FROM json_each(?) wanted
        WHERE NOT EXISTS (SELECT 1 FROM json_each(c.tags_json) own WHERE own.value=wanted.value))`,
      values: [input.group, input.group, input.scope, JSON.stringify(input.tags)],
    };
  }
  async function libraryFacets(filter: CandidateFilter, input: ReturnType<typeof normalizedQuery>): Promise<LibraryFacets> {
    const p = libraryPredicate(input);
    const counts = await query<{ kind: "group" | "scope" | "tag"; key: string; count: number; popularity: number }>(`WITH flags AS (
      SELECT c.group_key,c.scopes_json,c.tags_json,${p.group} in_group,${p.scope} in_scope,${p.tags} tagged
      FROM read_model_catalog c WHERE ${filter.where}
    )
    SELECT 'group' kind,group_key key,COUNT(*) count,0 popularity FROM flags WHERE in_scope AND tagged GROUP BY group_key
    UNION ALL SELECT 'scope',scope.value,COUNT(*),0 FROM flags,json_each(scopes_json) scope WHERE in_group AND tagged GROUP BY scope.value
    UNION ALL SELECT 'tag',tag.value,SUM(tagged),COUNT(*) FROM flags,json_each(tags_json) tag WHERE in_group AND in_scope GROUP BY tag.value`,
    [...p.values, ...filter.values]);
    const groups = { all: 0, ...Object.fromEntries(Object.keys(GROUPS).map((key) => [key, 0])) } as LibraryFacets["groups"];
    const scopes = Object.fromEntries(READ_MODEL_SCOPES.map((key) => [key, 0])) as LibraryFacets["scopes"];
    const tags: { tag: string; count: number; popularity: number }[] = [];
    for (const row of counts) {
      if (row.kind === "group") { groups.all += row.count; groups[row.key as GroupKey] = row.count; }
      else if (row.kind === "scope") scopes[row.key as LibraryScope] = row.count;
      else tags.push({ tag: row.key, count: row.count, popularity: row.popularity });
    }
    const sorted = tags.sort((a, b) => b.popularity - a.popularity || a.tag.localeCompare(b.tag, "zh-CN")).slice(0, 12);
    for (const tag of input.tags) if (!sorted.some((row) => row.tag === tag)) sorted.push(tags.find((row) => row.tag === tag) ?? { tag, count: 0, popularity: 0 });
    return { groups, scopes, tags: sorted.map(({ tag, count }) => ({ tag, count })) };
  }
  async function hitCounts(source: RankedCandidate[], rawQuery: string) {
    const terms = highlightTerms(rawQuery), hits = new Map<string, LibraryHits>();
    if (!terms.length) return hits;
    for (let start = 0; start < source.length; start += 24) {
      const group = source.slice(start, start + 24);
      const text = await channelTexts(group.map((row) => row.hash), ["body", "front"]);
      for (const row of group) {
        const title = countIn(row.title, terms);
        const frontmatter = countIn(text.get(textKey(row.hash, "front")) ?? "", terms);
        const body = countIn(text.get(textKey(row.hash, "body")) ?? "", terms);
        hits.set(row.path, { title, frontmatter, body, total: title + frontmatter + body });
      }
    }
    return hits;
  }
  async function catalogCards(revision: string, paths: string[]) {
    if (!paths.length) return [];
    return query<CatalogRow>(`SELECT c.* FROM json_each(?) selected CROSS JOIN read_model_catalog c
      ON c.revision=? AND c.path=selected.value ORDER BY CAST(selected.key AS INTEGER)`, [JSON.stringify(paths), revision]);
  }
  async function resultCards(source: CatalogRow[], rawQuery: string, hits?: Map<string, LibraryHits>, palette = false): Promise<LibraryResult[]> {
    const terms = highlightTerms(rawQuery);
    const channel = palette ? "palette" : "body";
    const text = terms.length || palette ? await channelTexts(source.map((row) => row.hash), [channel]) : new Map<string, string>();
    return source.map((row) => {
      const card = cardOf(row), parts = terms.length || palette ? searchSnippet(text.get(textKey(row.hash, channel)) ?? "", rawQuery, palette ? {} : { radius: 30, fallback: 0 }) : null;
      return { ...card, titleParts: splitByTerms(card.title, terms), snippetParts: palette || parts?.some((part) => part.hit) ? parts : null, hits: hits?.get(row.path) ?? null };
    });
  }
  function libraryPlan(revision: string, key: string, input: ReturnType<typeof normalizedQuery>) {
    const planKey = JSON.stringify(["library-plan", revision, key]);
    const cached = cachedResult<LibraryPlan>(planKey);
    if (cached) return Promise.resolve(cached);
    const existing = queryPlans.get(planKey);
    if (existing) return existing;
    const task = (async () => {
      const filter = await candidateFilter(revision, input.query);
      const facets = await libraryFacets(filter, input);
      let result: LibraryPlan = { facets, filter };
      if (input.sort === "title" || input.sort === "relevance") {
        const p = libraryPredicate(input);
        const source = await query<RankedCandidate>(`SELECT c.path,c.hash,c.ordinal,c.mtime,json_extract(c.card_json,'$.title') title
          FROM read_model_catalog c WHERE ${filter.where} AND ${p.group} AND ${p.scope} AND ${p.tags} ORDER BY c.ordinal`, [...filter.values, ...p.values]);
        const hits = input.sort === "relevance" ? await hitCounts(source, input.query) : new Map<string, LibraryHits>();
        const collator = new Intl.Collator("zh-CN");
        source.sort((a, b) => input.sort === "relevance" ? compareRelevance(hits.get(a.path)!, hits.get(b.path)!) || b.mtime - a.mtime : collator.compare(a.title, b.title));
        result = { facets, ranked: source.map(({ path }) => ({ path, hits: hits.get(path) })) };
      }
      rememberResult(planKey, result);
      return result;
    })().finally(() => { queryPlans.delete(planKey); });
    queryPlans.set(planKey, task);
    return task;
  }
  async function library(revision: string, input: LibraryQuery = {}): Promise<LibraryPage> {
    const version = await ready(revision), normalized = normalizedQuery(input);
    const key = await readModelHash(JSON.stringify(normalized));
    const offset = decodeCursor(input.cursor, revision, key), limit = pageSize(input.limit, 24);
    const resultKey = JSON.stringify(["library", revision, tokyoParts().date, key, offset, limit]);
    const cached = cachedResult<LibraryPage>(resultKey);
    if (cached) return cached;
    const plan = await libraryPlan(revision, key, normalized), facets = structuredClone(plan.facets);
    const total = Object.hasOwn(facets.groups, normalized.group) ? facets.groups[normalized.group] : 0;
    let page: CatalogRow[];
    let hits: Map<string, LibraryHits>;
    if ("ranked" in plan) {
      const selected = plan.ranked.slice(offset, offset + limit);
      page = await catalogCards(revision, selected.map((item) => item.path));
      hits = normalized.sort === "relevance" ? new Map(selected.flatMap(({ path, hits }) => hits ? [[path, hits]] : [])) :
        await hitCounts(page.map((row) => ({ ...row, title: (JSON.parse(row.card_json) as NoteCard).title })), normalized.query);
    } else {
      const { filter } = plan, p = libraryPredicate(normalized);
      const order = normalized.sort === "connections" ? "json_extract(c.card_json,'$.links') DESC,c.mtime DESC,c.ordinal" : "c.mtime DESC,c.ordinal";
      page = await query<CatalogRow>(`SELECT c.* FROM read_model_catalog c WHERE ${filter.where} AND ${p.group} AND ${p.scope} AND ${p.tags}
        ORDER BY ${order} LIMIT ? OFFSET ?`, [...filter.values, ...p.values, limit, offset]);
      hits = await hitCounts(page.map((row) => ({ ...row, title: (JSON.parse(row.card_json) as NoteCard).title })), normalized.query);
    }
    const result: LibraryPage = { revision, items: await resultCards(page, normalized.query, hits), total,
      nextCursor: offset + limit < total ? encodeCursor(revision, key, offset + limit) : null,
      facets, effectiveSort: normalized.sort, sourceUpdatedAt: version.sourceUpdatedAt, indexedAt: version.indexedAt };
    rememberResult(resultKey, result);
    return result;
  }
  async function search(revision: string, rawQuery = "", limit = 8, recentPaths: string[] = []): Promise<SearchPage> {
    const version = await ready(revision), size = pageSize(limit, 8);
    const hasQuery = Boolean(rawQuery.trim());
    const recent = hasQuery ? [] : [...new Set(recentPaths)];
    const resultKey = JSON.stringify(["search", revision, tokyoParts().date, rawQuery, size, recent]);
    const cached = cachedResult<SearchPage>(resultKey);
    if (cached) return cached;
    const filter = await candidateFilter(revision, rawQuery);
    const countStatement = db.prepare(`SELECT COUNT(*) total FROM read_model_catalog c WHERE ${filter.where}`).bind(...filter.values);
    const pageStatement = recent.length
      ? db.prepare(`SELECT c.* FROM json_each(?) selected CROSS JOIN read_model_catalog c ON c.revision=? AND c.path=selected.value
        ORDER BY CAST(selected.key AS INTEGER) LIMIT ?`).bind(JSON.stringify(recent), revision, size)
      : db.prepare(`SELECT c.* FROM read_model_catalog c WHERE ${filter.where}
        ORDER BY ${hasQuery ? "c.ordinal" : "c.mtime DESC,c.ordinal"} LIMIT ?`).bind(...filter.values, size);
    const [count, selected] = await db.batch([countStatement, pageStatement]);
    const [{ total }] = rows<{ total: number }>(count);
    let page = rows<CatalogRow>(selected);
    if (recent.length && !page.length) page = await query<CatalogRow>("SELECT c.* FROM read_model_catalog c WHERE c.revision=? ORDER BY c.mtime DESC,c.ordinal LIMIT ?", [revision, size]);
    const result = { revision, items: await resultCards(page, rawQuery, undefined, true), total, sourceUpdatedAt: version.sourceUpdatedAt, indexedAt: version.indexedAt };
    rememberResult(resultKey, result);
    return result;
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
    // 先定位当前笔记可涉及的目标，再走目标索引，避免查询计划反向扫整版链接。
    const source = await query<CatalogRow & { direction: string }>(`WITH targets AS (
      SELECT target FROM read_model_aliases WHERE revision=?1 AND path=?2
      UNION SELECT target FROM read_model_links WHERE revision=?1 AND source_path=?2
    ), candidates AS (
      SELECT a.target,a.path,a.exact,MAX(a.exact) OVER (PARTITION BY a.target) priority
      FROM targets t CROSS JOIN read_model_aliases a ON a.revision=?1 AND a.target=t.target
    ), resolved AS (
      SELECT target,MIN(path) path FROM candidates WHERE exact=priority GROUP BY target HAVING COUNT(*)=1
    ), edges AS (
      SELECT l.source_path path,'back' direction FROM resolved r
      CROSS JOIN read_model_links l INDEXED BY read_backlink_lookup ON l.revision=?1 AND l.target=r.target WHERE r.path=?2 AND l.source_path<>?2
      UNION SELECT r.path,'out' direction FROM read_model_links l
      JOIN resolved r ON r.target=l.target WHERE l.revision=?1 AND l.source_path=?2
    ) SELECT c.*,e.direction FROM edges e CROSS JOIN read_model_catalog c ON c.revision=?1 AND c.path=e.path ORDER BY c.ordinal`, [revision, path]);
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
  return { begin, importBatch, finish, importArtifact, status, firstMissingBatch, latest, ensure, library, search, resolve, backlinks, getCard, readRecord, readRecords, listRecords };
}
