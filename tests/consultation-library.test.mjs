import assert from "node:assert/strict";
import test from "node:test";
import { buildConsultationCatalog, findConsultationTranscript } from "../lib/consultation-library.ts";

const note = (path, frontmatter, content = "", mtime = 0) => ({ path, frontmatter, content, tags: [], stat: { ctime: 0, mtime, size: content.length } });
const root = "20_求職/株式会社テスト";
const job = (id, status = "不採用", extra = {}) => note(`${root}/${id}.md`, { type: "job-case", company: "株式会社テスト", case_id: id, status, ...extra });
const raw = (id, extra = {}, content = "質問です。\n回答です。") => note(`${root}/${id}.md`, { type: "transcript", company: "株式会社テスト", date: "2026-09-20", round: "一次面接", ...extra }, content);
const studyBody = "## q01 中文摘要\n- **s001｜面**\n    - 正:: 経験を教えてください。\n    - 訳:: 请介绍经历。\n    - 注:: INTERNAL-ANNOTATION\n- **s002｜私?**\n    - 正:: 開発を担当しました。\n    - 誤:: AI-EVALUATION";
const study = (id, extra = {}, content = studyBody) => note(`${root}/${id}_整理稿.md`, { type: "transcript-study", company: "株式会社テスト", date: "2026-09-20", round: "一次面接", ...extra }, content);

test("有面试记录的公司不限五家，只保留面试过的岗位，无面试公司与准备稿不进入清单", () => {
  const jobs = Array.from({ length: 8 }, (_, index) => job(`test-${index}`, "不採用", { company: `株式会社テスト${index}`, position: "エンジニア" }));
  const studies = jobs.map((item, index) => study(`test-study-${index}`, { company: item.frontmatter.company, case_id: item.frontmatter.case_id }));
  const notes = [...jobs, ...studies, job("another-role", "面接中", { company: "テスト0", position: "リーダー" }), job("not-applied", "未応募", { company: "株式会社未応募テスト" }),
    job("documents-only", "書類通過", { company: "株式会社書類のみテスト" }),
    note(`${root}/prep.md`, { type: "interview-prep", company: "株式会社準備テスト", date: "2026-10-01" })];
  const catalog = buildConsultationCatalog(notes);
  assert.equal(catalog.companies.length, 8);
  assert.equal(catalog.companies.reduce((count, company) => count + company.applications.length, 0), 8);
  assert.deepEqual(catalog.companies.find(company => company.company === "株式会社テスト0").applications.map(application => application.status), ["不採用"]);
  assert.equal(catalog.sessions.length, 8);
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
  assert.equal(legal.applications.length, 1);
  assert.deepEqual(legal.sessionIds, [linked.id]);
  assert.equal(linked.companyId, legal.id);
  assert.equal(linked.company, "株式会社法人A");
  assert.equal(linked.outcomeKind, "rejected");
  assert.equal(unlinked.company, "ブランドB");
  assert.notEqual(unlinked.companyId, legal.id);
  assert.equal(unlinked.outcomeKind, "unknown");
});

