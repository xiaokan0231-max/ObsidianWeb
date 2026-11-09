import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  getPrepV2Section,
  parseInterviewPrepDoc,
} from "../lib/interview-prep-doc.ts";
import {
  companyMotivationIssues,
  findCompanyMotivationHeading,
  interviewPrepStructureIssues,
  interviewPrepVersion,
  prepCarryForwardIssues,
  prepContractReminder,
  prepReverseQuestionIssues,
  prepStageBlockIssues,
} from "../lib/interview-prep-validation.mjs";
import {
  companyMotivationAssetTarget,
  parseSharedAssetDocument,
} from "../lib/interview-shared-assets.ts";

const BODY = `# 株式会社テスト 面接準備

## 纵览与建议

### 工作与机会

公司情况与建议。[正文补充](https://example.com/overview)

## 志望動機

### 20秒版（既定）

【あなた】御社のデータ基盤事業に興味を持ちました。私の開発経験で貢献（こうけん）したいです。

▷ 根拠: [公司直接页面](https://example.com/company)

### 追問されたら

【あなた】信頼性を改善した経験があります。

## 逆質問

### 1. 主问题

【あなた】最初に期待される成果を教えていただけますか。

## 研究资料

### ⭐ [公司直接页面](https://example.com/company)

读到了什么：数据基础设施业务。与你的关系：开发经验。

### 其他资料

- [案例全文与工作职责说明](https://example.com/case)
- [公司重复](https://example.com/company)
- [会在临场备用提及](https://example.com/reference)

## 临场备用

### 本场难题

【あなた】簡潔に説明します。

[会议入口](https://example.com/meeting)
`;

const STAGE = `### 冒頭30秒

【あなた】本日はお時間をいただき、ありがとうございます。

自己紹介を求められたら：[[自己紹介_音読台本#30秒版]]

### 本場の懸念 TOP3 と先回り一言

#### 1. 定着

【あなた】腰を据えて長く取り組める環境を探しています。

### 締めの一言

【あなた】ぜひ選考に進ませていただきたいです。

#### 当日お礼メッセージ

本日はお時間をいただき、ありがとうございました。

`;
const WITH_STAGE = BODY.replace("### 本场难题", `${STAGE}### 本场难题`);

