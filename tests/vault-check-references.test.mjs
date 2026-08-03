import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

// vault:check が落ちると Stop hook が毎ターン止まり、vault の pre-commit が無関係な
// commit まで拒む（AGENTS.md の三層表）。誤検知の代償が大きいので、
// 「合法な vault 状態で落ちないこと」と「本当の参照切れは落ちること」を両方固定する。

function runCheck(root) {
  return spawnSync(process.execPath, ["scripts/vault-check.mjs"], {
    encoding: "utf8",
    cwd: process.cwd(),
    env: { ...process.env, OBSIDIAN_VAULT_PATH: root },
  });
}

async function fixtureVault(files) {
  const root = await mkdtemp(join(tmpdir(), "vault-check-"));
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return root;
}

const material = (name, body) => `---\ntype: material\n---\n# ${name}\n\n${body}\n`;

async function check(t, files) {
  const root = await fixtureVault(files);
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = runCheck(root);
  return { ...result, output: `${result.stdout}${result.stderr}` };
}

test("実体のある添付への埋め込みは参照切れではない", async (t) => {
  const result = await check(t, {
    "20_求職/覚書.md": material("覚書", "![[求人票スクショ.png]]"),
    "求人票スクショ.png": "",
  });
  // スクショを1枚貼っただけで全庫の検査が落ちてはいけない。
  assert.equal(result.status, 0, result.output);
});

test("実体の無い添付は今まで通り参照切れとして落とす", async (t) => {
  const result = await check(t, {
    "20_求職/覚書.md": material("覚書", "![[消えた求人票.pdf]]"),
  });
  assert.notEqual(result.status, 0);
  assert.match(result.output, /参照先が無い \[\[消えた求人票\.pdf\]\]/u);
});

test("走査対象外だが実在するノート（90_归档・模板・制御ファイル）への参照は通る", async (t) => {
  const result = await check(t, {
    "20_求職/索引.md": material("索引", "[[旧横断分析]] と [[tpl_復盤]] と [[AGENTS]] を見る。"),
    "90_归档/80_AI分析/旧横断分析.md": material("旧横断分析", ""),
    "99_系统/模板/tpl_復盤.md": material("tpl_復盤", ""),
    "AGENTS.md": "# AGENTS\n",
  });
  // vault:compact が 90_归档 へ移す先はまさにここ。移動が検査を赤くしてはいけない。
  assert.equal(result.status, 0, result.output);
});

test("同名ノートが2つあるだけでは問題にしない", async (t) => {
  const result = await check(t, {
    "20_求職/A社/面接準備_2026-07-28.md": material("面接準備", ""),
    "20_求職/B社/面接準備_2026-07-28.md": material("面接準備", ""),
  });
  // 同日に2社面接すれば同じ命名規則で普通に起きる。誰も曖昧に参照していなければ合法。
  assert.equal(result.status, 0, result.output);
});

test("同名ノートを曖昧に参照した時だけ、曖昧だと言って落とす", async (t) => {
  const result = await check(t, {
    "20_求職/A社/面接準備_2026-07-28.md": material("面接準備", ""),
    "20_求職/B社/面接準備_2026-07-28.md": material("面接準備", ""),
    "20_求職/索引.md": material("索引", "[[面接準備_2026-07-28]] を見る。"),
  });
  assert.notEqual(result.status, 0);
  assert.match(result.output, /同名ノートが複数あって決められない/u);
});

test("どこにも実体の無い参照は落とす", async (t) => {
  const result = await check(t, {
    "20_求職/索引.md": material("索引", "[[存在しないノート]] を見る。"),
  });
  assert.notEqual(result.status, 0);
  assert.match(result.output, /参照先が無い \[\[存在しないノート\]\]/u);
});