test("终面落选仍算进入终面、前轮通过，不把另一岗位后续面试当作通过", () => {
  const notes = [job("main"), job("different", "内定"), study("first", { case: "[[main]]" }),
    study("final", { date: "2026-09-23", round: "最終面接", case: "[[main]]" }),
    study("other-role", { date: "2026-10-01", case: "[[different]]" })];
  const catalog = buildConsultationCatalog(notes);
  const sessions = catalog.sessions;
  assert.equal(sessions.find(session => session.date === "2026-09-20").outcomeKind, "passed");
  assert.equal(sessions.find(session => session.date === "2026-09-23").outcomeKind, "rejected");
  assert.equal(sessions.find(session => session.date === "2026-09-23").stage, "final");
  assert.equal(catalog.companies[0].reachedFinal, true);
  assert.equal(catalog.companies[0].hasPassedInterview, true);
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

test("原稿的次轮仍参与结果判断，中介面谈排除且不能证明企业面试通过", () => {
  const notes = [job("main"), raw("early", { case: "[[main]]" }), raw("late", { date: "2026-09-22", case: "[[main]]", round: "最終面接" }),
    raw("agent", { date: "2026-09-23", case: "[[main]]", round: "エージェント面談" })];
  const sessions = buildConsultationCatalog(notes).sessions;
  assert.equal(sessions.length, 2);
  assert.equal(sessions.find(session => session.date === "2026-09-20").outcomeKind, "passed");
  assert.equal(sessions.find(session => session.date === "2026-09-22").outcomeKind, "rejected");
  assert.equal(sessions.find(session => session.date === "2026-09-23"), undefined);
});

test("空稿、无稿公司、中介与明确平台服务不生成入口，未知结果的真实企业场次保留", () => {
  const notes = [job("no-interview", "不採用", { company: "株式会社無面接テスト" }),
    raw("empty-raw", { company: "株式会社空原稿テスト" }, "---\ntype: transcript\n---\n# 原稿\n \n"),
    study("empty-study", { company: "株式会社空整理テスト" }, "## q01 経験\n- **s001｜面**\n    - 正::   "),
    raw("agent-only", { company: "株式会社紹介テスト", round: "エージェント面談" }),
    raw("service-raw", { company: "株式会社媒体テスト", round: "" }),
    study("service-study", { company: "株式会社媒体テスト", round: "ユーザーサクセス面談", source_note: "[[service-raw]]" }),
    study("explicit-support", { company: "株式会社支援テスト", session_kind: "platform-support" }),
    ...["会社説明会", "説明会", "セミナー", "seminar"].map((round, index) => raw(`seminar-${index}`, { company: `株式会社説明テスト${index}`, round })),
    raw("unknown-employer", { company: "株式会社企業テスト", round: "面談" })];
  const catalog = buildConsultationCatalog(notes);
  assert.deepEqual(catalog.companies.map(company => company.company), ["株式会社企業テスト"]);
  assert.equal(catalog.sessions.length, 1);
  assert.equal(catalog.sessions[0].outcomeKind, "unknown");
  assert.equal(catalog.companies[0].reachedFinal, false);
  assert.equal(catalog.companies[0].hasPassedInterview, false);
});

test("同一案件的确认终面邀约可标进入终面，草稿、未确认准备与同公司另一岗位不可推断", () => {
  const base = [job("main", "面接中"), study("first", { case_id: "main" })];
  const invitation = status => note(`${root}/final-prep.md`, { type: "interview-prep", company: "株式会社テスト", date: "2026-10-01", round: "最終面接", case_id: "main", ...(status ? { session_status: status } : {}) });
  const confirmed = buildConsultationCatalog([...base, invitation("scheduled")]);
  assert.equal(confirmed.sessions.length, 1);
  assert.equal(confirmed.companies[0].reachedFinal, true);
  assert.equal(confirmed.companies[0].hasPassedInterview, true);
  assert.equal(confirmed.sessions[0].stage, "round-1");
  for (const status of ["draft", "preparing", "cancelled", ""]) {
    const catalog = buildConsultationCatalog([...base, invitation(status)]);
    assert.equal(catalog.companies[0].reachedFinal, false, status);
    assert.equal(catalog.companies[0].hasPassedInterview, false, status);
    assert.equal(catalog.sessions[0].outcomeKind, "waiting", status);
  }
  const differentRole = buildConsultationCatalog([...base, job("other", "面接中"), { ...invitation("scheduled"), frontmatter: { ...invitation("scheduled").frontmatter, case_id: "other" } }]);
  assert.equal(differentRole.companies[0].applications.length, 1);
  assert.equal(differentRole.companies[0].reachedFinal, false);
  assert.equal(differentRole.companies[0].hasPassedInterview, false);
});

test("结构化终面确约只作用于同一归属已有面试记录的公司，不从正文或准备标题猜进展", () => {
  const scheduled = job("main", "面接中", { next_event_at: "2026-10-01 14:00", next_event_label: "最終面接" });
  const catalog = buildConsultationCatalog([scheduled, study("first", { case_id: "main" }),
    job("no-record", "面接中", { company: "株式会社記録なしテスト", next_event_at: "2026-10-02 15:00 最終面接" })]);
  assert.equal(catalog.companies.length, 1);
  assert.equal(catalog.companies[0].reachedFinal, true);
  assert.equal(catalog.companies[0].hasPassedInterview, true);
  assert.equal(catalog.sessions[0].outcomeKind, "passed");
  const unknown = buildConsultationCatalog([job("unknown", "面接中"), raw("unknown", { case_id: "unknown", round: "面談" }, "次は最終面接かもしれません。"),
    note(`${root}/title-only-prep.md`, { type: "interview-prep", company: "株式会社テスト", date: "2026-10-01", case_id: "unknown", session_status: "scheduled" }, "# 最終面接の準備")]);
  assert.equal(unknown.companies[0].reachedFinal, false);
  assert.equal(unknown.sessions[0].stage, "");
});

test("结构化后轮邀约必须有同案件的明确先后，同日缺时间或其他岗位不能证明前轮通过", () => {
  const invitation = (at, extra = {}) => job("main", "面接中", { next_event_at: at, next_event_label: "最終面接", ...extra });
  const first = extra => study("first", { case_id: "main", ...extra });
  const sameDayUnknown = buildConsultationCatalog([invitation("2026-09-20 14:00"), first({})]);
  assert.equal(sameDayUnknown.sessions[0].outcomeKind, "waiting");
  assert.equal(sameDayUnknown.companies[0].hasPassedInterview, false);
  const sameDayLater = buildConsultationCatalog([invitation("2026-09-20 14:00"), first({ time: "10:00" })]);
  assert.equal(sameDayLater.sessions[0].outcomeKind, "passed");
  assert.equal(sameDayLater.companies[0].hasPassedInterview, true);
  const earlier = buildConsultationCatalog([invitation("2026-09-19 14:00"), first({ time: "10:00" })]);
  assert.equal(earlier.companies[0].hasPassedInterview, false);
  const anotherRole = buildConsultationCatalog([job("main", "面接中"), first({}),
    job("other-role", "面接中", { next_event_at: "2026-10-01 14:00", next_event_label: "最終面接" })]);
  assert.equal(anotherRole.companies[0].hasPassedInterview, false);
  assert.equal(anotherRole.companies[0].reachedFinal, false);
});

test("实录对应内定计面试通过，只有書類通過状态不计面试通过", () => {
  const offer = buildConsultationCatalog([job("offered", "内定"), study("offered", { case_id: "offered" })]);
  assert.equal(offer.companies[0].hasPassedInterview, true);
  const documents = buildConsultationCatalog([job("documents", "書類通過"), study("documents", { case_id: "documents" })]);
  assert.equal(documents.companies[0].hasPassedInterview, false);
  assert.equal(documents.companies[0].reachedFinal, false);
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
    job("third", "面接中", { company: "株式会社サンプル", applied_on: "2026-09-01" }), study("one-session", { case_id: "one" }),
    study("second-session", { company: "株式会社サンプル", case_id: "second" }),
    study("third-session", { company: "株式会社サンプル", case_id: "third" }), ledger]);
  assert.equal(catalog.companies.find(company => company.company === "株式会社テスト").applications[0].appliedOn, "2026-08-01");
  assert.deepEqual(catalog.companies.find(company => company.company === "株式会社サンプル").applications.map(application => application.appliedOn).sort(), ["", "2026-09-01"]);
});

