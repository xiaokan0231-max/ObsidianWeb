#!/usr/bin/env node
// vault の job-case frontmatter を検証する。壊れた値は Web 側で静かに無視されて
// 気づけないため、ここで落とす。`npm run vault:check`

import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import {
  VAULT,
  findFrontmatterDefects,
  listMarkdownFiles,
  listVaultFileKeys,
  parseFrontmatter,
  parseOwns,
  readJobCases,
  vaultRefKey,
} from "./vault-lib.mjs";
import {
  auditJobCaseCompleteness,
  validateJobCaseFrontmatter,
} from "../lib/job-case-schema.ts";
import { listEmbeds, listHeadings, sliceSection, stripFrontmatter } from "../lib/interview-prep-embed.mjs";
import { companyMotivationIssues } from "../lib/interview-prep-validation.mjs";
import {
  isLanguageExpressionCourseNote,
  parseLanguageExpressionCourse,
} from "../lib/language-expression-course.ts";
import {
  buildGraphNoteIndex,
  buildKnowledgeGraph,
  parseConfirmedSkillTable,
} from "../lib/knowledge-graph.ts";
import { GENERATED_LIFECYCLES, markerJson } from "../lib/vault-compact.mjs";

const PREP_REQUIRED = ["company", "round", "format", "interviewers", "case"];
const PREP_SESSION_STATUSES = ["preparing", "scheduled", "completed", "cancelled"];
const TODO_STATUSES = ["未着手", "進行中", "保留", "完了"];
const TODO_PRIORITIES = ["high", "medium", "low"];
const TODO_AUDIENCES = ["user", "system"];
const SYSTEM_TODO_CATEGORIES = ["台帳整合", "観測基盤"];
const VERSIONED_ARTIFACT_TYPES = new Set(["language-bank", "language-curriculum"]);
// ai-review も分析層。fingerprint・ai_author の規約は ai-report と同じものを課す。
const ANALYSIS_TYPES = new Set(["ai-report", "analysis", "ai-review"]);
const REVIEW_VERDICTS = new Set(["agree", "partially_agree", "disagree", "needs_evidence"]);
const AI_AUTHOR_REQUIRED_FROM = "2026-08-03";
const GENERIC_AI_AUTHORS = new Set(["ai", "人工智能", "unknown", "不明", "未记录"]);
const CURRICULUM_START = "<!-- language-curriculum-json:start -->";
const CURRICULUM_END = "<!-- language-curriculum-json:end -->";
const BATCH_START = "<!-- language-batch-json:start -->";
const BATCH_END = "<!-- language-batch-json:end -->";

const problems = [];
// 警告は exit code を変えない。「直すべきだが、止めると他が全部止まる」もの専用。
const warnings = [];
const notes = await readJobCases();
const caseIds = new Map();

const today = new Date().toLocaleDateString("sv-SE");

for (const note of notes) {
  const fm = note.frontmatter;

  // 形の検査は lib/job-case-schema.ts が唯一の正本。ここで条件を書き足さないこと
  // ——書き足した瞬間に「書く側の規約」と「読む側の規約」がまた分裂する。
  for (const problem of validateJobCaseFrontmatter(fm)) {
    problems.push(`${note.name}: ${problem}`);
  }
  // 中身の未完了は**止めない**。既存の未採点ノートで Stop hook が固まると、
  // 他の作業まで巻き添えで止まる。見えるようにするのが目的。
  for (const warning of auditJobCaseCompleteness(fm, note.content, { today })) {
    warnings.push(`${note.name}: ${warning}`);
  }

  if (fm.case_id) {
    const files = caseIds.get(fm.case_id) ?? [];
    files.push(note.name);
    caseIds.set(fm.case_id, files);
  }
}

for (const [caseId, files] of caseIds) {
  if (files.length > 1) problems.push(`case_id「${caseId}」が重複: ${files.join(" と ")}`);
}

