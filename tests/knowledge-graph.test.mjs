import assert from "node:assert/strict";
import test from "node:test";

import {
  buildKnowledgeGraph,
  extractWikiLinks,
  graphHealth,
  normalizeCompany,
  normalizeSkill,
  parseConfirmedSkillTable,
  selectKnowledgeGraphView,
} from "../lib/knowledge-graph.ts";

function note(path, type, frontmatter = {}, body = "") {
  return {
    path,
    stat: { ctime: 1, mtime: 2, size: body.length },
    tags: [],
    frontmatter: { type, ...frontmatter },
    content: `---\ntype: ${type}\n---\n# ${path.split("/").pop().replace(/\.md$/, "")}\n\n${body}`,
  };
}

test("wiki link extractor separates embeds and ignores examples in code/comments", () => {
  const links = extractWikiLinks(`
[[普通笔记]] ![[嵌入笔记#章|别名]]

\`[[行内示例]]\`
\`\`\`
[[代码块示例]]
\`\`\`
<!-- [[注释示例]] -->
`);
  assert.deepEqual(
    links.map((link) => ({ target: link.target, embed: link.embed, section: link.section })),
    [
      { target: "普通笔记", embed: false, section: "" },
      { target: "嵌入笔记", embed: true, section: "章" },
    ],
  );
});

test("company and skill normalization is deterministic but not fuzzy", () => {
  assert.deepEqual(normalizeCompany("株式会社 Sharing_Innovations"), {
    id: "company:sharinginnovations",
    key: "sharinginnovations",
    label: "Sharing Innovations",
  });
  assert.deepEqual(normalizeSkill("GCP"), {
    id: "skill:google-cloud",
    key: "google-cloud",
    label: "Google Cloud",
    preferred: false,
  });
  assert.equal(normalizeSkill("Kafka（歓迎欄のみ）")?.preferred, true);
  assert.notEqual(normalizeSkill("ETL")?.id, normalizeSkill("ETL/ELT")?.id);
});

test("confirmed skill table is the only source of personal experience edges", () => {
  const parsed = parseConfirmedSkillTable(`
# 技術スタック

## 経験年数（確定値・テスト）

| skill_id | 技術 | 年数 | 起点 |
|---|---|---|---|
| apache-spark | Spark | 約8年 | 2016年 |
| java | Java | 約12年 | 2012年 |

## 散文
Python も使える。
`);
  assert.deepEqual(parsed.map((skill) => skill.id), ["apache-spark", "java"]);
});

