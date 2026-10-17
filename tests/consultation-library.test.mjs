import assert from "node:assert/strict";
import test from "node:test";
import { buildConsultationCatalog, findConsultationTranscript } from "../lib/consultation-library.ts";

const note = (path, frontmatter, content = "", mtime = 0) => ({ path, frontmatter, content, tags: [], stat: { ctime: 0, mtime, size: content.length } });
const root = "20_求職/株式会社テスト";
const job = (id, status = "不採用", extra = {}) => note(`${root}/${id}.md`, { type: "job-case", company: "株式会社テスト", case_id: id, status, ...extra });
const raw = (id, extra = {}, content = "質問です。\n回答です。") => note(`${root}/${id}.md`, { type: "transcript", company: "株式会社テスト", date: "2026-09-20", round: "一次面接", ...extra }, content);
const studyBody = "## q01 中文摘要\n- **s001｜面**\n    - 正:: 経験を教えてください。\n    - 訳:: 请介绍经历。\n    - 注:: INTERNAL-ANNOTATION\n- **s002｜私?**\n    - 正:: 開発を担当しました。\n    - 誤:: AI-EVALUATION";
const study = (id, extra = {}, content = studyBody) => note(`${root}/${id}_整理稿.md`, { type: "transcript-study", company: "株式会社テスト", date: "2026-09-20", round: "一次面接", ...extra }, content);

test("全量保留已应募公司和每个岗位，未応募与准备稿不进入清单", () => {
  const jobs = Array.from({ length: 8 }, (_, index) => job(`test-${index}`, "不採用", { company: `株式会社テスト${index}`, position: "エンジニア" }));
  const notes = [...jobs, job("another-role", "面接中", { company: "テスト0", position: "リーダー" }), job("not-applied", "未応募", { company: "株式会社未応募テスト" }),
    note(`${root}/prep.md`, { type: "interview-prep", company: "株式会社準備テスト", date: "2026-10-01" })];
  const catalog = buildConsultationCatalog(notes);
  assert.equal(catalog.companies.length, 8);
  assert.equal(catalog.companies.reduce((count, company) => count + company.applications.length, 0), 9);
  assert.deepEqual(catalog.companies.find(company => company.company === "テスト0").applications.map(application => application.status).sort(), ["不採用", "面接中"]);
  assert.equal(catalog.sessions.length, 0);
});

test("当前案件状态是正本，不被历史复盘结果覆盖；没有关联不猜同公司岗位", () => {
  const notes = [job("main", "内定"), study("linked", { case: "[[main]]" }), study("unlinked", { date: "2026-09-21" }),
    note(`${root}/old-review.md`, { type: "review", company: "株式会社テスト", date: "2026-09-20", result: "不採用" })];
  const catalog = buildConsultationCatalog(notes);
  assert.equal(catalog.companies[0].applications[0].status, "内定");
  assert.equal(catalog.sessions.find(session => session.date === "2026-09-20").outcomeKind, "offer");
  const unlinked = catalog.sessions.find(session => session.date === "2026-09-21");
  assert.equal(unlinked.outcomeKind, "unknown");
  assert.match(unlinked.outcome, /関連は未確認/);
});

test("品牌名只凭明确 case_id 归入法人公司，不猜未关联品牌或移用其他岗位的结果", () => {
  const notes = [job("legal-role-a", "不採用", { company: "株式会社法人A" }), job("legal-role-b", "内定", { company: "株式会社法人A" }),
    study("brand-b", { company: "ブランドB", case_id: "legal-role-a" }),
    study("unlinked-brand-b", { company: "ブランドB", date: "2026-09-21" })];
  const catalog = buildConsultationCatalog(notes);
  const legal = catalog.companies.find(company => company.company === "株式会社法人A");
  const linked = catalog.sessions.find(session => session.date === "2026-09-20");
  const unlinked = catalog.sessions.find(session => session.date === "2026-09-21");
  assert.equal(catalog.companies.length, 2);
  assert.equal(legal.applications.length, 2);
  assert.deepEqual(legal.sessionIds, [linked.id]);
  assert.equal(linked.companyId, legal.id);
  assert.equal(linked.company, "株式会社法人A");
  assert.equal(linked.outcomeKind, "rejected");
  assert.equal(unlinked.company, "ブランドB");
  assert.notEqual(unlinked.companyId, legal.id);
  assert.equal(unlinked.outcomeKind, "unknown");
});

