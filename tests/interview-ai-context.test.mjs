import assert from "node:assert/strict";
import test from "node:test";
import { buildInterviewReadModelRecords, INTERVIEW_RECORDS } from "../lib/interview-read-model.ts";
import { resolveInterviewAiContext } from "../lib/server/interview-ai-context.ts";

function note(path, frontmatter, content = "") {
  return { path, frontmatter, content, tags: [], stat: { ctime: 0, mtime: 1, size: content.length } };
}

const root = "20_求職/株式会社テスト";
const company = "株式会社テスト";
const dossierPath = `${root}/会社.md`;
const casePath = `${root}/岗位A/案件.md`;
const prepPath = `${root}/岗位A/一次.md`;
const summaryPath = "80_AI分析/测试公司总结.md";
const materialPath = `${root}/私有素材.md`;
const prepFrontmatter = {
  type: "interview-prep", prep_version: 2, company, round: "一次面接", case: `[[${casePath}]]`,
};

function fixture(prep = note(prepPath, prepFrontmatter, `# 株式会社テスト 面試準備

## 纵览与建议

### 基本情報

| 项目 | 内容 |
| --- | --- |
| 岗位 | 数据质量工程师 |
| 日時 | 虚构面谈时间 |
| 場所 | [虚构会议](https://example.com/secret) |

### 工作与机会

负责代码レビュー与质量监控，和[不外发的链接标题](https://example.com/jobs)有关。

候选人私密年収。

联系 sample@example.com。

号码 08012345678。

![[${materialPath}]]

#### 私有提示

嵌套标题下的私有文字。

## 志望動機

### 20秒版（既定）

【あなた】データ品質の改善に取り組みたいです。

### 追問されたら

【あなた】另一个话题的非选中答案。

## 研究资料

全量资料没有选中。

## 临场备用

### HR事実カード

绝密本人事实。
`)) {
  const summary = note(summaryPath, {
    type: "ai-report", report_kind: "company-summary", schema_version: 1, assessed_on: "2026-10-15",
    company_dossier: `[[${dossierPath}]]`, ai_author: "测试助手", coverage_period: "公开资料",
    sources: [{ label: "官网", url: "https://example.com/business" }],
  }, `# 株式会社テスト 公司研究

## 公司总结

公司向零售客户提供报表平台。

[员工原文](https://jobtalk.jp/test)不外发的评论正文。

## 资料与边界

完整链接放在这里，不进入对话。
`);
  const dossier = note(dossierPath, {
    type: "company", company, company_summary: `[[${summaryPath}]]`,
    company_profile: { version: 1, updated_on: "2026-10-15", reviews: [], facts: [{
      id: "business", label: "主要业务", value: "企业报表软件", as_of: "2026-10-15", scope: "公司",
      sources: [{ label: "官网", url: "https://example.com/business" }],
    }] },
  });
  const owner = note(casePath, {
    type: "job-case", company, case_id: "test-role-a", company_dossier: `[[${dossierPath}]]`, status: "面接中",
  });
  const anotherCase = note(`${root}/岗位B/案件.md`, { type: "job-case", company, case_id: "test-role-b" });
  const anotherPrep = note(`${root}/岗位B/一次.md`, { ...prepFrontmatter, case: `[[${anotherCase.path}]]` },
    "## 纵览与建议\n### 工作与机会\n另一岗位专属内容。");
  const notes = [prep, summary, dossier, owner, anotherCase, anotherPrep,
    note(materialPath, { type: "material", publish: false }, "绝密共享素材。")];
  return { prep, summary, notes, records: buildInterviewReadModelRecords(notes, { today: "2026-10-15" }) };
}

function reader(data) {
  const reads = [];
  const record = (kind, path) => data.records.find((item) => item.kind === kind && item.key === path)?.value ?? null;
  return {
    reads,
    context: async (path) => record(INTERVIEW_RECORDS.context, path),
    company: async (path) => {
      reads.push(path);
      return record(INTERVIEW_RECORDS.company, path);
    },
    note: async (path) => {
      reads.push(path);
      const found = data.notes.find((item) => item.path === path);
      assert.ok(found, "只能读取准确索引指向的笔记");
      return found;
    },
  };
}

test("只使用同版当前案件的业务总结、当前轮准备片段与简短身份", async () => {
  const sources = reader(fixture());
  const context = await resolveInterviewAiContext(prepPath, sources);
  assert.equal(context.limited, false);
  assert.deepEqual(sources.reads, [prepPath, casePath, summaryPath]);
  assert.deepEqual(context.sources.map((item) => item.id), ["scope", "company", "role", "motivation"]);
  const outbound = JSON.stringify(context.sources);
  assert.match(outbound, /株式会社テスト · 一次面接/);
  assert.match(outbound, /向零售客户提供报表平台/);
  assert.match(outbound, /数据质量工程师.*代码レビュー与质量监控/);
  assert.match(outbound, /データ品質の改善に取り組みたい/);
  assert.doesNotMatch(outbound, /绝密|另一岗位|候选人私密|虚构会议|虚构面谈时间|不外发|嵌套标题|非选中|全量资料|example\.com|08012345678|jobtalk\.jp|\[\[/);
});

test("公司总结不可外发时只回退到业务事实", async () => {
  const data = fixture();
  data.summary.frontmatter.publish = false;
  const context = await resolveInterviewAiContext(prepPath, reader(data));
  assert.equal(context.sources.find((source) => source.id === "company")?.excerpt, "主要业务：企业报表软件");
  assert.doesNotMatch(JSON.stringify(context.sources), /零售客户/);
});

test("私有准备稿仅绑定本场，独立允许的公司总结可以使用", async () => {
  const data = fixture(note(prepPath, { ...prepFrontmatter, publish: false },
    "## 纵览与建议\n### 工作与机会\n不外发的岗位片段。"));
  const context = await resolveInterviewAiContext(prepPath, reader(data));
  assert.equal(context.limited, true);
  assert.deepEqual(context.sources.map((source) => source.id), ["scope", "company"]);
  assert.equal(context.sources[0].excerpt, company);
  assert.match(context.sources[1].excerpt, /向零售客户提供报表平台/);
  assert.doesNotMatch(JSON.stringify(context.sources), /不外发的岗位片段|一次面接/);

  data.notes.find((item) => item.path === casePath).frontmatter.publish = false;
  const privateCase = await resolveInterviewAiContext(prepPath, reader(data));
  assert.deepEqual(privateCase.sources.map((source) => source.id), ["company"]);
});

test("没有可用资料时允许空来源，旧稿和对照稿仍拒绝", async () => {
  for (const override of [
    { prep_version: 1 },
    { replay_of: "[[原准备稿]]" },
    { type: "interview-prep-replay" },
  ]) {
    const data = fixture(note(prepPath, { ...prepFrontmatter, ...override },
      "## 纵览与建议\n### 工作与机会\n准备片段。"));
    await assert.rejects(resolveInterviewAiContext(prepPath, reader(data)), { status: 404 });
  }
  for (const publish of [true, false]) {
    const empty = fixture(note(prepPath, { ...prepFrontmatter, case: "[[不存在的案件]]", publish },
      "## 临场备用\n### HR事実カード\n绝密本人事实。"));
    const context = await resolveInterviewAiContext(prepPath, reader(empty));
    assert.equal(context.limited, !publish);
    assert.deepEqual(context.sources, []);
  }
});
