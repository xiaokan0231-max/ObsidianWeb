import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAppModule } from "./helpers/render-tsx.mjs";
import * as notes from "../lib/notes.ts";
import { noteInVaultScope } from "../lib/vault-scope.ts";

const { InterviewReassessmentEntry } = await loadAppModule("app/interview-reassessment-entry.tsx", { stubs: { "@/lib/notes": notes } });
const note = (path, frontmatter) => ({ path, name: path.split("/").at(-1), frontmatter, content: "# 测试重评", stat: { mtime: 1, ctime: 1, size: 0 } });
const sourcePath = "20_求職/株式会社テスト/2026-01-01_一次面接_整理稿.md";
const base = { type: "ai-report", report_kind: "interview-reassessment", method_version: "test-v2", generated_at: "2026-01-02" };
const index = note("20_求職/重评/总索引.md", { ...base, report_role: "index" });
const actions = note("20_求職/重评/行动.md", { ...base, report_role: "actions" });
const previous = note("20_求職/株式会社テスト/旧报告.md", { type: "review" });
const full = note("20_求職/重评/新版.md", { ...base, report_role: "session", source_path: sourcePath, assessment_scope: "full_available_text", previous_report: previous.path });

test("reassessment is available in interview scope and opens the saved notes with an exact source identity", () => {
  const opened = [];
  assert.equal(noteInVaultScope(index, "interview"), true);
  const tree = InterviewReassessmentEntry({ notes: [index, actions, previous, full], sourcePath, onOpenNote: (n) => opened.push(n.path) });
  function visit(element) {
    if (!element || typeof element !== "object") return;
    if (element.type === "button") element.props.onClick({ currentTarget: { closest: () => null } });
    for (const child of [element.props?.children].flat(Infinity)) visit(child);
  }
  visit(tree);
  assert.deepEqual(opened, [full.path, actions.path, previous.path]);
  assert.equal(InterviewReassessmentEntry({ notes: [full], sourcePath: sourcePath.replace("株式会社テスト", "株式会社サンプル"), onOpenNote() {} }), null);
});

test("limited sources show no full score, while the index remains available without a study note", () => {
  const limited = { ...full, frontmatter: { ...full.frontmatter, assessment_scope: "memory" } };
  const html = renderToStaticMarkup(createElement(InterviewReassessmentEntry, { notes: [limited], sourcePath, onOpenNote() {} }));
  assert.match(html, /现有材料不足以给整场评分/);
  assert.doesNotMatch(html, /100|优秀/);
  assert.match(renderToStaticMarkup(createElement(InterviewReassessmentEntry, { notes: [index, actions], onOpenNote() {} })), /重评总索引/);
});

test("default entry puts unresolved severe evidence and recovery before detail links, without a numeric evaluation", () => {
  const revised={...full,frontmatter:{...full.frontmatter,diagnostic_conclusion:"核心信息未交付",priority_issues:["严重 · 未恢复 · q01 s001：问过去职务，却答未来意向；原因未知。下一步：先确认时期再答真实职称。"],dimension_evaluation:["覆盖完整度：关键缺口未恢复（q01）","问题理解：未评估／证据不足"],material_coverage:"可取得全部文本",material_limits:"没有原音，原因未知"}};
  const html=renderToStaticMarkup(createElement(InterviewReassessmentEntry,{notes:[revised,previous],sourcePath,onOpenNote(){}}));
  assert.match(html,/严重 · 未恢复 · q01 s001/);
  assert.ok(html.indexOf("问过去职务，却答未来意向")<html.indexOf("查看评价依据"));
  assert.match(html,/原因未知/);
  assert.doesNotMatch(html,/95|100|优秀|兼容指数/);
});

test("default index exposes unrepaired core evidence before opening individual reports", () => {
  const critical={...full,frontmatter:{...full.frontmatter,priority_issues:["严重 · 未恢复 · q01 s001：核心时段未交付；原因未知。"]}};
  const html=renderToStaticMarkup(createElement(InterviewReassessmentEntry,{notes:[index,critical],onOpenNote(){}}));
  assert.match(html,/先看未恢复的关键问题/);
  assert.match(html,/q01 s001/);
  assert.ok(html.indexOf("核心时段未交付")<html.indexOf("重评总索引"));
  assert.doesNotMatch(html,/95|100|优秀/);
});

