import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildGraduateCatalog,
  buildGraduateReadModelRecords,
  graduateAssessmentScore,
  graduateCatalogEntries,
  graduateBand,
  graduateDateLabel,
  graduateDeviationRange,
  graduateLocationFromSearch,
  graduateManYen,
  graduateNoteSections,
  graduateSearch,
  graduateStepState,
  graduateTotalFee,
  GRADUATE_ASSESSMENT_RUBRIC,
  GRADUATE_RECORD_KIND,
  nextGraduateDeadline,
  nextGraduateEvent,
  overdueGraduatePrerequisites,
  parseGraduateReference,
  parseGraduateSchool,
  sortGraduateEntries,
} from "../lib/graduate.ts";
import { includePublishedNote } from "../lib/vault-boundary.mjs";
import { buildApplicationReadModel } from "../scripts/read-model-source.mjs";
import { writeReadModelAssets } from "../scripts/read-model-published.mjs";
import { createReadModel } from "../lib/server/read-model.ts";
import { database } from "./read-model-db.mjs";
import { loadAppModule } from "./helpers/render-tsx.mjs";

// 学校名一律虚构：仓库公开，本人在看哪些学校属于个人事实。
const masterSteps = () => [
  { id: "consult", kind: "prerequisite", label: "事前協議申込", label_zh: "联系导师确认报名资格", due: "2026-11-30", deadline_type: "必着",
    materials: [{ label: "事前協議申込書", url: "https://example.test/consult.pdf" }, { label: "研究計画書", url: "https://example.test/plan.pdf" }, { label: "履歴票" }] },
  { id: "homeroom", kind: "prerequisite", label: "向语言学校担任报备" },
  { id: "apply", kind: "application", label: "正式出願", start: "2027-01-08", due: "2027-01-15", deadline_type: "必着" },
  { id: "exam", kind: "exam", label: "入学試験", on: "2027-02-20" },
];
const route = (id, track, overrides = {}) => ({
  id, label: `${id} の正式名称`, label_zh: `${id} 中文名`, track, degree: track === "master" ? "修士（工学）" : "学士（工学）",
  years: track === "master" ? 2 : 3, entry: "2027年4月", exams: ["小論文（60分）", "面接"],
  fees: { first_year: 1001430, annual: 789000, basis: "テスト用の学費表" }, steps: masterSteps(), ...overrides,
});
const school = ({ path = "40_大学院/テスト工科大学.md", id = "test-tech", sort = 1, routes = [route("test-master", "master"), route("test-bachelor", "bachelor")], content, ...frontmatter } = {}) => ({
  path, stat: { ctime: 1, mtime: 1, size: 1 }, tags: [],
  frontmatter: { type: "graduate-school", schema_version: 1, publish: false, school_id: id, school: "テスト工科大学", school_zh: "测试工科大学",
    sort, region: "tokyo", location: "東京都・テスト校舎", checked_on: "2026-11-13", indicators: [{ kind: "ranking", label: "テストランキング2025", value: "201+", scope: "2025年発表・大学全体", url: "https://example.test/rank" }], routes, ...frontmatter },
  content: content ?? `---\ntype: graduate-school\n---\n# テスト工科大学\n\n> 导语\n\n## 学校口径\n\n- 排名说明\n\n${routes.map((item) => `## ${item.label}\n\n### 出愿资格与匹配\n\n资格段落\n\n### 出愿与材料\n\n材料段落\n`).join("\n")}\n## 出处\n\n- [要项](https://example.test/guide.pdf)\n`,
});
const level = { focus: "情報学部", focus_low: 37.5, focus_high: 37.5, school_low: 35, school_high: 45, url: "https://example.test/border" };
const institution = { kind: "private", registry_url: "https://example.test/registry" };
const referenceNote = (frontmatter = {}) => ({
  path: "40_大学院/层次对照.md", stat: { ctime: 1, mtime: 1, size: 1 }, tags: [], content: "# 对照\n",
  frontmatter: { type: "graduate-reference", publish: false, checked_on: "2026-11-13", source_label: "测试偏差值", source_url: "https://example.test/rank", analogy_author: "Claude",
    bands: [{ min: 60, label: "难关", analogy: "类比甲" }, { min: 42.5, label: "中段", analogy: "类比乙" }, { min: 37.5, label: "中下", analogy: "类比丙" }, { min: 35, label: "低门槛", analogy: "类比丁" }],
    anchors: [{ name: "参照工业大学", note: "私立 · 工学部", low: 42.5, high: 62.5, url: "https://example.test/a" }],
    notes: ["35.0 即 37.4 以下", "修士入学不看偏差值"], ...frontmatter },
});
const prepNote = (path = "40_大学院/テスト工科大学_備考.md") => ({
  path, stat: { ctime: 1, mtime: 1, size: 1 }, tags: [],
  frontmatter: { type: "graduate-prep", publish: false, route: "test-master", source_note: "[[テスト工科大学]]" },
  content: "# 备考\n\n## 2026 年度小论文真题\n\n600 字以上 800 字以内。\n",
});
const assessment = (overrides = {}) => ({
  author: "Codex", assessed_on: "2026-11-15", scores: { exam: 30, fit: 24, readiness: 18, value: 7 }, recommendation: "consider",
  summary_zh: "值得申请，需先确定研究方向", strengths_zh: "既有项目经验可以支持研究计划", risk_zh: "须先获得导师同意",
  sources: [{ label: "测试募集要项", url: "https://example.test/admission.pdf" }], ...overrides,
});