// 規則IDの正本は1ファイルだけ（vault AGENTS.md「同じ規範を2箇所に書かない」）。
// 2つの正本が同じIDを持つと「どちらが現行か」が壊れたまま残り続けるので、ここで落とす。
const ownersById = new Map();
// 埋め込みの解決に使うため、ノート名 → 本文 を先に集める。
// basename が重複していると Obsidian 側も参照が曖昧になるので、その事実も持っておく。
const bodyByName = new Map();
const frontmatterByName = new Map();
const duplicateNames = new Set();
let prepCount = 0;
let prepEmbedCount = 0;
let languageExpressionCourseCount = 0;
const languageExpressionCoursePathsById = new Map();
const files = await listMarkdownFiles();
const contents = new Map();
const prepSessionIds = new Map();
const prepCaseOrders = new Map();
const focusedTodos = [];

function wikiTarget(value) {
  const raw = String(value ?? "").trim().replace(/^["']|["']$/g, "");
  const inner = raw.match(/^\[\[([^\]]+)\]\]$/)?.[1] ?? raw;
  return inner.split("|")[0].split("#")[0].trim();
}

function validCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validCalendarDateTime(value) {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})(?: ([01]\d|2[0-3]):([0-5]\d))?$/);
  return Boolean(match && validCalendarDate(match[1]));
}

for (const path of files) {
  const content = await readFile(path, "utf8");
  contents.set(path, content);
  // 🔴 型や必須項目より先に「Obsidian がこの frontmatter を読めるか」を見る。
  // ここが壊れると type ごと消えるので、以降の検査は全部素通りしてしまう
  // （2026-08-04：salary 重複で job-case が1件、静かに Web から消えていた）。
  for (const defect of findFrontmatterDefects(content)) {
    problems.push(`${relative(VAULT, path)}: ${defect}`);
  }
  const name = path.split("/").pop().replace(/\.md$/i, "");
  if (bodyByName.has(name)) duplicateNames.add(name);
  else {
    bodyByName.set(name, stripFrontmatter(content));
    frontmatterByName.set(name, parseFrontmatter(content));
  }
}

const graphNotes = files.map((path) => {
  const content = contents.get(path);
  return {
    path: relative(VAULT, path),
    stat: { ctime: 0, mtime: 0, size: content.length },
    tags: [],
    frontmatter: parseFrontmatter(content),
    content,
  };
});
const graphIndex = buildGraphNoteIndex(graphNotes);
const knowledgeGraph = buildKnowledgeGraph(graphNotes);
// 同名ノートが2つあること自体は Obsidian では合法（パスで消歧できる）。
// 実際に曖昧なリンクが飛んで初めて問題なので、collisions は単独では報告しない。
const vaultFileKeys = await listVaultFileKeys();
for (const unresolved of knowledgeGraph.unresolved) {
  const key = vaultRefKey(unresolved.target);
  const field = unresolved.sourceField ? ` (${unresolved.sourceField})` : "";
  // 曖昧判定を実体判定より先に置く。同名が2つある時はどちらも実在するので、
  // 先に実体で通すと「どっちを指しているか決められない」参照が黙って素通りする。
  if (graphIndex.collisions.has(key)) {
    problems.push(
      `${unresolved.sourcePath}: ${unresolved.relation}${field} の [[${unresolved.target}]] は同名ノートが複数あって決められない。パスまで書く`,
    );
    continue;
  }
  if (vaultFileKeys.has(key)) continue;
  problems.push(
    `${unresolved.sourcePath}: ${unresolved.relation}${field} の参照先が無い [[${unresolved.target}]]`,
  );
}

const currentArtifacts = new Map();
const versionedArtifactCounts = new Map();
const curriculumFingerprints = new Set();
const activeBatchReferences = [];
const skillIds = new Map();

