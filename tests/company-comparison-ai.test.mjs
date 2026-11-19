import assert from "node:assert/strict";
import test from "node:test";
import { formatCompanyComparisonAnalysis, resolveCompanyComparisonAiContext } from "../lib/server/company-comparison-ai.ts";
import { requestCompanyComparison } from "../scripts/company-comparison-openai.mjs";
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
  id, advantages: [{ text: "有公开的产品方向。", evidenceIds: [firstFact] }],
  tradeoffs: [], unknowns: ["需要确认岗位分工。"], questions: ["岗位分工如何？"],
});
const exampleResult = {
  companies: [company("C2"), company("C1")],
  differences: [{ text: "C1 面向库存，C2 面向财务。", evidenceIds: ["C1-F1", "C2-F1"] }],
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
  let reads = 0;
  await assert.rejects(resolveCompanyComparisonAiContext([paths[0], "20_求職/非候选.md"], catalog, async () => { reads++; return null; }), { status: 409 });
  assert.equal(reads, 0, "目录外路径不能访问任何正文或投影");
});

test("OpenAI 结构化输出校验证据归属，处理两种额度耗尽错误", async (t) => {
  const original = { key: process.env.OPENAI_API_KEY, file: process.env.INTERVIEW_CHAT_OPENAI_KEY_FILE };
  process.env.OPENAI_API_KEY = "key-for-stub-only";
  delete process.env.INTERVIEW_CHAT_OPENAI_KEY_FILE;
  t.after(() => {
    if (original.key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = original.key;
    if (original.file === undefined) delete process.env.INTERVIEW_CHAT_OPENAI_KEY_FILE; else process.env.INTERVIEW_CHAT_OPENAI_KEY_FILE = original.file;
  });
  const { companies } = await context();
  const completed = (data) => Response.json({ status: "completed", output: [{
    type: "message", content: [{ type: "output_text", text: JSON.stringify(data) }],
  }] });
  const out = await requestCompanyComparison({ companies, locale: "ja" }, async (url, request) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    const payload = JSON.parse(request.body);
    assert.equal(payload.store, false);
    assert.equal(payload.text.format.name, "company_comparison");
    assert.deepEqual(JSON.parse(payload.input[0].content), { language: "日本語", companies });
    return completed(exampleResult);
  });
  assert.deepEqual(out, exampleResult);
  await assert.rejects(requestCompanyComparison({ companies }, async () =>
    completed({ ...exampleResult, companies: [company("C1", "C2-F1"), company("C2")] })), { status: 502 });
  await assert.rejects(requestCompanyComparison({ companies }, async () =>
    completed({ ...exampleResult, differences: [{ text: "无效差异", evidenceIds: ["C1-F1"] }] })), { status: 502 });
  for (const code of ["insufficient_quota", "credit_balance_exhausted"]) {
    await assert.rejects(requestCompanyComparison({ companies }, async () =>
      Response.json({ error: { code, message: "原始服务错误不外露" } }, { status: 429 })), { status: 429, code: "openai_credit" });
  }
});

test("只接受同源本机 POST，校验选择和资料版本后才发起 OpenAI 请求", async () => {
  const outbound = await context();
  const config = { env: { OBSIDIAN_DATA_SOURCE: "live" } };
  const sent = [];
  let current = outbound;
  let fail = false;
  const { POST } = await loadAppModule("app/api/interview/company-comparison/route.ts", { globals: { process: config }, stubs: {
    "@/lib/server/codex-bridge": { async companyComparisonBridge(body) {
      sent.push(body);
      if (fail) throw Object.assign(new RequestRejectedError("OpenAI API 额度不足", 429), { code: "openai_credit" });
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
  const insufficient = await POST(request());
  assert.equal(insufficient.status, 429);
  assert.equal((await insufficient.json()).code, "openai_credit");
  config.env.OBSIDIAN_DATA_SOURCE = "published";
  assert.equal((await POST(request())).status, 403);
  assert.equal(sent.length, 2);
});