test("同一案件的前轮与末轮分开判断，不把另一岗位后续面试当作通过", () => {
  const notes = [job("main"), job("different", "内定"), study("first", { case: "[[main]]" }),
    study("final", { date: "2026-09-23", round: "最終面接", case: "[[main]]" }),
    study("other-role", { date: "2026-10-01", case: "[[different]]" })];
  const sessions = buildConsultationCatalog(notes).sessions;
  assert.equal(sessions.find(session => session.date === "2026-09-20").outcomeKind, "passed");
  assert.equal(sessions.find(session => session.date === "2026-09-23").outcomeKind, "rejected");
});

test("原稿单独存在也可读，整理稿明确引用原稿时合并，输入顺序不改变稳定 ID", () => {
  const notes = [job("main"), raw("first", { case: "[[main]]" }), study("first", { case: "[[main]]", source_note: "[[first]]" }),
    raw("raw-only", { date: "2026-10-03", case: "[[main]]" }), study("readable-only", { date: "2026-10-04", case: "[[main]]" })];
  const catalog = buildConsultationCatalog(notes);
  assert.equal(catalog.sessions.length, 3);
  const merged = catalog.sessions.find(session => session.date === "2026-09-20");
  assert.equal(merged.hasRaw, true);
  assert.equal(merged.hasReadable, true);
  const onlyRaw = catalog.sessions.find(session => session.date === "2026-10-03");
  assert.equal(onlyRaw.hasReadable, false);
  assert.equal(findConsultationTranscript(notes, onlyRaw.id).raw, "質問です。\n回答です。");
  assert.deepEqual(findConsultationTranscript(notes, onlyRaw.id).blocks, []);
  assert.match(findConsultationTranscript(notes, onlyRaw.id).notice, /原始転写のみ/);
  assert.deepEqual(buildConsultationCatalog([...notes].reverse()), catalog);
  assert.equal(findConsultationTranscript(notes, notes[1].path), null);
  assert.equal(findConsultationTranscript(notes, "../../private.md"), null);
});

test("原稿だけの次轮仍参与权威结果判断，中介面谈不计作企业落选", () => {
  const notes = [job("main"), raw("early", { case: "[[main]]" }), raw("late", { date: "2026-09-22", case: "[[main]]", round: "最終面接" }),
    raw("agent", { date: "2026-09-23", case: "[[main]]", round: "エージェント面談" })];
  const sessions = buildConsultationCatalog(notes).sessions;
  assert.equal(sessions.find(session => session.date === "2026-09-20").outcomeKind, "passed");
  assert.equal(sessions.find(session => session.date === "2026-09-23").outcomeKind, "not-applicable");
});

test("明确但失效的案件链接不回退到同公司，多个同日原稿不任意合并", () => {
  const notes = [job("main"), raw("raw-a"), raw("raw-b"), study("ambiguous"),
    study("broken", { date: "2026-10-01", case: "[[not-found]]" })];
  const catalog = buildConsultationCatalog(notes);
  assert.equal(catalog.sessions.length, 4);
  assert.ok(catalog.sessions.every(session => session.outcomeKind === "unknown"));
});

test("合并必须双向唯一，明确原稿链接不能掩盖不同岗位归属", () => {
  const ambiguous = [raw("single-raw"), study("study-a"), study("study-b")];
  const catalog = buildConsultationCatalog(ambiguous);
  assert.equal(catalog.sessions.length, 3);
  assert.deepEqual(buildConsultationCatalog([...ambiguous].reverse()), catalog);
  const conflict = [job("role-a"), job("role-b", "内定"), raw("conflict-raw", { case: "[[role-a]]" }),
    study("conflict-study", { case: "[[role-b]]", source_note: "[[conflict-raw]]" })];
  const sessions = buildConsultationCatalog(conflict).sessions;
  assert.equal(sessions.length, 2);
  assert.deepEqual(sessions.map(session => session.outcomeKind).sort(), ["offer", "rejected"]);
});

