import {
  getString,
  getTitle,
  getType,
  noteBasename,
  stripFrontmatter,
  stripMarkdown,
  type Note,
} from "./notes.ts";

export type GraphNodeKind = "note" | "company" | "skill";
export type GraphViewMode = "semantic" | "all";
export type GraphGroup = "self" | "career" | "study" | "analysis" | "system";

export type GraphRelation =
  | "about_company"
  | "for_case"
  | "requires_skill"
  | "prefers_skill"
  | "has_experience"
  | "derived_from"
  | "uses_annotation"
  | "continues"
  | "uses_evidence"
  | "embeds"
  | "related_to"
  | "indexes"
  | "governs"
  | "reviews"
  | "references";

export type GraphEdgeOrigin =
  | "frontmatter"
  | "canonical-table"
  | "embed"
  | "wikilink";

export type KnowledgeGraphNode = {
  id: string;
  label: string;
  kind: GraphNodeKind;
  group: GraphGroup;
  notePath?: string;
  noteType?: string;
  layer: "authority" | "evidence" | "analysis" | "action" | "reference" | "generated";
  updatedAt: number;
  excerpt: string;
  pathLabel: string;
  openable: boolean;
};

export type KnowledgeGraphEdge = {
  id: string;
  source: string;
  target: string;
  relation: GraphRelation;
  origin: GraphEdgeOrigin;
  sourceField?: string;
  directed: boolean;
};

export type KnowledgeGraph = {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  unresolved: GraphUnresolvedReference[];
};

export type GraphUnresolvedReference = {
  sourcePath: string;
  target: string;
  relation: GraphRelation;
  sourceField?: string;
};

export type WikiLink = {
  raw: string;
  target: string;
  section: string;
  alias: string;
  embed: boolean;
};

export type GraphViewOptions = {
  mode: GraphViewMode;
  group?: GraphGroup | "all";
  kind?: GraphNodeKind | "all";
};

const GENERATED_TYPES = new Set([
  "ledger",
  "training-profile",
  "training-lesson",
  "training-log",
  "practice-log",
  "exam-log",
  "language-bank",
  "language-session-log",
  "language-coach-log",
  "language-exam-log",
  "language-curriculum",
  "language-batch-log",
  "language-expression-course-progress",
  "outbound-draft",
]);

// 出リンクが「そのノートの中身」になる type だけを型付きにする。
// policy-change は _数据字典 の規約上「仅供审计，不参与当前判断」なので昇格させない。
const INDEX_LINK_RELATIONS: Record<string, GraphRelation | undefined> = {
  moc: "indexes",
  policy: "governs",
};

const ACTION_TYPES = new Set([
  "job-case",
  "todo",
  "job-queue",
  "job-audit",
  "application_log",
]);

const EVIDENCE_TYPES = new Set([
  "company",
  "review",
  "transcript",
  "transcript-study",
  "study-annotation",
  "interview-answer-feedback",
  "mail",
  "policy",
  "job-case",
]);

const ANALYSIS_TYPES = new Set([
  "ai-report",
  "analysis",
  "ai-review",
  "deep-thought-opinion",
  "interview-answer-review",
]);

export const GRAPH_RELATION_LABELS: Record<GraphRelation, string> = {
  about_company: "关于公司",
  for_case: "关联案件",
  requires_skill: "要求技能",
  prefers_skill: "欢迎技能",
  has_experience: "本人经验",
  derived_from: "派生自",
  uses_annotation: "使用批注",
  continues: "承接前次",
  uses_evidence: "使用证据",
  embeds: "嵌入",
  related_to: "明确相关",
  indexes: "索引",
  governs: "规约",
  reviews: "复核",
  references: "普通引用",
};

function graphGroup(path: string): GraphGroup {
  if (path.startsWith("10_")) return "self";
  if (path.startsWith("20_")) return "career";
  if (path.startsWith("30_")) return "study";
  if (path.startsWith("80_")) return "analysis";
  return "system";
}

function graphLayer(note: Note): KnowledgeGraphNode["layer"] {
  const type = getType(note);
  if (GENERATED_TYPES.has(type)) return "generated";
  if (type === "self") return "authority";
  if (EVIDENCE_TYPES.has(type)) return "evidence";
  if (ANALYSIS_TYPES.has(type)) return "analysis";
  if (ACTION_TYPES.has(type)) return "action";
  return "reference";
}

