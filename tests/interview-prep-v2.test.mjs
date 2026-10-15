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
