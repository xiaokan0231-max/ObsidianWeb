import assert from "node:assert/strict";
import test from "node:test";
import { loadAppModule } from "./helpers/render-tsx.mjs";

const path = "面试准备/株式会社テスト-一面.md";
const revision = "test-revision";
const messages = [{ role: "user", content: "这家公司做什么？" }];
const sources = [{ id: "company", label: "公司总结", excerpt: "株式会社テスト开发库存软件。" }];

function request(body, host = "localhost", site = "same-origin") {
  return new Request(`http://${host}/api/interview/coach`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Sec-Fetch-Site": site },
    body: JSON.stringify({ path, revision, ...body }),
  });
}

test("本场对话只有在同源本机确认同版资料后才调用付费服务", async (t) => {
  const previous = process.env.OBSIDIAN_DATA_SOURCE;
  process.env.OBSIDIAN_DATA_SOURCE = "live";
  t.after(() => {
    if (previous === undefined) delete process.env.OBSIDIAN_DATA_SOURCE;
    else process.env.OBSIDIAN_DATA_SOURCE = previous;
  });
  const bridge = [];
  const { POST } = await loadAppModule("app/api/interview/coach/route.ts", { stubs: {
    "@/lib/server/codex-bridge": { async interviewChatBridge(init) {
      bridge.push(init);
      return init.method === "GET" ? { configured: true } : { answer: "开发库存软件。", evidenceIds: ["company"] };
    } },
    "@/lib/server/interview-ai-context": { async readInterviewAiContext(prepPath, dataRevision) {
      assert.equal(dataRevision, revision);
      return { sources: prepPath === path ? sources : [{ ...sources[0], excerpt: "另一家公司的资料。" }] };
    } },
  } });
  assert.equal((await POST(request({ action: "preview" }, "example.test"))).status, 403);
  assert.equal((await POST(request({ action: "preview" }, "localhost", "cross-site"))).status, 403);
  assert.equal(bridge.length, 0);

  const preview = await POST(request({ action: "preview" }));
  assert.equal(preview.headers.get("Cache-Control"), "no-store");
  const { digest, sources: previewSources } = await preview.json();
  assert.deepEqual(previewSources, sources);
  assert.deepEqual(bridge, [{ method: "GET" }]);
  assert.equal((await POST(request({ action: "chat", path: "另一轮.md", digest, messages }))).status, 409);
  assert.equal((await POST(request({ action: "chat", digest, messages: [{ role: "assistant", content: "坏输入" }] }))).status, 400);
  assert.equal(bridge.length, 1);

  const answer = await POST(request({ action: "chat", digest, messages }));
  assert.equal(answer.status, 200);
  assert.deepEqual(JSON.parse(bridge[1].body), { sources, messages });
  assert.deepEqual(await answer.json(), { answer: "开发库存软件。", evidenceIds: ["company"] });
  process.env.OBSIDIAN_DATA_SOURCE = "published";
  assert.equal((await POST(request({ action: "chat", digest, messages }))).status, 403);
  assert.equal(bridge.length, 2);
});