test("公司级台账补全单岗位応募日，不把拒信日期或同公司另一岗位日期当作応募日", () => {
  const ledger = note("20_求職/_応募日台帳.md", { type: "ledger" }, "| 2026-08-01 | 株式会社テスト | 株式会社テスト | one | Green |\n| 2026-08-02 | 株式会社サンプル | 株式会社サンプル | two | Green |");
  const catalog = buildConsultationCatalog([job("one", "不採用（2026-09-30・書類選考）"), job("second", "不採用", { company: "株式会社サンプル" }),
    job("third", "面接中", { company: "株式会社サンプル", applied_on: "2026-09-01" }), ledger]);
  assert.equal(catalog.companies.find(company => company.company === "株式会社テスト").applications[0].appliedOn, "2026-08-01");
  assert.deepEqual(catalog.companies.find(company => company.company === "株式会社サンプル").applications.map(application => application.appliedOn).sort(), ["", "2026-09-01"]);
});

test("老师投影只给发言与原稿，隐藏联系方式、内部链接和路径，不返回批注或 AI 评价", () => {
  const source = raw("private", {}, "---\nprivate: DO-NOT-EXPOSE\n---\n質問 test@example.com 090-1234-5678 https://example.invalid\n[[20_求職/内部资料]] /Users/sample/private.md");
  const readable = study("private", { source_note: "[[private]]" });
  const annotations = note(`${root}/private_批注.md`, { type: "study-annotation", company: "株式会社テスト", date: "2026-09-20" }, "- **a001｜s002｜裁定｜answered｜2026-09-21**\n    - 対象:: speaker\n    - 我:: 自分の発言\n");
  const notes = [source, readable, annotations];
  const catalog = buildConsultationCatalog(notes);
  const transcript = findConsultationTranscript(notes, catalog.sessions[0].id);
  const serialized = JSON.stringify(transcript);
  assert.doesNotMatch(serialized, /DO-NOT-EXPOSE|test@example|090-1234|https:\/\/|20_求職|\/Users|INTERNAL-ANNOTATION|AI-EVALUATION|中文摘要|请介绍/);
  assert.equal(transcript.company, "株式会社テスト");
  assert.equal(transcript.blocks[0].title, "やり取り 1");
  assert.equal(transcript.blocks[0].turns[1].speaker, "self");
  assert.equal(transcript.blocks[0].turns[1].uncertain, false);
});

test("未裁定话者保留不确定性，记忆重构提示不能声称逐字原话", () => {
  const notes = [study("memory", { reconstruction: "memory", verbatim: false })];
  const catalog = buildConsultationCatalog(notes);
  const transcript = findConsultationTranscript(notes, catalog.sessions[0].id);
  assert.equal(catalog.sessions[0].recordKind, "memory");
  assert.equal(transcript.blocks[0].turns[1].speaker, "unknown");
  assert.equal(transcript.blocks[0].turns[1].uncertain, true);
  assert.match(transcript.notice, /記憶から再構成/);
});

test("更新时间来自笔记 mtime；模板与归档不是当前投影资料", () => {
  const notes = [note("20_求職/current.md", { type: "job-case", company: "株式会社テスト", status: "応募済" }, "", Date.UTC(2026, 9, 17)),
    note("90_归档/old.md", { type: "transcript", company: "株式会社アーカイブ" }, "", Date.UTC(2026, 9, 18))];
  const catalog = buildConsultationCatalog(notes);
  assert.equal(catalog.updatedAt, "2026-10-17T00:00:00.000Z");
  assert.equal(catalog.companies.length, 1);
  assert.equal(catalog.sessions.length, 0);
  assert.equal(buildConsultationCatalog([]).updatedAt, "");
});
