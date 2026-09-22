import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { dump } from "js-yaml";
import {
  COMPANY_FIT_DIMENSIONS,
  LEGACY_COMPANY_FIT_DIMENSIONS,
  buildCompanyOverviews,
  companyFitDimensions,
  resolveCompanyOverview,
  validateCompanyOverviewNotes,
} from "../lib/company-overview.ts";

function note(path, frontmatter, content = "# 株式会社テスト — データ基盤") {
  return { path, frontmatter, content, tags: [], stat: { ctime: 0, mtime: 0, size: content.length } };
}

const source = () => ({ label: "公开资料", url: "https://example.com/company" });
const fact = (id, value, scope = "单体") => ({ id, label: id === "employees" ? "员工规模" : id,
  value, as_of: "2026-09-01", scope, sources: [source()] });
const review = (overrides = {}) => ({ platform: "评论平台", url: "https://example.com/reviews", status: "available",
  score: 3.5, scale: 5, sample_count: 8, comment_period: "2024～2026年", coverage: "不同部门混合",
  positive: ["团队支持"], negative: ["部门差异"], read_on: "2026-09-19", limitations: "样本有限", ...overrides });

function fixture() {
  const dossier = note("20_求職/测试/_公司.md", { type: "company", company: "株式会社テスト", company_profile: {
    version: 1, updated_on: "2026-09-19", facts: [fact("employees", "约100人")], reviews: [review()],
  } });
  const context = note("20_求職/测试/案件.md", { type: "job-case", company: "株式会社テスト", case_id: "test-data",
    company_dossier: "[[20_求職/测试/_公司]]", fit_assessment: "[[80_AI分析/契合评价]]", rating: 9.5 });
  const report = note("80_AI分析/契合评价.md", { type: "ai-report", report_kind: "company-fit", schema_version: 1,
    criteria_version: 1, assessed_on: "2026-09-19", ai_author: "Codex", case: "[[20_求職/测试/案件]]",
    company_dossier: "[[20_求職/测试/_公司]]", fit_assessment: {
      summary: "经验可迁移，具体职责待确认", strengths: ["有系统开发经验"], questions: ["实际分工是什么"],
      dimensions: Object.fromEntries(LEGACY_COMPANY_FIT_DIMENSIONS.map(({ key }) => [key, {
        score: key === "experience" ? 4 : null, rationale: key === "experience" ? "既有经验对应所需任务" : "公开资料不够具体",
        evidence: key === "experience" ? [source(), { label: "本人经历", wiki: "[[10_关于我/经历#项目]]" }] : [],
        unknowns: key === "experience" ? [] : ["面谈确认实际分工"],
      }])), context_facts: [fact("salary", "公开求人范围；根据职责协商", "当前岗位")],
    } });
  const candidate = note("10_关于我/经历.md", { type: "material" }, "# 经历\n\n## 项目\n\n事实。\n");
  const prep = note("20_求職/测试/旧准备.md", { type: "interview-prep", company: "株式会社テスト", case: "[[20_求職/测试/案件]]",
    company_dossier: "[[20_求職/测试/_公司]]", date: "2026-08-01" }, "# 历史准备\n\n旧正文保持。\n");
  return { dossier, context, report, candidate, prep, notes: [dossier, context, report, candidate, prep] };
}

test("最新画像有明确来源和六维，旧准备读取最新正本且正文不变", () => {
  const { notes, prep, report } = fixture();
  const before = prep.content;
  assert.deepEqual(validateCompanyOverviewNotes(notes), []);
  const entry = resolveCompanyOverview(notes, prep);
  assert.equal(entry.key, "case:20_求職/测试/案件.md");
  assert.equal(entry.title, "データ基盤");
  assert.equal(entry.profile.updatedOn, "2026-09-19");
  assert.equal(entry.assessment.note.path, report.path);
  assert.equal(entry.assessment.criteriaVersion, 1);
  assert.deepEqual(entry.assessment.dimensions.map((dimension) => dimension.key), LEGACY_COMPANY_FIT_DIMENSIONS.map(({ key }) => key));
  assert.equal(entry.assessment.dimensions[0].score, 4);
  assert.ok(entry.assessment.dimensions.slice(1).every((dimension) => dimension.score === null));
  assert.equal(entry.assessment.contextFacts[0].id, "salary");
  assert.equal(entry.profile.reviews[0].sampleCount, 8);
  assert.equal(prep.content, before);
});