test("同法人没有面试过的岗位不进入公司行，也不抬高最新日期或覆盖面试结果", () => {
  const notes = [job("interviewed", "不採用", { status_updated: "2026-09-21", position: "面接済エンジニア" }),
    job("not-interviewed", "内定", { status_updated: "2026-10-18", position: "別ポジション" }),
    study("interviewed", { case_id: "interviewed" })];
  const catalog = buildConsultationCatalog(notes);
  assert.equal(catalog.companies.length, 1);
  assert.deepEqual(catalog.companies[0].applications.map(application => application.position), ["面接済エンジニア"]);
  assert.equal(catalog.companies[0].latestDate, "2026-09-20");
  assert.equal(catalog.companies[0].outcome, "不採用");
  assert.equal(catalog.companies[0].hasPassedInterview, false);
  const unlinked = buildConsultationCatalog([job("same-name", "内定"), study("unknown-owner")]);
  assert.equal(unlinked.companies.length, 1);
  assert.deepEqual(unlinked.companies[0].applications, []);
  assert.equal(unlinked.sessions[0].outcomeKind, "unknown");
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
    raw("current-session", { case: "[[current]]" }),
    note("90_归档/old.md", { type: "transcript", company: "株式会社アーカイブ" }, "", Date.UTC(2026, 9, 18))];
  const catalog = buildConsultationCatalog(notes);
  assert.equal(catalog.updatedAt, "2026-10-17T00:00:00.000Z");
  assert.equal(catalog.companies.length, 1);
  assert.equal(catalog.sessions.length, 1);
  assert.equal(buildConsultationCatalog([]).updatedAt, "");
});

