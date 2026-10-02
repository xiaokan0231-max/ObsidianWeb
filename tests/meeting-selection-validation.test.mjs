import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

async function checkNotes(notes) {
  const vault = await mkdtemp(join(tmpdir(), "meeting-selection-vault-"));
  try {
    const directory = join(vault, "20_求職");
    await mkdir(directory, { recursive: true });
    await Promise.all(Object.entries(notes).map(([name, fields]) =>
      writeFile(join(directory, `${name}.md`), `---\n${fields}\n---\n# ${name}\n`),
    ));
    return spawnSync(process.execPath, ["scripts/vault-check.mjs"], {
      cwd: process.cwd(),
      env: { ...process.env, OBSIDIAN_VAULT_PATH: vault },
      encoding: "utf8",
    });
  } finally {
    await rm(vault, { recursive: true, force: true });
  }
}

const completedMeeting = `type: todo
status: 完了
priority: high
category: 面接準備
next_event_at: 2026-07-01 10:00`;

test("独立面談は準備完了後も waiting を保ち、明示的に closed にできる", async () => {
  const result = await checkNotes({
    "結果待ち": `${completedMeeting}\nselection_status: waiting`,
    "終了": `${completedMeeting}\nselection_status: 'closed'`,
    "未確認": completedMeeting,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("selection_status の不明値・空値・誤型を拒否する", async () => {
  const result = await checkNotes({
    "不明値": `${completedMeeting}\nselection_status: done`,
    "空値": `${completedMeeting}\nselection_status:`,
    "会社": "type: company\ncompany: 株式会社テスト\nselection_status: closed",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /不明値\.md: selection_status "done" は waiting \/ closed/);
  assert.match(result.stderr, /空値\.md: selection_status "" は waiting \/ closed/);
  assert.match(result.stderr, /会社\.md: selection_status は独立面談を正本とする todo 専用/);
});

test("案件と関連した面談に選考状態を重複保持させない", async () => {
  const result = await checkNotes({
    "案件": "type: job-case\ncase_id: test-case\ncompany: 株式会社テスト\nstatus: 未応募\norigin: manual",
    "関連面談": `${completedMeeting}\ncase_id: test-case\nselection_status: waiting`,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /関連面談\.md: selection_status と case_id は併用不可/);
});
