import { readFile, mkdir, rename, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { isOperationalPath } from "../lib/vault-boundary.mjs";
import { noteInVaultScope } from "../lib/vault-scope.ts";

// 从正式接口导出，保留 Obsidian 的 metadata、tags 和时间；只导出内容，不复制插件配置和密钥。
const vaultPath = process.env.OBSIDIAN_VAULT_PATH ?? join(homedir(), "obsidian/xiaokan");
const configPath = process.env.OBSIDIAN_CONFIG_PATH ?? join(vaultPath, ".obsidian/plugins/obsidian-local-rest-api/data.json");
const key = process.env.OBSIDIAN_API_KEY ?? JSON.parse(await readFile(configPath, "utf8")).apiKey;
if (!key) throw new Error("Obsidian API key is not configured");
const base = (process.env.OBSIDIAN_API_URL ?? "http://127.0.0.1:27123").replace(/\/$/, "");
async function get(path, note = false) {
  const response = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: note ? "application/vnd.olrapi.note+json" : "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Vault export failed (${response.status})`);
  return response.json();
}
async function list(prefix = "") {
  const data = await get(`/vault/${encodeURIComponent(prefix)}`);
  const paths = [];
  for (const entry of data.files ?? []) {
    const path = prefix + entry;
    if (!isOperationalPath(path)) continue;
    if (entry.endsWith("/")) paths.push(...await list(path));
    else if (entry.toLowerCase().endsWith(".md")) paths.push(path);
  }
  return paths;
}
const paths = (await list()).sort();
if (!paths.length) throw new Error("Refusing to publish an empty Vault");
const notes = new Array(paths.length);
let cursor = 0;
await Promise.all(Array.from({ length: Math.min(8, paths.length) }, async () => {
  while (cursor < paths.length) {
    const index = cursor++;
    notes[index] = await get(`/vault/${encodeURIComponent(paths[index])}`, true);
  }
}));
const directory = resolve("public/_published-vault");
const staged = directory + ".tmp";
await rm(staged, { recursive: true, force: true });
await mkdir(staged, { recursive: true });
const scopes = Object.fromEntries(["all", "overview", "actions", "activity", "jobs", "interview", "training"].map((scope) => [scope, []]));
const chunks = {};
const groups = new Map();
let total = 0;
// 按 scope 成员关系分组，避免每次请求逐文件发起几百次资源读取。
for (const note of notes) {
  const data = JSON.stringify(note);
  const bytes = Buffer.byteLength(data);
  if (bytes > 24 * 1024 * 1024) throw new Error("A single note exceeds the deployment asset limit");
  total += bytes;
  const membership = Object.keys(scopes).filter((scope) => noteInVaultScope(note, scope));
  const key = membership.join(",");
  const batches = groups.get(key) ?? [];
  let batch = batches.at(-1);
  if (!batch || batch.bytes + bytes > 2 * 1024 * 1024) { batch = { bytes: 0, notes: [], membership }; batches.push(batch); }
  batch.bytes += bytes;
  batch.notes.push(note);
  groups.set(key, batches);
}
for (const batches of groups.values()) for (const batch of batches) {
  const data = JSON.stringify(batch.notes);
  const file = createHash("sha256").update(data).digest("hex").slice(0, 24) + ".json";
  await writeFile(join(staged, file), data, { mode: 0o600 });
  for (const note of batch.notes) chunks[note.path] = file;
  for (const scope of batch.membership) scopes[scope].push(file);
}
await writeFile(join(staged, "manifest.json"), JSON.stringify({ schemaVersion: 2, publishedAt: new Date().toISOString(), scopes, chunks }), { mode: 0o600 });
await rm(directory, { recursive: true, force: true });
await rename(staged, directory);
console.log(`Published Vault prepared: ${notes.length} notes, ${(total / 1024 / 1024).toFixed(1)} MiB`);