test("只有实际单场复盘也进入企业目录，保留无稿终面及前轮通过，不生成可读稿", () => {
  const reviews = [
    note(`${root}/first-review.md`, { type: "review", company: "株式会社履歴テスト", date: "2026-07-01", round: "一次", result: "通過" }, "# 一次面接の振り返り"),
    note(`${root}/final-review.md`, { type: "review", company: "株式会社履歴テスト", date: "2026-07-10", round: "最終", result: "不採用" }, "# 最終面接の振り返り"),
    note(`${root}/email-review.md`, { type: "review", company: "株式会社メールテスト", date: "2026-07-11", round: "一次面接", result: "通過" }, "# 宿題メールの審査"),
    note(`${root}/service-review.md`, { type: "review", company: "株式会社サービステスト", date: "2026-07-12", round: "面談", purpose: "career-support" }, "# 面談の振り返り"),
  ];
  const catalog = buildConsultationCatalog(reviews);
  assert.equal(catalog.companies.length, 1);
  assert.deepEqual(catalog.sessions, []);
  const company = catalog.companies[0];
  assert.equal(company.hasTranscript, false);
  assert.deepEqual(company.sessionIds, []);
  assert.equal(company.interviews.length, 2);
  assert.equal(company.reachedFinal, true);
  assert.equal(company.hasPassedInterview, true);
  assert.equal(company.outcome, "不採用");
  assert.equal(company.latestDate, "2026-07-10");
  assert.ok(company.interviews.every(interview => interview.evidenceKind === "review" && !interview.sessionId));
  assert.equal(findConsultationTranscript(reviews, company.interviews[0].id), null);
});

test("完成准备稿及明确案件实施字段补目录，未完成或未来预约不算实施，版本不重复计算", () => {
  const completed = note(`${root}/completed-prep.md`, { type: "interview-prep", company: "株式会社テスト", case_id: "prepared", date: "2026-09-20", round: "カジュアル面談", session_status: "completed" });
  const notes = [job("prepared"), completed, { ...completed, path: `${root}/completed-prep-v2.md` },
    job("flagged", "不採用（2026-10-02・書類選考）", { company: "株式会社完了テスト", interview_completed: true, interview_date: "2026-09-24", interview_round: "カジュアル面談", position: "実施済ポジション" }),
    note(`${root}/upcoming-prep.md`, { type: "interview-prep", company: "株式会社予定テスト", date: "2026-12-01", round: "最終面接", session_status: "scheduled" }),
    note(`${root}/draft-prep.md`, { type: "interview-prep", company: "株式会社草稿テスト", date: "2026-01-01", round: "一次面接" })];
  const catalog = buildConsultationCatalog(notes);
  assert.equal(catalog.companies.length, 2);
  assert.deepEqual(catalog.sessions, []);
  assert.equal(catalog.companies.find(company => company.company === "株式会社テスト").interviews.length, 1);
  const flagged = catalog.companies.find(company => company.company === "株式会社完了テスト");
  assert.equal(flagged.latestDate, "2026-09-24");
  assert.equal(flagged.interviews[0].position, "実施済ポジション");
  assert.equal(flagged.interviews[0].evidenceKind, "job-case");
  assert.deepEqual(buildConsultationCatalog([...notes].reverse()), catalog);
});

test("历史材料只接纳明确completed记录，未知面试日期不拿结果日填补，来源路径不外泄", () => {
  const history = note("20_求職/_面談相談/history.md", { type: "material", material_kind: "interview-history", records: [
    { company: "株式会社過去テスト", completed: true, date: "", round: "", result: "不採用", result_date: "2026-03-25", position: "過去のエンジニア", source: "/Users/private/history.csv:20" },
    { company: "株式会社未確認テスト", completed: false, result: "不採用" },
    { company: "株式会社紹介テスト", completed: true, round: "エージェント面談" },
  ] });
  const notes = [history, job("another-role", "未応募", { company: "株式会社過去テスト" })];
  const catalog = buildConsultationCatalog(notes);
  assert.equal(catalog.companies.length, 1);
  const company = catalog.companies[0];
  assert.deepEqual(catalog.sessions, []);
  assert.deepEqual(company.applications, []);
  assert.equal(company.latestDate, "");
  assert.equal(company.interviews[0].date, "");
  assert.equal(company.interviews[0].evidenceKind, "history");
  assert.equal(company.interviews[0].position, "過去のエンジニア");
  assert.equal(company.outcome, "不採用");
  assert.doesNotMatch(JSON.stringify(catalog), /2026-03-25|\/Users|history\.csv/);
});

