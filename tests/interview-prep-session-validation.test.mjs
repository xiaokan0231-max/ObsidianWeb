import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

function prepBody(withCarryForward = false) {
  return `# 株式会社テスト 面接準備

## １．速査

| 使う場面 | 最初の一言 |
|---|---|
| 志望動機 | テスト社の公開方針と自分の経験を接続する |

## ２．勝ち筋と地雷

${withCarryForward ? `### 前回から今回への回流

| 種類 | 前回で確定したこと | 出典 | 今回どう変えるか |
|---|---|---|---|
| 課題 | 基盤強化 | [[前回整理稿#q01]] | 実績を先に出す |
` : ""}

## ６．想定問答

#### Q. 志望動機

##### 20秒版（既定）

【あなた】テスト社の公開方針に共感しました。私の基盤構築経験で貢献します。

▷ 根拠: [公式ページ](https://example.com/direct)
`;
}

test("vault:check は preparing の後続 session と legacy 前回を共存させる", async () => {
  const vault = await mkdtemp(join(tmpdir(), "prep-session-vault-"));
  try {
    const directory = join(vault, "20_求職", "Test");
    await mkdir(directory, { recursive: true });
    await Promise.all([
      writeFile(
        join(directory, "Test_case.md"),
        `---
type: job-case
case_id: test-case
company: 株式会社テスト
status: 面接中
status_updated: 2026-07-29
channel: 企業直投/ATS
origin: manual
---
# Test case
`,
      ),
      writeFile(
        join(directory, "_Test.md"),
        `---
type: company
company: 株式会社テスト
---
# Test
`,
      ),
      writeFile(
        join(directory, "面接準備_2026-07-20.md"),
        `---
type: interview-prep
company: 株式会社テスト
date: 2026-07-20
round: カジュアル面談
format: オンライン
interviewers: 採用担当
case: "[[Test_case]]"
---
${prepBody()}
`,
      ),
      writeFile(
        join(directory, "前回整理稿.md"),
        `---
type: study
company: 株式会社テスト
date: 2026-07-20
---
# 前回整理稿
## q01
`,
      ),
      writeFile(
        join(directory, "面接準備_Test_s02_一次面接.md"),
        `---
type: interview-prep
session_id: Test_case-s02
session_order: 2
session_status: preparing
company: 株式会社テスト
date: 未定
round: 一次面接
format: 未定
interviewers: 未定
case: "[[Test_case]]"
previous_prep: "[[面接準備_2026-07-20]]"
company_dossier: "[[_Test]]"
evidence_inputs:
  - "[[前回整理稿]]"
---
${prepBody(true)}
`,
      ),
    ]);

    const result = spawnSync(process.execPath, ["scripts/vault-check.mjs"], {
      cwd: process.cwd(),
      env: { ...process.env, OBSIDIAN_VAULT_PATH: vault },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /✅ 問題なし/);
  } finally {
    await rm(vault, { recursive: true, force: true });
  }
});

test("vault:check は後続 session の前回参照・証拠・回流欠落を止める", async () => {
  const vault = await mkdtemp(join(tmpdir(), "prep-session-invalid-"));
  try {
    const directory = join(vault, "20_求職", "Test");
    await mkdir(directory, { recursive: true });
    await Promise.all([
      writeFile(
        join(directory, "Test_case.md"),
        `---
type: job-case
case_id: test-case
company: 株式会社テスト
status: 未応募
origin: manual
---
# Test case
`,
      ),
      writeFile(
        join(directory, "面接準備_Test_s02_一次面接.md"),
        `---
type: interview-prep
session_id: Test_case-s02
session_order: 2
session_status: preparing
company: 株式会社テスト
date: 未定
round: 一次面接
format: 未定
interviewers: 未定
case: "[[Test_case]]"
---
${prepBody()}
`,
      ),
    ]);

    const result = spawnSync(process.execPath, ["scripts/vault-check.mjs"], {
      cwd: process.cwd(),
      env: { ...process.env, OBSIDIAN_VAULT_PATH: vault },
      encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /previous_prep が必須/);
    assert.match(result.stderr, /evidence_inputs が1件以上必要/);
    assert.match(result.stderr, /前回から今回への回流/);
  } finally {
    await rm(vault, { recursive: true, force: true });
  }
});