test("东京筛选只列标为入选的修士，其他筛选保留学校和路线", () => {
  const second = school({ path: "40_大学院/サンプル大学.md", id: "sample-u", sort: 2, routes: [route("sample-master", "master", { shortlist: "tokyo-social-2027", fees: undefined }), route("sample-first", "bachelor"), route("sample-second", "bachelor")] });
  const catalog = buildGraduateCatalog([second, school()]);
  assert.deepEqual(catalog.issues, []);
  assert.deepEqual(graduateCatalogEntries(catalog, "master").map(({ route }) => route.id), ["test-master", "sample-master"]);
  assert.deepEqual(graduateCatalogEntries(catalog, "tokyo").map(({ route }) => route.id), ["sample-master"]);
  assert.equal(catalog.schools[1].routes[0].fees, undefined);
  assert.equal(graduateCatalogEntries(catalog, "bachelor").length, 3);
  assert.equal(graduateCatalogEntries(catalog, "all").length, 5);
  assert.equal(catalog.schools[0].id, "test-tech", "sort 小的在前");
  // 目录只带比较用的精简字段，材料链接和说明随正文按需读取。
  const step = catalog.schools[0].routes[0].steps[0];
  assert.equal("materials" in step, false);
  assert.equal("basis" in catalog.schools[0].routes[0].fees, false);
});

test("地区独立于学位筛选，东京修士仍须满足原名单标记", () => {
  const tokyo = school({ routes: [route("test-listed", "master", { shortlist: "tokyo-social-2027" }), route("test-unlisted", "master"), route("test-bachelor", "bachelor")] });
  const outside = school({ id: "outside-u", path: "40_大学院/郊外テスト大学.md", region: "kanagawa", routes: [route("outside-master", "master", { shortlist: "tokyo-social-2027" })] });
  const catalog = buildGraduateCatalog([tokyo, outside]);
  assert.deepEqual(graduateCatalogEntries(catalog, "master", "tokyo").map(({ route }) => route.id), ["test-listed"]);
  assert.deepEqual(graduateCatalogEntries(catalog, "all", "tokyo").map(({ route }) => route.id), ["test-listed", "test-bachelor"]);
  assert.deepEqual(graduateCatalogEntries(catalog, "bachelor", "tokyo").map(({ route }) => route.id), ["test-bachelor"]);
  assert.equal(graduateCatalogEntries(catalog, "master", "all").length, 3);
  assert.equal(graduateCatalogEntries(catalog, "all", "all").length, 4);
  assert.equal(catalog.schools.find((item) => item.id === "outside-u").region, "kanagawa");
  assert.equal(catalog.schools.find((item) => item.id === "test-tech").location, "東京都・テスト校舎");
});

test("适合度由分项合成，目录保留判断与署名，出处随详情读取", () => {
  const note = school({ routes: [route("test-master", "master", { assessment: assessment() })] });
  const full = parseGraduateSchool(note);
  assert.deepEqual(full.issues, []);
  const parsed = full.school.routes[0].assessment;
  assert.equal(graduateAssessmentScore(parsed), 79);
  assert.equal(GRADUATE_ASSESSMENT_RUBRIC.reduce((sum, part) => sum + part.max, 0), 100);
  assert.equal(parsed.assessedOn, "2026-11-15");
  assert.deepEqual(parsed.sources, assessment().sources);
  const catalog = buildGraduateCatalog([note]);
  const compact = catalog.schools[0].routes[0].assessment;
  assert.equal(graduateAssessmentScore(compact), 79);
  assert.equal(compact.author, "Codex");
  assert.equal(compact.summaryZh, assessment().summary_zh);
  assert.equal(compact.riskZh, assessment().risk_zh);
  assert.equal("sources" in compact, false);
  assert.equal("score" in compact, false, "总分不另存一份");
  assert.equal(parseGraduateSchool(school()).school.routes[0].assessment, undefined, "旧笔记未评分仍可读取");
  assert.equal(graduateAssessmentScore(undefined), null, "未评分不能冒充零分");
});