test("hybrid graph builds typed evidence, company, case and skill relations", () => {
  const notes = [
    note("10_关于我/技術スタック.md", "self", {}, `
## 経験年数（確定値・2026）

| skill_id | 技術 | 年数 | 起点 |
|---|---|---|---|
| apache-spark | Spark | 約8年 | 2016年 |

正文提到 Python，但没有结构化确证行。
`),
    note("20_求職/Acme/_Acme.md", "company", { company: "株式会社Acme" }),
    note("20_求職/Acme/Acme_Data.md", "job-case", {
      case_id: "acme-data",
      company: "Acme株式会社",
      stack: "[Spark, Kafka（歓迎欄のみ）, ETL/ELT]",
    }, "[[普通参考]]"),
    note("20_求職/Acme/逐字稿.md", "transcript", { company: "Acme株式会社" }),
    note("20_求職/Acme/整理稿.md", "transcript-study", {
      company: "Acme株式会社",
      source_note: "[[逐字稿]]",
    }),
    note("20_求職/Acme/批注.md", "study-annotation", {
      source_note: "[[整理稿]]",
    }),
    note("20_求職/Acme/回答品質復盤.md", "interview-answer-review", {
      company: "Acme株式会社",
      source_note: "[[整理稿]]",
      annotation_note: "[[批注]]",
    }),
    note("20_求職/Acme/准备1.md", "interview-prep", {
      company: "Acme株式会社",
      case: "[[Acme_Data]]",
      evidence_inputs: ["[[整理稿]]"],
    }, "![[技術スタック]]"),
    note("20_求職/Acme/准备2.md", "interview-prep", {
      company: "Acme株式会社",
      case: "[[Acme_Data]]",
      previous_prep: "[[准备1]]",
    }),
    note("20_求職/_TODO/Acme.md", "todo", { case_id: "acme-data" }),
    note("99_系统/普通参考.md", "policy"),
    note("80_AI分析/机器课程.md", "language-curriculum", {}, "[[Acme_Data]]"),
  ];

  const graph = buildKnowledgeGraph(notes);
  assert.equal(graph.unresolved.length, 0);
  assert.equal(graph.nodes.filter((node) => node.kind === "company").length, 1);
  assert.ok(graph.nodes.some((node) => node.id === "skill:apache-spark"));
  assert.ok(graph.edges.some((edge) => edge.relation === "has_experience" && edge.target === "skill:apache-spark"));
  assert.ok(graph.edges.some((edge) => edge.relation === "requires_skill" && edge.target === "skill:apache-spark"));
  assert.ok(graph.edges.some((edge) => edge.relation === "prefers_skill" && edge.target === "skill:apache-kafka"));
  assert.ok(graph.edges.some((edge) => edge.relation === "derived_from" && edge.source.endsWith("整理稿.md")));
  assert.ok(graph.edges.some((edge) => edge.relation === "uses_annotation"));
  assert.ok(graph.edges.some((edge) => edge.relation === "continues"));
  assert.ok(graph.edges.some((edge) => edge.relation === "uses_evidence"));
  assert.ok(graph.edges.some((edge) => edge.relation === "for_case" && edge.source.includes("_TODO")));
  assert.ok(graph.edges.some((edge) => edge.relation === "embeds"));
  assert.equal(
    graph.edges.some((edge) => edge.relation === "has_experience" && edge.target.includes("python")),
    false,
    "正文提及不得升级为本人技能事实",
  );

  const semantic = selectKnowledgeGraphView(graph, { mode: "semantic", group: "all", kind: "all" });
  assert.equal(semantic.edges.some((edge) => edge.relation === "references"), false);
  assert.equal(semantic.nodes.some((node) => node.noteType === "language-curriculum"), false);
  const all = selectKnowledgeGraphView(graph, { mode: "all", group: "all", kind: "all" });
  assert.ok(all.edges.some((edge) => edge.relation === "references"));
  assert.ok(all.nodes.some((node) => node.noteType === "language-curriculum"));

  const companies = selectKnowledgeGraphView(graph, { mode: "semantic", group: "all", kind: "company" });
  assert.ok(companies.nodes.some((node) => node.kind === "company"));
  assert.ok(companies.nodes.some((node) => node.kind === "note"), "公司筛选要保留关系上下文笔记");
  assert.ok(companies.edges.every((edge) => edge.relation === "about_company"));
  const skills = selectKnowledgeGraphView(graph, { mode: "semantic", group: "all", kind: "skill" });
  assert.ok(skills.nodes.some((node) => node.kind === "skill"));
  assert.ok(skills.edges.some((edge) => edge.relation === "has_experience"));
  assert.ok(skills.edges.some((edge) => edge.relation === "requires_skill"));
});

test("索引・规范笔记的出边升格为语义边，入边仍是弱关系", () => {
  const notes = [
    note("99_系统/_数据字典.md", "policy", {}, "正本は [[_不採用台帳_正]] と [[_求人検索条件]] を見る。"),
    note("20_求職/_求人検索条件.md", "policy", {}, ""),
    note("30_日本語学習/_日本語学習.md", "moc", {}, "→ [[誤用辞典]]"),
    note("30_日本語学習/誤用辞典.md", "study", {}, "本文にリンクは無い。"),
    note("20_求職/_不採用台帳_正.md", "ledger", {}, "ルールは [[_数据字典]] に従う。"),
    note("99_系统/规则変更/2026-07-21_SEARCH-EXCL.md", "policy-change", {}, "旧版は [[_数据字典]]。"),
  ];
  const graph = buildKnowledgeGraph(notes);
  const rel = (from, to) => graph.edges
    .find((edge) => edge.source === from && edge.target === to)?.relation;

  // 出边＝そのノートの中身なので型付き
  assert.equal(rel("99_系统/_数据字典.md", "20_求職/_不採用台帳_正.md"), "governs");
  assert.equal(rel("30_日本語学習/_日本語学習.md", "30_日本語学習/誤用辞典.md"), "indexes");
  // 入边（みんなが規則書を引く方）は弱いまま＝毛玉を作らない
  assert.equal(rel("20_求職/_不採用台帳_正.md", "99_系统/_数据字典.md"), "references");
  // policy-change は「仅供审计」なので昇格させない
  assert.equal(rel("99_系统/规则変更/2026-07-21_SEARCH-EXCL.md", "99_系统/_数据字典.md"), "references");

  // 本文にリンクを持たない study ノートも、MOC から indexes で拾われて既定ビューに出る
  const semantic = selectKnowledgeGraphView(graph, { mode: "semantic", group: "all", kind: "all" });
  const ids = new Set(semantic.nodes.map((node) => node.id));
  assert.ok(ids.has("30_日本語学習/誤用辞典.md"));
  assert.ok(ids.has("99_系统/_数据字典.md"));
});

