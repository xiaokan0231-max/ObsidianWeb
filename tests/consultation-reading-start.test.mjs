import assert from "node:assert/strict";
import test from "node:test";
import { buildConsultationCatalog, findConsultationTranscript } from "../lib/consultation-library.ts";
import { selectConsultationReadingGroups } from "../lib/consultation-reading-start.ts";

const root = "20_求職/株式会社テスト";
const note = (name, frontmatter, content = "") => ({ path: `${root}/${name}.md`, frontmatter, content, tags: [], stat: { ctime: 0, mtime: 0, size: content.length } });
const job = (id, position) => note(id, { type: "job-case", company: "株式会社テスト", case_id: id, status: "面接中", position });
const body = "## q01 INTERNAL-SUMMARY\n- **s001｜面**\n    - 正:: これまで担当された業務を教えてください。\n    - 訳:: INTERNAL-TRANSLATION\n    - 注:: INTERNAL-ANNOTATION\n- **s002｜私**\n    - 正:: 開発を担当しました。\n    - 誤:: INTERNAL-AI-EVALUATION";
const study = (name, extra = {}, content = body) => note(`${name}_整理稿`, { type: "transcript-study", company: "株式会社テスト", date: "2026-10-01", round: "一次面接", ...extra }, content);
const raw = (name, extra = {}) => note(name, { type: "transcript", company: "株式会社テスト", date: "2026-10-01", round: "一次面接", ...extra }, "原始転写の内容です。");

test("阅读起点的岗位只取同场明确所属案件，不借用同公司其他岗位", () => {
  const catalog = buildConsultationCatalog([
    job("role-a", "設計エンジニア"), job("role-b", "品質エンジニア"),
    study("linked", { case_id: "role-b" }), study("unlinked", { date: "2026-10-02" }),
  ]);
  assert.equal(catalog.sessions.find(session => session.date === "2026-10-01").position, "品質エンジニア");
  assert.equal(catalog.sessions.find(session => session.date === "2026-10-02").position, undefined);
  assert.ok(catalog.sessions.every(session => session.readingGuide.featured === false));
});

test("重点和介绍来自明确 frontmatter，整理稿优先且空值可清除原稿设置", () => {
  const source = raw("linked", { teacher_featured: true, teacher_example: true, teacher_intro_ja: "元の紹介です。", teacher_request_ja: "質問の伝え方をご覧ください。" });
  const readable = study("linked", { source_note: "[[linked]]", teacher_featured: false, teacher_example: false, teacher_intro_ja: "整理稿の紹介です。" });
  let guide = buildConsultationCatalog([source, readable]).sessions[0].readingGuide;
  assert.equal(guide.featured, false);
  assert.equal(guide.example, false);
  assert.equal(guide.introduction, "整理稿の紹介です。");
  assert.equal(guide.request, "質問の伝え方をご覧ください。");
  readable.frontmatter.teacher_intro_ja = "";
  readable.frontmatter.teacher_request_ja = "";
  readable.frontmatter.teacher_featured = "true";
  guide = buildConsultationCatalog([source, readable]).sessions[0].readingGuide;
  assert.equal(guide.introduction, undefined);
  assert.equal(guide.request, undefined);
  assert.equal(guide.featured, false);
  delete readable.frontmatter.teacher_featured;
  delete readable.frontmatter.teacher_example;
  assert.equal(buildConsultationCatalog([source, readable]).sessions[0].readingGuide.featured, true);
  assert.equal(buildConsultationCatalog([source, readable]).sessions[0].readingGuide.example, true);
});

