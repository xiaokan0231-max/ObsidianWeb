import assert from "node:assert/strict";
import test from "node:test";
import { languageIndexHref, languageIndexOf, languagePointsForQuestion, parseInterviewLanguageIndex, questionLocation, validLanguageHighlights } from "../lib/interview-language.ts";
import { parseInterviewQuestionCollection } from "../lib/interview-question-collection.ts";

const source = { id: "test-source", path: "20_求職/株式会社テスト/原稿.md", date: "2026-09-01", company: "株式会社テスト", kind: "employer", transcriptType: "asr", scope: "primary", sha256: "a".repeat(64), lineCount: 100, readCoverage: "full", limitations: [] };
const question = (id, text = "簡単にご説明いただけますか。") => ({ id, sourceId: source.id, topicId: "introduction", intentId: "career-summary", intentZh: "简述经历", originalText: text, questionText: text, meaningZh: "简短说明经历。", answerScopeZh: "说明职业经历。", detailsZh: ["简短即可。"], structureZh: [], lineStart: 1, lineEnd: 1, questionKind: "request", confidence: "high", reviewStatus: "accepted", reviewReasonZh: "原问明确请求。", speakerBasisZh: "连续问答确认。", annotations: [] });
const collection = () => ({ schemaVersion: 1, collectionId: "test-questions", title: "测试问题", window: { start: "2026-07-04", end: "2026-10-04", timezone: "Asia/Tokyo" }, phase: "complete", publishedTopicIds: ["introduction"], sources: [structuredClone(source)], questions: [question("q-one")], excludedCandidates: [], auditNotes: [] });
const occurrence = () => ({ questionId: "q-one", quote: "簡単にご説明いただけますか。", highlights: [{ start: 0, end: 3, text: "簡単に", role: "qualifier", labelZh: "篇幅限制" }, { start: 3, end: 13, text: "ご説明いただけますか", role: "polite", labelZh: "礼貌请求" }], coreMeaningZh: "简短说明。", limitsZh: ["简短即可。"], explanationZh: "请求听话者说明。" });
const point = () => ({ id: "hon-request", dimension: "honorific", titleZh: "礼貌请求", patternJa: "ご説明いただけますか", meaningZh: "请对方说明。", explanationZh: ["先辨请求内容。"], pitfallsZh: ["不要只回答可以。"], occurrences: [occurrence()], practice: { promptZh: "对方请你做什么？", answerZh: "简短说明。", simpleJa: "はい、説明します。", noteZh: "教学示例，不代表本人经历。" } });
const index = () => ({ schemaVersion: 1, sourceCollectionId: "test-questions", points: [point()], auditNotes: ["使用审核通过的原问。"] });

test("旧问题集不需要语言索引；坏索引不隐藏旧问题，语言索引单独拒绝", () => {
  const data = collection();
  assert.ok(parseInterviewQuestionCollection(data));
  assert.equal(languageIndexOf(data), null);
  data.languageIndex = { bad: true };
  assert.ok(parseInterviewQuestionCollection(data));
  assert.equal(languageIndexOf(data), null);
  assert.ok(parseInterviewLanguageIndex(index(), data));
});

test("只接受已发布、审核通过的窗口内ASR原问，不接收回忆、待核和教学重写", () => {
  for (const mutate of [
    d => { d.questions[0].reviewStatus = "pending"; },
    d => { d.sources[0].scope = "nonverbatim"; d.sources[0].transcriptType = "memory"; },
    d => { d.sources[0].scope = "background"; },
    d => { d.publishedTopicIds = []; },
  ]) { const data = collection(); mutate(data); assert.equal(parseInterviewLanguageIndex(index(), data), null); }
  const invalid = index(); invalid.points[0].occurrences[0].quote = "経歴を教えてください。";
  assert.equal(parseInterviewLanguageIndex(invalid, collection()), null);
  invalid.points[0].occurrences[0].questionId = "missing";
  assert.equal(parseInterviewLanguageIndex(invalid, collection()), null);
});

test("精确UTF-16标记支持非BMP，不接受错位、重叠、无标签与替换原句", () => {
  assert.equal(validLanguageHighlights("🙂お願いします", [{ start: 2, end: 8, text: "お願いします", labelZh: "礼貌请求", role: "polite" }]), true);
  const q = occurrence(); assert.equal(validLanguageHighlights(q.quote, q.highlights), true);
  const wrong = structuredClone(q.highlights); wrong[1].text = "ご説明ください";
  assert.equal(validLanguageHighlights(q.quote, wrong), false);
  wrong[1].text = q.highlights[1].text; wrong[1].start = 2;
  assert.equal(validLanguageHighlights(q.quote, wrong), false);
  wrong[1].start = 3; wrong[1].labelZh = "";
  assert.equal(validLanguageHighlights(q.quote, wrong), false);
});

test("一道原问可关联多个知识点，每点不重复收录同一题；教学内容不计原问", () => {
  const data = index(); const grammar = point(); grammar.id = "gram-short"; grammar.dimension = "grammar"; data.points.push(grammar);
  const parsed = parseInterviewLanguageIndex(data, collection()); assert.ok(parsed);
  assert.equal(languagePointsForQuestion(parsed, "q-one").length, 2);
  data.points[0].occurrences.push(occurrence()); assert.equal(parseInterviewLanguageIndex(data, collection()), null);
});

test("语言链接清理互斥位置，合法类别保留；旧问题跨页和合并来源均能定位", () => {
  const href = languageIndexHref("?chapter=old&knowledge=one&lessonView=source&course=old&questionSearch=old&questionPage=3&questionId=q-one", "test-questions", "grammar", "gram-short");
  const params = new URL(href, "http://localhost:3000").searchParams;
  for (const key of ["chapter", "knowledge", "lessonView", "course", "questionSearch", "questionPage", "questionId"]) assert.equal(params.has(key), false);
  assert.equal(params.get("questionView"), "language"); assert.equal(params.get("languageCategory"), "grammar"); assert.equal(params.get("languagePoint"), "gram-short");
  const data = collection(); data.questions = Array.from({ length: 43 }, (_, i) => question(`q-${i}`, `経歴${i}を説明してください。`));
  assert.deepEqual(questionLocation(data, "q-42"), { topicId: "introduction", page: 3, representativeQuestionId: "q-42" });
  data.questions.push({ ...data.questions[0], id: "q-duplicate" });
  assert.deepEqual(questionLocation(data, "q-duplicate"), { topicId: "introduction", page: 1, representativeQuestionId: "q-0" });
  data.questions[0].reviewStatus = "pending"; assert.equal(questionLocation(data, "q-0"), null);
});
