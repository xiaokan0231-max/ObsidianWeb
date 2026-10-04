import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

// 快練ログは読み取り側がパスで当月分を探し、month で月を決める。
// どちらかがずれると事件が別の月に入るか消えるので vault:check で落とす。
// 逆に正しいログで落ちると Stop hook が練習のたびに止まるため、合法な形が通ることも固定する。

function runCheck(root) {
  return spawnSync(process.execPath, ["scripts/vault-check.mjs"], {
    encoding: "utf8",
    cwd: process.cwd(),
    env: { ...process.env, OBSIDIAN_VAULT_PATH: root },
  });
}

// vault:check は 20_求職 を必ず走査する。空 vault では readdir が落ちるので、無関係な素材を1枚置く。
const BASELINE = { "20_求職/覚書.md": "---\ntype: material\n---\n# 覚書\n" };

async function check(t, files) {
  const root = await mkdtemp(join(tmpdir(), "vault-check-quick-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [path, content] of Object.entries({ ...BASELINE, ...files })) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  const result = runCheck(root);
  return { ...result, output: `${result.stdout}${result.stderr}` };
}

const quickLog = (month) => `---
type: language-quick-log
month: "${month}"
layer: user-action
schema_version: 1
---
# ${month} 快練ログ

<!-- language-quick-event:{"eventId":"e1","itemId":"li2_test","type":"cloze_choice","action":"answer","response":"に","passed":true,"first":true,"at":"${month}-02T01:00:00.000Z"} -->
`;

test("正しい場所・month の快練ログは通る（month の引用符の有無は問わない）", async (t) => {
  const result = await check(t, {
    "30_日本語学習/快練ログ/2026-10_快練ログ.md": quickLog("2026-10"),
    "30_日本語学習/快練ログ/2026-11_快練ログ.md": quickLog("2026-11").replace('month: "2026-11"', "month: 2026-11"),
  });
  assert.equal(result.status, 0, result.output);
});

test("month がファイル名と食い違う快練ログは落ちる", async (t) => {
  const result = await check(t, { "30_日本語学習/快練ログ/2026-10_快練ログ.md": quickLog("2026-09") });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /month（2026-09）がファイル名の 2026-10 と一致しない/u);
});

test("所定フォルダ外・日付付きファイル名の快練ログは落ちる", async (t) => {
  const result = await check(t, { "30_日本語学習/快練ログ/2026-10-02_快練ログ.md": quickLog("2026-10") });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /30_日本語学習\/快練ログ\/YYYY-MM_快練ログ\.md に置く/u);
});
