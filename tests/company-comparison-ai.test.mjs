import assert from "node:assert/strict";
import test from "node:test";
import { formatCompanyComparisonAnalysis, resolveCompanyComparisonAiContext } from "../lib/server/company-comparison-ai.ts";
import { COMPANY_COMPARISON_SCHEMA, companyComparisonPrompt, parseCompanyComparisonInput, validateCompanyComparisonOutput } from "../scripts/company-comparison-codex.mjs";
import { RequestRejectedError } from "../lib/server/write-guards.ts";
import { loadAppModule } from "./helpers/render-tsx.mjs";

const revision = "test-comparison-revision";
const paths = ["20_求職/株式会社テスト/岗位甲.md", "20_求職/株式会社テスト/岗位乙.md"];
const publicSources = [{ label: "企业概要", url: "https://example.com/company" }];
const fact = (id, label, value, sources = publicSources, scope = "单体") => ({ id, label, value, sources, scope, asOf: "2026年3月期" });
const catalog = { comparisons: paths.map((path, index) => ({
  path, shortName: "株式会社テスト", displayRole: ["库存工程师", "财务工程师"][index],
  reviews: [{ platform: "OpenWork", score: 3.2, scale: 5, sampleCount: 4, sampleUnit: "件",
    readOn: "2026-11-01", commentPeriod: "2026年", url: "https://openwork.example/company", coverage: "应忽略的内部备注" }],
})) };
const projection = (path) => ({
  kind: "interview-company", sourcePath: path, profile: {
    facts: [fact("business", "业务", path === paths[0] ? "库存软件" : "财务软件"),
      fact("revenue", "年营收", "2 億円"),
      fact("capital", "资本金", "待确认"),
      fact("team_size", "工程团队", "不应发送的混合引用", [...publicSources, { label: "本机", wiki: "[[老师留言]]" }]),
      fact("employees", "员工人数", "不应发送的邀请链接", [{ label: "未知", url: "https://example.com/join?token=private" }])],
    reviewSynthesis: { paragraphs: ["不应发送的口碑原话"] },
  },
  assessment: { data: { summary: "不应发送的个人适配判断", contextFacts: [
    fact("role", "职责", "维护企业系统"),
    fact("salary", "招聘年收", "候选人本人希望 800万"),
    fact("work_style", "工作方式", "需要联系 staff@example.com"),
    fact("unlisted", "内部信息", "不应发送的未允许字段"),
  ] } },
});

const context = () => resolveCompanyComparisonAiContext(paths, catalog, async (path) => projection(path));
const company = (id, firstFact = `${id}-F1`) => ({
  id, advantages: [{ text: "有公开的产品方向。", implication: `${id} 的产品方向可以帮助确认业务场景。`, evidenceIds: [firstFact] }],
  tradeoffs: [], unknowns: ["需要确认岗位分工。"],
  questions: [
    { question: `${id} 入职后三个月会承担哪个模块？`, reason: "判断是否能跟进模块的设计与上线。", evidenceIds: [`${id}-F3`] },
    { question: "谁负责验收？", reason: "确认岗位目前未披露的责任范围。", evidenceIds: [] },
  ],
});
const exampleResult = {
  companies: [company("C2"), company("C1")],
  differences: [{ axis: "业务方向", text: "C1 面向库存（C1-F1），C2 面向财务（C2-F1）。",
    implication: "C1 与 C2 的系统使用场景不同，需核实各岗位实际负责的业务模块。", evidenceIds: ["C1-F1", "C2-F1"] }],
  scenarios: [{ priority: "愿意优先深耕供应链业务", choice: "如果能参与核心模块，优先了解 C1 。",
    verify: "确认 C1 的岗位是否接触库存业务，若仅外围支持，则重新比较 C2 。", evidenceIds: ["C1-F1", "C2-F1"] }],
};

