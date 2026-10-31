import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, brotliCompressSync, gunzipSync } from "node:zlib";
import test from "node:test";
import { copySealedPublishedVault, sites } from "../build/sites-vite-plugin.ts";
import { sealPublishedVault } from "../scripts/seal-published-vault.mjs";

const secret = "ab".repeat(32);
const magic = Buffer.from("OWSEALED1", "ascii");
const script = fileURLToPath(new URL("../scripts/seal-published-vault.mjs", import.meta.url));

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "sealed-published-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "plaintext");
  await mkdir(source);
  const body = Buffer.from('{"content":"学习短摘，完整保留。"}');
  const files = new Map([
    ["manifest.json", Buffer.from('{"schemaVersion":2,"chunks":{"例.md":"current.json"}}')],
    ["current.json", body], ["current.json.gz", gzipSync(body)], ["current.json.br", brotliCompressSync(body)],
    ["retained.json.gz", gzipSync(Buffer.from('{"revision":"previous"}'))],
  ]);
  for (const [name, bytes] of files) await writeFile(join(source, name), bytes);
  return { root, source, files };
}

async function decrypt(bytes) {
  assert.deepEqual(bytes.subarray(0, magic.length), magic);
  const key = await crypto.subtle.importKey("raw", Buffer.from(secret, "hex"), "AES-GCM", false, ["decrypt"]);
  return gunzipSync(Buffer.from(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(magic.length, magic.length + 12) }, key, bytes.subarray(magic.length + 12))));
}

function runCLI(input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", bytes => { stdout += bytes; });
    child.stderr.on("data", bytes => { stderr += bytes; });
    child.once("error", reject);
    child.once("close", code => resolve({ code, stdout, stderr }));
    child.stdin.end(JSON.stringify(input) + "\n");
  });
}

test("CLI从stdin读取密钥，将当前与历史全部资产加密且可独立解密，原稿字节不变", async t => {
  const { root, source, files } = await fixture(t);
  const destination = join(root, "encrypted");
  const result = await runCLI({ secret, source, destination });
  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(secret, "u"));
  assert.deepEqual((await readdir(destination)).sort(), [...files.keys()].sort());
  assert.equal(JSON.parse(result.stdout).files, files.size);
  for (const [name, original] of files) {
    const sealed = await readFile(join(destination, name));
    assert.deepEqual(await decrypt(sealed), original, name);
    assert.deepEqual(await readFile(join(source, name)), original, name);
    assert.ok(!sealed.includes(Buffer.from("学习短摘")));
  }
  const another = join(root, "encrypted-again");
  await sealPublishedVault({ secret, source, destination: another });
  assert.notDeepEqual(await readFile(join(another, "manifest.json")), await readFile(join(destination, "manifest.json")));
});

test("CLI拒绝无效密钥、目录重叠及非空目标，不输出密钥或改动原资料", async t => {
  const { root, source, files } = await fixture(t);
  const existing = join(root, "existing");
  await mkdir(existing);
  await writeFile(join(existing, "keep.txt"), "keep");
  for (const input of [
    { secret: "invalid", source, destination: join(root, "invalid") },
    { secret, source, destination: source },
    { secret, source, destination: join(source, "nested") },
    { secret, source, destination: join(source, "..nested") },
    { secret, source, destination: existing },
  ]) {
    const result = await runCLI(input);
    assert.equal(result.code, 1);
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(secret, "u"));
  }
  assert.equal(await readFile(join(existing, "keep.txt"), "utf8"), "keep");
  assert.deepEqual(await readFile(join(source, "manifest.json")), files.get("manifest.json"));
});

test("普通明文或缺少快照的构建会清除Vite复制的明文与旧资产，不阻塞本机构建", async t => {
  const { root, source } = await fixture(t);
  const output = join(root, "dist/client/_published-vault");
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "leak.json"), "plaintext");
  assert.equal(await copySealedPublishedVault(source, output), false);
  await assert.rejects(stat(output), error => error.code === "ENOENT");
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "leak.json"), "plaintext");
  assert.equal(await copySealedPublishedVault(join(root, "missing"), output), false);
  await assert.rejects(stat(output), error => error.code === "ENOENT");
});

test("构建只复制完整密文快照并清掉退休资产，重复构建仍全部保持密文", async t => {
  const { root, source, files } = await fixture(t);
  const published = join(root, "public/_published-vault");
  await sealPublishedVault({ secret, source, destination: published });
  const output = join(root, "dist/client/_published-vault");
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "retired.json"), "plaintext");
  const plugin = sites();
  plugin.configResolved({ root });
  for (let run = 0; run < 2; run++) {
    await plugin.closeBundle();
    assert.deepEqual((await readdir(output)).sort(), [...files.keys()].sort());
    for (const name of files.keys()) assert.deepEqual(await readFile(join(output, name)), await readFile(join(published, name)));
  }
});

test("密文manifest不能掩盖夹带的明文资产，构建拒绝整份且不留下部分输出", async t => {
  const { root, source } = await fixture(t);
  const published = join(root, "encrypted");
  await sealPublishedVault({ secret, source, destination: published });
  await writeFile(join(published, "retained.json.gz"), "plaintext-hidden-in-old-version");
  const output = join(root, "dist/client/_published-vault");
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "leak.json"), "plaintext");
  await assert.rejects(copySealedPublishedVault(published, output), /未加密/u);
  await assert.rejects(stat(output), error => error.code === "ENOENT");
});