test("适合度缺分项、超范围、非整数或没有判断依据时拒收", () => {
  const invalid = [
    { scores: { exam: 41, fit: 30, readiness: 20, value: 10 } },
    { scores: { exam: 40, fit: 31, readiness: 20, value: 10 } },
    { scores: { exam: 40, fit: 30, readiness: 21, value: 10 } },
    { scores: { exam: 40, fit: 30, readiness: 20, value: 11 } },
    { scores: { exam: -1, fit: 30, readiness: 20, value: 10 } },
    { scores: { exam: 25.5, fit: 30, readiness: 20, value: 10 } },
    { scores: { exam: 40, fit: 30, value: 10 } },
    { assessed_on: "2026-02-30" }, { author: "AI" }, { recommendation: "guaranteed" },
    { summary_zh: "" }, { strengths_zh: "" }, { risk_zh: "" },
    { sources: [{ label: "没有可靠地址", url: "javascript:alert(1)" }] },
  ];
  for (const fields of invalid) {
    const note = school({ routes: [route("test-master", "master", { assessment: assessment(fields) })] });
    const parsed = parseGraduateSchool(note);
    assert.equal(parsed.school, null, JSON.stringify(fields));
    assert.ok(parsed.issues.some((issue) => issue.includes("assessment")));
    assert.equal(buildGraduateCatalog([note]).schools.length, 0);
    if (fields.scores) assert.equal(graduateAssessmentScore({ scores: fields.scores }), null);
  }
});

test("适合度排序先高分再近期截止，未知分数靠后，期限排序独立且不改原数组", () => {
  const application = (due) => due ? [{ id: "apply", kind: "application", label: "出願", due, deadline_type: "必着" }] : [];
  const scored = (id, scores, due) => route(id, "master", { assessment: assessment({ scores }), steps: application(due) });
  const high = { exam: 40, fit: 25, readiness: 20, value: 5 };
  const catalog = buildGraduateCatalog([school({ routes: [
    route("unknown", "master", { steps: application("2026-11-16") }),
    scored("zero", { exam: 0, fit: 0, readiness: 0, value: 0 }, "2026-11-17"),
    scored("high-later", high, "2026-12-01"),
    scored("high-sooner", high, "2026-11-25"),
    scored("high-same", high, "2026-11-25"),
  ] })]);
  const entries = graduateCatalogEntries(catalog, "all");
  const before = entries.map(({ route }) => route.id);
  assert.deepEqual(sortGraduateEntries(entries, "2026-11-15").map(({ route }) => route.id), ["high-sooner", "high-same", "high-later", "zero", "unknown"]);
  assert.deepEqual(sortGraduateEntries(entries, "2026-11-15", "deadline").map(({ route }) => route.id), ["unknown", "zero", "high-sooner", "high-same", "high-later"]);
  assert.deepEqual(entries.map(({ route }) => route.id), before);
  const closed = { ...entries[0], route: { ...entries[0].route, steps: [] } };
  assert.equal(sortGraduateEntries([closed, entries[1]], "2026-11-15", "deadline").at(-1), closed, "没有可办截止日的排末尾");
});

test("学费只存整数日元，毕业前合计由首年加之后每年算出", () => {
  assert.equal(graduateTotalFee({ years: 2, fees: { firstYear: 1001430, annual: 789000 } }), 1790430);
  assert.equal(graduateManYen(1790430), "179.0");
  assert.equal(graduateManYen(graduateTotalFee({ years: 3, fees: { firstYear: 1723620, annual: 1457000 } })), "463.8");
  assert.equal(graduateManYen(graduateTotalFee({ years: 4, fees: { firstYear: 1629660, annual: 1405000 } })), "584.5");
  assert.equal(graduateTotalFee({ years: 1, fees: { firstYear: 500000, annual: 999999 } }), 500000, "一年制不加之后的学费");
  const { issues } = parseGraduateSchool(school({ routes: [route("test-master", "master", { fees: { first_year: "約100万", annual: 1.5 } })] }));
  assert.ok(issues.some((issue) => issue.includes("first_year は円の整数")));
  assert.ok(issues.some((issue) => issue.includes("annual は円の整数")));
});