/**
 * 示例代码里的 `[[...]]` 不属于知识关系。先剥离 frontmatter、代码和注释，
 * 再区分嵌入与普通双链；结构化 frontmatter 由独立规则读取。
 */
export function extractWikiLinks(content: string): WikiLink[] {
  const body = stripFrontmatter(content)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/`[^`\n]*`/g, " ");
  return Array.from(
    body.matchAll(/(!)?\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g),
    (match) => ({
      raw: match[0],
      embed: Boolean(match[1]),
      target: match[2].trim(),
      section: (match[3] ?? "").trim(),
      alias: (match[4] ?? "").trim(),
    }),
  ).filter((link) => Boolean(link.target));
}

export function graphStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => graphStringList(item));
  }
  const text = getString(value).trim().replace(/^['"]|['"]$/g, "");
  if (!text) return [];
  const wikiLinks = Array.from(text.matchAll(/\[\[([^\]]+)\]\]/g), (match) => match[0]);
  if (wikiLinks.length) return wikiLinks;
  const unwrapped = text.replace(/^\[|\]$/g, "");
  return unwrapped
    .split(/[,，]/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function wikiTarget(value: unknown): string {
  const raw = getString(value).trim().replace(/^['"]|['"]$/g, "");
  const inner = raw.match(/^\[\[([^\]]+)\]\]$/)?.[1] ?? raw;
  return inner.split("|")[0].split("#")[0].trim().replace(/\.md$/i, "");
}

function normalizeIndexKey(value: string) {
  return value.normalize("NFKC").trim().replace(/\.md$/i, "");
}

type NoteIndex = {
  byKey: Map<string, Note>;
  collisions: Set<string>;
};

export function buildGraphNoteIndex(notes: Note[]): NoteIndex {
  const byKey = new Map<string, Note>();
  const collisions = new Set<string>();
  const register = (key: string, note: Note) => {
    const normalized = normalizeIndexKey(key);
    if (!normalized) return;
    const existing = byKey.get(normalized);
    if (existing && existing.path !== note.path) collisions.add(normalized);
    else byKey.set(normalized, note);
  };
  for (const note of notes) {
    register(noteBasename(note.path), note);
    register(note.path, note);
    register(note.path.replace(/\.md$/i, ""), note);
    for (const alias of graphStringList(note.frontmatter.aliases)) register(alias, note);
  }
  return { byKey, collisions };
}

export function resolveGraphNote(index: NoteIndex, target: string) {
  const normalized = normalizeIndexKey(target);
  if (!normalized || index.collisions.has(normalized)) return undefined;
  const direct = index.byKey.get(normalized);
  if (direct) return direct;
  // basename へ落とす経路にも曖昧判定を効かせる。ここで最初に登録された1本を返すと、
  // 間違った辺が「解決済み」として図に載り、unresolved にも出ないので誰も気づけない。
  const fallback = normalizeIndexKey(noteBasename(normalized));
  return index.collisions.has(fallback) ? undefined : index.byKey.get(fallback);
}

export function normalizeCompany(value: unknown) {
  const raw = getString(value).normalize("NFKC").trim();
  const display = raw
    .replace(/^(株式会社|有限会社|合同会社)\s*/u, "")
    .replace(/\s*(株式会社|有限会社|合同会社)$/u, "")
    .replace(/[_　]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const key = display
    .toLocaleLowerCase("en-US")
    .replace(/[\s・･._-]+/g, "")
    .replace(/[()（）]/g, "");
  return key ? { id: `company:${key}`, key, label: display || raw } : null;
}

const SKILL_ALIASES: Record<string, { id: string; label: string }> = {
  gcp: { id: "google-cloud", label: "Google Cloud" },
  "google cloud": { id: "google-cloud", label: "Google Cloud" },
  oracle: { id: "oracle-database", label: "Oracle Database" },
  "oracle database": { id: "oracle-database", label: "Oracle Database" },
  spark: { id: "apache-spark", label: "Spark" },
  hadoop: { id: "apache-hadoop", label: "Hadoop" },
  hive: { id: "apache-hive", label: "Hive" },
  kafka: { id: "apache-kafka", label: "Kafka" },
  flink: { id: "apache-flink", label: "Flink" },
  kylin: { id: "apache-kylin", label: "Kylin" },
};

function skillSlug(value: string) {
  const ascii = value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "");
  return ascii || encodeURIComponent(value.normalize("NFKC"));
}

export function normalizeSkill(value: unknown) {
  const raw = getString(value).normalize("NFKC").trim();
  const preferred = /[（(](歓迎欄のみ|歓迎|尚可|preferred)[）)]$/iu.test(raw);
  const stripped = raw
    .replace(/[（(](歓迎欄のみ|歓迎|尚可|preferred)[）)]$/iu, "")
    .trim();
  if (!stripped) return null;
  const alias = SKILL_ALIASES[stripped.toLocaleLowerCase("en-US")];
  const id = alias?.id ?? skillSlug(stripped);
  return {
    id: `skill:${id}`,
    key: id,
    label: alias?.label ?? stripped,
    preferred,
  };
}

export type ConfirmedSkill = {
  id: string;
  label: string;
  experience: string;
  since: string;
};

/** 《技術スタック》中的这张表是本人技能关系的唯一上游，不从散文猜经验。 */
export function parseConfirmedSkillTable(content: string): ConfirmedSkill[] {
  const body = stripFrontmatter(content);
  const heading = body.search(/^##\s+経験年数（確定値/mu);
  if (heading < 0) return [];
  const section = body.slice(heading).split(/\n##\s+/u)[0];
  const lines = section.split(/\r?\n/u).filter((line) => /^\|.*\|\s*$/u.test(line));
  if (lines.length < 3) return [];
  const cells = (line: string) => line.slice(1, -1).split("|").map((value) => value.trim());
  const headers = cells(lines[0]);
  const idIndex = headers.findIndex((value) => value === "skill_id");
  const labelIndex = headers.findIndex((value) => value === "技術");
  const experienceIndex = headers.findIndex((value) => value === "年数");
  const sinceIndex = headers.findIndex((value) => value === "起点");
  if ([idIndex, labelIndex, experienceIndex, sinceIndex].some((index) => index < 0)) return [];
  return lines.slice(2).flatMap((line) => {
    const row = cells(line);
    const id = row[idIndex]?.replace(/`/g, "").trim();
    const label = row[labelIndex]?.replace(/\*\*/g, "").trim();
    if (!id || !label) return [];
    return [{
      id,
      label,
      experience: row[experienceIndex]?.replace(/\*\*/g, "").trim() ?? "",
      since: row[sinceIndex]?.replace(/\*\*/g, "").trim() ?? "",
    }];
  });
}

