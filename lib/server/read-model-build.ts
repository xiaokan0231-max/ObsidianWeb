import { getString, getTitle, getType, stripMarkdown, type Note } from "../notes.ts";
import { GROUPS, getGroup, libraryScopeMatches, noteFolder, noteLinks, trustLayer, type LibraryScope } from "../memory-atlas-data.ts";
import { libraryCardSummary, libraryPlainText, noteTags } from "../library-search.ts";
import { noteDecisionMeta } from "../read-model-decision.ts";
import { tokyoParts } from "../dojo/utils.ts";
import { isOperationalPath } from "../vault-boundary.mjs";
import type { NoteCard, ReadModelArtifact, ReadModelBatch, ReadModelChunkRow, ReadModelRecord } from "../read-model.ts";

export const READ_MODEL_BATCH_BYTES = 480_000;
const CHUNK_LENGTH = 24_000;
const OVERLAP = 128;
export const READ_MODEL_SCOPES: LibraryScope[] = ["all", "evidence", "action", "interview", "language", "analysis"];
export const READ_MODEL_GROUPS = Object.keys(GROUPS);

export async function readModelHash(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** 保留重叠窗口用于边界命中；prefix 表示重组时应跳过的重复 UTF-16 长度。 */
function textChunks(hash: string, channel: string, text: string): ReadModelChunkRow[] {
  const rows: ReadModelChunkRow[] = [];
  let start = 0;
  do {
    let end = Math.min(text.length, start + CHUNK_LENGTH);
    if (end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1])) end--;
    let from = start;
    for (let count = 0; count < OVERLAP && from > 0; count++) {
      from--;
      if (from > 0 && /[\uDC00-\uDFFF]/u.test(text[from]) && /[\uD800-\uDBFF]/u.test(text[from - 1])) from--;
    }
    const ordinal = rows.length;
    rows.push({ id: `${hash}:${channel}:${ordinal}`, hash, channel, ordinal, text: text.slice(from, end), prefix: start - from });
    start = end;
  } while (start < text.length);
  return rows;
}

function frontmatterText(note: Note) {
  return Object.entries(note.frontmatter).map(([key, value]) => `${key} ${Array.isArray(value) ? value.join(" ") : getString(value)}`).join("\n");
}

type PreparedNote = { hash: string; revisionHash: string; chunks: ReadModelChunkRow[] };
const preparedNotes = new WeakMap<Note, Promise<PreparedNote>>();
function prepareNote(note: Note): Promise<PreparedNote> {
  const cached = preparedNotes.get(note);
  if (cached) return cached;
  const pending = (async () => {
    const hash = await readModelHash(JSON.stringify({ path: note.path, content: note.content, frontmatter: note.frontmatter }));
    return { hash, revisionHash: await readModelHash(JSON.stringify([hash, note.tags, note.stat])), chunks: [
      ...textChunks(hash, "match", `${note.path}\n${note.content}\n${JSON.stringify(note.frontmatter)}`.toLowerCase()),
      ...textChunks(hash, "body", libraryPlainText(note)), ...textChunks(hash, "front", frontmatterText(note)),
      ...textChunks(hash, "palette", stripMarkdown(note.content)),
    ] };
  })();
  // Vault 缓存只替换变更过的 Note；未变正文不再重复哈希、剥 Markdown 和分块。
  preparedNotes.set(note, pending);
  pending.catch(() => { if (preparedNotes.get(note) === pending) preparedNotes.delete(note); });
  return pending;
}

function decisionSource(note: Note, card: NoteCard): Note {
  const keys = ["type", "status", "next_action", "action", "next_event_at", "audience", "status_updated", "date"];
  return { path: note.path, tags: [], stat: note.stat, content: `# ${card.title}`,
    frontmatter: { ...Object.fromEntries(keys.filter((key) => key in note.frontmatter).map((key) => [key, note.frontmatter[key]])), reason: card.decision.importance } };
}