test("同名岗位按正本区分，模型输入仅有公开依据和列号，点击引用由本机还原链接", async () => {
  const outbound = await context();
  const serialized = JSON.stringify(outbound.companies);
  assert.doesNotMatch(serialized, /株式会社テスト|20_求職|https:\/\/|不应发送|staff@example.com|适配判断|候选人|内部备注|待确认/);
  assert.deepEqual(outbound.companies[0].facts.map(({ id, label }) => [id, label]), [
    ["C1-F1", "业务"], ["C1-F2", "年营收"], ["C1-F3", "职责"], ["C1-F4", "OpenWork 平台评分"],
  ]);
  const response = formatCompanyComparisonAnalysis(exampleResult, outbound);
  assert.deepEqual(response.companies.map(({ path, role }) => [path, role]), [
    [paths[0], "库存工程师"], [paths[1], "财务工程师"],
  ]);
  assert.deepEqual(response.evidence[0].sources, publicSources);
  assert.equal(response.evidence[1].scope, "单体");
  assert.equal(response.differences[0].text, "株式会社テスト（库存工程师） 面向库存，株式会社テスト（财务工程师） 面向财务。");
  assert.match(response.differences[0].implication, /株式会社テスト（库存工程师）/);
  assert.match(response.companies[0].questions[0].question, /株式会社テスト（库存工程师）/);
  assert.match(response.scenarios[0].verify, /株式会社テスト（财务工程师）/);
  assert.deepEqual(response.scenarios[0].evidenceIds, ["C1-F1", "C2-F1"]);
  let reads = 0;
  await assert.rejects(resolveCompanyComparisonAiContext([paths[0], "20_求職/非候选.md"], catalog, async () => { reads++; return null; }), { status: 409 });
  assert.equal(reads, 0, "目录外路径不能访问任何正文或投影");
});

test("Codex 提示仅接收筛选后的资料，结构化输出保留有效字段", async () => {
  const { companies } = await context();
  const input = parseCompanyComparisonInput({ locale: "ja", companies: companies.map((entry) => ({
    ...entry, path: "本机路径", facts: entry.facts.map((evidence) => ({ ...evidence, sources: publicSources })),
  })) });
  const [, promptPayload] = companyComparisonPrompt(input).split("\n\nINPUT_JSON:\n");
  assert.deepEqual(JSON.parse(promptPayload), { language: "日本語", companies });
  assert.throws(() => parseCompanyComparisonInput({ locale: "ja", companies: [companies[1], companies[0]] }));
  assert.throws(() => parseCompanyComparisonInput({ locale: "ja", companies: [companies[0], { id: "C2", facts: [] }] }));
  assert.deepEqual(COMPANY_COMPARISON_SCHEMA.required, ["companies", "differences", "scenarios"]);
  assert.deepEqual(validateCompanyComparisonOutput(exampleResult, companies), exampleResult);
});

test("丢弃引用无效的单项，保留同一报告中有依据的结论和缺口追问", async () => {
  const { companies } = await context();
  const [right, left] = exampleResult.companies;
  const [validDifference] = exampleResult.differences;
  const [validScenario] = exampleResult.scenarios;
  const report = {
    companies: [right, { ...left,
      advantages: [company("C1", "C2-F1").advantages[0], ...left.advantages],
      tradeoffs: [null, { ...left.advantages[0], evidenceIds: ["C1-F1", "C1-F不存在"] }],
      questions: [{ ...left.questions[0], evidenceIds: ["C2-F3"] }, ...left.questions],
    }],
    differences: [{ ...validDifference, evidenceIds: ["C1-F1", "C1-F2"] }, validDifference],
    scenarios: [null, { ...validScenario, evidenceIds: ["C1-F1", "C2-F不存在"] }, validScenario],
  };
  assert.deepEqual(validateCompanyComparisonOutput(report, companies), exampleResult);
});