function applyCurrentCriteria(report) {
  report.frontmatter.criteria_version = 2;
  report.frontmatter.fit_assessment.dimensions = Object.fromEntries(COMPANY_FIT_DIMENSIONS.map(({ key }) => [key, {
    score: key === "practical" ? null : 4,
    rationale: key === "practical" ? "求人尚未披露工作地点与方式" : "求人明确任务与本人经历相符",
    evidence: key === "practical" ? [] : [source(), { label: "本人经历", wiki: "[[10_关于我/经历#项目]]" }],
    unknowns: key === "practical" ? ["公开工作条件尚未取得"] : ["入社后的具体配属另在面谈确认"],
  }]));
}

test("新版六维按面试前已知资料评分，执行层面的待确认事项不自动清空分数", () => {
  const { notes, context, report } = fixture();
  applyCurrentCriteria(report);
  assert.deepEqual(validateCompanyOverviewNotes(notes), []);
  const assessment = resolveCompanyOverview(notes, context).assessment;
  assert.equal(assessment.criteriaVersion, 2);
  assert.deepEqual(assessment.dimensions.map(({ key, label }) => [key, label]), [
    ["technical", "技术匹配"], ["experience", "经验发挥"], ["business", "业务方向"],
    ["role", "职责方向"], ["growth", "成长方向"], ["practical", "已知条件"],
  ]);
  assert.deepEqual(assessment.dimensions.map(({ score }) => score), [4, 4, 4, 4, 4, null]);
  assert.deepEqual(companyFitDimensions(1), LEGACY_COMPANY_FIT_DIMENSIONS);
  assert.deepEqual(companyFitDimensions(2), COMPANY_FIT_DIMENSIONS);
});

test("同日新版报告独立引用，旧版标签和分数不自动迁移", () => {
  const { notes, context, report } = fixture();
  const oldData = JSON.stringify(report);
  const newer = structuredClone(report);
  newer.path = "80_AI分析/契合评价_v2.md";
  applyCurrentCriteria(newer);
  notes.push(newer);
  let assessment = resolveCompanyOverview(notes, context).assessment;
  assert.equal(assessment.criteriaVersion, 1);
  assert.equal(assessment.dimensions.find(({ key }) => key === "growth").label, "成长空间");
  assert.equal(assessment.dimensions.find(({ key }) => key === "growth").score, null);
  assert.ok(!assessment.dimensions.some(({ key }) => key === "technical"));
  context.frontmatter.fit_assessment = "[[80_AI分析/契合评价_v2]]";
  assessment = resolveCompanyOverview(notes, context).assessment;
  assert.equal(assessment.criteriaVersion, 2);
  assert.equal(assessment.dimensions.find(({ key }) => key === "growth").label, "成长方向");
  assert.equal(assessment.dimensions.find(({ key }) => key === "growth").score, 4);
  assert.equal(JSON.stringify(report), oldData);
  assert.deepEqual(validateCompanyOverviewNotes(notes), []);
});

test("报告版本必须对应原本六轴，不能直接换版本把旧分冒充新分", () => {
  for (const [from, to, unexpected] of [[1, 2, "autonomy"], [2, 1, "technical"]]) {
    const { notes, context, report } = fixture();
    if (from === 2) applyCurrentCriteria(report);
    report.frontmatter.criteria_version = to;
    assert.equal(resolveCompanyOverview(notes, context).assessmentStatus, "invalid");
    assert.match(validateCompanyOverviewNotes(notes).join("\n"), new RegExp(`criteria_version: ${to} 不支持 ${unexpected}`));
  }
});

test("新版评分仍需证据与理由，未知公开资料仍可保留null但须交代缺口", () => {
  const mutations = [
    ["有分数时必须有证据", (dimensions) => { dimensions.technical.evidence = []; }],
    ["rationale 必填", (dimensions) => { dimensions.role.rationale = ""; }],
    ["未评分时必须说明待确认事项", (dimensions) => { dimensions.practical.unknowns = []; }],
    ["1～5", (dimensions) => { dimensions.practical.score = 0; }],
  ];
  for (const [expected, mutate] of mutations) {
    const { notes, context, report } = fixture();
    applyCurrentCriteria(report);
    mutate(report.frontmatter.fit_assessment.dimensions);
    assert.equal(resolveCompanyOverview(notes, context).assessment, null);
    assert.match(validateCompanyOverviewNotes(notes).join("\n"), new RegExp(expected));
  }
});

