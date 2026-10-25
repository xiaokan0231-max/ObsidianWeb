import assert from "node:assert/strict";
import test from "node:test";
import { buildCompanyOverviews } from "../lib/company-overview.ts";
import { COMPANY_COMPARE_LIMIT, buildCompanyCompareCandidates, companyComparePreset, companyCompareRatings, filterCompanyCompareCandidates } from "../lib/company-compare.ts";

const today = "2026-10-25";
const note = (path, frontmatter, content = "") => ({ path, frontmatter, content, tags: [], stat: { ctime: 0, mtime: 0, size: 0 } });
const review = (platform, score, extra = {}) => ({ platform, status: "available", score, scale: 5,
  sample_count: 12, sample_unit: platform === "OpenWork" ? "名回答者" : "条分类评论", read_on: today,
  url: `https://example.com/reviews/${platform === "OpenWork" ? "openwork" : "jobtalk"}`,
  coverage: "工程师样本", comment_period: "2026年", limitations: "不代表全体员工", positive: [], negative: [], ...extra });
function fixture(key, { company = `株式会社テスト${key}`, scores = [], upcoming = "", past = "", profile = true, ownerExtra = {} } = {}) {
  const dossier = note(`20_求職/${key}/_会社.md`, { type: "company", company,
    ...(profile ? { company_profile: { version: 1, updated_on: today, facts: [], reviews: scores } } : {}) });
  const owner = note(`20_求職/${key}/案件.md`, { type: "job-case", company, case_id: `case-${key}`,
    position: `数据工程${key}`, status: "面接中", channel: "测试媒体", company_dossier: `[[20_求職/${key}/_会社]]`,
    ...(upcoming ? { next_event_at: upcoming, next_event_label: "一次面接" } : {}), ...ownerExtra });
  const prep = past ? note(`20_求職/${key}/準備.md`, { type: "interview-prep", company, date: past,
    session_status: "completed", case: `[[20_求職/${key}/案件]]`, round: "一次面接", time: "13:00" }) : null;
  return { dossier, owner, prep, notes: [dossier, owner, ...(prep ? [prep] : [])] };
}
const build = (...data) => {
  const notes = data.flatMap((entry) => entry.notes ?? entry);
  return buildCompanyCompareCandidates(buildCompanyOverviews(notes), notes, today);
};
const path = (item) => item.context.note.path;

test("recent and upcoming companies remain selectable with profile-only or no assessment", () => {
  const future = fixture("future", { company: "株式会社テスト予定", upcoming: "2026-10-28 17:00", scores: [review("OpenWork", 2.8)] });
  const recent = fixture("recent", { past: "2026-10-23" });
  const info = fixture("info");
  const empty = fixture("empty", { profile: false });
  const items = build(empty, info, recent, future);
  assert.equal(items.length, 4);
  assert.deepEqual(items.map(path), [future.owner.path, recent.owner.path, info.owner.path, empty.owner.path]);
  assert.equal(items[0].shortName, "テスト予定");
  assert.equal(items[0].context.assessment, null);
  assert.equal(items[0].eventAt, "2026-10-28 17:00");
  assert.equal(items[1].lastInterviewAt, "2026-10-23 13:00");
  assert.match(items[0].dateLabel, /下次 2026-10-28/);
  assert.match(items[1].dateLabel, /面过 2026-10-23/);
  assert.deepEqual(filterCompanyCompareCandidates(items, "", "relevant", [], "relevance").map(path), items.slice(0, 3).map(path));
  assert.ok(filterCompanyCompareCandidates(items, "", "relevant", [empty.owner.path], "relevance").some((item) => path(item) === empty.owner.path));
  assert.equal(items.at(-1).readinessLabel, "资料待补 · 仍可对比");
});

test("task due and research updates never become interview dates or recent presets", () => {
  const data = fixture("undated", { ownerExtra: { due: "2026-10-29", updated: today, status_updated: today } });
  data.notes.push(note("20_求職/_TODO/准备资料.md", { type: "todo", category: "面接準備", company: data.owner.frontmatter.company,
    due: "2026-10-29", status: "未着手", case_id: data.owner.frontmatter.case_id }));
  const item = build(data)[0];
  assert.equal(item.hasInterview, false);
  assert.equal(item.eventAt, "");
  assert.equal(item.lastInterviewAt, "");
  assert.equal(item.dateLabel, "面谈日期未记录");
  assert.deepEqual(companyComparePreset([item], "recent"), []);
  assert.deepEqual(companyComparePreset([item], "upcoming"), []);
});