test("较大的比较保留优先项，引用截断时仍覆盖每家被引用的公司", () => {
  const companies = Array.from({ length: 4 }, (_, index) => {
    const id = `C${index + 1}`;
    return { id, facts: Array.from({ length: 10 }, (_, index) => ({ id: `${id}-F${index + 1}` })) };
  });
  const report = company("C1");
  const notes = ["产品方向", "系统上线", "业务部门"].map((text) => ({ ...report.advantages[0], text }));
  const evidenceIds = [...companies[0].facts.map(({ id }) => id), "C2-F1"];
  const differences = Array.from({ length: 5 }, (_, index) => ({ ...exampleResult.differences[0], axis: `维度 ${index}`, evidenceIds }));
  const result = validateCompanyComparisonOutput({
    companies: [{ ...report, advantages: notes }], differences, scenarios: [],
  }, companies);
  assert.deepEqual(result.companies.map(({ id }) => id), ["C1", "C2", "C3", "C4"]);
  assert.deepEqual(result.companies[0].advantages, notes.slice(0, 2));
  assert.deepEqual(result.companies[1].advantages, []);
  assert.deepEqual(result.differences.map(({ axis }) => axis), differences.slice(0, 4).map(({ axis }) => axis));
  assert.deepEqual(result.differences[0].evidenceIds, [...evidenceIds.slice(0, 7), "C2-F1"]);
});

test("比较结构无效或缺少可用内容时返回固定错误", async () => {
  const { companies } = await context();
  assert.throws(() => validateCompanyComparisonOutput({ ...exampleResult, scenarios: null }, companies),
    { message: "本机 Codex 返回的比较结构无效。" });
  assert.throws(() => validateCompanyComparisonOutput({
    companies: [], differences: [{ ...exampleResult.differences[0], evidenceIds: ["C1-F1"] }], scenarios: [],
  }, companies), { message: "本机 Codex 未返回有依据的对比或可用追问。" });
});

test("只接受同源本机 POST，校验选择和资料版本后才请求 Codex", async () => {
  const outbound = await context();
  const config = { env: { OBSIDIAN_DATA_SOURCE: "live" } };
  const sent = [];
  let current = outbound;
  let fail = false;
  const { POST } = await loadAppModule("app/api/interview/company-comparison/route.ts", { globals: { process: config }, stubs: {
    "@/lib/server/codex-bridge": { async companyComparisonBridge(body) {
      sent.push(body);
      if (fail) throw Object.assign(new RequestRejectedError("Codex 正忙", 429), { code: "codex_busy" });
      return exampleResult;
    } },
    "@/lib/server/company-comparison-ai": { formatCompanyComparisonAnalysis, async readCompanyComparisonAiContext(chosen, version) {
      assert.deepEqual(chosen, paths);
      if (version !== revision) throw new RequestRejectedError("版已变化", 409);
      return current;
    } },
  } });
  const request = (overrides = {}, host = "localhost", site = "same-origin") => new Request(`http://${host}/api/interview/company-comparison`, {
    method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": site },
    body: JSON.stringify({ revision, paths, locale: "ja", ...overrides }),
  });
  assert.equal((await POST(request({}, "example.test"))).status, 403);
  assert.equal((await POST(request({}, "localhost", "cross-site"))).status, 403);
  assert.equal((await POST(request({ paths: [paths[0], paths[0]] }))).status, 400);
  assert.equal((await POST(request({ revision: "old" }))).status, 409);
  current = { ...outbound, companies: [{ id: "C1", facts: [] }, outbound.companies[1]] };
  assert.equal((await POST(request())).status, 422);
  assert.equal(sent.length, 0);
  current = outbound;
  const result = await POST(request());
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(sent, [{ companies: outbound.companies, locale: "ja" }]);
  assert.deepEqual((await result.json()).differences, formatCompanyComparisonAnalysis(exampleResult, outbound).differences);
  fail = true;
  const busy = await POST(request());
  assert.equal(busy.status, 429);
  assert.equal((await busy.json()).code, "codex_busy");
  config.env.OBSIDIAN_DATA_SOURCE = "published";
  assert.equal((await POST(request())).status, 403);
  assert.equal(sent.length, 2);
});
