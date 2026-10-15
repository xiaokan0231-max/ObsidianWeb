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

test("旧版テンプレートの安定 session と 12 節を保持する", async () => {
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

test("旧版契約は company→session→6模块の Web 回読を保持する", async () => {
  const skill = await readFile(`${SKILL}/references/legacy-prep.md`, "utf8");
  assert.match(skill, /公司／job-case → session 轮次/);
  assert.match(skill, /最近的 scheduled → 最新 preparing → 最近 completed/);
  assert.match(skill, /本轮专属/);
  assert.match(skill, /案件共用（截至本轮）/);
  assert.match(skill, /全局共用/);
});


test("默认模板改为五个语义章节的 v2，旧版通过独立文档保留", async () => {
  const [skill, template] = await Promise.all([
    readFile(`${SKILL}/SKILL.md`, "utf8"),
    readFile(`${SKILL}/assets/面談準備_v2_テンプレート.md`, "utf8"),
  ]);
  assert.match(skill, /默认创建 `prep_version: 2`/);
  assert.match(skill, /assets\/面談準備_v2_テンプレート.md/);
  assert.match(skill, /references\/legacy-prep.md/);
  assert.match(template, /^prep_version: 2$/m);
  assert.deepEqual([...template.matchAll(/^## (.+)$/gm)].map((match) => match[1]), ["纵览与建议", "志望動機", "逆質問", "研究资料", "临场备用"]);
  assert.match(template, /^### 20秒版（既定）$/m);
  assert.match(template, /^▷ 根拠:/m);
  assert.equal([...template.matchAll(/^### [1-5]\./gm)].length, 5);
  assert.equal([...template.matchAll(/^### ★ /gm)].length, 3);
  assert.match(skill, /不设字数或全文阅读时长上限/);
  assert.match(skill, /不做移动适配或验收/);
});

test("v2 模板在临场备用开头固定冒頭・懸念・締め三块，填好后通过校验", async () => {
  const { PREP_V2_STAGE_BLOCKS, prepStageBlockIssues } = await import("../lib/interview-prep-validation.mjs");
  const template = await readFile(`${SKILL}/assets/面談準備_v2_テンプレート.md`, "utf8");
  const backup = template.slice(template.indexOf("## 临场备用"));
  const h3 = [...backup.matchAll(/^### (.+)$/gm)].map((match) => match[1]);
  assert.deepEqual(h3.slice(0, 3), PREP_V2_STAGE_BLOCKS.map((spec) => spec.title), "固定块在最前，顺序与标题原样");
  assert.match(backup, /\[\[自己紹介_音読台本#30秒版\]\]/);
  assert.equal([...backup.matchAll(/^#### [1-3]\. /gm)].length, 3, "懸念默认三点");
  assert.match(backup, /^#### 当日お礼メッセージ$/m);
  assert.match(backup, /ぜひ選考（せんこう）に進（すす）ませていただきたい/);
  assert.match(backup, /第一志望群/);
  // 模板自带新契约标记；占位符换成任意正文后，三块满足校验器（照模板写的新稿就能过）。
  assert.match(template, /^prep_contract: 2026-10$/m);
  const filled = template.replace(/\{\{[^}]*\}\}/g, "テストです。");
  assert.deepEqual(prepStageBlockIssues(filled, { contract: "2026-10" }), []);
});

test("v2 模板的逆質問：面接官研究在前，五题各带用到的信息、预想回答与接话", async () => {
  const { prepReverseQuestionIssues } = await import("../lib/interview-prep-validation.mjs");
  const template = await readFile(`${SKILL}/assets/面談準備_v2_テンプレート.md`, "utf8");
  const questions = template.slice(template.indexOf("## 逆質問"), template.indexOf("## 研究资料"));
  assert.deepEqual([...questions.matchAll(/^### (.+)$/gm)].map((match) => match[1].replace(/\{\{[^}]*\}\}/g, "…")), [
    "面接官研究", "1. 〔面接官本人型〕…", "2. 〔经验连接型〕…", "3. 〔…〕…", "4. 备用｜〔…〕…", "5. 备用｜〔…〕…",
  ]);
  for (const label of ["**用到的信息**", "**预想回答与接话**", "▷ 这一问还能帮你判断"]) {
    assert.equal(questions.split(label).length - 1, 5, label);
  }
  assert.equal(questions.split("【面接官】").length - 1, 10, "每题两组预想回答");
  assert.match(questions, /最後（さいご）に一点（いってん）だけ、お伺（うかが）いしてもよろしいでしょうか/);
  // 旧的信息收集格式退场，「如何判断」降为题末备注。
  assert.doesNotMatch(questions, /\*\*(?:目的|听清什么|如何判断|答后怎么接)\*\*/);
  // 把占位换成真实的问法与短句后，新稿照模板写就能过逆質問校验。
  const filled = template
    .replace(/\{\{已确认出席者[^}]*\}\}/, "出席者未确认，现场用开场自我介绍接。")
    .replace(/〔\{\{[^}]*\}\}〕/g, "〔事业课题型〕")
    .replace(/【あなた】\{\{(?:前置き|先一句)[^}]*\}\}/g, "【あなた】御社のブログで、データ基盤を作り直された経緯を拝見しました。作り直すと決めたとき、どんな点を一番重視して判断されたのでしょうか。")
    .replace(/\{\{[^}]*\}\}/g, "テストです。");
  assert.deepEqual(prepReverseQuestionIssues(filled, { strict: true, round: "一次面接" }), []);
});

test("SKILL 与方法论：被问到才说边界，逆質問用双方信息把话聊起来，交付前查主动示弱", async () => {
  const [skill, methodology] = await Promise.all([
    readFile(`${SKILL}/SKILL.md`, "utf8"),
    readFile(`${SKILL}/references/methodology.md`, "utf8"),
  ]);
  for (const text of [skill, methodology]) {
    assert.match(text, /未被问的负面信息或道歉/);
    assert.match(text, /面接官本人型/);
    assert.match(text, /经验连接型/);
    assert.match(text, /预想回答/);
    assert.match(text, /一句话能答完吗/);
    assert.doesNotMatch(text, /2 个意欲・贡献型＋1 个业务理解型/, "旧 brief 的逆質問规则已作废");
  }
  assert.match(methodology, /被问到才说边界，并配现状＋计划/);
  assert.doesNotMatch(methodology, /边界 → 真实证据 → 能承担的范围/);
  assert.match(skill, /冒頭30秒、本場の懸念 TOP3 と先回り一言、締めの一言/);
  assert.match(skill, /面试当天和前一天默认打开临场卡/);
  assert.match(skill, /### 面接官研究/);
  assert.match(skill, /type: interview-prep-replay/);
  assert.match(skill, /## 对照：当时实际发生了什么／新稿会改变什么/);
});
