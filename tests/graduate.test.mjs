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
  graduateCatalogEntries,
  graduateDateLabel,
  graduateLocationFromSearch,
  graduateManYen,
  graduateNoteSections,
  graduateSearch,
  graduateStepState,
  graduateTotalFee,
  GRADUATE_RECORD_KIND,
  nextGraduateDeadline,
  nextGraduateEvent,
  overdueGraduatePrerequisites,
  parseGraduateSchool,
} from "../lib/graduate.ts";
import { includePublishedNote } from "../lib/vault-boundary.mjs";
import { buildApplicationReadModel } from "../scripts/read-model-source.mjs";
import { writeReadModelAssets } from "../scripts/read-model-published.mjs";
import { createReadModel } from "../lib/server/read-model.ts";
import { database } from "./read-model-db.mjs";
import { loadAppModule } from "./helpers/render-tsx.mjs";

// 学校名一律虚构：仓库公开，本人在看哪些学校属于个人事实。
const masterSteps = () => [
  { id: "consult", kind: "prerequisite", label: "事前協議申込", due: "2026-11-30", deadline_type: "必着",
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
    sort, checked_on: "2026-11-13", indicators: [{ kind: "ranking", label: "テストランキング2025", value: "201+", scope: "2025年発表・大学全体", url: "https://example.test/rank" }], routes, ...frontmatter },
  content: content ?? `---\ntype: graduate-school\n---\n# テスト工科大学\n\n> 导语\n\n## 学校口径\n\n- 排名说明\n\n${routes.map((item) => `## ${item.label}\n\n### 出愿资格与匹配\n\n资格段落\n\n### 出愿与材料\n\n材料段落\n`).join("\n")}\n## 出处\n\n- [要项](https://example.test/guide.pdf)\n`,
});
const prepNote = (path = "40_大学院/テスト工科大学_備考.md") => ({
  path, stat: { ctime: 1, mtime: 1, size: 1 }, tags: [],
  frontmatter: { type: "graduate-prep", publish: false, route: "test-master", source_note: "[[テスト工科大学]]" },
  content: "# 备考\n\n## 2026 年度小论文真题\n\n600 字以上 800 字以内。\n",
});

test("候选表默认只列修士，按学校 sort 排序；全部时列出每条路线", () => {
  const second = school({ path: "40_大学院/サンプル大学.md", id: "sample-u", sort: 2, routes: [route("sample-master", "master"), route("sample-first", "bachelor"), route("sample-second", "bachelor")] });
  const catalog = buildGraduateCatalog([second, school()]);
  assert.deepEqual(catalog.issues, []);
  assert.deepEqual(graduateCatalogEntries(catalog, "master").map(({ route }) => route.id), ["test-master", "sample-master"]);
  assert.equal(graduateCatalogEntries(catalog, "bachelor").length, 3);
  assert.equal(graduateCatalogEntries(catalog, "all").length, 5);
  assert.equal(catalog.schools[0].id, "test-tech", "sort 小的在前");
  // 目录只带比较用的精简字段，材料链接和说明随正文按需读取。
  const step = catalog.schools[0].routes[0].steps[0];
  assert.equal("materials" in step, false);
  assert.equal("basis" in catalog.schools[0].routes[0].fees, false);
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

test("稳定链接只写本区三个键：修士是默认值，外壳参数原样保留", () => {
  assert.deepEqual(graduateLocationFromSearch(""), { track: "master", school: "", route: "" });
  assert.deepEqual(graduateLocationFromSearch("?track=all&school=test-tech&route=test-master"), { track: "all", school: "test-tech", route: "test-master" });
  assert.deepEqual(graduateLocationFromSearch("?track=phd&school=../x"), { track: "master", school: "", route: "" }, "认不出的值回到默认");
  assert.equal(graduateSearch({ track: "master", school: "", route: "" }, "note=a.md&track=all").toString(), "note=a.md");
  assert.equal(graduateSearch({ track: "bachelor", school: "test-tech", route: "test-bachelor" }).toString(), "track=bachelor&school=test-tech&route=test-bachelor");
  assert.equal(graduateSearch({ track: "all", school: "", route: "stale" }).toString(), "track=all", "没有学校时不留路线");
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
  const notes = [school(), prepNote(), shared];
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
  assert.deepEqual(catalog, { schemaVersion: 1, schools: [], issues: [] });
});

test("候选表一行一条路线：学位、学制、两种费用、科目和下一道截止并排；过期前置手续标红", async () => {
  const { CandidateTable, GRADUATE_COPY } = await loadAppModule("app/graduate-view.tsx");
  const catalog = buildGraduateCatalog([school()]);
  const html = renderToStaticMarkup(createElement(CandidateTable, { entries: graduateCatalogEntries(catalog, "master"), track: "master", today: "2026-11-13", locale: "zh-CN", t: GRADUATE_COPY["zh-CN"], onOpen() {} }));
  assert.equal((html.match(/<tr data-track=/g) ?? []).length, 1);
  assert.match(html, /href="\/graduate\?school=test-tech&amp;route=test-master"/);
  for (const text of ["测试工科大学", "test-master 中文名", "修士（工学）", "2 年", "100.1", "179.0", "小論文", "11/30（一）", "必着", "事前協議申込", "还剩 17 天"]) assert.ok(html.includes(text), text);
  const late = renderToStaticMarkup(createElement(CandidateTable, { entries: graduateCatalogEntries(catalog, "master"), track: "master", today: "2026-12-01", locale: "zh-CN", t: GRADUATE_COPY["zh-CN"], onOpen() {} }));
  assert.match(late, /前置期限已过：事前協議申込/);
  assert.match(late, /1\/15（五）/);
});

test("学校详情首屏：当前要做的事带截止与必着，前置过期给出核对提示", async () => {
  const { SchoolDetail, GRADUATE_COPY } = await loadAppModule("app/graduate-view.tsx");
  const catalog = buildGraduateCatalog([school({ routes: [route("test-master", "master", { prep: "[[テスト工科大学_備考]]" })] }), prepNote()]);
  const props = { school: catalog.schools[0], route: catalog.schools[0].routes[0], revision: "r1", locale: "zh-CN", t: GRADUATE_COPY["zh-CN"],
    onSelectRoute() {}, onBack() {}, onOpenSource() {}, onOpenWiki() {} };
  const html = renderToStaticMarkup(createElement(SchoolDetail, { ...props, today: "2026-11-13" }));
  assert.match(html, /当前要做的事/);
  assert.match(html, /事前協議申込/);
  assert.match(html, /11\/30（一）/);
  assert.match(html, /还剩 17 天/);
  assert.match(html, /备考资料 →/, "有备考时首屏就能跳到备考");
  for (const anchor of ["graduate-apply", "graduate-fees", "graduate-exam", "graduate-sources"]) assert.match(html, new RegExp(`href="#${anchor}"`));
  assert.ok(html.indexOf("出愿与材料") < html.indexOf("学位与费用") && html.indexOf("学位与费用") < html.indexOf("考试与备考") && html.indexOf("考试与备考") < html.indexOf(">出处<"));
  const late = renderToStaticMarkup(createElement(SchoolDetail, { ...props, today: "2026-12-01" }));
  assert.match(late, /前置期限已过，没有完成记录/);
  assert.match(late, /正式出願/);
});
