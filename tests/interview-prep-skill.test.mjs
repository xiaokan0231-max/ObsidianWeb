import assert from "node:assert/strict";
import { readFile, readlink } from "node:fs/promises";
import test from "node:test";

const SKILL = ".agents/skills/japan-interview-prep";

test("Claude Code と Codex は同じ面接準備 skill を使う", async () => {
  const [skill, link] = await Promise.all([
    readFile(`${SKILL}/SKILL.md`, "utf8"),
    readlink(".claude/skills/japan-interview-prep"),
  ]);
  assert.equal(link, "../../.agents/skills/japan-interview-prep");
  assert.match(skill, /^name: japan-interview-prep$/m);
  assert.match(skill, /旧 prep 的人工正文必须保持不变/);
  assert.match(skill, /SHA-256/);
});

test("新しい準備テンプレートは安定 session と前輪 evidence を契約にする", async () => {
  const template = await readFile(
    `${SKILL}/assets/面談準備_テンプレート.md`,
    "utf8",
  );
  for (const field of [
    "session_id:",
    "session_order:",
    "session_status:",
    "previous_prep:",
    "company_dossier:",
    "evidence_inputs:",
  ]) {
    assert.match(template, new RegExp(`^${field}`, "m"), field);
  }
  assert.match(template, /^### 前回から今回への回流/m);
  assert.match(template, /根拠（同社前回 qNN／横断）/);
  assert.match(template, /今回の修正/);
  assert.match(template, /既存パスなら停止/);
  assert.match(template, /未来回は混ぜない/);

  const h2 = [...template.matchAll(/^##\s+/gm)];
  assert.equal(h2.length, 12, "Web／埋め込み契約の12節を増減しない");
});

test("skill は company→session→6模块の Web 回読まで要求する", async () => {
  const skill = await readFile(`${SKILL}/SKILL.md`, "utf8");
  assert.match(skill, /公司／job-case → session 轮次/);
  assert.match(skill, /最近的 scheduled → 最新 preparing → 最近 completed/);
  assert.match(skill, /本轮专属/);
  assert.match(skill, /案件共用（截至本轮）/);
  assert.match(skill, /全局共用/);
});