test("ai-review は原稿を書き換えず reviews 辺で相互検証の履歴を残す", () => {
  const notes = [
    note("80_AI分析/2026-08-03_Codex_戦略転換.md", "ai-report", { ai_author: "Codex" }, ""),
    note("80_AI分析/2026-08-03_Claude_複核.md", "ai-review", {
      ai_author: "Claude",
      reviews: "[[2026-08-03_Codex_戦略転換]]",
      reviewed_author: "Codex",
      verdict: "partially_agree",
    }, ""),
  ];
  const graph = buildKnowledgeGraph(notes);
  const edge = graph.edges.find((item) => item.relation === "reviews");
  assert.equal(edge.source, "80_AI分析/2026-08-03_Claude_複核.md");
  assert.equal(edge.target, "80_AI分析/2026-08-03_Codex_戦略転換.md");

  // 既定ビューに両方出ないと「誰が誰を複核したか」が読めない
  const semantic = selectKnowledgeGraphView(graph, { mode: "semantic", group: "all", kind: "all" });
  const ids = new Set(semantic.nodes.map((node) => node.id));
  assert.ok(ids.has("80_AI分析/2026-08-03_Codex_戦略転換.md"));
  assert.ok(ids.has("80_AI分析/2026-08-03_Claude_複核.md"));
});

test("同名ノートが複数ある時は、パス付きリンクの basename 落としでも解決しない", () => {
  const notes = [
    note("20_求職/A社/面談メモ.md", "material"),
    note("20_求職/B社/面談メモ.md", "material"),
    note("10_关于我/引用元.md", "self", {}, "[[20_求職/C社/面談メモ]] を見る。"),
  ];
  const graph = buildKnowledgeGraph(notes);
  // 曖昧なまま1本目に寄せると、間違った辺が「解決済み」として図に載って誰も気づけない。
  assert.equal(graph.edges.filter((edge) => edge.relation === "references").length, 0);
  assert.deepEqual(graph.unresolved.map((item) => item.target), ["20_求職/C社/面談メモ"]);
});

test("健康度の孤点は、強型辺を1本も持たない既定ビュー節点を数える", () => {
  const notes = [
    note("20_求職/Acme/Acme_Data.md", "job-case", { case_id: "acme-data", company: "Acme株式会社" }),
    note("99_系统/散らし.md", "material", {}, "[[Acme_Data]] を普通の双链でだけ引く。"),
  ];
  const health = graphHealth(buildKnowledgeGraph(notes));
  assert.equal(health.referenceEdges, 1);
  assert.equal(health.defaultIsolates, 1, "普通双链しか持たないノートは孤点として出る");
  assert.equal(health.semanticNodes, 2, "job-case と会社実体は about_company で繋がっている");
});

test("governs フィールドで、本文リンクの無い規範ノートも接続を宣言できる", () => {
  const notes = [
    note("99_系统/信息源与证据规则.md", "policy", { governs: "[[_不採用台帳_正]]" }, "本文にリンクは無い。"),
    note("20_求職/_不採用台帳_正.md", "ledger", {}, ""),
  ];
  const graph = buildKnowledgeGraph(notes);
  const edge = graph.edges.find((item) => item.relation === "governs");
  assert.equal(edge.source, "99_系统/信息源与证据规则.md");
  assert.equal(edge.target, "20_求職/_不採用台帳_正.md");
  assert.equal(edge.sourceField, "governs");
});