test("同公司不同岗位保留不同key；没有报告时绝不使用旧rating", () => {
  const { notes, context } = fixture();
  const other = note("20_求職/测试/另一个岗位.md", { ...context.frontmatter, case_id: "test-other", fit_assessment: undefined, rating: 10 }, "# 株式会社テスト — アプリ開発");
  notes.push(other);
  const entries = buildCompanyOverviews(notes);
  assert.equal(entries.length, 2);
  assert.notEqual(entries[0].key, entries[1].key);
  assert.equal(entries[1].assessment, null);
  assert.equal(entries[1].assessmentStatus, "missing");
  assert.equal(entries[1].profile.facts[0].value, "约100人");
});

test("真实面谈todo没有准备稿也可显示，不需要伪造job-case", () => {
  const { notes, context, report } = fixture();
  context.frontmatter.type = "todo";
  context.frontmatter.category = "面接準備";
  context.frontmatter.meeting_topic = "担当範囲の情報交換";
  delete context.frontmatter.case_id;
  report.frontmatter.meeting = report.frontmatter.case;
  delete report.frontmatter.case;
  const withoutPrep = notes.filter((entry) => entry.frontmatter.type !== "interview-prep");
  const entry = resolveCompanyOverview(withoutPrep, context.path);
  assert.equal(entry.kind, "meeting");
  assert.equal(entry.title, "担当範囲の情報交換");
  assert.equal(entry.assessmentStatus, "available");
  assert.deepEqual(validateCompanyOverviewNotes(withoutPrep), []);
});

test("没有公司链接时可用同一显式context旧准备的卷宗；错链接不降级猜测", () => {
  const { notes, context } = fixture();
  delete context.frontmatter.company_dossier;
  assert.equal(resolveCompanyOverview(notes, context).profileStatus, "available");
  context.frontmatter.company_dossier = "[[不存在]]";
  assert.equal(resolveCompanyOverview(notes, context).profileStatus, "invalid");
  assert.equal(resolveCompanyOverview(notes, context).profile, null);
  assert.match(validateCompanyOverviewNotes(notes).join("\n"), /引用不存在或同名歧义/);
});

test("同名短引用或多个context拒绝消歧，不能仅靠公司和日期匹配", () => {
  const { notes, context, prep } = fixture();
  notes.push(note("20_求職/另处/案件.md", { ...context.frontmatter, fit_assessment: undefined }));
  prep.frontmatter.case = "[[案件]]";
  assert.equal(resolveCompanyOverview(notes, prep), null);
  prep.frontmatter.case = "[[20_求職/测试/案件]]";
  prep.frontmatter.meeting = "[[其他面谈]]";
  assert.equal(resolveCompanyOverview(notes, prep), null);
  delete prep.frontmatter.case;
  delete prep.frontmatter.meeting;
  assert.equal(resolveCompanyOverview(notes, prep), null);
});

test("评分缺证据、理由、作者或版本错误，整体报告显示缺失并报错", () => {
  const mutations = [
    ["证据", (r) => { r.fit_assessment.dimensions.experience.evidence = []; }],
    ["rationale", (r) => { r.fit_assessment.dimensions.experience.rationale = ""; }],
    ["ai_author", (r) => { r.ai_author = "AI"; }],
    ["schema_version", (r) => { r.schema_version = 2; }],
    ["criteria_version", (r) => { r.criteria_version = 3; }],
    ["assessed_on", (r) => { r.assessed_on = "2026-02-30"; }],
    ["1～5", (r) => { r.fit_assessment.dimensions.experience.score = 0; }],
    ["1～5", (r) => { r.fit_assessment.dimensions.experience.score = "4"; }],
    ["明确 null", (r) => { delete r.fit_assessment.dimensions.business.score; }],
    ["待确认", (r) => { r.fit_assessment.dimensions.business.unknowns = []; }],
    ["不存在", (r) => { r.fit_assessment.dimensions.experience.evidence[1].wiki = "[[丢失经历]]"; }],
  ];
  for (const [expected, mutate] of mutations) {
    const { notes, report, context } = fixture();
    mutate(report.frontmatter);
    const entry = resolveCompanyOverview(notes, context);
    assert.equal(entry.assessment, null, expected);
    assert.equal(entry.assessmentStatus, "invalid", expected);
    assert.match(validateCompanyOverviewNotes(notes).join("\n"), new RegExp(expected));
  }
});