const PROMPT = "〇〇様は、御社で長く採用に携わってこられたと伺いました。中途で入社して早く現場で信頼された方には、どんな共通点がありましたか。";
const question = (no, type, prompt = PROMPT) => `### ${no}. ${no >= 4 ? "备用｜" : ""}〔${type}〕テーマ${no}

【あなた】${prompt}

**用到的信息**：对方＝当场自我介绍；本人＝无

**预想回答与接话**：

【面接官】現場との関係づくりを大事にしている方が多いですね。

【あなた】ありがとうございます。具体的には、どんな場面でしたか。

【面接官】最初の案件で、メンバーと方針をすり合わせた方です。

【あなた】その中で、中途で入った方は、最初にどの工程を担当されることが多いですか。

【あなた】ありがとうございます。最初の進め方がよく分かりました。

▷ 这一问还能帮你判断：新人如何融入团队。

`;
const questionsSection = (types = ["面接官本人型", "经验连接型", "事业课题型", "活跃期待型", "确认型"]) => `## 逆質問

### 面接官研究

出席者未确认，现场用开场自我介绍接。

【あなた】先ほど〇〇とおっしゃっていましたが、もう少し伺ってもよろしいでしょうか。

${types.map((type, index) => question(index + 1, type)).join("")}`;
const WITH_QUESTIONS = WITH_STAGE.replace(/## 逆質問[\s\S]*?(?=## 研究资料)/, questionsSection());

// 2026-11 契约：規律与事実カード加在三块之间，懸念固定打底定着与日本語。句子都是虚构的测试值。
const STAGE_2026_11 = `### 本場の規律

- 結論→証拠二文→止める。
- 過去／未来・個人／チーム・社数／業態を確認してから答える。
- 聞かれていない負号・謝罪・自己評価を出さない。

▷ 出典：[[面接傾向_横断#反復している戦略タグ（2 場以上で出たものだけ）]]。

### 冒頭30秒

【あなた】本日はお時間をいただき、ありがとうございます。

自己紹介を求められたら：[[自己紹介_音読台本#30秒版]]

### HR事実カード

▷ 正本確認：在留・年収・他社は 2026-11-01 本人確認。

| 聞かれること | 最初の一文（【あなた】） | 正本 |
|---|---|---|
| 直近の役職 | 直近は株式会社テストでリードエンジニアとして、データ基盤の設計を担当しました。 | [[面接標準回答集#p49 直近の役職・担当責任：先回答过去事实]] |
| 来日理由 | 日本で長く働くために来日しました。 | [[面接標準回答集#p10 来日本的理由：为什么来、为什么留下]] |
| 在留・入社時期 | 就労資格への変更が必要で、入社日は許可取得後にご相談したいです。 | [[面接標準回答集#p27 在留資格と就労可能時期]] |
| 希望年収 | 希望は年収（ねんしゅう）400万円以上です。役割を伺ったうえでご相談したいです。 | [[求職硬性約束]] |
| 他社状況 | 他社は書類選考中が一社あります。 | [[面接標準回答集#p24 他社選考状況]] |
| リーダー経験・規模 | チームリーダーは通算約3年、正式な最大人数は4名です。 | [[面接標準回答集#p17 管理经验与今后的领导角色]] |
| 日本語での業務範囲 | チーム内の要件確認と技術文書は日本語で対応できます。顧客対応は技術面から広げたいです。 | [[面接標準回答集#p09 日语环境下的客户折衝]] |
| 強みを一言で | 軸はデータ基盤の設計です。 | [[面接標準回答集#p01 自我介绍：从技术标签改成问题解决能力]] |

#### 逐社退職理由（聞かれた社だけ一句で）

| 社名 | 期間 | 【あなた】一句 |
|---|---|---|
| 株式会社テスト | 2020-04〜2023-03 | 事業の縮小に伴い、次の構築機会を求めて転職しました。 |

▷ 正本：[[転職理由台本#逐社一句(深掘り対策)]]。

### 本場の懸念 TOP3 と先回り一言

#### 1. 定着

【あなた】腰を据えて長く取り組める環境を探しています。

#### 2. 日本語での業務範囲

【あなた】チーム内の要件確認は日本語で進め、顧客対応は段階的に広げたいです。

#### 3. 立ち上がり

【あなた】まず既存の運用を理解し、三か月を目安に担当範囲を広げます。

### 締めの一言

【あなた】ぜひ選考に進ませていただきたいです。

#### 当日お礼メッセージ

本日はお時間をいただき、ありがとうございました。

`;
const WITH_STAGE_11 = BODY.replace("### 本场难题", `${STAGE_2026_11}### 本场难题`);

function prepNote(content = BODY, version = 2) {
  return {
    path: "20_求職/Test/准备.md",
    stat: { ctime: 0, mtime: 0, size: content.length },
    tags: [],
    frontmatter: { type: "interview-prep", company: "株式会社テスト", prep_version: version },
    content,
  };
}

test("prep_version 只接受缺省、1 和 2，未知版本不会降级成历史稿", () => {
  for (const value of [undefined, 1, "1"]) assert.equal(interviewPrepVersion(value), 1);
  for (const value of [2, "2"]) assert.equal(interviewPrepVersion(value), 2);
  for (const value of [null, "", 0, 3, "02", [], true]) {
    assert.equal(interviewPrepVersion(value), null);
    assert.equal(parseInterviewPrepDoc(prepNote(BODY, value), []), null);
  }
  const legacyNote = prepNote(BODY);
  delete legacyNote.frontmatter.prep_version;
  const legacy = parseInterviewPrepDoc(legacyNote, []);
  assert.equal(legacy.prepVersion, 1);
  assert.equal(legacy.sections[0].id, "prep-sec-0");
  assert.deepEqual(legacy.externalLinks, []);
});

test("v2 五个语义章节使用固定入口，资料抽取只读研究资料且支持标题链接", () => {
  const doc = parseInterviewPrepDoc(prepNote(), []);
  assert.equal(doc.prepVersion, 2);
  assert.deepEqual(doc.sections.map((section) => section.navLabel), ["纵览", "志望動機", "逆質問", "资料", "临场备用"]);
  assert.equal(getPrepV2Section(doc.sections, "motivation").id, "prep-v2-motivation");
  assert.deepEqual(doc.externalLinks.map((link) => link.href), [
    "https://example.com/company", "https://example.com/case", "https://example.com/reference",
  ]);
  assert.equal(doc.externalLinks[0].starred, true);
  assert.equal(doc.externalLinks[1].starred, false);
});

test("v2 志望動機入口限制到选中稿的 H2，保留注音和独立追问", () => {
  const doc = parseInterviewPrepDoc(prepNote(), []);
  const target = companyMotivationAssetTarget(doc);
  assert.equal(target.section, "志望動機");
  assert.equal(target.note, doc.note.path);
  assert.equal(target.scope, "round");
  const shared = parseSharedAssetDocument(doc.note, target.section);
  assert.deepEqual(shared.sections.map((section) => section.title), ["20秒版（既定）", "追問されたら"]);
  assert.match(JSON.stringify(shared.sections[0].blocks), /"kind":"ruby"/);
  assert.doesNotMatch(JSON.stringify([shared.intro, shared.sections]), /最初に期待される成果|工作与机会/);
  assert.equal(findCompanyMotivationHeading(BODY, 1), null);
});

test("v2 校验五节、2至3句台词与同节根拠，不再要求旧版速查", () => {
  assert.deepEqual(interviewPrepStructureIssues(BODY, 2), []);
  assert.deepEqual(companyMotivationIssues(BODY, 2), []);
  assert.match(interviewPrepStructureIssues(BODY.replace("## 临场备用", "## 额外章节"), 2).join("\n"), /临场备用|额外章节/);
  assert.match(interviewPrepStructureIssues(`${BODY}\n## 研究资料\n重复`, 2).join("\n"), /当前 2 个/);
  assert.match(companyMotivationIssues(BODY.replace("### 20秒版（既定）", "##### 20秒版（既定）"), 2).join("\n"), /### 20秒版/);
  assert.match(companyMotivationIssues(BODY.replace("私の開発経験で貢献（こうけん）したいです。", ""), 2).join("\n"), /2〜3句/);
  assert.match(companyMotivationIssues(BODY.replace(/^▷ 根拠:.*\n/m, ""), 2).join("\n"), /公式の直接ページ/);
  assert.match(companyMotivationIssues(BODY.replace("御社のデータ基盤事業", "{{公司事实}}"), 2).join("\n"), /置換済み/);
});

test("临场备用三块：带新模板标记 prep_contract 才强制；旧模板稿按日期不拦，只给提醒", () => {
  // 面试日期不再触发强制：旧模板写的草稿补上日期那一刻，不能拦住整个 vault。
  for (const date of ["2026-10-15", "未定", "2026-10-16", "2026-12-01"]) assert.deepEqual(prepStageBlockIssues(BODY, { date }), [], date);
  const due = prepStageBlockIssues(BODY, { contract: "2026-10" }).join("\n");
  for (const title of ["冒頭30秒", "本場の懸念 TOP3 と先回り一言", "締めの一言"]) assert.match(due, new RegExp(title));
  assert.deepEqual(prepStageBlockIssues(WITH_STAGE, { contract: "2026-10" }), []);
  // 经由结构检查接进 vault:check；标记从 frontmatter 传入，未知值直接报。
  assert.deepEqual(interviewPrepStructureIssues(WITH_QUESTIONS, 2, { contract: "2026-10" }), []);
  assert.match(interviewPrepStructureIssues(BODY, 2, { contract: "2026-10" }).join("\n"), /締めの一言/);
  assert.match(interviewPrepStructureIssues(WITH_QUESTIONS, 2, { contract: "2027-01" }).join("\n"), /prep_contract 只支持 2026-10/);
  // 旧模板稿：面试日期到生效日才提醒；已带标记或已补齐就不提醒。
  assert.equal(prepContractReminder(BODY, 2, { date: "2026-10-15" }), null);
  assert.equal(prepContractReminder(BODY, 2, { date: "未定" }), null);
  assert.match(prepContractReminder(BODY, 2, { date: "2026-10-16" }), /旧模板/);
  assert.equal(prepContractReminder(BODY, 2, { date: "2026-10-16", contract: "2026-10" }), null);
  assert.equal(prepContractReminder(WITH_QUESTIONS, 2, { date: "2026-10-16" }), null);
  assert.equal(prepContractReminder(BODY, 1, { date: "2026-10-16" }), null);
  // 只写了一块也要写全，不论日期。
  const partial = BODY.replace("### 本场难题", "### 締めの一言\n\n【あなた】ぜひ選考に進ませていただきたいです。\n\n#### 当日お礼メッセージ\n\n本日はありがとうございました。\n\n### 本场难题");
  assert.match(prepStageBlockIssues(partial).join("\n"), /冒頭30秒/);
});

test("临场备用三块逐项检查：朗读节链接、懸念台词、单纯否定或道歉、お礼短文", () => {
  const issues = (from, to) => prepStageBlockIssues(WITH_STAGE.replace(from, to)).join("\n");
  assert.match(issues("[[自己紹介_音読台本#30秒版]]", "[[自己紹介_音読台本]]"), /指定朗读节/);
  assert.match(issues("【あなた】腰を据えて長く取り組める環境を探しています。", "▷ 只写了推断。"), /懸念「1\. 定着」缺少/);
  assert.match(issues("#### 1. 定着", "1. 定着"), /1〜3 个/);
  // 注音不能让单纯否定躲过检查。
  assert.match(issues("腰を据えて長く取り組める環境を探しています。", "本番運用（ほんばんうんよう）の経験（けいけん）はまだありません。"), /本場の懸念.*单纯否定或道歉/);
  assert.match(issues("ぜひ選考に進ませていただきたいです。", "申し訳ございません、以上です。"), /締めの一言.*单纯否定或道歉/);
  assert.match(issues("【あなた】ぜひ選考に進ませていただきたいです。", "▷ 忘了写。"), /志望度表达/);
  assert.match(issues("本日はお時間をいただき、ありがとうございました。", "▷ 只有发送说明。"), /当日お礼メッセージ」缺少/);
  assert.match(issues("#### 当日お礼メッセージ", "#### お礼"), /当日お礼メッセージ`（当前 0 个）/);
  // 被问到才用的高风险短答不在检查范围：边界可以说，是否配了现状＋计划由内容复核把关。
  assert.deepEqual(prepStageBlockIssues(WITH_STAGE.replace("【あなた】簡潔に説明します。", "【あなた】本番運用の経験はまだありません。")), []);
});

test("2026-11 契约：規律与事実カード必有，懸念固定打底定着与日本語；2026-10 稿与无标记样稿不受影响", () => {
  assert.deepEqual(prepStageBlockIssues(WITH_STAGE_11, { contract: "2026-11" }), []);
  assert.deepEqual(interviewPrepStructureIssues(WITH_STAGE_11.replace(/## 逆質問[\s\S]*?(?=## 研究资料)/, questionsSection()), 2, { contract: "2026-11", round: "一次面接" }), []);
  // 旧契约的稿照旧；没写 prep_contract 的对照样稿与 strict 都按最早一版查，不因加版被拦。
  assert.deepEqual(prepStageBlockIssues(WITH_STAGE, { contract: "2026-10" }), []);
  assert.deepEqual(prepStageBlockIssues(WITH_STAGE, { replay: true }), []);
  assert.deepEqual(prepStageBlockIssues(WITH_STAGE, { strict: true }), []);
  const due = prepStageBlockIssues(WITH_STAGE, { contract: "2026-11" }).join("\n");
  for (const text of ["本場の規律", "HR事実カード", "3〜4 个", "固定打底「日本語」"]) assert.match(due, new RegExp(text));
  assert.match(interviewPrepStructureIssues(WITH_QUESTIONS, 2, { contract: "2027-01" }).join("\n"), /只支持 2026-10／2026-11/);
  assert.match(prepContractReminder(BODY, 2, { date: "2026-10-16" }), /prep_contract: 2026-11/);
  // 事実カード逐行：必有行、第一句不能单纯否定、第三列回链正本、逐社子表与出处。
  const issues = (from, to) => prepStageBlockIssues(WITH_STAGE_11.replace(from, to), { contract: "2026-11" }).join("\n");
  assert.match(issues("| 希望年収 |", "| 希望の金額 |"), /缺少「希望年収」一行/);
  assert.match(issues("チームリーダーは通算約3年、正式な最大人数は4名です。", "チームを率いた経験（けいけん）はまだありません。"), /「リーダー経験・規模」不能用单纯否定/);
  assert.match(issues("[[面接標準回答集#p24 他社選考状況]]", "p24"), /「他社状況」要在第三列回链正本/);
  assert.match(issues("#### 逐社退職理由（聞かれた社だけ一句で）", "#### 退職理由"), /逐社退職理由…` 子表（当前 0 个）/);
  assert.match(issues("| 株式会社テスト | 2020-04〜2023-03 | 事業の縮小に伴い、次の構築機会を求めて転職しました。 |", "| 株式会社テスト | 2020-04〜2023-03 |  |"), /一句不能留空/);
  assert.match(issues("[[転職理由台本#逐社一句(深掘り対策)]]", "転職理由台本"), /回链 `\[\[転職理由台本#…\]\]`/);
  // 規律：2〜4 条列表项并有出处。
  assert.match(issues("- 結論→証拠二文→止める。\n- 過去／未来・個人／チーム・社数／業態を確認してから答える。\n", ""), /2〜4 条列表项（当前 1 条）/);
  assert.match(issues("[[面接傾向_横断#反復している戦略タグ（2 場以上で出たものだけ）]]", "横断趋势表"), /回链出处/);
  // 懸念：固定两点缺一不可，总数 3〜4。
  assert.match(issues("#### 2. 日本語での業務範囲", "#### 2. 業務範囲"), /固定打底「日本語」/);
  assert.match(issues("#### 1. 定着", "#### 1. 立ち上がり前"), /固定打底「定着」/);
});

test("新版逆質問：旧格式稿不查，带标记或开始用新格式后按面接官研究＋五题检查", () => {
  assert.deepEqual(prepReverseQuestionIssues(BODY, { date: "2026-10-20" }), []);
  assert.match(prepReverseQuestionIssues(BODY, { contract: "2026-10" }).join("\n"), /面接官研究/);
  assert.deepEqual(prepReverseQuestionIssues(WITH_QUESTIONS, { round: "一次面接" }), []);
  assert.deepEqual(interviewPrepStructureIssues(WITH_QUESTIONS, 2, { contract: "2026-10", round: "一次面接" }), []);
});

test("新版逆質問逐题检查：是非题、单问期待、自贬、接话组数、题型组合与早期轮次的确认型", () => {
  const issues = (text, options = {}) => prepReverseQuestionIssues(WITH_QUESTIONS.replace(/## 逆質問[\s\S]*?(?=## 研究资料)/, text), options).join("\n");
  const one = (prompt) => questionsSection().replace(PROMPT, prompt);
  assert.match(issues(one("〇〇様は、御社で長く採用に携わってこられたと伺いました。中途で入社した方も、現場で活躍されていますか。")), /不问是非/);
  assert.match(issues(one("最も期待されることは何でしょうか。入社後に一番求められる役割について、具体的に教えていただけますか。")), /最も期待されること/);
  assert.match(issues(one("つまらない質問かもしれませんが、中途で入社して早く現場で信頼された方には、どんな共通点がありましたか。")), /自贬/);
  assert.match(issues(one("採用に携わってこられたと伺いました。長く見てこられました。どんな共通点がありましたか。")), /最多 2 句/);
  assert.match(issues(one("どんな方が活躍していますか。")), /60〜110 字/);
  const single = questionsSection().replace("【面接官】最初の案件で、メンバーと方針をすり合わせた方です。\n\n【あなた】その中で、中途で入った方は、最初にどの工程を担当されることが多いですか。\n\n", "");
  assert.match(issues(single), /2〜3 组/);
  assert.match(issues(questionsSection(["事业课题型", "经验连接型", "事业课题型", "活跃期待型", "确认型"])), /至少要有 1 个〔面接官本人型〕/);
  const casual = questionsSection(["面接官本人型", "经验连接型", "确认型", "活跃期待型", "事业课题型"]);
  assert.match(issues(casual, { round: "カジュアル面談" }), /〔确认型〕不当主问题/);
  assert.doesNotMatch(issues(casual, { round: "人事面接" }), /确认型/);
  assert.match(issues(questionsSection().replace("### 4. 备用｜", "### 4. ")), /备用题/);
  assert.match(issues(questionsSection().replace("出席者未确认，现场用开场自我介绍接。", "出席者是采用担当。")), /直接 URL，或写明「未确认」/);
});

test("v2 后续轮次只接受纵览内的回流章节，其他节和注释不能替代", () => {
  const carry = "### 前回から今回への回流\n\n前回的事实、出处与本轮调整。\n\n";
  assert.deepEqual(prepCarryForwardIssues(BODY.replace("### 工作与机会", `${carry}### 工作与机会`), 2), []);
  assert.match(prepCarryForwardIssues(`${BODY}\n${carry}`, 2).join("\n"), /纵览与建议/);
  assert.match(prepCarryForwardIssues(BODY.replace("### 工作与机会", `<!--\n${carry}-->\n### 工作与机会`), 2).join("\n"), /纵览与建议/);
});

test("vault:check 接受同案件的新旧稿，并拒绝未知版本与放错位置的回流", async () => {
  const vault = await mkdtemp(join(tmpdir(), "prep-v2-vault-"));
  try {
    const directory = join(vault, "20_求職", "Test");
    await mkdir(directory, { recursive: true });
    const legacy = `---
type: interview-prep
company: 株式会社テスト
date: 2026-08-01
round: 一次面接
format: オンライン
interviewers: 採用担当
case: "[[Test_case]]"
---
# 株式会社テスト
## １．速査
| 使う場面 | 最初の一言 |
|---|---|
| 志望動機 | 固有の事業と経験 |
## ６．想定問答
#### Q. 志望動機
##### 20秒版（既定）
【あなた】御社の方針に共感しました。私の開発経験で貢献します。
▷ 根拠: [公式](https://example.com/company)
`;
    const frontmatter = `---
type: interview-prep
prep_version: 2
session_id: test-s02
session_order: 2
session_status: scheduled
company: 株式会社テスト
date: 2026-09-01
round: 二次面接
format: オンライン
interviewers: 採用担当
case: "[[Test_case]]"
previous_prep: "[[legacy]]"
evidence_inputs:
  - "[[前回整理稿]]"
---
`;
    const carry = "### 前回から今回への回流\n\n[[前回整理稿]] から開発経験を先に説明する。\n\n";
    const second = frontmatter + BODY.replace("### 工作与机会", `${carry}### 工作与机会`);
    await Promise.all([
      writeFile(join(directory, "Test_case.md"), "---\ntype: job-case\ncase_id: test-case\ncompany: 株式会社テスト\nstatus: 未応募\norigin: manual\n---\n# Test case\n"),
      writeFile(join(directory, "legacy.md"), legacy),
      writeFile(join(directory, "前回整理稿.md"), "# 前回整理稿\n"),
      writeFile(join(directory, "自己紹介_音読台本.md"), "# 自己紹介\n\n## 30秒版\n\n【あなた】テストと申します。\n"),
      writeFile(join(directory, "second.md"), second),
    ]);
    const check = () => spawnSync(process.execPath, ["scripts/vault-check.mjs"], {
      cwd: process.cwd(), env: { ...process.env, OBSIDIAN_VAULT_PATH: vault }, encoding: "utf8",
    });
    let result = check();
    assert.equal(result.status, 0, result.stderr || result.stdout);
    await writeFile(join(directory, "second.md"), second.replace("prep_version: 2", "prep_version: 3"));
    result = check();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /prep_version/);
    await writeFile(join(directory, "second.md"), `${frontmatter}${BODY}\n${carry}`);
    result = check();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /纵览与建议中缺少/);
    // 旧模板稿补上 10-16 以后的日期：只给 ⚠️ 提醒，不拦。
    const dated = second.replace("date: 2026-09-01", "date: 2026-10-20");
    await writeFile(join(directory, "second.md"), dated);
    result = check();
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stderr, /second\.md: 按旧模板写成/);
    // 带上新模板标记就按新契约强制：缺临场三块与新版逆質問会被拦下，补齐即通过且不再提醒。
    const contracted = dated.replace("prep_version: 2\n", "prep_version: 2\nprep_contract: 2026-10\n");
    await writeFile(join(directory, "second.md"), contracted);
    result = check();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /冒頭30秒/);
    await writeFile(join(directory, "second.md"), contracted.replace("### 本场难题", `${STAGE}### 本场难题`).replace(/## 逆質問[\s\S]*?(?=## 研究资料)/, questionsSection()));
    result = check();
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.doesNotMatch(result.stderr, /按旧模板写成/);
  } finally {
    await rm(vault, { recursive: true, force: true });
  }
});

test("v2 将岗位、准确时间与会议信息提至页头，保留附加现场信息", async () => {
  const { prepV2Overview, prepSourceHost } = await import("../lib/interview-prep-v2.ts");
  const body = BODY.replace("### 工作与机会", `### 基本情報

| 项目 | 内容 |
|---|---|
| 岗位 | データエンジニア |
| 日時 | 2026年9月24日（木）17:00 JST |
| 場所 | [进入会议](https://example.com/meeting?code=test) |
| 持ち物 | メモ用紙 |

### 工作与机会`);
  const doc = parseInterviewPrepDoc(prepNote(body), []);
  const result = prepV2Overview(doc);
  assert.equal(result.position, "データエンジニア");
  assert.equal(result.dateTime, "2026年9月24日（木）17:00 JST");
  assert.equal(result.meetingUrl, "https://example.com/meeting?code=test");
  assert.match(JSON.stringify(result.blocks), /メモ用紙/);
  assert.doesNotMatch(JSON.stringify(result.blocks), /17:00/);
  const inPerson = prepV2Overview(parseInterviewPrepDoc(prepNote(body.replace("[进入会议](https://example.com/meeting?code=test)", "テストビル 3 階")), []));
  assert.equal(inPerson.place, "テストビル 3 階");
  assert.equal(inPerson.meetingUrl, "");
  assert.equal(prepSourceHost("https://"), "链接格式异常");
  assert.equal(prepSourceHost("https://www.example.com/long-title"), "example.com");
});

test("v2 素材不把基本信息或其他章节混入主题出处", async () => {
  const { prepV2BlockLinks, prepV2Overview } = await import("../lib/interview-prep-v2.ts");
  const doc = parseInterviewPrepDoc(prepNote(), []);
  const overview = prepV2Overview(doc);
  assert.deepEqual(prepV2BlockLinks(overview.blocks).map((link) => link.href), ["https://example.com/overview"]);
  assert.doesNotMatch(JSON.stringify(doc.externalLinks), /meeting|overview/);
});

test("首屏先显示本轮求人和公司入口，继承资料不取代本轮求人", async () => {
  const { prepOpeningSources } = await import("../lib/interview-prep-v2.ts");
  const current = parseInterviewPrepDoc(prepNote(BODY.replace("### ⭐ [公司直接页面](https://example.com/company)", `### ★ [当前求人票：数据工程师](https://example.com/jobs/44)

### [公司官网](https://example.com/)

### [公司技术博客](https://example.com/company/blog/updates)

### [招聘信息一覧](https://example.com/recruit/)

### [另一个招聘岗位](https://example.com/jobs/55/)

### [企业站内原文](https://example.com/messages/123)

### [公司直接页面](https://example.com/company)`)), []);
  const previous = parseInterviewPrepDoc(prepNote(`# テスト

## 11．会社研究リンク集

### 求人・採用

- ★ [原求人票](https://example.com/jobs/22/)

- [旧轮中的同一岗位](https://example.com/jobs/44/)

### 公式サイト・プロダクト

- [旧版公司官网](https://example.com/)
`, 1), []);
  const summary = [{ label: "公司官网", url: "https://example.com" }, { label: "产品案例", url: "https://example.com/services/data" }];
  const result = prepOpeningSources([...previous.externalLinks, ...current.externalLinks], "https://example.com/jobs/22", summary, current.externalLinks);
  assert.deepEqual(result.job.map((link) => link.href), ["https://example.com/jobs/44"]);
  assert.equal(result.job[0].label, "当前求人票：数据工程师");
  assert.deepEqual(result.company.slice(0, 2).map((link) => link.label), ["公司官网", "公司技术博客"]);
  assert.equal(result.company.filter((link) => link.href === "https://example.com/").length, 1);
  assert.ok(result.company.some((link) => link.label === "产品案例"));
  assert.ok(result.other.some((link) => link.label === "原求人票"));
  assert.ok(result.other.some((link) => link.label === "另一个招聘岗位"));
  assert.doesNotMatch(JSON.stringify(result), /messages/);
});

test("首屏求人只回退到案件中可辨认的岗位原文", async () => {
  const { prepOpeningSources } = await import("../lib/interview-prep-v2.ts");
  const link = { label: "官方通年採用", href: "https://example.com/recruit/yearround/", group: "", starred: true };
  assert.deepEqual(prepOpeningSources([link], "https://example.com/recruit/yearround").job, [link]);
  assert.equal(prepOpeningSources([link]).job.length, 0);
  assert.equal(prepOpeningSources([], "https://example.com/jobs/1").job[0].href, "https://example.com/jobs/1");
  const comparison = { label: "对比岗位", href: "https://example.com/jobs/2", group: "", starred: false };
  const fromCase = prepOpeningSources([comparison], "https://example.com/jobs/1");
  assert.deepEqual(fromCase.job.map((source) => source.href), ["https://example.com/jobs/1"]);
  assert.deepEqual(fromCase.other, [comparison]);
  assert.equal(prepOpeningSources([], "https://example.com/recruit").job.length, 0);
  const roleSection = { label: "中途採用 04 JAVA", href: "https://example.com/recruit/#position-java", group: "", starred: true };
  assert.deepEqual(prepOpeningSources([roleSection]).job, [roleSection]);
  assert.equal(prepOpeningSources([], "https://example.com/career/14").job[0].href, "https://example.com/career/14");
  assert.equal(prepOpeningSources([], "https://mail.google.com/mail/u/1/#inbox/test").job.length, 0);
  assert.equal(prepOpeningSources([], "javascript:alert(1)").job.length, 0);
});

test("公司事实优先呈现规模和业务并保留来源与口径", async () => {
  const { prepOpeningCompanyFacts } = await import("../lib/interview-prep-v2.ts");
  const facts = [
    { id: "founded", label: "成立", value: "2010 年", asOf: "", scope: "", sources: [] },
    { id: "business", label: "业务", value: "企业软件", asOf: "", scope: "", sources: [] },
    { id: "workforce", label: "人员构成", value: "100 人", asOf: "2026-09-01", scope: "全公司", sources: [{ label: "官网", url: "https://example.com/company" }] },
  ];
  assert.deepEqual(prepOpeningCompanyFacts(facts), [facts[2], facts[1], facts[0]]);
  assert.equal(facts[0].id, "founded");
});
