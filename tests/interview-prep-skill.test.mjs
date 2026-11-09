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

test("v2 模板在临场备用开头固定規律・冒頭・事実カード・懸念・締め五块，填好后通过校验", async () => {
  const { PREP_V2_STAGE_BLOCKS, PREP_V2_FACT_ROWS, prepStageBlockIssues } = await import("../lib/interview-prep-validation.mjs");
  const template = await readFile(`${SKILL}/assets/面談準備_v2_テンプレート.md`, "utf8");
  const backup = template.slice(template.indexOf("## 临场备用"));
  const h3 = [...backup.matchAll(/^### (.+)$/gm)].map((match) => match[1]);
  assert.deepEqual(h3.slice(0, PREP_V2_STAGE_BLOCKS.length), PREP_V2_STAGE_BLOCKS.map((spec) => spec.title), "固定块在最前，顺序与标题原样");
  assert.match(backup, /\[\[自己紹介_音読台本#30秒版\]\]/);
  // 規律取自趋势表；事実カード八行必有，逐社子表只抄転職理由台本的台本栏。
  assert.match(backup, /\[\[面接傾向_横断#/);
  for (const row of PREP_V2_FACT_ROWS) assert.match(backup, new RegExp(`^\\| ${row.key} \\|`, "m"), row.key);
  assert.match(backup, /^#### 逐社退職理由/m);
  assert.match(backup, /\[\[転職理由台本#逐社一句/);
  assert.match(backup, /【内部・言わない】欄は写さない/);
  // 懸念前两点固定：定着与日本語，第三点本场特有。
  assert.deepEqual([...backup.matchAll(/^#### [1-3]\. (.+)$/gm)].map((match) => match[1].slice(0, 3)), ["定着（", "日本語", "{{本"]);
  assert.match(backup, /^#### 当日お礼メッセージ$/m);
  assert.match(backup, /ぜひ選考（せんこう）に進（すす）ませていただきたい/);
  assert.match(backup, /第一志望群/);
  // 模板自带新契约标记；占位符换成任意正文后，五块满足校验器（照模板写的新稿就能过）。
  assert.match(template, /^prep_contract: 2026-11$/m);
  const filled = template.replace(/\{\{[^}]*\}\}/g, "テストです。");
  assert.deepEqual(prepStageBlockIssues(filled, { contract: "2026-11" }), []);
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
    .replace(/\{\{区分确定出席者[^}]*\}\}/, "出席者未确认，现场用开场自我介绍接。")
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
  assert.match(skill, /本場の規律、冒頭30秒、HR事実カード、本場の懸念 TOP3 と先回り一言、締めの一言/);
  // 事実カード与規律在 skill 和方法论里都有说明，内部栏不进稿的红线也在两处。
  for (const text of [skill, methodology]) {
    assert.match(text, /HR事実カード/);
    assert.match(text, /逐社退職理由/);
    assert.match(text, /【内部】栏永远不进稿/);
  }
  assert.match(methodology, /結論→証拠二文→止める/);
  assert.match(skill, /临场卡由本人点击打开/);
  assert.match(skill, /### 面接官研究/);
  assert.match(skill, /type: interview-prep-replay/);
  assert.match(skill, /## 对照：当时实际发生了什么／新稿会改变什么/);
});