for (const path of files) {
  const content = contents.get(path);
  const frontmatter = parseFrontmatter(content);
  const relativePath = relative(VAULT, path);
  const type = String(frontmatter.type ?? "");
  if (VERSIONED_ARTIFACT_TYPES.has(type)) {
    versionedArtifactCounts.set(type, (versionedArtifactCounts.get(type) ?? 0) + 1);
    const lifecycle = String(frontmatter.lifecycle ?? "");
    if (!GENERATED_LIFECYCLES.includes(lifecycle)) {
      problems.push(`${relativePath}: ${type} lifecycle は ${GENERATED_LIFECYCLES.join(" / ")} のいずれかが必須`);
    }
    if (String(frontmatter.schema_version ?? "") !== "2") {
      problems.push(`${relativePath}: ${type} schema_version は 2 が必須`);
    }
    if (!frontmatter.source_fingerprint || !frontmatter.content_fingerprint) {
      problems.push(`${relativePath}: ${type} には source_fingerprint / content_fingerprint が必須`);
    }
    if (lifecycle === "current") {
      const currentPaths = currentArtifacts.get(type) ?? [];
      currentPaths.push(relativePath);
      currentArtifacts.set(type, currentPaths);
    }
    if (type === "language-curriculum") {
      // draft batch 保存的是实际课程内容版本，不能用输入源 fingerprint 代替。
      if (frontmatter.content_fingerprint) curriculumFingerprints.add(String(frontmatter.content_fingerprint));
      const curriculum = markerJson(content, CURRICULUM_START, CURRICULUM_END);
      if (!curriculum) problems.push(`${relativePath}: language-curriculum JSON 区块が読めない`);
    }
  }
  if (ANALYSIS_TYPES.has(type)) {
    const lifecycle = String(frontmatter.lifecycle ?? "");
    if (!GENERATED_LIFECYCLES.includes(lifecycle)) {
      problems.push(`${relativePath}: ${type} lifecycle は ${GENERATED_LIFECYCLES.join(" / ")} のいずれかが必須`);
    }
    if (String(frontmatter.schema_version ?? "") !== "2") {
      problems.push(`${relativePath}: ${type} schema_version は 2 が必須`);
    }
    if (!frontmatter.source_fingerprint || !frontmatter.content_fingerprint) {
      problems.push(`${relativePath}: ${type} には source_fingerprint / content_fingerprint が必須`);
    }
    const reportDate = String(frontmatter.date ?? "").slice(0, 10);
    const aiAuthor = String(frontmatter.ai_author ?? "").trim();
    if (reportDate >= AI_AUTHOR_REQUIRED_FROM && !aiAuthor) {
      problems.push(`${relativePath}: ${AI_AUTHOR_REQUIRED_FROM} 以降の ${type} には ai_author が必須`);
    }
    if (aiAuthor && GENERIC_AI_AUTHORS.has(aiAuthor.toLocaleLowerCase("ja"))) {
      problems.push(`${relativePath}: ai_author は「AI」ではなく Codex / Claude 等の具体名にする`);
    }
  }
  if (type === "ai-review") {
    // 相互レビューは「誰が誰の何を評価したか」が辿れないと、後から根拠として使えない。
    const target = String(frontmatter.reviews ?? "").trim();
    if (!/\[\[[^\]]+\]\]/u.test(target)) {
      problems.push(`${relativePath}: ai-review には reviews: "[[対象ノート]]" が必須（リンク切れは図の unresolved で検出）`);
    }
    const reviewed = String(frontmatter.reviewed_author ?? "").trim();
    if (!reviewed) problems.push(`${relativePath}: ai-review には reviewed_author（原文の書き手）が必須`);
    const verdict = String(frontmatter.verdict ?? "").trim();
    if (!REVIEW_VERDICTS.has(verdict)) {
      problems.push(`${relativePath}: ai-review の verdict は ${[...REVIEW_VERDICTS].join(" / ")} のいずれか`);
    }
    const author = String(frontmatter.ai_author ?? "").trim();
    if (author && reviewed && author === reviewed) {
      problems.push(`${relativePath}: ai-review の ai_author と reviewed_author が同一。自己レビューは相互検証にならない`);
    }
  }
  if (type === "language-batch-log") {
    const batch = markerJson(content, BATCH_START, BATCH_END);
    if (!batch) problems.push(`${relativePath}: language-batch JSON 区块が読めない`);
    else if (batch.phase !== "completed" && frontmatter.status !== "completed") {
      activeBatchReferences.push({ relativePath, fingerprint: String(batch.curriculumFingerprint ?? "") });
    }
  }
  if (relativePath === "10_关于我/技術スタック.md") {
    const confirmedSkills = parseConfirmedSkillTable(content);
    if (confirmedSkills.length === 0) {
      problems.push(`${relativePath}: 経験年数の確定表に skill_id 列が無い、または解析できない`);
    }
    for (const skill of confirmedSkills) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(skill.id)) {
        problems.push(`${relativePath}: skill_id「${skill.id}」は小文字英数字とハイフンだけにする`);
      }
      const labels = skillIds.get(skill.id) ?? [];
      labels.push(skill.label);
      skillIds.set(skill.id, labels);
    }
  }
  if (frontmatter.type === "company" && frontmatter.status) {
    problems.push(`${relativePath}: company は応募 status を持てない。対応する job-case へ移す`);
  }
  if (frontmatter.type === "policy" && frontmatter.lifecycle !== "current") {
    problems.push(`${relativePath}: 現行 policy には lifecycle: current が要る`);
  }
  if (frontmatter.type === "policy-change" && frontmatter.owns) {
    problems.push(`${relativePath}: policy-change は規則IDを owns できない`);
  }
  if (frontmatter.type === "todo") {
    const status = String(frontmatter.status ?? "");
    const priority = String(frontmatter.priority ?? "");
    const audience = String(frontmatter.audience ?? "user");
    const category = String(frontmatter.category ?? "");
    if (!TODO_STATUSES.includes(status)) {
      problems.push(`${relativePath}: todo status "${status}" は ${TODO_STATUSES.join(" / ")} のいずれか`);
    }
    if (!TODO_PRIORITIES.includes(priority)) {
      problems.push(`${relativePath}: todo priority "${priority}" は ${TODO_PRIORITIES.join(" / ")} のいずれか`);
    }
    if (!TODO_AUDIENCES.includes(audience)) {
      problems.push(`${relativePath}: todo audience "${audience}" は ${TODO_AUDIENCES.join(" / ")} のいずれか`);
    }
    if (SYSTEM_TODO_CATEGORIES.includes(category) && audience !== "system") {
      problems.push(`${relativePath}: category "${category}" は audience: system が必要`);
    }
    if (frontmatter.due && !validCalendarDate(String(frontmatter.due))) {
      problems.push(`${relativePath}: due "${frontmatter.due}" が実在する YYYY-MM-DD ではない`);
    }
    // expires_at（失効日）は Web 側が「過ぎたら収尾へ」判定に使う。書式が壊れていると
    // 静かに無効になり、失効したはずの待办が首页を占領し続ける——normalizeJobStatus の
    // 静默失効と同型の坑なので、ここで赤くする。
    if (frontmatter.expires_at) {
      if (!validCalendarDate(String(frontmatter.expires_at))) {
        problems.push(`${relativePath}: expires_at "${frontmatter.expires_at}" が実在する YYYY-MM-DD ではない`);
      } else if (
        frontmatter.due &&
        validCalendarDate(String(frontmatter.due)) &&
        String(frontmatter.expires_at) < String(frontmatter.due)
      ) {
        problems.push(
          `${relativePath}: expires_at (${frontmatter.expires_at}) が due (${frontmatter.due}) より前。` +
            `失効日は期限より後（イベント当日）のはずで、逆なら書き間違い`,
        );
      }
    }
    if (frontmatter.next_event_at && !validCalendarDateTime(String(frontmatter.next_event_at))) {
      problems.push(`${relativePath}: next_event_at "${frontmatter.next_event_at}" は YYYY-MM-DD または YYYY-MM-DD HH:MM ではない`);
    }
    if (frontmatter.case_id && !caseIds.has(String(frontmatter.case_id))) {
      problems.push(`${relativePath}: case_id「${frontmatter.case_id}」に対応する job-case が無い`);
    }

    const action = String(frontmatter.action ?? "").trim();
    if (action && (/[*_`[\]]/.test(action) || action.length > 88)) {
      problems.push(`${relativePath}: action は Markdown を含まない88文字以内の表示用短文にする`);
    }
    if (audience === "system" && !action) {
      problems.push(`${relativePath}: audience: system には内部用語を見出しから漏らさない action が必要`);
    }
    if (frontmatter.blocks_next_stage && !frontmatter.case_id) {
      problems.push(`${relativePath}: blocks_next_stage には case_id が必要`);
    }
    const focused = frontmatter.focus === true || frontmatter.focus === "true";
    if (audience === "system" && focused) {
      problems.push(`${relativePath}: audience: system は首頁重点にできないため focus を付けられない`);
    }
    if (focused) {
      focusedTodos.push(relativePath);
      if (!action) problems.push(`${relativePath}: focus: true には action が必要`);
      if (!validCalendarDate(String(frontmatter.focus_until ?? ""))) {
        problems.push(`${relativePath}: focus: true には実在する YYYY-MM-DD の focus_until が必要`);
      }
      if (!["未着手", "進行中"].includes(status)) {
        problems.push(`${relativePath}: focus: true の todo は未着手または進行中でなければならない`);
      }
    } else if (frontmatter.focus_until) {
      problems.push(`${relativePath}: focus_until があるなら focus: true が必要`);
    }
  }

  const courseNote = {
    path: relativePath,
    frontmatter,
    content: stripFrontmatter(content),
  };
  if (isLanguageExpressionCourseNote(courseNote)) {
    languageExpressionCourseCount += 1;
    const courseId = String(frontmatter.course_id ?? "").trim();
    if (courseId) {
      const coursePaths = languageExpressionCoursePathsById.get(courseId) ?? [];
      coursePaths.push(relativePath);
      languageExpressionCoursePathsById.set(courseId, coursePaths);
    }
    try {
      parseLanguageExpressionCourse(courseNote);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const line of message.split("\n")) {
        problems.push(line.startsWith(`${relativePath}:`) ? line : `${relativePath}: ${line}`);
      }
    }
  }

  // 面接準備ノートは共通資産を ![[…]] で参照する形にしているので、参照が切れると
  // Web と当日用 HTML から章がまるごと消える。しかも「空の章」は目視で気づきにくい。
  if (frontmatter.type === "interview-prep") {
    prepCount += 1;
    for (const key of PREP_REQUIRED) {
      if (!frontmatter[key]) problems.push(`${relativePath}: frontmatter に \`${key}\` が無い`);
    }
    const hasSessionContract =
      Boolean(frontmatter.session_id) ||
      frontmatter.session_order !== undefined ||
      Boolean(frontmatter.session_status);
    const sessionStatus = String(frontmatter.session_status ?? "");
    const sessionOrder = Number(frontmatter.session_order);
    const date = String(frontmatter.date ?? "");

    if (!hasSessionContract) {
      // 既存の date 命名ノートはそのまま読める。新規ノートだけ安定 session 契約へ移行する。
      if (!date) problems.push(`${relativePath}: legacy prep の frontmatter に \`date\` が無い`);
      else if (!validCalendarDate(date)) {
        problems.push(`${relativePath}: date "${date}" が実在する YYYY-MM-DD ではない`);
      }
    } else {
      for (const key of ["session_id", "session_order", "session_status"]) {
        if (!frontmatter[key]) problems.push(`${relativePath}: session prep の frontmatter に \`${key}\` が無い`);
      }
      if (frontmatter.session_id && /[\s/[\]]/.test(String(frontmatter.session_id))) {
        problems.push(`${relativePath}: session_id は空白・/・角括弧を含めない`);
      }
      if (!Number.isInteger(sessionOrder) || sessionOrder < 1) {
        problems.push(`${relativePath}: session_order "${frontmatter.session_order}" は1以上の整数ではない`);
      }
      if (!PREP_SESSION_STATUSES.includes(sessionStatus)) {
        problems.push(
          `${relativePath}: session_status "${sessionStatus}" は ${PREP_SESSION_STATUSES.join(" / ")} のいずれか`,
        );
      }
      if (sessionStatus === "preparing") {
        if (date && date !== "未定" && !validCalendarDate(date)) {
          problems.push(`${relativePath}: preparing の date は YYYY-MM-DD／未定／省略のいずれか`);
        }
      } else if (sessionStatus === "scheduled" || sessionStatus === "completed") {
        if (!validCalendarDate(date)) {
          problems.push(`${relativePath}: ${sessionStatus} の date は実在する YYYY-MM-DD が必須`);
        }
      } else if (date && date !== "未定" && !validCalendarDate(date)) {
        problems.push(`${relativePath}: date "${date}" が実在する YYYY-MM-DD ではない`);
      }

      if (frontmatter.session_id) {
        const sessionPaths = prepSessionIds.get(String(frontmatter.session_id)) ?? [];
        sessionPaths.push(relativePath);
        prepSessionIds.set(String(frontmatter.session_id), sessionPaths);
      }
      if (frontmatter.case && Number.isInteger(sessionOrder) && sessionOrder >= 1) {
        const key = `${wikiTarget(frontmatter.case)}::${sessionOrder}`;
        const sessionPaths = prepCaseOrders.get(key) ?? [];
        sessionPaths.push(relativePath);
        prepCaseOrders.set(key, sessionPaths);
      }

      if (sessionOrder > 1) {
        if (!frontmatter.previous_prep) {
          problems.push(`${relativePath}: session_order > 1 には previous_prep が必須`);
        } else {
          const previousTarget = wikiTarget(frontmatter.previous_prep);
          const previousFrontmatter = frontmatterByName.get(previousTarget);
          if (!previousFrontmatter) {
            problems.push(`${relativePath}: previous_prep の参照先が無い [[${previousTarget}]]`);
          } else if (previousFrontmatter.type !== "interview-prep") {
            problems.push(`${relativePath}: previous_prep [[${previousTarget}]] は type: interview-prep ではない`);
          } else if (
            wikiTarget(previousFrontmatter.case) !== wikiTarget(frontmatter.case)
          ) {
            problems.push(`${relativePath}: previous_prep は同じ case の準備ノートではない`);
          } else {
            const previousOrder = Number(previousFrontmatter.session_order);
            if (
              Number.isInteger(previousOrder) &&
              previousOrder !== sessionOrder - 1
            ) {
              problems.push(
                `${relativePath}: previous_prep の session_order は ${sessionOrder - 1} ではない`,
              );
            }
          }
        }
        const evidenceInputs = Array.isArray(frontmatter.evidence_inputs)
          ? frontmatter.evidence_inputs
          : [];
        if (evidenceInputs.length === 0) {
          problems.push(`${relativePath}: session_order > 1 には evidence_inputs が1件以上必要`);
        }
        for (const evidence of evidenceInputs) {
          const target = wikiTarget(evidence);
          if (!frontmatterByName.has(target)) {
            problems.push(`${relativePath}: evidence_inputs の参照先が無い [[${target}]]`);
          } else if (duplicateNames.has(target)) {
            problems.push(`${relativePath}: evidence_inputs「${target}」が同名複数あり曖昧`);
          }
        }
        if (!/^###\s+前回から今回への回流\s*$/m.test(content)) {
          problems.push(`${relativePath}: §2 に「### 前回から今回への回流」が無い`);
        }
      }
    }
    for (const issue of companyMotivationIssues(content)) {
      problems.push(`${relativePath}: ${issue}`);
    }
    if (/{{[^}]+}}/.test(content)) {
      problems.push(`${relativePath}: テンプレートの {{…}} が残っている`);
    }
    if (frontmatter.case) {
      const caseTarget = wikiTarget(frontmatter.case);
      const targetFrontmatter = frontmatterByName.get(caseTarget);
      if (!targetFrontmatter) {
        problems.push(`${relativePath}: case の参照先が無い [[${caseTarget}]]`);
      } else if (duplicateNames.has(caseTarget)) {
        problems.push(`${relativePath}: case の参照先「${caseTarget}」が同名複数あり曖昧`);
      } else if (targetFrontmatter.type !== "job-case") {
        problems.push(`${relativePath}: case [[${caseTarget}]] は type: job-case ではない`);
      }
    }
    for (const embed of listEmbeds(content)) {
      prepEmbedCount += 1;
      const target = bodyByName.get(embed.target);
      if (!target) {
        problems.push(`${relativePath}: 埋め込み先が無い ${embed.raw}`);
        continue;
      }
      if (duplicateNames.has(embed.target)) {
        problems.push(`${relativePath}: 埋め込み先「${embed.target}」が同名複数あり参照が曖昧 ${embed.raw}`);
      }
      if (embed.section && !sliceSection(target, embed.section)) {
        const available = listHeadings(target).slice(0, 8).join(" / ");
        problems.push(
          `${relativePath}: 埋め込み先に「${embed.section}」の節が無い ${embed.raw}` +
            (available ? `（その ノート の見出し: ${available}）` : ""),
        );
      }
    }
  }
  for (const id of parseOwns(frontmatter.owns)) {
    const files = ownersById.get(id) ?? [];
    files.push(relativePath);
    ownersById.set(id, files);
  }
}
for (const [id, files] of ownersById) {
  if (files.length > 1) {
    problems.push(`規則ID「${id}」を複数の正本が持っている: ${files.join(" と ")}`);
  }
}
for (const [courseId, coursePaths] of languageExpressionCoursePathsById) {
  if (coursePaths.length > 1) {
    problems.push(`表現専門コース course_id「${courseId}」が重複: ${coursePaths.join(" と ")}`);
  }
}
for (const type of VERSIONED_ARTIFACT_TYPES) {
  const paths = currentArtifacts.get(type) ?? [];
  if ((versionedArtifactCounts.get(type) ?? 0) > 0 && paths.length !== 1) {
    problems.push(`${type} の lifecycle: current は全庫で1件必須（現在 ${paths.length}件: ${paths.join(" / ") || "なし"}）`);
  }
}
for (const reference of activeBatchReferences) {
  if (!reference.fingerprint) {
    problems.push(`${reference.relativePath}: 未完了 batch に curriculumFingerprint が無い`);
  } else if (!curriculumFingerprints.has(reference.fingerprint)) {
    problems.push(
      `${reference.relativePath}: 未完了 batch が参照する curriculum ${reference.fingerprint} が operational 区に無い`,
    );
  }
}
for (const [skillId, labels] of skillIds) {
  if (labels.length > 1) {
    problems.push(`技術スタックの skill_id「${skillId}」が重複: ${labels.join(" / ")}`);
  }
}
for (const [sessionId, sessionPaths] of prepSessionIds) {
  if (sessionPaths.length > 1) {
    problems.push(`面接準備 session_id「${sessionId}」が重複: ${sessionPaths.join(" と ")}`);
  }
}
for (const [caseOrder, sessionPaths] of prepCaseOrders) {
  if (sessionPaths.length > 1) {
    problems.push(`同じ case と session_order「${caseOrder}」が重複: ${sessionPaths.join(" と ")}`);
  }
}
if (focusedTodos.length > 1) {
  problems.push(`focus: true の todo が複数ある: ${focusedTodos.join(" と ")}`);
}

console.log(
  `job-case ノート ${notes.length} 件・owns 規則ID ${ownersById.size} 件・` +
    `面接準備ノート ${prepCount} 件（埋め込み ${prepEmbedCount} 件）・` +
    `表現専門コース ${languageExpressionCourseCount} 件を検査`,
);

if (warnings.length) {
  console.warn(`\n⚠️  ${warnings.length} 件の未完了（止めない・順次直す）:\n`);
  for (const warning of warnings) console.warn(`  - ${warning}`);
  console.warn("");
}

if (problems.length) {
  console.error(`❌ ${problems.length} 件の問題:\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error("");
  process.exit(1);
}

// 成功メッセージは「止めるべき問題があるか」だけを表す。警告で文言を変えると、
// これを契約にしている呼び出し側（テスト・hook）が壊れる。
console.log("✅ 問題なし");
if (warnings.length) console.log(`（未完了 ${warnings.length} 件は上に出ている）`);
