#!/usr/bin/env node
// vault の job-case frontmatter を検証する。壊れた値は Web 側で静かに無視されて
// 気づけないため、ここで落とす。`npm run vault:check`

import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import {
  CHANNEL_REQUIRED_FROM,
  JOB_STATUSES,
  KNOWN_CHANNELS,
  VAULT,
  baseStatus,
  listMarkdownFiles,
  parseFrontmatter,
  parseOwns,
  readJobCases,
} from "./vault-lib.mjs";
import { JOB_CASE_ORIGINS } from "../lib/vault-boundary.mjs";
import { listEmbeds, listHeadings, sliceSection, stripFrontmatter } from "../lib/interview-prep-embed.mjs";
import { companyMotivationIssues } from "../lib/interview-prep-validation.mjs";
import {
  isLanguageExpressionCourseNote,
  parseLanguageExpressionCourse,
} from "../lib/language-expression-course.ts";

const REQUIRED = ["case_id", "company", "status", "origin"];
const PREP_REQUIRED = ["company", "round", "format", "interviewers", "case"];
const PREP_SESSION_STATUSES = ["preparing", "scheduled", "completed", "cancelled"];
const TODO_STATUSES = ["未着手", "進行中", "保留", "完了"];
const TODO_PRIORITIES = ["high", "medium", "low"];
const TODO_AUDIENCES = ["user", "system"];
const SYSTEM_TODO_CATEGORIES = ["台帳整合", "観測基盤"];
const WAITING_FOR = ["self", "company", "agent", "platform"];

const problems = [];
const notes = await readJobCases();
const caseIds = new Map();

for (const note of notes) {
  const fm = note.frontmatter;
  const at = (message) => problems.push(`${note.name}: ${message}`);

  for (const key of REQUIRED) {
    if (!fm[key]) at(`frontmatter に \`${key}\` が無い`);
  }

  if (fm.case_id) {
    const files = caseIds.get(fm.case_id) ?? [];
    files.push(note.name);
    caseIds.set(fm.case_id, files);
  }
  if (fm.origin && !JOB_CASE_ORIGINS.includes(String(fm.origin))) {
    at(`origin "${fm.origin}" は未知。既知は ${JOB_CASE_ORIGINS.join(" / ")}`);
  }

  const status = String(fm.status ?? "");
  const base = baseStatus(status);
  if (status && !base) {
    at(`status "${status}" は列挙に無い。使えるのは ${JOB_STATUSES.join(" / ")}（後ろに（補足）は可）`);
  }

  if (base && CHANNEL_REQUIRED_FROM.includes(base)) {
    if (!fm.channel) at(`status が「${base}」なら \`channel\` が要る（${KNOWN_CHANNELS.join(" / ")}）`);
    else if (!KNOWN_CHANNELS.includes(String(fm.channel)))
      at(`channel "${fm.channel}" は未知。既知は ${KNOWN_CHANNELS.join(" / ")}`);
  }

  // 「保留」は日付の定まらない状態なので必須にしない（無い日付を作らせないため）。
  if (base && CHANNEL_REQUIRED_FROM.includes(base) && !fm.status_updated) {
    at(`status が「${base}」なら \`status_updated\` が要る（YYYY-MM-DD）`);
  }
  if (fm.status_updated && !/^\d{4}-\d{2}-\d{2}$/.test(String(fm.status_updated))) {
    at(`status_updated "${fm.status_updated}" が YYYY-MM-DD ではない`);
  }
  if (fm.waiting_for && !WAITING_FOR.includes(String(fm.waiting_for))) {
    at(`waiting_for "${fm.waiting_for}" は ${WAITING_FOR.join(" / ")} のいずれか`);
  }
  if (fm.follow_up_at && !fm.waiting_for) {
    at("follow_up_at があるなら waiting_for も必要");
  }
  if (fm.follow_up_at && !validCalendarDate(String(fm.follow_up_at))) {
    at(`follow_up_at "${fm.follow_up_at}" が実在する YYYY-MM-DD ではない`);
  }
  if (fm.next_event_at && !validCalendarDateTime(String(fm.next_event_at))) {
    at(`next_event_at "${fm.next_event_at}" は YYYY-MM-DD または YYYY-MM-DD HH:MM ではない`);
  }

  const rating = Number(fm.rating);
  if (fm.rating !== undefined && (!Number.isFinite(rating) || rating < 0 || rating > 10)) {
    at(`rating "${fm.rating}" が 0〜10 の数値ではない`);
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
  const name = path.split("/").pop().replace(/\.md$/i, "");
  if (bodyByName.has(name)) duplicateNames.add(name);
  else {
    bodyByName.set(name, stripFrontmatter(content));
    frontmatterByName.set(name, parseFrontmatter(content));
  }
}

for (const path of files) {
  const content = contents.get(path);
  const frontmatter = parseFrontmatter(content);
  const relativePath = relative(VAULT, path);
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

if (problems.length) {
  console.error(`\n❌ ${problems.length} 件の問題:\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error("");
  process.exit(1);
}

console.log("✅ 問題なし");