test("compact session controls wrap while complete legacy actions remain available in the index", async () => {
  const { readAppCss } = await import("./css-source.mjs");
  const css = await readAppCss();
  const html = renderToStaticMarkup(createElement(InterviewReassessmentEntry, { notes: [index, actions], onOpenNote() {} }));
  assert.match(html, /rv-reassessment-copy/);
  assert.match(html, /rv-reassessment-actions/);
  assert.match(css, /\.rv-assessment-links \{[^}]*flex-wrap: wrap/);
  assert.match(css, /\.rv-reading-bar \{[^}]*flex-wrap: wrap;[^}]*margin-bottom: 8px/);
});

test("session starts compact with score and recovery, retaining full detail and report actions", () => {
  const revised = { ...full, frontmatter: { ...full.frontmatter, evaluation_mode: "scored_evidence", overall_score: 60, dimension_scores: { questionUnderstanding: 85, coverage: 50, directness: 85 }, diagnostic_conclusion: "核心信息未交付", priority_issues: ["严重 · 未恢复 · q01 s001：核心时段未交付", "中等 · 已恢复 · q02 s002：补充成功"], score_basis: ["可靠正证和上限保留"], material_limits: "没有原音" } };
  const html = renderToStaticMarkup(createElement(InterviewReassessmentEntry, { notes: [revised, actions, previous], sourcePath, onOpenNote() {} }));
  const summary = html.match(/^<details[^>]*><summary>([\s\S]*?)<\/summary>/)?.[1];
  assert.ok(summary);
  assert.doesNotMatch(html.match(/^<details[^>]*>/)[0], /\sopen(?:=|\s|>)/);
  assert.match(summary, /60 \/ 100/);
  assert.match(summary, /核心时段未交付/);
  assert.doesNotMatch(summary, /q01|s001|未恢复/);
  assert.match(summary, /查看评价与建议/);
  assert.doesNotMatch(summary, /可靠正证和上限保留|没有原音/);
  assert.match(html, /中等 · 已恢复 · q02 s002/);
  assert.match(html, /可靠正证和上限保留/);
  for (const label of ["完整评价", "跨场练习建议", "查看之前的评价"]) assert.ok(html.includes(label));
  const opened = renderToStaticMarkup(createElement(InterviewReassessmentEntry, { notes: [revised], sourcePath, expanded: true }));
  assert.match(opened, /^<details[^>]* open=""/);
});

test("reader-facing summary and advice separate provenance and expose only verified original sentences", async () => {
  const { assessmentIssueCopy } = await loadAppModule("app/interview-reassessment-entry.tsx");
  const issue = "严重 · 未恢复 · q01 s001、s999：关键时期没有回答。下一步：先确认时期再说明实际职责。";
  assert.deepEqual(assessmentIssueCopy(issue), { observation: "关键时期没有回答。", action: "先确认时期再说明实际职责。", blockId: "q01", sentenceIds: ["s001", "s999"] });
  const source = { ...full, path: sourcePath, frontmatter: { type: "transcript-study" }, content: "# 整理稿\n## q01 職務の確認\n- **s001｜面**\n    - 正:: 以前の役職は？\n- **s002｜私**\n    - 正:: 開発担当です。\n" };
  const report = { ...full, frontmatter: { ...full.frontmatter, evaluation_mode: "scored_evidence", overall_score: 60, dimension_scores: { questionUnderstanding: 85, coverage: 50, directness: 85 }, priority_issues: [issue], eligibility: "full_available_text / coverage / directness", material_limits: "ASR / schema / scoringEligible", scoring_formula: "baseScore - deductions" } };
  const opened = [];
  const tree = InterviewReassessmentEntry({ notes: [source, report], sourcePath, onOpenEvidence: ref => opened.push(ref) });
  const visit = node => {
    if (!node || typeof node !== "object") return;
    if (node.type === "button" && node.props.children === "查看这段原文 →") node.props.onClick();
    for (const child of [node.props?.children].flat(Infinity)) visit(child);
  };
  visit(tree);
  assert.deepEqual(opened, [{ sourcePath, blockId: "q01", sentenceIds: ["s001"] }]);
  const html = renderToStaticMarkup(tree);
  const main = html.split('<details class="rv-assessment-evidence">')[0];
  assert.match(main, /关键时期没有回答/);
  assert.match(main, /先确认时期再说明实际职责/);
  assert.match(main, /优先改进/);
  assert.doesNotMatch(main, /full_available_text|schema|scoringEligible|baseScore|新版|未恢复|s999/);
  assert.match(html, /full_available_text/);
});
