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