/** 索引在同步/发布阶段生成；读取端只导入有界批次，不解析一整库正文。 */
export async function buildReadModelArtifact(input: Note[], options: { revision?: string; publishedAt?: string; records?: ReadModelRecord[]; skipContentHashes?: ReadonlySet<string> } = {}): Promise<ReadModelArtifact> {
  const notes = input.filter((note) => isOperationalPath(note.path));
  if (new Set(notes.map((note) => note.path)).size !== notes.length) throw new Error("资料目录存在重复路径");
  const batches: ReadModelBatch[] = [];
  let batch: ReadModelBatch = {};
  let batchBytes = 2;
  const hashes: Record<string, number> = {};
  const counts = { catalog: notes.length, aliases: 0, links: 0, records: options.records?.length ?? 0 };
  const add = <K extends keyof ReadModelBatch>(kind: K, row: NonNullable<ReadModelBatch[K]>[number]) => {
    const size = new TextEncoder().encode(JSON.stringify(row)).byteLength + 40;
    if (size > READ_MODEL_BATCH_BYTES) throw new Error("单条索引超过导入上限");
    if (batchBytes + size > READ_MODEL_BATCH_BYTES) { batches.push(batch); batch = {}; batchBytes = 2; }
    const rows = (batch[kind] ??= []) as NonNullable<ReadModelBatch[K]>;
    (rows as unknown[]).push(row);
    batchBytes += size;
  };
  const addText = (hash: string, channel: string, value: string) => {
    const chunks = textChunks(hash, channel, value);
    hashes[hash] = (hashes[hash] ?? 0) + chunks.length;
    if (!options.skipContentHashes?.has(hash)) for (const chunk of chunks) add("chunks", chunk);
  };
  const today = tokyoParts().date;
  const contentHashes: string[] = [];
  for (const [ordinal, note] of notes.entries()) {
    const prepared = await prepareNote(note), bodyHash = prepared.hash;
    contentHashes.push(prepared.revisionHash);
    const card: NoteCard = { kind: "note-card", path: note.path, title: getTitle(note), type: getType(note), group: getGroup(note.path),
      mtime: note.stat.mtime, tags: noteTags(note), folder: noteFolder(note.path), summary: libraryCardSummary(note),
      trust: trustLayer(note), decision: noteDecisionMeta(note, today), links: noteLinks(note).length, bodyHash };
    add("catalog", { path: note.path, ordinal, hash: bodyHash, card_json: JSON.stringify(card), decision_json: JSON.stringify(decisionSource(note, card)),
      type_lower: card.type.toLowerCase(), status_lower: getString(note.frontmatter.status).toLowerCase(), group_key: card.group,
      scopes_json: JSON.stringify(READ_MODEL_SCOPES.filter((scope) => libraryScopeMatches(note, scope))), tags_json: JSON.stringify(card.tags), mtime: card.mtime });
    const stem = note.path.replace(/\.md$/i, "");
    add("aliases", { target: stem, path: note.path, exact: 1 }); counts.aliases++;
    for (let slash = stem.indexOf("/"); slash !== -1; slash = stem.indexOf("/", slash + 1)) {
      add("aliases", { target: stem.slice(slash + 1), path: note.path, exact: 0 }); counts.aliases++;
    }
    for (const target of new Set(noteLinks(note))) { add("links", { source_path: note.path, target }); counts.links++; }
    hashes[bodyHash] = prepared.chunks.length;
    if (!options.skipContentHashes?.has(bodyHash)) for (const chunk of prepared.chunks) add("chunks", chunk);
  }
  const recordKeys = new Set<string>();
  const recordHashes: string[] = [];
  for (const record of options.records ?? []) {
    const key = JSON.stringify([record.kind, record.key]);
    if (recordKeys.has(key)) throw new Error("查询投影存在重复键");
    recordKeys.add(key);
    const value = JSON.stringify(record.value);
    if (value === undefined) throw new Error("查询投影内容不能序列化");
    const hash = await readModelHash(`record:${value}`);
    recordHashes.push(hash);
    add("records", { kind: record.kind, key: record.key, hash });
    if (!(hash in hashes)) addText(hash, "record", value);
  }
  if (batchBytes > 2) batches.push(batch);
  const sourceUpdatedAt = Math.max(0, ...notes.map((note) => note.stat.mtime));
  const revision = options.revision ?? `read-${await readModelHash(JSON.stringify([contentHashes, [...recordKeys], recordHashes, today]))}`;
  const indexedAt = options.publishedAt ? Date.parse(options.publishedAt) : Date.now();
  return { manifest: { schemaVersion: 1, revision, sourceUpdatedAt, indexedAt: Number.isFinite(indexedAt) ? indexedAt : Date.now(),
    noteCount: notes.length, batchCount: batches.length, counts, hashes,
    batchDigests: await Promise.all(batches.map((value) => readModelHash(JSON.stringify(value)))) }, batches };
}
