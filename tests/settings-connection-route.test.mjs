import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadAppModule } from "./helpers/render-tsx.mjs";

/*
 * GET /api/settings/connection 跑真实 route，只替换 process.env。
 * OBSIDIAN_API_KEY 与 CODEX_BRIDGE_TOKEN 兼作签名密钥：响应里出现任何一段都算泄露。
 */

const SECRETS = {
  OBSIDIAN_API_URL: "http://local-user:local-pass@127.0.0.1:27124/secret-path?token=url-token",
  OBSIDIAN_API_KEY: "test-obsidian-api-key-0001",
  CODEX_BRIDGE_URL: "http://127.0.0.1:43999",
  CODEX_BRIDGE_TOKEN: "test-bridge-token-0002",
  LANGUAGE_BATCH_SIGNING_KEY: "test-signing-key-0003",
  OPENAI_API_KEY: "test-openai-key-0004",
  OBSIDIAN_VAULT_PATH: "/Users/test-user/test-vault",
};

async function call(env) {
  const { GET } = await loadAppModule("app/api/settings/connection/route.ts", { globals: { process: { env } } });
  const response = await GET();
  return { response, text: await response.text() };
}

test("只回 host:port 与布尔值，不缓存", async () => {
  const { response, text } = await call(SECRETS);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(JSON.parse(text), {
    obsidian: { host: "127.0.0.1", port: "27124", keyConfigured: true },
    vaultPathConfigured: true,
  });
});

test("响应里不含任何密钥、令牌、URL 认证段与本机路径", async () => {
  const { text } = await call(SECRETS);
  for (const [name, value] of Object.entries(SECRETS)) {
    if (name === "CODEX_BRIDGE_URL") continue;
    assert.ok(!text.includes(value), `${name} 原文出现在响应里`);
  }
  for (const fragment of ["local-user", "local-pass", "secret-path", "url-token", "test-user", "test-vault", "Bearer", "43999"]) {
    assert.ok(!text.includes(fragment), `响应里出现了 ${fragment}`);
  }
});

test("没配密钥、没传 vault 路径时如实回 false；地址写坏时不回显原文", async () => {
  const empty = JSON.parse((await call({})).text);
  assert.deepEqual(empty, { obsidian: { host: "127.0.0.1", port: "27123", keyConfigured: false }, vaultPathConfigured: false });
  const broken = JSON.parse((await call({ OBSIDIAN_API_URL: "::bad::secret-in-url", OBSIDIAN_API_KEY: "" })).text);
  assert.deepEqual(broken.obsidian, { host: "", port: "", keyConfigured: false });
});

test("route 只有 GET，不读写 vault、不调用 Obsidian", () => {
  const source = readFileSync(new URL("../app/api/settings/connection/route.ts", import.meta.url), "utf8");
  assert.match(source, /export async function GET\(\)/);
  assert.doesNotMatch(source, /export async function (POST|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(source, /fetch\(|lib\/server\//);
});