test("引用另一岗位或不同公司卷宗的评价时不能复用评分", () => {
  const { notes, context, report } = fixture();
  const other = note("20_求職/测试/另一岗位.md", { type: "job-case", company: "株式会社テスト" });
  notes.push(other);
  report.frontmatter.case = "[[20_求職/测试/另一岗位]]";
  assert.equal(resolveCompanyOverview(notes, context).assessment, null);
  assert.match(validateCompanyOverviewNotes(notes).join("\n"), /与当前正本不符/);
  report.frontmatter.case = "[[20_求職/测试/案件]]";
  const otherDossier = note("20_求職/另处/_公司.md", { type: "company" });
  notes.push(otherDossier);
  report.frontmatter.company_dossier = "[[20_求職/另处/_公司]]";
  assert.equal(resolveCompanyOverview(notes, context).assessment, null);
  assert.match(validateCompanyOverviewNotes(notes).join("\n"), /company_dossier 与当前正本不符/);
});

test("人数不同口径分开保留，口碑保留各平台量尺和受限状态", () => {
  const { notes, dossier, context } = fixture();
  dossier.frontmatter.company_profile.facts.push(fact("employees_group", "约500人", "集团；官方日期较旧"));
  dossier.frontmatter.company_profile.reviews.push(review({ platform: "另一平台", score: 65, scale: 100, sample_count: null, status: "restricted", limitations: "仅页面总分可见，正文受限", positive: [], negative: [] }));
  const entry = resolveCompanyOverview(notes, context);
  assert.equal(entry.profile.facts.length, 2);
  assert.deepEqual(entry.profile.facts.map((f) => f.scope), ["单体", "集团；官方日期较旧"]);
  assert.deepEqual(entry.profile.reviews.map((r) => [r.score, r.scale, r.sampleCount]), [[3.5, 5, 8], [65, 100, null]]);
  assert.equal(entry.profile.reviews[1].status, "restricted");
});

test("未调查/没找到资料允许无URL，不虚构平台页；不得附加假评分与评论主题", () => {
  for (const status of ["not_researched", "no_samples"]) {
    const { notes, dossier, context } = fixture();
    dossier.frontmatter.company_profile.reviews = [review({ platform: "公开员工口碑", status, url: "", score: null, scale: null,
      sample_count: null, positive: [], negative: [], comment_period: "未取得", coverage: "未取得", limitations: "没有取得可核验样本；不代表没有评论" })];
    assert.deepEqual(validateCompanyOverviewNotes(notes), []);
    assert.equal(resolveCompanyOverview(notes, context).profile.reviews[0].score, null);
    dossier.frontmatter.company_profile.reviews[0].positive = ["想象中的优点"];
    assert.match(validateCompanyOverviewNotes(notes).join("\n"), /不可写评价主题/);
  }
});

test("vault-check实际读取结构化YAML，兼容两版评价口径且坏数据会阻断", async (t) => {
  const { context, dossier, report, candidate } = fixture();
  context.frontmatter = { type: "todo", company: "株式会社テスト", category: "面接準備", status: "未着手", priority: "medium", audience: "user",
    action: "确认分工", company_dossier: "[[20_求職/测试/_公司]]", fit_assessment: "[[80_AI分析/契合评价]]" };
  report.frontmatter.meeting = report.frontmatter.case;
  delete report.frontmatter.case;
  const root = await mkdtemp(join(tmpdir(), "company-overview-vault-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const persist = async (entry) => {
    const path = join(root, entry.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `---\n${dump(entry.frontmatter, { lineWidth: -1 })}---\n${entry.content}`);
  };
  for (const entry of [context, dossier, report, candidate]) await persist(entry);
  const check = () => spawnSync(process.execPath, ["scripts/vault-check.mjs"], { encoding: "utf8", env: { ...process.env, OBSIDIAN_VAULT_PATH: root } });
  let checked = check();
  assert.equal(checked.status, 0, `${checked.stdout}${checked.stderr}`);
  applyCurrentCriteria(report);
  await persist(report);
  checked = check();
  assert.equal(checked.status, 0, `${checked.stdout}${checked.stderr}`);
  report.frontmatter.fit_assessment.dimensions.experience.evidence = [];
  await persist(report);
  checked = check();
  assert.notEqual(checked.status, 0);
  assert.match(`${checked.stdout}${checked.stderr}`, /有分数时必须有证据/);
});