test("下一道截止按 JST 日历日比较：当天仍算、办完或过期的不算", () => {
  const steps = buildGraduateCatalog([school()]).schools[0].routes[0].steps;
  assert.equal(nextGraduateDeadline(steps, "2026-11-13")?.id, "consult");
  assert.equal(nextGraduateDeadline(steps, "2026-11-30")?.id, "consult", "必着日当天还没过");
  assert.equal(nextGraduateDeadline(steps, "2026-12-01")?.id, "apply");
  assert.equal(nextGraduateDeadline(steps, "2027-01-16"), null);
  assert.equal(nextGraduateEvent(steps, "2027-01-16")?.id, "exam", "没有截止时退到下一项日程");
  const done = buildGraduateCatalog([school({ routes: [route("test-master", "master", { steps: masterSteps().map((step) => step.id === "consult" ? { ...step, done_on: "2026-11-20" } : step) })] })]).schools[0].routes[0].steps;
  assert.equal(nextGraduateDeadline(done, "2026-11-13")?.id, "apply");
});

test("必需的前置手续过期且无完成记录时才提示；可选或已完成的不提示", () => {
  const withOptional = [...masterSteps(), { id: "credit", kind: "prerequisite", optional: true, label: "认定单位确认", due: "2026-11-01", deadline_type: "必着" }];
  const steps = buildGraduateCatalog([school({ routes: [route("test-master", "master", { steps: withOptional })] })]).schools[0].routes[0].steps;
  assert.deepEqual(overdueGraduatePrerequisites(steps, "2026-11-30").map((step) => step.id), []);
  assert.deepEqual(overdueGraduatePrerequisites(steps, "2026-12-01").map((step) => step.id), ["consult"]);
  const doneSteps = steps.map((step) => step.id === "consult" ? { ...step, doneOn: "2026-11-28" } : step);
  assert.deepEqual(overdueGraduatePrerequisites(doneSteps, "2026-12-01"), []);
  // 出愿步骤过期不是「前置手续缺口」：另一批次还可以报。
  assert.deepEqual(overdueGraduatePrerequisites(steps, "2027-01-20").map((step) => step.id), ["consult"]);
});

test("时间轴状态：无校方日期、未开始、进行中、已过、已完成", () => {
  const [consult, homeroom, apply] = buildGraduateCatalog([school()]).schools[0].routes[0].steps;
  assert.equal(graduateStepState(homeroom, "2026-11-13"), "undated");
  assert.equal(graduateStepState(apply, "2026-11-13"), "upcoming");
  assert.equal(graduateStepState(apply, "2027-01-10"), "open");
  assert.equal(graduateStepState(consult, "2026-11-13"), "open", "只有截止日的手续在截止前都可办");
  assert.equal(graduateStepState(consult, "2026-12-01"), "closed");
  assert.equal(graduateStepState({ ...consult, doneOn: "2026-11-20" }, "2026-12-01"), "done");
});

test("坏日期、缺必着／消印有効、未标 publish: false 的卷宗被拒收并说明原因", () => {
  const broken = school({ publish: true, checked_on: "2026/11/13", routes: [route("test-master", "master", { steps: [
    { id: "consult", kind: "prerequisite", label: "事前協議", due: "2026-02-30", deadline_type: "必着" },
    { id: "apply", kind: "application", label: "出願", due: "2027-01-15" },
    { id: "apply", kind: "application", label: "重复", due: "2027-01-15", deadline_type: "書留" },
    { id: "wrong", kind: "interview", label: "未知种类" },
    { id: "range", kind: "application", label: "倒序", start: "2027-01-20", due: "2027-01-15", deadline_type: "消印有効" },
  ] })] });
  const { school: parsed, issues } = parseGraduateSchool(broken);
  assert.equal(parsed, null);
  for (const expected of ["publish: false が必須", "checked_on", "due は \"YYYY-MM-DD\" の実在日付", "deadline_type（必着・消印有効など）が無い",
    "deadline_type は 必着 / 消印有効 / 期限内必着", "kind は prerequisite", "id「apply」が重複", "start 2027-01-20 が due 2027-01-15 より後"]) {
    assert.ok(issues.some((issue) => issue.includes(expected)), `缺少问题：${expected}\n${issues.join("\n")}`);
  }
  const catalog = buildGraduateCatalog([broken]);
  assert.equal(catalog.schools.length, 0);
  assert.ok(catalog.issues.every((issue) => issue.path === broken.path));
});

