import assert from "node:assert/strict";
import test from "node:test";
import { buildCalendarCompanyRatings } from "../lib/calendar-company-rating.ts";
import { buildCompanyOverviews } from "../lib/company-overview.ts";

const note = (path, frontmatter, content = "") => ({ path, frontmatter, content, tags: [], stat: { ctime: 0, mtime: 0, size: 0 } });
const review = (extra = {}) => ({
  platform: "OpenWork", url: "https://example.com/openwork/test", status: "available",
  score: 4.18, scale: 5, sample_count: 12, sample_unit: "名回答者", comment_period: "2024–2026年",
  coverage: "不同部门混合", positive: ["协作机会"], negative: ["配属差异"], read_on: "2026-10-25",
  limitations: "样本不能代替本岗位的确认", ...extra,
});
const fixture = (key = "a", extra = {}) => {
  const dossier = note(`20_求職/${key}/_公司.md`, {
    type: "company", company: "株式会社テスト", company_profile: {
      version: 1, updated_on: "2026-10-25", facts: [], reviews: [review(extra)],
    },
    // 日历冷加载没有这些报告时，不能抹掉公司的有效口碑统计。
    company_summary: "[[80_AI分析/未加载总结]]",
  });
  const owner = note(`20_求職/${key}/案件.md`, {
    type: "job-case", company: "株式会社テスト", case_id: `test-${key}`,
    company_dossier: `[[20_求職/${key}/_公司]]`, fit_assessment: "[[80_AI分析/未加载契合报告]]", rating: 9.9,
  });
  const prep = note(`20_求職/${key}/准备.md`, {
    type: "interview-prep", company: "株式会社テスト", date: "2026-10-29", case: `[[20_求職/${key}/案件]]`,
    company_dossier: `[[20_求職/${key}/_公司]]`,
  });
  const event = {
    id: `event-${key}`, note: owner, kind: "event", date: "2026-10-29", time: "13:00", company: "株式会社テスト",
    label: "一次面接", phase: "upcoming", caseId: owner.frontmatter.case_id, prepPath: prep.path,
  };
  const notes = [dossier, owner, prep];
  return { dossier, owner, prep, event, notes };
};
const read = (data, event = data.event, targets) => buildCalendarCompanyRatings([event], data.notes, targets).get(event.id);

test("过去与未来场次共享画像后仍与分别解析的口碑一致，冲突关联仍不借分", () => {
  const first = fixture("a");
  const second = fixture("b", { score: 3.2 });
  const notes = [...first.notes, ...second.notes];
  const contexts = buildCompanyOverviews(notes);
  for (const phase of ["past", "upcoming"]) {
    const events = [first.event, second.event].map((event) => ({ ...event, phase }));
    const shared = buildCalendarCompanyRatings(events, notes, undefined, contexts);
    assert.deepEqual(shared, buildCalendarCompanyRatings(events, notes));
    assert.equal(shared.get(first.event.id).score, 4.18);
    assert.equal(shared.get(second.event.id).score, 3.2);
    const conflicting = new Map([[first.event.id, { sourcePath: second.prep.path, path: second.prep.path, caseId: "test-b" }]]);
    assert.equal(buildCalendarCompanyRatings(events, notes, conflicting, contexts).has(first.event.id), false);
  }
});
const target = (event, extra = {}) => ({ view: "session", path: null, sourcePath: event.note.path, caseId: event.caseId,
  company: event.company, date: event.date, label: event.label, ...extra });

test("calendar projects validated company statistics without company summary or fit reports", () => {
  const data = fixture();
  assert.deepEqual(read(data), {
    platform: "OpenWork", url: "https://example.com/openwork/test", status: "available", score: 4.18, scale: 5,
    sampleCount: 12, sampleUnit: "名回答者", readOn: "2026-10-25", commentPeriod: "2024–2026年",
    coverage: "不同部门混合", limitations: "样本不能代替本岗位的确认",
  });
  const before = JSON.stringify(data.notes);
  read(data);
  assert.equal(JSON.stringify(data.notes), before, "投影不改写正本或把旧 9.9 换算成口碑分");
});

test("explicit identities keep homonymous corporations separate and never match display names", () => {
  const a = fixture("a", { score: 4.18 });
  const b = fixture("b", { score: 2.5, url: "https://example.com/openwork/other" });
  const notes = [...a.notes, ...b.notes];
  const ratings = buildCalendarCompanyRatings([a.event, b.event], notes);
  assert.equal(ratings.get(a.event.id).score, 4.18);
  assert.equal(ratings.get(b.event.id).score, 2.5);
  const old = { ...a.event, note: note("旧复盘.md", { type: "review", company: "株式会社テスト" }), caseId: "", prepPath: "" };
  assert.equal(buildCalendarCompanyRatings([old], notes).size, 0);
  assert.equal(buildCalendarCompanyRatings([old], a.notes).size, 0, "即使只有一家同名公司，也不能凭名字补分");
});