function noteNode(note: Note): KnowledgeGraphNode {
  const excerpt = stripMarkdown(note.content).replace(/\s+/g, " ").trim();
  return {
    id: note.path,
    label: getTitle(note),
    kind: "note",
    group: graphGroup(note.path),
    notePath: note.path,
    noteType: getType(note),
    layer: graphLayer(note),
    updatedAt: note.stat.mtime,
    excerpt,
    pathLabel: note.path.replace(/\.md$/i, ""),
    openable: true,
  };
}

function relationValues(value: unknown, related = false): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => relationValues(item, related));
  const text = getString(value).trim();
  if (!text) return [];
  if (related && !text.includes("[[")) {
    return text.split(/[／/]/u).map((item) => item.trim()).filter(Boolean);
  }
  const links = Array.from(text.matchAll(/\[\[([^\]]+)\]\]/g), (match) => `[[${match[1]}]]`);
  return links.length ? links : [text];
}

export function buildKnowledgeGraph(notes: Note[]): KnowledgeGraph {
  const nodes = notes.map(noteNode);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edgeKeys = new Set<string>();
  const edges: KnowledgeGraphEdge[] = [];
  const unresolved: GraphUnresolvedReference[] = [];
  const noteIndex = buildGraphNoteIndex(notes);
  const caseById = new Map<string, Note>();
  notes.forEach((note) => {
    const caseId = getString(note.frontmatter.case_id).trim();
    if (["job-case", "excluded-job"].includes(getType(note)) && caseId) caseById.set(caseId, note);
  });

  const addNode = (node: KnowledgeGraphNode) => {
    if (nodeById.has(node.id)) return;
    nodes.push(node);
    nodeById.set(node.id, node);
  };
  const addEdge = (
    source: string,
    target: string,
    relation: GraphRelation,
    origin: GraphEdgeOrigin,
    sourceField?: string,
    directed = true,
  ) => {
    if (!nodeById.has(source) || !nodeById.has(target) || source === target) return;
    const key = `${source}\u0000${target}\u0000${relation}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({
      id: `edge:${edges.length}:${relation}`,
      source,
      target,
      relation,
      origin,
      sourceField,
      directed,
    });
  };
  const addNoteRelation = (
    source: Note,
    rawTarget: unknown,
    relation: GraphRelation,
    sourceField: string,
  ) => {
    const targetName = wikiTarget(rawTarget);
    const target = resolveGraphNote(noteIndex, targetName);
    if (!target) {
      if (targetName) unresolved.push({ sourcePath: source.path, target: targetName, relation, sourceField });
      return;
    }
    addEdge(source.path, target.path, relation, "frontmatter", sourceField);
  };

  for (const note of notes) {
    const company = normalizeCompany(note.frontmatter.company);
    if (company) {
      addNode({
        id: company.id,
        label: company.label,
        kind: "company",
        group: "career",
        layer: "evidence",
        updatedAt: note.stat.mtime,
        excerpt: `${company.label} 的案件、卷宗与面试证据实体。`,
        pathLabel: `公司实体/${company.key}`,
        openable: false,
      });
      addEdge(note.path, company.id, "about_company", "frontmatter", "company");
    }

    const caseId = getString(note.frontmatter.case_id).trim();
    if (caseId && !["job-case", "excluded-job"].includes(getType(note))) {
      const target = caseById.get(caseId);
      if (target) addEdge(note.path, target.path, "for_case", "frontmatter", "case_id");
      else unresolved.push({ sourcePath: note.path, target: caseId, relation: "for_case", sourceField: "case_id" });
    }
    for (const value of relationValues(note.frontmatter.case)) {
      addNoteRelation(note, value, "for_case", "case");
    }
    for (const value of relationValues(note.frontmatter.source_note)) {
      addNoteRelation(note, value, "derived_from", "source_note");
    }
    for (const value of relationValues(note.frontmatter.annotation_note)) {
      addNoteRelation(note, value, "uses_annotation", "annotation_note");
    }
    for (const value of relationValues(note.frontmatter.previous_prep)) {
      addNoteRelation(note, value, "continues", "previous_prep");
    }
    for (const value of relationValues(note.frontmatter.evidence_inputs)) {
      addNoteRelation(note, value, "uses_evidence", "evidence_inputs");
    }
    for (const value of relationValues(note.frontmatter.company_dossier)) {
      addNoteRelation(note, value, "uses_evidence", "company_dossier");
    }
    for (const value of relationValues(note.frontmatter.related, true)) {
      addNoteRelation(note, value, "related_to", "related");
    }
    // 本文にリンクを持たない規範ノート（例：信息源与证据规则）が、
    // 何を規約しているかを自分で宣言できるようにする。
    for (const value of relationValues(note.frontmatter.governs)) {
      addNoteRelation(note, value, "governs", "governs");
    }
    // AI 同士の相互レビュー。原文を上書きせず署名付きで並べる規約（AGENTS.md AI-ATTRIBUTION）の
    // 図側の受け皿。誰が誰を複核したかが辿れないと、後から根拠として使えない。
    for (const value of relationValues(note.frontmatter.reviews)) {
      addNoteRelation(note, value, "reviews", "reviews");
    }

    if (getType(note) === "job-case") {
      for (const rawSkill of graphStringList(note.frontmatter.stack)) {
        const skill = normalizeSkill(rawSkill);
        if (!skill) continue;
        addNode({
          id: skill.id,
          label: skill.label,
          kind: "skill",
          group: "self",
          layer: "reference",
          updatedAt: note.stat.mtime,
          excerpt: `${skill.label} 的岗位需求与本人确证经验实体。`,
          pathLabel: `技能实体/${skill.key}`,
          openable: false,
        });
        addEdge(
          note.path,
          skill.id,
          skill.preferred ? "prefers_skill" : "requires_skill",
          "frontmatter",
          "stack",
        );
      }
    }

    // 索引・規範ノートの「出リンク」はそのノートの中身そのもの
    // （MOC は目次、policy は「この事実はどこが正本か」の routing）。
    // 一方ハブに見える被リンク（ルール書が65本から引かれる等）は **入** 側なので、
    // 出側だけを型付きに昇格すれば、意味は拾えて毛玉は増えない。
    const indexRelation = INDEX_LINK_RELATIONS[getType(note)];

    for (const link of extractWikiLinks(note.content)) {
      const target = resolveGraphNote(noteIndex, link.target);
      const relation = link.embed ? "embeds" : indexRelation ?? "references";
      if (!target) {
        unresolved.push({ sourcePath: note.path, target: link.target, relation });
        continue;
      }
      addEdge(
        note.path,
        target.path,
        relation,
        link.embed ? "embed" : "wikilink",
        undefined,
        relation !== "references",
      );
    }
  }

  for (const note of notes) {
    if (noteBasename(note.path) !== "技術スタック") continue;
    for (const confirmed of parseConfirmedSkillTable(note.content)) {
      const skill = normalizeSkill(confirmed.label);
      if (!skill) continue;
      const id = `skill:${confirmed.id}`;
      addNode({
        id,
        label: skill.label,
        kind: "skill",
        group: "self",
        layer: "authority",
        updatedAt: note.stat.mtime,
        excerpt: `${confirmed.experience}${confirmed.since ? ` · 起点 ${confirmed.since}` : ""}`,
        pathLabel: `技能实体/${confirmed.id}`,
        openable: false,
      });
      // 求人侧の別名から先に同じ技能が作られていても、stable skill_id を正にする。
      if (skill.id !== id && nodeById.has(skill.id)) {
        const aliasEdges = edges.filter((edge) => edge.target === skill.id);
        for (const edge of aliasEdges) edge.target = id;
        nodeById.delete(skill.id);
        const index = nodes.findIndex((node) => node.id === skill.id);
        if (index >= 0) nodes.splice(index, 1);
      }
      addEdge(note.path, id, "has_experience", "canonical-table", "skill_id");
    }
  }

  return { nodes, edges, unresolved };
}

export function selectKnowledgeGraphView(graph: KnowledgeGraph, options: GraphViewOptions) {
  const baseNodes = graph.nodes
    .filter((node) => options.group === undefined || options.group === "all" || node.group === options.group)
    .filter((node) => options.mode === "all" || node.layer !== "generated");
  const allowedNodes = new Set(baseNodes.map((node) => node.id));
  const nodeById = new Map(baseNodes.map((node) => [node.id, node]));
  let edges = graph.edges.filter((edge) => (
    allowedNodes.has(edge.source)
    && allowedNodes.has(edge.target)
    && (options.mode === "all" || edge.relation !== "references")
  ));
  const selectedKind = options.kind === undefined || options.kind === "all"
    ? null
    : options.kind;
  if (selectedKind === "note") {
    edges = edges.filter((edge) => (
      nodeById.get(edge.source)?.kind === "note"
      && nodeById.get(edge.target)?.kind === "note"
    ));
  } else if (selectedKind) {
    // 公司／技能本身没有同类边；筛选时保留相邻笔记，关系才仍然可读。
    edges = edges.filter((edge) => (
      nodeById.get(edge.source)?.kind === selectedKind
      || nodeById.get(edge.target)?.kind === selectedKind
    ));
  }
  const connected = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
  const visibleNodes = new Set(
    graph.nodes
      .filter((node) => allowedNodes.has(node.id))
      .filter((node) => !selectedKind || node.kind === selectedKind || connected.has(node.id))
      .map((node) => node.id),
  );
  if (options.mode === "all") {
    return {
      nodes: graph.nodes.filter((node) => visibleNodes.has(node.id)),
      edges,
    };
  }
  return {
    nodes: graph.nodes.filter((node) => visibleNodes.has(node.id) && connected.has(node.id)),
    edges,
  };
}

export function graphHealth(graph: KnowledgeGraph) {
  const semanticEdges = graph.edges.filter((edge) => edge.relation !== "references");
  const connected = new Set(semanticEdges.flatMap((edge) => [edge.source, edge.target]));
  // 孤点は「既定ビューの母集団のうち、強型辺を1本も持たないもの」。
  // 母集団を connected で先に絞ると孤点は構造上ゼロにしかならず、健康度が嘘をつく。
  const defaultNodes = graph.nodes.filter((node) => node.layer !== "generated");
  return {
    semanticNodes: defaultNodes.filter((node) => connected.has(node.id)).length,
    semanticEdges: semanticEdges.length,
    referenceEdges: graph.edges.length - semanticEdges.length,
    unresolved: graph.unresolved.length,
    defaultIsolates: defaultNodes.filter((node) => !connected.has(node.id)).length,
  };
}
