import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const run = promisify(execFile);
const wasmFiles = ["vision_wasm_internal.js", "vision_wasm_internal.wasm", "vision_wasm_nosimd_internal.js", "vision_wasm_nosimd_internal.wasm"];

for (const cached of [false, true]) {
  test(`CI 跳过模型下载仍复制 WASM，${cached ? "保留已有模型" : "不创建模型"}`, async (t) => {
    // 脚本按自身路径找项目根；独立目录保证测试不触碰本机模型和 node_modules。
    const root = await mkdtemp(join(tmpdir(), "obsidianweb-mediapipe-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const scripts = join(root, "scripts");
    const wasm = join(root, "node_modules/@mediapipe/tasks-vision/wasm");
    const target = join(root, "public/mediapipe");
    await Promise.all([scripts, wasm, target].map((path) => mkdir(path, { recursive: true })));
    const script = join(scripts, "fetch-mediapipe.mjs");
    await copyFile(new URL("../scripts/fetch-mediapipe.mjs", import.meta.url), script);
    await Promise.all(wasmFiles.map((name) => writeFile(join(wasm, name), `fixture:${name}`)));
    const model = join(target, "gesture_recognizer.task");
    if (cached) await writeFile(model, "cached-model");
    const guard = "data:text/javascript," + encodeURIComponent('globalThis.fetch = () => { throw new Error("UNEXPECTED_NETWORK_REQUEST"); };');
    const result = await run(process.execPath, ["--import", guard, script, "--skip-model-download"]);
    assert.match(result.stdout, /model: skipped \(--skip-model-download\)/);
    assert.doesNotMatch(result.stdout + result.stderr, /UNEXPECTED_NETWORK_REQUEST|unavailable/);
    for (const name of wasmFiles) assert.equal(await readFile(join(target, "wasm", name), "utf8"), `fixture:${name}`);
    if (cached) assert.equal(await readFile(model, "utf8"), "cached-model");
    else await assert.rejects(stat(model), { code: "ENOENT" });
  });
}
