import type { GroupKey, LibraryScope } from "./memory-atlas-data.ts";
import type { LibraryHits } from "./library-search.ts";
import type { NoteDecisionMeta } from "./read-model-decision.ts";
import type { SnippetPart } from "./search-snippet.ts";

/** 目录项不是完整笔记；打开正文时必须另外读取，不能放进 Note[] 的正文缓存。 */
export type NoteCard = {
  kind: "note-card";
  path: string;
  title: string;
  type: string;
  group: GroupKey;
  mtime: number;
  tags: string[];
  folder: string;
  summary: string;
  trust: { label: string; className: string };
  decision: NoteDecisionMeta;
  links: number;
  bodyHash: string;
};
export type LibraryResult = NoteCard & { titleParts: SnippetPart[]; snippetParts: SnippetPart[] | null; hits: LibraryHits | null };
export type LibrarySort = "relevance" | "recent" | "connections" | "title";
export type LibraryQuery = {
  query?: string; group?: GroupKey | "all"; scope?: LibraryScope; tags?: string[];
  sort?: LibrarySort | "auto"; cursor?: string | null; limit?: number;
};
export type LibraryPage = {
  syncState?: "ready" | "building" | "failed";
  revision: string;
  items: LibraryResult[];
  total: number;
  nextCursor: string | null;
  facets: { groups: Record<GroupKey | "all", number>; scopes: Record<LibraryScope, number>; tags: { tag: string; count: number }[] };
  effectiveSort: LibrarySort;
  sourceUpdatedAt: number;
  indexedAt: number;
};
export type SearchPage = Pick<LibraryPage, "revision" | "items" | "total" | "sourceUpdatedAt" | "indexedAt">;
export type NoteResolution = { revision: string } & ({ kind: "resolved"; path: string; section: string | null } | { kind: "missing" | "ambiguous" });
export type BacklinksPage = { revision: string; items: NoteCard[]; outlinks: NoteCard[]; total: number };
export type ReadModelRecord<T = unknown> = { kind: string; key: string; value: T };

export type ReadModelManifest = {
  schemaVersion: 1; revision: string; sourceUpdatedAt: number; indexedAt: number;
  noteCount: number; batchCount: number;
  counts: { catalog: number; aliases: number; links: number; records: number };
  hashes: Record<string, number>;
  batchDigests: string[];
  baseRevision?: string;
};
export type ReadModelChunkRow = { id: string; hash: string; channel: string; ordinal: number; text: string; prefix: number };
export type ReadModelCatalogRow = {
  path: string; ordinal: number; hash: string; card_json: string; decision_json: string;
  type_lower: string; status_lower: string; group_key: string; scopes_json: string; tags_json: string; mtime: number;
};
export type ReadModelAliasRow = { target: string; path: string; exact: number };
export type ReadModelLinkRow = { source_path: string; target: string };
export type ReadModelRecordRow = { kind: string; key: string; hash: string };
/** 每个批次可以独立导入；所有批次的完成标记校验通过后才对读者可见。 */
export type ReadModelBatch = {
  chunks?: ReadModelChunkRow[]; catalog?: ReadModelCatalogRow[]; aliases?: ReadModelAliasRow[];
  links?: ReadModelLinkRow[]; records?: ReadModelRecordRow[];
};
export type ReadModelArtifact = { manifest: ReadModelManifest; batches: ReadModelBatch[] };
export type ReadModelStatus = { revision: string; state: "building" | "ready"; sourceUpdatedAt: number; indexedAt: number; completedBatches: number; batchCount: number };