test("同公司同日历史合并要求归属相同、已知时间不冲突，不从无关联复盘猜原稿岗位", () => {
  const first = raw("record", { case_id: "main", time: "10:00" });
  const review = (id, extra = {}) => note(`${root}/${id}.md`, { type: "review", company: "株式会社テスト", date: "2026-09-20", round: "一次面接", result: "不採用", ...extra }, "# 当日の面接の振り返り");
  const notes = [job("main"), first, review("unlinked"), review("later", { case_id: "main", time: "15:00" })];
  const company = buildConsultationCatalog(notes).companies[0];
  assert.equal(company.interviews.length, 3);
  assert.equal(company.sessionIds.length, 1);
  assert.equal(company.hasTranscript, true);
  const matched = buildConsultationCatalog([job("main"), first, review("same", { case_id: "main", time: "10:00" })]).companies[0];
  assert.equal(matched.interviews.length, 1);
  assert.ok(matched.interviews[0].sessionId);
});

test("未知日期的已实施案件不因后来预约而推断通过，原有内定证据不被旧复盘覆盖", () => {
  const notes = [job("unknown-date", "不採用", { interview_completed: true, interview_date: "", next_event_at: "2026-10-01 14:00 最終面接" })];
  const catalog = buildConsultationCatalog(notes);
  assert.equal(catalog.companies[0].hasPassedInterview, false);
  assert.equal(catalog.companies[0].interviews[0].outcomeKind, "rejected");
  const offered = buildConsultationCatalog([job("offered", "内定"), study("offered", { case_id: "offered" }),
    note(`${root}/old-review.md`, { type: "review", company: "株式会社テスト", date: "2026-09-20", round: "一次面接", result: "不採用", case_id: "offered" }, "# 面接の振り返り")]);
  assert.equal(offered.companies[0].outcome, "内定");
  assert.equal(offered.companies[0].hasPassedInterview, true);
});

test("同公司同日另一历史岗位不合并原稿，完全重复的历史记录只显示一次", () => {
  const record = { company: "株式会社テスト", completed: true, date: "2026-09-20", round: "一次面接", position: "品質エンジニア", result: "不採用", source: "旧記録:20" };
  const notes = [raw("unlinked-development", {}, "開発職の経験について回答しました。"),
    note(`${root}/history-material.md`, { type: "material", material_kind: "interview-history", records: [record, { ...record }] })];
  const catalog = buildConsultationCatalog(notes);
  assert.equal(catalog.sessions.length, 1);
  assert.equal(catalog.sessions[0].outcomeKind, "unknown");
  assert.equal(catalog.companies[0].interviews.length, 2);
  const history = catalog.companies[0].interviews.find(interview => interview.evidenceKind === "history");
  assert.equal(history.position, "品質エンジニア");
  assert.equal(history.sessionId, undefined);
  assert.equal(catalog.companies[0].interviews.find(interview => interview.sessionId).outcomeKind, "unknown");
  assert.equal(findConsultationTranscript(notes, catalog.sessions[0].id).outcomeKind, "unknown");
});

test("同一案件当轮复盘明确通过时，企业历史、原稿列表与原稿详情结果一致，案件当前落选保持", () => {
  const notes = [job("main", "不採用"), raw("first-record", { case_id: "main" }),
    note(`${root}/first-review.md`, { type: "review", company: "株式会社テスト", date: "2026-09-20", round: "一次面接", result: "通過", case_id: "main" }, "# 当日の面接の振り返り")];
  const catalog = buildConsultationCatalog(notes);
  assert.equal(catalog.sessions[0].outcomeKind, "passed");
  assert.equal(catalog.companies[0].interviews.find(interview => interview.sessionId).outcomeKind, "passed");
  assert.equal(findConsultationTranscript(notes, catalog.sessions[0].id).outcomeKind, "passed");
  assert.equal(catalog.companies[0].applications[0].status, "不採用");
  assert.equal(catalog.companies[0].outcome, "不採用");
});


test("咨询库日语轮次沿用明确阶段，未知名称回退且不改写来源", () => {
  for (const [label, display] of [["轻松面谈", "カジュアル面談"], ["第三次面试", "三次面接"], ["最终面试", "最終面接"], ["技術面談", "技術面談"]]) {
    const source = raw("round-display", { case_id: "main", round: label });
    const notes = [job("main"), source];
    const catalog = buildConsultationCatalog(notes);
    const session = catalog.sessions[0];
    assert.equal(session.round, display, label);
    assert.equal(findConsultationTranscript(notes, session.id).round, display, label);
    assert.equal(catalog.companies[0].interviews[0].round, display, label);
    assert.equal(source.frontmatter.round, label, "显示投影不能改写原始轮次");
  }
});
