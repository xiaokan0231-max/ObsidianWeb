import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const run = promisify(execFile);

async function fixture(t, git = true) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "obsidianweb startup ")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const primary = join(root, "main checkout");
  await mkdir(primary);
  await copyFile(new URL("../start.sh", import.meta.url), join(primary, "start.sh"));
  // 用真实 npm 跑无副作用的探针，验证实际启动目录和端口，不启动额外服务。
  await writeFile(join(primary, "package.json"), JSON.stringify({ scripts: { dev: "node record.mjs" } }));
  await writeFile(join(primary, "record.mjs"), 'console.log("START_RESULT:" + JSON.stringify({ cwd: process.cwd(), port: process.env.PORT }));');
  if (git) {
    await run("git", ["init", "-q", "-b", "main", primary]);
    await run("git", ["-C", primary, "add", "."]);
    await run("git", ["-C", primary, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "-qm", "fixture"]);
  }
  return { root, primary };
}

function started(stdout) {
  const match = stdout.match(/^START_RESULT:(.+)$/m);
  assert.ok(match, stdout);
  return JSON.parse(match[1]);
}

test("main 与无依赖的临时 worktree 都从 main 启动，保留含空格路径", async (t) => {
  const { root, primary } = await fixture(t);
  const linked = join(root, "临时 checkout");
  await run("git", ["-C", primary, "worktree", "add", "--detach", linked]);
  for (const checkout of [primary, linked]) {
    const result = await run("bash", [join(checkout, "start.sh")], { cwd: root, env: { ...process.env, PORT: "3999" } });
    assert.deepEqual(started(result.stdout), { cwd: primary, port: "3000" });
  }
});

test("没有 main 检出时明确停止，不启动临时检出", async (t) => {
  const { primary } = await fixture(t);
  await run("git", ["-C", primary, "branch", "-m", "preview"]);
  await assert.rejects(run("bash", [join(primary, "start.sh")]), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /未找到 main 分支的检出目录/);
    assert.doesNotMatch(error.stdout, /START_RESULT:/);
    return true;
  });
});

test("无 Git 元数据的源码副本仍能在自身目录启动", async (t) => {
  const { primary } = await fixture(t, false);
  const result = await run("bash", [join(primary, "start.sh")], { cwd: tmpdir() });
  assert.deepEqual(started(result.stdout), { cwd: primary, port: "3000" });
});

test("缺依赖在读取 Vault 与启动 bridge 前报告 npm ci 修复方法", async (t) => {
  const { primary } = await fixture(t, false);
  const scripts = join(primary, "scripts");
  await mkdir(scripts);
  const script = join(scripts, "dev-with-obsidian.sh");
  await copyFile(new URL("../scripts/dev-with-obsidian.sh", import.meta.url), script);
  await assert.rejects(run("sh", [script], { cwd: tmpdir() }), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /项目依赖未安装或不完整/);
    assert.match(error.stderr, /npm ci/);
    assert.ok(error.stderr.includes(primary));
    assert.doesNotMatch(error.stdout + error.stderr, /vault:check|ERR_MODULE_NOT_FOUND|configuration was not found|Bridge listening/);
    return true;
  });
});
