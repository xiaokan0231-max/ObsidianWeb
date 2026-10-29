import { readFile, mkdir, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { isOperationalPath } from "../lib/vault-boundary.mjs";
import { writePublishedVaultAssets } from "./published-vault-assets.mjs";

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
const { bytes: total } = await writePublishedVaultAssets(notes, staged, new Date().toISOString(), directory);
// 暂存资源完整后才替换；第二次改名失败仍能恢复上一份完整发布目录。
const previous = directory + ".previous";
await rm(previous, { recursive: true, force: true });
let moved = false;
try { await rename(directory, previous); moved = true; } catch (error) { if (error.code !== "ENOENT") throw error; }
try { await rename(staged, directory); } catch (error) { if (moved) await rename(previous, directory); throw error; }
await rm(previous, { recursive: true, force: true });
console.log(`Published Vault prepared: ${notes.length} notes, ${(total / 1024 / 1024).toFixed(1)} MiB`);