test("老师介绍限制长度并隐藏联系方式和内部资料地址", () => {
  const item = study("metadata", {
    teacher_featured: true,
    teacher_intro_ja: "ご確認ください。 test@example.com /Users/sample/private.md [[20_求職/内部資料]] C:\\private\\file.md https://example.invalid/secret",
    teacher_request_ja: "あ".repeat(900),
  });
  const guide = buildConsultationCatalog([item]).sessions[0].readingGuide;
  assert.equal(guide.featured, true);
  assert.doesNotMatch(guide.introduction, /test@example|\/Users|20_求職|C:\\|https:\/\//);
  assert.equal([...guide.request].length, 500);
  assert.equal([...buildConsultationCatalog([study("long", { teacher_intro_ja: "あ".repeat(900) })]).sessions[0].readingGuide.introduction].length, 300);
});

test("原问句预览只选明确面试官的问题，跳过开场确认和未知话者", () => {
  const content = [
    "## q01 PRIVATE-HEADER",
    "- **s001｜面**\n    - 正:: 録画と文字起こしを利用してもよろしいでしょうか。",
    "- **s002｜面**\n    - 正:: こちらの画面は見えていますか。",
    "- **s003｜私**\n    - 正:: 入社後に担当する業務を教えてください。",
    "- **s004｜面?**\n    - 正:: どのような働き方を希望しますか。",
    "## q02 INTERNAL-SUMMARY",
    "- **s005｜面**\n    - 正:: これまで担当された業務を教えてください。\n    - 訳:: PRIVATE-TRANSLATION\n    - 注:: PRIVATE-ANNOTATION",
    "- **s006｜私**\n    - 正:: 開発を担当しました。",
    "## q03 INTERNAL-SUMMARY",
    "- **s007｜面**\n    - 正:: 弊社に応募された理由をお聞かせいただけますか。",
    "- **s008｜面**\n    - 正:: 最近の業務で工夫した点を教えてください。",
  ].join("\n");
  const notes = [study("questions", {}, content)];
  const session = buildConsultationCatalog(notes).sessions[0];
  assert.deepEqual(session.readingGuide.excerpts, [
    { blockId: "q02", text: "これまで担当された業務を教えてください。" },
    { blockId: "q03", text: "弊社に応募された理由をお聞かせいただけますか。" },
  ]);
  assert.equal(session.readingGuide.blockCount, 3);
  const detail = findConsultationTranscript(notes, session.id);
  for (const excerpt of session.readingGuide.excerpts) {
    assert.ok(detail.blocks.find(block => block.id === excerpt.blockId).turns.some(turn => turn.speaker === "interviewer" && turn.text === excerpt.text));
  }
  assert.doesNotMatch(JSON.stringify(session), /PRIVATE-|INTERNAL-/);
});

test("原问句预览与详情共用最终话者裁定，不能保留已判为本人发言的问题", () => {
  const content = "## q01 内部摘要\n- **s001｜面?**\n    - 正:: これまで担当された業務を教えてください。";
  const item = study("speaker", {}, content);
  const annotation = note("speaker_批注", { type: "study-annotation", company: "株式会社テスト", date: "2026-10-01" }, "- **a001｜s001｜裁定｜answered｜2026-10-02**\n    - 対象:: speaker\n    - 我:: 面接官の発言\n");
  let catalog = buildConsultationCatalog([item, annotation]);
  assert.equal(catalog.sessions[0].readingGuide.excerpts.length, 1);
  assert.equal(findConsultationTranscript([item, annotation], catalog.sessions[0].id).blocks[0].turns[0].speaker, "interviewer");
  annotation.content = annotation.content.replace("面接官の発言", "自分の発言");
  catalog = buildConsultationCatalog([item, annotation]);
  assert.deepEqual(catalog.sessions[0].readingGuide.excerpts, []);
  assert.equal(findConsultationTranscript([item, annotation], catalog.sessions[0].id).blocks[0].turns[0].speaker, "self");
});

test("记忆重构和原始稿不冒充已确认逐字问题预览，人工介绍仍保留", () => {
  const memory = study("memory", { reconstruction: "memory", verbatim: false, teacher_featured: true, teacher_intro_ja: "記憶から再構成した資料です。" });
  const original = raw("raw-only", { date: "2026-10-02" });
  const catalog = buildConsultationCatalog([memory, original]);
  const remembered = catalog.sessions.find(session => session.recordKind === "memory");
  assert.deepEqual(remembered.readingGuide.excerpts, []);
  assert.equal(remembered.readingGuide.featured, true);
  assert.equal(remembered.readingGuide.blockCount, 1);
  assert.equal(remembered.readingGuide.introduction, "記憶から再構成した資料です。");
  const rawOnly = catalog.sessions.find(session => !session.hasReadable);
  assert.deepEqual(rawOnly.readingGuide.excerpts, []);
  assert.equal(rawOnly.readingGuide.blockCount, 0);
});

const session = (id, date, featured = false, extra = {}) => ({ id, companyId: `company-${id}`, company: "株式会社テスト", date, round: "一次面接", outcome: "進行中", outcomeKind: "waiting", hasReadable: true, hasRaw: false, readingGuide: { featured, excerpts: [], blockCount: 1 }, ...extra });

test("最近两场按日期展示，终面按企业去重且不按结果或隐式重点选择", () => {
  const sessions = [
    session("latest", "2026-10-07", false, { outcome: "不採用", outcomeKind: "rejected" }),
    session("offer", "2026-10-06", false, { outcome: "内定", outcomeKind: "offer" }),
    session("final-a", "2026-10-05", false, { stage: "final" }),
    session("final-b", "2026-10-04", false, { stage: "final", recordKind: "memory" }),
    session("flagged", "2026-10-03", true, { readingGuide: { featured: true, example: true } }),
    session("final-c", "2026-10-02", false, { stage: "final" }),
    session("old-final-a", "2026-10-01", false, { stage: "final", companyId: "company-final-a" }),
  ];
  const groups = selectConsultationReadingGroups(sessions);
  assert.deepEqual(groups.map(group => [group.id, group.sessions.map(item => item.id)]), [["recent", ["latest", "offer"]], ["final", ["final-a", "final-b", "final-c"]]]);
  assert.equal(groups[1].sessions[1].recordKind, "memory");
  assert.ok(groups.every(group => group.histories.length === 0));
  assert.equal(sessions.length, 7);
  assert.deepEqual(selectConsultationReadingGroups(sessions.slice(0, 2)).map(group => group.id), ["recent"]);
  assert.deepEqual(selectConsultationReadingGroups(sessions), groups);
});

test("缺少原稿的全部已确认终面保留历史，不伪造场次或截断为两家", () => {
  const final = session("recorded-final", "2026-10-05", false, { stage: "final" });
  const interview = (id, date, stage = "final") => ({ id, date, stage, round: stage === "final" ? "最終面接" : "一次面接", outcome: "不採用", outcomeKind: "rejected", evidenceKind: "history" });
  const company = (id, interviews) => ({ id, company: `株式会社テスト${id}`, applications: [], sessionIds: [], latestDate: "", outcome: "不採用", interviews });
  const missing = interview("history-only", "2026-10-02");
  const companies = [
    company(final.companyId, [interview("same-company-history", "2026-10-06")]),
    company("company-third", [missing, interview("older-third", "2026-09-01")]),
    company("company-fourth", [interview("another-final", "2026-10-03")]),
    company("company-fourth", [interview("duplicate-company", "2026-10-03")]),
    { ...company("not-final", [interview("first-round", "2026-10-04", "round-1")]), reachedFinal: true },
  ];
  const original = structuredClone(companies);
  const group = selectConsultationReadingGroups([final], companies).find(item => item.id === "final");
  assert.deepEqual(group.sessions.map(item => item.id), [final.id]);
  assert.deepEqual(group.histories.map(item => item.companyId), ["company-fourth", "company-third"]);
  assert.equal(group.sessions.length + group.histories.length, 3);
  assert.equal(group.histories[1].interview, missing);
  assert.equal(group.histories[1].interview.sessionId, undefined);
  assert.equal(group.histories[1].sessionId, undefined);
  assert.deepEqual(companies, original);
  const historyOnly = selectConsultationReadingGroups([], companies.filter(item => item.id === "company-third"));
  assert.deepEqual(historyOnly.map(item => item.id), ["final"]);
  assert.equal(historyOnly[0].sessions.length, 0);
  assert.equal(historyOnly[0].histories.length, 1);
});

test("没有日期的记录不超过已知日期，重复和无稿重点不占起点", () => {
  const latest = session("known", "2026-10-01", true);
  assert.deepEqual(selectConsultationReadingGroups([session("undated", "", true), latest, { ...latest }, session("no-record", "2026-11-01", true, { hasReadable: false })])[0].sessions.map(item => item.id), ["known", "undated"]);
  assert.deepEqual(selectConsultationReadingGroups([session("undated-b", ""), session("undated-a", "")])[0].sessions.map(item => item.id), ["undated-a", "undated-b"]);
  assert.deepEqual(selectConsultationReadingGroups([]), []);
});

test("原问句预览跳过声音检查整段，同段追问不占据两个入口", () => {
  const content = "## q01 音声確認\n- **s001｜面**\n    - 正:: 失礼しました。こちらはいかがですか。\n## q02 業務内容\n- **s002｜面**\n    - 正:: 最近担当された仕事を教えてください。\n- **s003｜面**\n    - 正:: いつから担当していますか。\n## q03 志望動機\n- **s004｜面**\n    - 正:: 弊社の志望理由を教えてください。";
  assert.deepEqual(buildConsultationCatalog([study("preview", {}, content)]).sessions[0].readingGuide.excerpts.map(item => item.blockId), ["q02", "q03"]);
});