test("display names never merge event ownership across corporations or positions", () => {
  const a = fixture("a", { company: "株式会社テスト同名", upcoming: "2026-10-28 17:00" });
  const b = fixture("b", { company: "株式会社テスト同名" });
  const items = build(a, b);
  assert.equal(items.find((item) => path(item) === a.owner.path).hasInterview, true);
  assert.equal(items.find((item) => path(item) === b.owner.path).hasInterview, false);
  assert.equal(companyComparePreset(items, "upcoming").length, 1);
  const unrelated = note("旧面谈.md", { type: "review", company: a.owner.frontmatter.company, date: "2026-10-24", round: "一次面接" });
  assert.ok(build(a, b, [unrelated]).every((item) => !item.lastInterviewAt), "没有明确关联的同名旧面谈不能借给案件");
});

test("scores retain each platform and sample unit; sorting never synthesizes an average", () => {
  const a = fixture("a", { scores: [review("OpenWork", 4.8), review("転職会議", 2.7)] });
  const b = fixture("b", { scores: [review("OpenWork", 3.4), review("転職会議", 4.9)] });
  const absent = fixture("absent");
  const items = build(a, b, absent);
  assert.equal(items.find((item) => path(item) === a.owner.path).reviews.length, 2);
  const dual = items.find((item) => path(item) === a.owner.path).reviews;
  assert.deepEqual(dual.map((item) => [item.platform, item.score, item.sampleUnit]), [["OpenWork", 4.8, "名回答者"], ["転職会議", 2.7, "条分类评论"]]);
  assert.deepEqual(filterCompanyCompareCandidates(items, "", "all", [], "openwork").map(path), [a.owner.path, b.owner.path, absent.owner.path]);
  assert.deepEqual(filterCompanyCompareCandidates(items, "", "all", [], "jobtalk").map(path), [b.owner.path, a.owner.path, absent.owner.path]);
  assert.deepEqual(companyComparePreset(items, "openwork"), [a.owner.path, b.owner.path]);
  assert.deepEqual(companyComparePreset(items, "jobtalk"), [b.owner.path, a.owner.path]);
});

test("invalid, stale-replaced, conflicting and non-five-point statistics are excluded", () => {
  const a = fixture("a", { scores: [review("OpenWork", 4.8, { read_on: "2026-10-20" }),
    review("OpenWork", null, { status: "no_samples", scale: null, sample_count: 0, read_on: today })] });
  const b = fixture("b", { scores: [review("OpenWork", 4.8), review("OpenWork", 4.7)] });
  const c = fixture("c", { scores: [review("OpenWork", 8.7, { scale: 10 }), review("転職会議", 4.3, { status: "restricted" })] });
  const data = build(a, b, c);
  assert.equal(data.find((item) => path(item) === a.owner.path).reviews.length, 0);
  assert.equal(data.find((item) => path(item) === b.owner.path).reviews.length, 0);
  assert.deepEqual(companyCompareRatings(data.find((item) => path(item) === b.owner.path).context), [], "展示与排序共用冲突剔除结果");
  assert.deepEqual(data.find((item) => path(item) === c.owner.path).reviews.map((r) => [r.platform, r.score, r.status]), [["転職会議", 4.3, "restricted"]]);
  assert.deepEqual(companyComparePreset(data, "openwork"), []);
});

test("candidate identity uses the explicitly linked legal entity and searches its business description", () => {
  const data = fixture("child", { company: "テスト持株／テスト製造技術" });
  data.dossier.frontmatter.company = "株式会社テスト製造技術";
  data.dossier.frontmatter.company_profile.facts = [{ id: "business", label: "业务", value: "制造数据分析与传感器运用",
    as_of: today, scope: "该法人整体", sources: [{ label: "公司介绍", url: "https://example.com/company" }] }];
  const items = build(data);
  assert.equal(items[0].shortName, "テスト製造技術");
  assert.equal(items[0].context.company, "テスト持株／テスト製造技術", "不改写原来的案件显示名，也不按名称合并法人");
  assert.equal(filterCompanyCompareCandidates(items, "制造 传感器", "relevant", [], "relevance").length, 1);
  assert.equal(filterCompanyCompareCandidates(items, "テスト持株", "all", [], "relevance").length, 1);
});