test("学校与路线 id 全库唯一，备考双链解析到唯一的备考笔记", () => {
  const twin = school({ path: "40_大学院/重复学校.md" });
  const catalog = buildGraduateCatalog([school({ routes: [route("test-master", "master", { prep: "[[テスト工科大学_備考]]" })] }), prepNote(), twin]);
  assert.equal(catalog.schools.length, 1);
  assert.equal(catalog.schools[0].routes[0].prepPath, "40_大学院/テスト工科大学_備考.md");
  assert.ok(catalog.issues.some((issue) => issue.path === twin.path && issue.message.includes("school_id「test-tech」")));
  const missing = buildGraduateCatalog([school({ routes: [route("test-master", "master", { prep: "[[不存在的备考]]" })] })]);
  assert.ok(missing.issues.some((issue) => issue.message.includes("[[不存在的备考]]")));
  const loosePrep = buildGraduateCatalog([school(), { ...prepNote(), frontmatter: { type: "graduate-prep" } }]);
  assert.ok(loosePrep.issues.some((issue) => issue.message.includes("publish: false")));
});

test("正文按路线标题切出小节，导语、学校口径和出处归学校，代码块里的标题不切", () => {
  const content = "---\ntype: graduate-school\n---\n# 学校\n\n> 核对日\n\n## 学校口径\n\n口径\n\n## 路线甲\n\n### 出愿与材料\n\n```md\n## 不是标题\n### 也不是\n```\n\n### 学位与费用\n\n费用\n\n## 出处\n\n- 来源\n";
  const sections = graduateNoteSections(content, ["路线甲"]);
  assert.deepEqual([...sections.school.keys()], ["", "学校口径", "出处"]);
  assert.equal(sections.school.get(""), "> 核对日");
  assert.deepEqual([...sections.routes.get("路线甲").keys()], ["出愿与材料", "学位与费用"]);
  assert.match(sections.routes.get("路线甲").get("出愿与材料"), /## 不是标题/);
});

test("稳定链接区分学位与地区：旧东京和全部链接保留原有范围", () => {
  assert.deepEqual(graduateLocationFromSearch(""), { track: "master", region: "tokyo", school: "", route: "" });
  assert.deepEqual(graduateLocationFromSearch("?track=tokyo"), { track: "master", region: "tokyo", school: "", route: "" });
  assert.deepEqual(graduateLocationFromSearch("?track=all&school=test-tech&route=test-master"), { track: "all", region: "all", school: "test-tech", route: "test-master" });
  assert.deepEqual(graduateLocationFromSearch("?track=phd&school=../x"), { track: "master", region: "tokyo", school: "", route: "" }, "认不出的值回到默认");
  assert.equal(graduateLocationFromSearch("?track=master").region, "all", "旧修士链接保留东京以外的学校");
  assert.equal(graduateLocationFromSearch("?track=bachelor&region=tokyo").region, "tokyo");
  assert.equal(graduateSearch({ track: "master", region: "tokyo", school: "", route: "" }, "note=a.md&track=all&region=all").toString(), "note=a.md");
  assert.equal(graduateSearch({ track: "bachelor", region: "all", school: "test-tech", route: "test-bachelor" }).toString(), "track=bachelor&region=all&school=test-tech&route=test-bachelor");
  assert.equal(graduateSearch({ track: "all", region: "all", school: "", route: "stale" }).toString(), "track=all&region=all", "没有学校时不留路线");
  for (const track of ["master", "bachelor", "all"]) {
    for (const region of ["tokyo", "all"]) {
      const location = { track, region, school: "test-tech", route: "test-master" };
      assert.deepEqual(graduateLocationFromSearch(graduateSearch(location).toString()), location);
    }
  }
});

test("日期标签带星期，同一年省略年份；不按本机时区换算", () => {
  assert.equal(graduateDateLabel("2026-11-30", "zh-CN", "2026-11-13"), "11/30（一）");
  assert.equal(graduateDateLabel("2027-01-15", "ja", "2026-11-13"), "2027/1/15（金）");
});

test("查询索引：候选表作为一条投影导入 D1 原样读回，招生期限不进日历", async (t) => {
  const notes = [school({ routes: [route("test-master", "master", { prep: "[[テスト工科大学_備考]]" })] }), prepNote()];
  const artifact = await buildApplicationReadModel(notes, "2026-11-13", "2026-11-13T00:00:00Z");
  const model = createReadModel(database(t).db);
  await model.importArtifact(artifact.manifest.revision, artifact);
  const stored = await model.readRecord(artifact.manifest.revision, GRADUATE_RECORD_KIND, "root");
  assert.deepEqual(stored, buildGraduateCatalog(notes));
  assert.deepEqual(buildGraduateReadModelRecords(notes).map(({ kind, key }) => [kind, key]), [[GRADUATE_RECORD_KIND, "root"]]);
  const calendar = await model.readRecord(artifact.manifest.revision, "calendar-catalog", "root");
  assert.deepEqual(calendar.events, [], "考试日、截止日只在大学院专区显示");
});

test("发布快照：publish: false 的大学院资料不进正文、目录和候选表投影", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "graduate-published-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const shared = { path: "30_資料/公开资料.md", stat: { ctime: 1, mtime: 1, size: 1 }, tags: [], frontmatter: { type: "material" }, content: "# 公开资料\n\n可以发布。" };
  const notes = [school(), prepNote(), referenceNote(), shared];
  assert.deepEqual(notes.filter(includePublishedNote).map((note) => note.path), [shared.path]);
  const index = await writeReadModelAssets(notes, directory, "2026-11-13T00:00:00Z");
  const read = async (file) => {
    const raw = await readFile(join(directory, file));
    return JSON.parse((file.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8"));
  };
  assert.deepEqual(Object.keys(await read(index.bodyIndexFile)), [shared.path]);
  const manifest = await read(index.manifestFile);
  const batches = await Promise.all(index.batches.map(read));
  assert.equal(batches.some((batch) => (batch.catalog ?? []).some((row) => row.path.startsWith("40_大学院/"))), false);
  const model = createReadModel(database(t).db);
  await model.importArtifact(manifest.revision, { manifest, batches });
  const catalog = await model.readRecord(manifest.revision, GRADUATE_RECORD_KIND, "root");
  assert.deepEqual(catalog, { schemaVersion: 1, schools: [], reference: null, issues: [] });
});

test("候选表显示学校参照档、办学性质和费用，换批次时同步切换截止日与放榜日", async () => {
  const { CandidateTable, GRADUATE_COPY } = await loadAppModule("app/graduate-view.tsx");
  const steps = [
    ...masterSteps().map((step) => ({ ...step, round: "1期" })),
    { id: "result-one", kind: "result", label: "第1期発表", round: "1期", on: "2027-03-08" },
    { id: "apply-two", kind: "application", label: "第2期出願", round: "2期", due: "2027-02-15", deadline_type: "必着" },
    { id: "result-two", kind: "result", label: "第2期発表", round: "2期", on: "2027-03-22" },
  ];
  const catalog = buildGraduateCatalog([school({ level, institution, routes: [route("test-master", "master", {
    shortlist: "tokyo-social-2027", steps, exams_zh: ["专业笔试", "面试"], requirements_zh: "事先联系导师", assessment: assessment(),
  })] }), referenceNote()]);
  const props = { entries: graduateCatalogEntries(catalog, "master", "tokyo"), reference: catalog.reference, track: "master", region: "tokyo", locale: "zh-CN", t: GRADUATE_COPY["zh-CN"], onOpen() {} };
  const html = renderToStaticMarkup(createElement(CandidateTable, { ...props, today: "2026-11-13" }));
  assert.equal((html.match(/<th scope="col"/g) ?? []).length, 7);
  assert.match(html, /学校与专业/);
  assert.match(html, /学校水平/);
  assert.match(html, /中下档/);
  assert.match(html, /本科偏差值 37\.5/);
  assert.match(html, /私立 · 文科省在册/);
  assert.match(html, /申请适合度与判断/);
  assert.match(html, /aria-label="申请适合度 79\/100"/);
  assert.match(html, /值得考虑/);
  assert.match(html, /须先获得导师同意/);
  assert.match(html, /aria-sort="descending"/);
  const renderedText = html.replace(/<[^>]+>/g, "");
  assert.match(renderedText, /首年 100\.1 万日元/);
  assert.match(renderedText, /全程约 179\.0 万日元/);
  assert.match(html, /专业笔试 · 面试/);
  assert.match(html, /主要材料 · 事先联系导师/);
  assert.match(html, /href="\/graduate\?school=test-tech&amp;route=test-master"/);
  for (const date of ["2026-11-30", "2027-03-08"]) assert.ok(html.includes(date), date);
  const late = renderToStaticMarkup(createElement(CandidateTable, { ...props, today: "2026-12-01" }));
  for (const date of ["2027-02-15", "2027-03-22"]) assert.ok(late.includes(date), date);
  assert.doesNotMatch(late, /2027-03-08/);
});

test("无本科的学校在候选表和对照图显示办学定位，保持本科数据为空", async () => {
  const { CandidateTable, LevelScale, GRADUATE_COPY } = await loadAppModule("app/graduate-view.tsx");
  const positioning = {
    label: "実務型大学院", label_zh: "实务型大学院", evidence: "分野別認証評価に適合", evidence_zh: "分野认证通过", url: "https://example.test/quality",
  };
  const verified = { ...institution, kind: "public", positioning };
  const catalog = buildGraduateCatalog([school({ institution: verified, graduate_only: true }), referenceNote()]);
  assert.deepEqual(catalog.issues, []);
  assert.equal(catalog.schools[0].level, undefined);
  const props = { reference: catalog.reference, locale: "zh-CN", t: GRADUATE_COPY["zh-CN"] };
  const table = renderToStaticMarkup(createElement(CandidateTable, {
    ...props, entries: graduateCatalogEntries(catalog, "master"), today: "2026-11-13", track: "master", onOpen() {},
  }));
  assert.match(table, /实务型大学院.*分野认证通过.*公立 · 文科省在册/);
  assert.doesNotMatch(table, /本科偏差值/);
  const scale = renderToStaticMarkup(createElement(LevelScale, { ...props, schools: catalog.schools }));
  assert.match(scale, /https:\/\/example.test\/quality/);
  assert.match(scale, /https:\/\/example.test\/registry/);
  assert.ok(parseGraduateSchool(school({ institution: { ...verified, registry_url: "" } })).issues.some((issue) => issue.includes("registry_url")));
});

test("候选表分别显示 QS 和 THE 总榜名次、未上榜和 Reporter", async () => {
  const { CandidateTable, GRADUATE_COPY } = await loadAppModule("app/graduate-view.tsx");
  const qs = { system: "QS", edition: 2027, rank: "=201", url: "https://example.test/qs" };
  const the = { system: "THE", edition: 2027, rank: "851–900", url: "https://example.test/the" };
  const build = (world_rankings) => buildGraduateCatalog([school({ world_rankings })]);
  const catalog = build([the, qs]);
  assert.deepEqual(catalog.issues, []);
  assert.deepEqual(catalog.schools[0].worldRankings, [qs, the]);
  const renderTable = (data) => renderToStaticMarkup(createElement(CandidateTable, {
    entries: graduateCatalogEntries(data, "master"), reference: null, today: "2026-11-13",
    track: "master", locale: "zh-CN", t: GRADUATE_COPY["zh-CN"], onOpen() {},
  }));
  const html = renderTable(catalog);
  assert.match(html, /aria-label="QS 2027 世界总榜 =201"[^>]+href="https:\/\/example\.test\/qs"[^>]+>QS 2027 <b>=201<\/b>/);
  assert.match(html, /aria-label="THE 2027 世界总榜 851–900"[^>]+>THE 2027 <b>851–900<\/b>/);
  const audited = renderTable(build([
    { system: "QS", edition: 2027, status: "unlisted", url: qs.url },
    { system: "THE", edition: 2027, status: "reporter", url: the.url },
  ]));
  assert.match(audited, /QS 2027 <b>未上榜<\/b>/);
  assert.match(audited, /THE 2027 <b>仅报送数据<\/b>/);
  assert.match(renderTable(build()), /世界排名未查到/);
  assert.ok(build([{ ...qs, rank: "东亚 =360" }]).issues.some(({ message }) => message.includes("world_rankings[0]")));
});

test("QS 按数字和官方区间排序，THE 名次不参与，归档路线不进入列表", () => {
  const ranked = (id, sort, rank, routes) => school({
    id, path: `40_大学院/${id}.md`, sort, routes,
    world_rankings: rank
      ? [{ system: "QS", edition: 2027, rank, url: "https://example.test/qs" }]
      : [{ system: "THE", edition: 2027, rank: "101", url: "https://example.test/the" }],
  });
  const catalog = buildGraduateCatalog([
    ranked("test-the", 1, null, [route("the-only", "master")]),
    ranked("test-plus", 2, "1401+", [route("plus", "master")]),
    ranked("test-range", 3, "851–900", [route("range", "master")]),
    ranked("test-tied", 4, "=201", [route("tied", "master"), route("archived", "master", { archived: true, shortlist: "tokyo-social-2027" })]),
    ranked("test-same", 5, "851–900", [route("same", "master"), route("same-second", "master")]),
  ]);
  assert.deepEqual(catalog.issues, []);
  const entries = graduateCatalogEntries(catalog, "all");
  assert.deepEqual(sortGraduateEntries(entries, "2026-11-15", "qs").map(({ route }) => route.id),
    ["tied", "range", "same", "same-second", "plus", "the-only"]);
  assert.equal(catalog.schools[3].routes[1].archived, true);
});

test("学校详情首屏：当前要做的事带截止与必着，前置过期给出核对提示", async () => {
  const { SchoolDetail, GRADUATE_COPY } = await loadAppModule("app/graduate-view.tsx");
  const catalog = buildGraduateCatalog([school({ level, routes: [route("test-master", "master", { prep: "[[テスト工科大学_備考]]" })] }), prepNote(), referenceNote()]);
  const props = { school: catalog.schools[0], route: catalog.schools[0].routes[0], schools: catalog.schools, reference: catalog.reference, revision: "r1", locale: "zh-CN", t: GRADUATE_COPY["zh-CN"],
    onSelectRoute() {}, onBack() {}, onOpenSource() {}, onOpenWiki() {} };
  const html = renderToStaticMarkup(createElement(SchoolDetail, { ...props, today: "2026-11-13" }));
  assert.match(html, /当前要做的事/);
  assert.match(html, /联系导师确认报名资格/);
  assert.match(html, /须送达/);
  assert.match(html, /11\/30（一）/);
  assert.match(html, /还剩 17 天/);
  assert.match(html, /备考资料 →/, "有备考时首屏就能跳到备考");
  for (const anchor of ["graduate-level", "graduate-apply", "graduate-fees", "graduate-exam", "graduate-sources"]) assert.match(html, new RegExp(`href="#${anchor}"`));
  assert.match(html, /情報学部偏差值 37\.5，属于「中下」一档，类比丙/);
  assert.match(html, /data-current="true"/, "对照图里高亮当前学校");
  assert.ok(html.indexOf("报名与材料") < html.indexOf("学位与费用") && html.indexOf("学位与费用") < html.indexOf("考试与备考") && html.indexOf("考试与备考") < html.indexOf(">出处<"));
  const japanese = renderToStaticMarkup(createElement(SchoolDetail, { ...props, today: "2026-11-13", locale: "ja", t: GRADUATE_COPY.ja }));
  assert.match(japanese, /事前協議申込/);
  assert.doesNotMatch(japanese, /联系导师确认报名资格/);
  const late = renderToStaticMarkup(createElement(SchoolDetail, { ...props, today: "2026-12-01" }));
  assert.match(late, /前置期限已过，没有完成记录/);
  assert.match(late, /正式出願/);
});

test("层次对照：档位从高到低取第一个不高于偏差值的，参照校跨档时写成档位区间", async () => {
  const { reference, issues } = parseGraduateReference(referenceNote());
  assert.deepEqual(issues, []);
  assert.equal(graduateBand(reference.bands, 62.5).label, "难关");
  assert.equal(graduateBand(reference.bands, 45).label, "中段");
  assert.equal(graduateBand(reference.bands, 37.5).label, "中下");
  assert.equal(graduateBand(reference.bands, 35).label, "低门槛", "35.0 是最低一档（37.4 以下）");
  assert.equal(graduateDeviationRange(37.5, 37.5), "37.5");
  assert.equal(graduateDeviationRange(35, 45), "35.0–45.0");
  const { LevelScale, GRADUATE_COPY } = await loadAppModule("app/graduate-view.tsx");
  const catalog = buildGraduateCatalog([school({ level }), referenceNote()]);
  const html = renderToStaticMarkup(createElement(LevelScale, { reference: catalog.reference, schools: catalog.schools, locale: "zh-CN", t: GRADUATE_COPY["zh-CN"] }));
  assert.ok(html.indexOf("参照工业大学") < html.indexOf("测试工科大学"), "按偏差值从高到低排");
  assert.match(html, /中段～难关/, "跨档的参照校不按最高学部归档");
  assert.match(html, /data-candidate="true"/);
  assert.match(html, /37\.4 以下/);
  assert.match(html, /Claude 为建立概念做的粗略类比/);
});

test("层次资料写错时拒收：偏差值不在刻度、档位顺序反了、类比没有署名", () => {
  const bad = parseGraduateReference(referenceNote({ analogy_author: "AI", bands: [{ min: 37.5, label: "中下", analogy: "x" }, { min: 60, label: "难关", analogy: "y" }], anchors: [{ name: "错值大学", low: 41, high: 40 }] }));
  assert.equal(bad.reference, null);
  for (const expected of ["analogy_author", "min の高い順", "最後の band の min は 35", "anchors[0].low は河合塾の偏差値帯"]) {
    assert.ok(bad.issues.some((issue) => issue.includes(expected)), `缺少问题：${expected}\n${bad.issues.join("\n")}`);
  }
  const wrongLevel = parseGraduateSchool(school({ level: { ...level, focus_high: 50, school_high: 45 } }));
  assert.ok(wrongLevel.issues.some((issue) => issue.includes("focus の範囲が school の範囲を超えている")));
  const offScale = parseGraduateSchool(school({ level: { ...level, focus_low: 36 } }));
  assert.ok(offScale.issues.some((issue) => issue.includes("level.focus_low")));
  const twice = buildGraduateCatalog([referenceNote(), { ...referenceNote(), path: "40_大学院/另一份对照.md" }]);
  assert.ok(twice.issues.some((issue) => issue.message.includes("graduate-reference は全庫で1件だけ")));
});
