import assert from "node:assert/strict";
import test from "node:test";
import { loadAppModule } from "./helpers/render-tsx.mjs";

const note = (type, content, extra = {}) => ({ path: `20_求職/株式会社テスト/${type}.md`, content, tags: [], stat: { ctime: 0, mtime: 1000, size: 0 }, frontmatter: { type, company: "株式会社テスト", date: "2026-10-01", round: "一次面接", ...extra } });
const notes = [
  note("job-case", "# 株式会社テスト — エンジニア", { status: "不採用", channel: "企業直接", applied_on: "2026-09-01" }),
  note("transcript", "質問の原文\n回答の原文"),
  note("transcript-study", "## q01 経験\n- **s001｜面**\n    - 正:: 経験を教えてください。\n- **s002｜私**\n    - 正:: 開発を担当しました。"),
];

async function routes(path = "app/api/consultation/route.ts", failure = false, items = notes) {
  const calls = [];
  const handlers = await loadAppModule(path, { stubs: { "@/lib/server/consultation-library": {
    async loadConsultationNotes(force = false) { calls.push(force); if (failure) throw new Error("private-path apiKey secret"); return items; },
  } } });
  return { module: handlers, calls };
}

test("咨询接口在线上地址提供全部只读清单，刷新仍读取同一来源集合", async () => {
  const { module, calls } = await routes();
  const response = await module.GET(new Request("https://example.com/api/consultation?refresh=1"));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.companies.length, 1);
  assert.equal(data.sessions.length, 1);
  assert.deepEqual(calls, [true]);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal((await module.POST()).status, 405);
});

test("通过清单ID读取原稿，任意路径不被当作笔记地址", async () => {
  const { module } = await routes();
  const catalog = await (await module.GET(new Request("https://example.com/api/consultation"))).json();
  const detail = await module.GET(new Request(`https://example.com/api/consultation?session=${encodeURIComponent(catalog.sessions[0].id)}`));
  assert.equal(detail.status, 200);
  assert.match((await detail.json()).raw, /質問の原文/);
  assert.equal((await module.GET(new Request("https://example.com/api/consultation?session=../../secret.md"))).status, 404);
});

test("加载失败返回可重试错误，不把失败伪装成空清单或泄露内部异常", async () => {
  const { module } = await routes(undefined, true);
  const response = await module.GET(new Request("https://example.com/api/consultation"));
  assert.equal(response.status, 503);
  const text = await response.text();
  assert.doesNotMatch(text, /private-path|secret|apiKey|companies/);
});

test("Word下载返回真正DOCX、日语文件名、完整面试正文与公司表", async () => {
  const { module: catalogRoute } = await routes();
  const catalog = await (await catalogRoute.GET(new Request("https://example.com/api/consultation"))).json();
  const { module } = await routes("app/api/consultation/export/route.ts");
  for (const query of [`session=${encodeURIComponent(catalog.sessions[0].id)}&view=raw`, "format=companies"]) {
    const response = await module.GET(new Request(`https://example.com/api/consultation/export?${query}`));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("Content-Type"), /wordprocessingml/);
    assert.match(response.headers.get("Content-Disposition"), /filename\*=UTF-8''/);
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual(Array.from(bytes.slice(0, 4)), [80, 75, 3, 4]);
  }
  assert.equal((await module.GET(new Request("https://example.com/api/consultation/export"))).status, 400);
  assert.equal((await module.GET(new Request("https://example.com/api/consultation/export?session=missing"))).status, 404);
});

test("记忆重构记录的下载名不冒充原始录音转写", async () => {
  const items = notes.map(item => ({ ...item, frontmatter: { ...item.frontmatter, verbatim: false } }));
  const { module: catalogRoute } = await routes(undefined, false, items);
  const catalog = await (await catalogRoute.GET(new Request("https://example.com/api/consultation"))).json();
  const { module: exporter } = await routes("app/api/consultation/export/route.ts", false, items);
  const response = await exporter.GET(new Request(`https://example.com/api/consultation/export?session=${encodeURIComponent(catalog.sessions[0].id)}&view=raw`));
  assert.equal(response.status, 200);
  const filename = decodeURIComponent(response.headers.get("Content-Disposition"));
  assert.match(filename, /記憶から再構成/);
  assert.doesNotMatch(filename, /原始転写/);
});