test("prep, target source, and legacy case id resolve the same explicitly linked owner", () => {
  const data = fixture();
  assert.equal(read(data, { ...data.event, note: data.prep, caseId: "", prepPath: "" }).score, 4.18);
  const old = { ...data.event, note: note("旧复盘.md", { type: "review" }), caseId: "", prepPath: "" };
  assert.equal(read(data, old, new Map([[old.id, target(old, { sourcePath: data.prep.path, path: data.prep.path })]])).score, 4.18);
  assert.equal(read(data, { ...old, caseId: data.owner.frontmatter.case_id }).score, 4.18);
  assert.equal(read(data, { ...old, prepPath: data.prep.path }).score, 4.18);
});

test("independent meeting todo uses its explicit company dossier and prep association", () => {
  const data = fixture();
  const meeting = note("20_求職/_TODO/测试面谈.md", {
    type: "todo", company: "株式会社テスト", next_event_at: "2026-10-29T13:00:00+09:00", next_event: "面談",
    company_dossier: data.owner.frontmatter.company_dossier,
  });
  data.prep.frontmatter = { type: "interview-prep", meeting: "[[20_求職/_TODO/测试面谈]]" };
  data.notes.push(meeting);
  assert.equal(read(data, { ...data.event, note: meeting, caseId: "" }).score, 4.18);
});

test("conflicting case, prep, target, dossier, and ambiguous references expose no chip", () => {
  const a = fixture("a"), b = fixture("b", { score: 2.5 });
  a.notes.push(...b.notes);
  for (const event of [
    { ...a.event, prepPath: b.prep.path },
    { ...a.event, caseId: b.owner.frontmatter.case_id },
    { ...a.event, prepPath: "已删除的准备.md" },
  ]) assert.equal(read(a, event), undefined);
  for (const extra of [
    { sourcePath: b.prep.path }, { path: b.prep.path }, { caseId: b.owner.frontmatter.case_id },
  ]) assert.equal(read(a, a.event, new Map([[a.event.id, target(a.event, extra)]])), undefined);
  a.prep.frontmatter.company_dossier = b.owner.frontmatter.company_dossier;
  assert.equal(read(a), undefined);
  a.prep.frontmatter.company_dossier = a.owner.frontmatter.company_dossier;
  a.prep.frontmatter.meeting = "";
  assert.equal(read(a), undefined, "两个显式所属字段不能靠空值绕过冲突检查");
  delete a.prep.frontmatter.meeting;
  a.prep.frontmatter.case = "[[案件]]";
  assert.equal(read(a), undefined);
  a.prep.frontmatter.case = "[[20_求職/a/案件]]";
  a.notes.push(note("20_求職/重复案件.md", { ...a.owner.frontmatter }));
  assert.equal(read(a), undefined, "case_id 重复时不按文件顺序选择");
});

test("invalid and missing statistics are never replaced by interview or fit scores", () => {
  const mutations = [
    { score: null }, { score: "4.18" }, { score: NaN }, { score: -1 }, { score: 6 }, { score: Infinity },
    { scale: null }, { scale: 0 }, { scale: "5" }, { scale: Infinity }, { sample_count: 1.5 },
    { read_on: "2026-02-30" }, { url: "javascript:alert(1)" },
    { status: "not_researched", score: null, scale: null, sample_count: null, positive: [], negative: [] },
    { status: "no_samples", score: null, sample_count: 0, positive: [], negative: [] },
  ];
  for (const mutation of mutations) assert.equal(read(fixture("a", mutation)), undefined, JSON.stringify(mutation));
  const data = fixture();
  delete data.dossier.frontmatter.company_profile;
  data.prep.frontmatter.score = 85;
  data.prep.frontmatter.fit_score = 4;
  assert.equal(read(data), undefined);
});

test("OpenWork is preferred without averaging platforms; restricted valid statistics retain their limits", () => {
  const data = fixture("a", { status: "restricted", limitations: "评分可见，评论全文受限" });
  data.dossier.frontmatter.company_profile.reviews.unshift(review({ platform: "其他平台", score: 8.2, scale: 10 }));
  const rating = read(data);
  assert.equal(rating.platform, "OpenWork");
  assert.equal(rating.score, 4.18);
  assert.equal(rating.scale, 5);
  assert.equal(rating.status, "restricted");
  assert.equal(rating.limitations, "评分可见，评论全文受限");
  data.dossier.frontmatter.company_profile.reviews.pop();
  assert.equal(read(data).score, 8.2);
  assert.equal(read(data).scale, 10, "其他平台保留原量尺");
  assert.equal(read(fixture("zero", { score: 0, scale: 10, sample_count: null })).score, 0);
});

test("same-platform snapshots use the latest read date and reject conflicting latest snapshots", () => {
  const data = fixture();
  data.dossier.frontmatter.company_profile.reviews.push(review({ score: 4.1, read_on: "2026-10-20" }));
  assert.equal(read(data).score, 4.18);
  data.dossier.frontmatter.company_profile.reviews.push(review({ score: 4.2 }));
  assert.equal(read(data), undefined);
});

test("invalid optional review detail does not hide already verified platform statistics", () => {
  const data = fixture("a", { insights: [{ title: "不完整观察", evidence: [] }] });
  assert.equal(read(data).score, 4.18);
});