test("meeting cards use the explicitly assessed role instead of a submission task title", () => {
  const data = fixture("meeting");
  data.owner.frontmatter.type = "todo";
  data.owner.frontmatter.category = "面接準備";
  data.owner.frontmatter.meeting_topic = "初回面談のテーマ";
  delete data.owner.frontmatter.position;
  data.owner.content = "# テスト会社 面談候補の提出状況確認";
  const context = buildCompanyOverviews(data.notes)[0];
  const originalTitle = context.title;
  context.assessment = { contextFacts: [{ id: "role", value: "BIコンサルタント（分析基盤）" }] };
  const items = buildCompanyCompareCandidates([context], data.notes, today);
  assert.equal(items[0].displayRole, "BIコンサルタント（分析基盤）");
  assert.equal(items[0].context.title, originalTitle, "原任务标题保留供查看来源");
  assert.equal(filterCompanyCompareCandidates(items, "BI 分析基盤", "relevant", [], "relevance").length, 1);
  context.assessment = null;
  assert.equal(buildCompanyCompareCandidates([context], data.notes, today)[0].displayRole, "初回面談のテーマ");
  delete context.note.frontmatter.meeting_topic;
  assert.equal(buildCompanyCompareCandidates([context], data.notes, today)[0].displayRole, originalTitle);
  const caseData = fixture("case-role");
  const caseContext = buildCompanyOverviews(caseData.notes)[0];
  caseContext.assessment = { contextFacts: [{ id: "role", value: "别的描述不覆盖案件岗位" }] };
  assert.equal(buildCompanyCompareCandidates([caseContext], caseData.notes, today)[0].displayRole, caseContext.title);
});

test("presets choose latest explicit corporate context and allow eight distinct companies", () => {
  const a = fixture("a", { past: "2026-10-23", scores: [review("OpenWork", 4.5)] });
  const older = fixture("older", { past: "2026-10-01", scores: [review("OpenWork", 4.5)] });
  older.owner.frontmatter.company_dossier = a.owner.frontmatter.company_dossier;
  older.notes = [older.owner, older.prep];
  const extra = Array.from({ length: 8 }, (_, index) => fixture(`x${index}`, { past: `2026-10-${String(22 - index).padStart(2, "0")}`, scores: [review("OpenWork", 4.4 - index / 10)] }));
  const items = build(older, a, ...extra);
  assert.deepEqual(companyComparePreset(items, "recent", 2), [a.owner.path, extra[0].owner.path]);
  assert.equal(companyComparePreset(items, "openwork", 99).length, COMPANY_COMPARE_LIMIT);
  assert.equal(companyComparePreset(items, "openwork", 0).length, 0);
  assert.ok(!companyComparePreset(items, "openwork", 99).includes(older.owner.path));
});

test("search normalizes width and searches role, status, channel and invitation clues", () => {
  const invited = fixture("invite", { company: "テストＡＢＣ株式会社", upcoming: "2026-10-29 13:00", ownerExtra: { origin: "scout" } });
  const ai = fixture("ai", { upcoming: "2026-10-28 17:00", ownerExtra: { application_actor: "ai", application_agent: "Codex", applied_on: "2026-10-03" } });
  const items = build(invited, ai);
  assert.equal(items.find((item) => path(item) === invited.owner.path).shortName, "テストＡＢＣ");
  assert.equal(items.find((item) => path(item) === invited.owner.path).originKind, "invited");
  assert.equal(items.find((item) => path(item) === ai.owner.path).originKind, "ai");
  assert.equal(filterCompanyCompareCandidates(items, "abc 测试媒体", "all", [], "relevance").length, 1);
  assert.equal(filterCompanyCompareCandidates(items, "ＡＩ 代投", "all", [], "relevance").length, 1);
  assert.equal(filterCompanyCompareCandidates(items, "", "selected", [invited.owner.path], "relevance")[0].context.note.path, invited.owner.path);
  assert.deepEqual(items.map(path), [ai.owner.path, invited.owner.path]);
});
