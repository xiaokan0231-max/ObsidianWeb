import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseInterviewPrepDoc } from "../lib/interview-prep-doc.ts";
import { loadAppModule } from "./helpers/render-tsx.mjs";

// 用真实准备稿解析和正文组件验三种落点，避免只看导航源代码而漏掉章节内容。
const content = `# 株式会社テスト 面接準備

## 纵览与建议

### 基本情報

| 项目 | 内容 |
|---|---|
| 岗位 | テスト・データ基盤 |
| 日時 | 2026年11月5日 14:00 JST |
| 場所 | オンライン |

### 本轮重点

本轮纵览正文独有：说明这次交流要解决的问题。

### 岗位与面试分析

岗位分析正文独有：先区分该岗位的公开职责与首个实际项目，再用既有工作经历说明能承担的交付范围。

面试分析收尾独有：最后根据对方回答判断何时能参与设计、由谁审查，以及入职后第一件要交付的工作。

## 志望動機

### 20秒版

【あなた】动机正文独有：御社のデータ活用に貢献したいです。

## 逆質問

### 1. 期待成果

【あなた】逆質問正文独有：最初に期待される成果を教えてください。

## 研究资料

### 本轮研究

研究正文独有：这条来源记录本轮实际读取的业务内容。

[本轮业务来源](https://example.com/current-research)

[本次求人票](https://example.com/jobs/42) · [公司官网](https://example.com/company) · [技术博客](https://example.com/blog/platform)

## 临场备用

### 追问备用

【あなた】备用正文独有：必要な場合に補足します。
`;
const note = {
  path: "20_求職/テスト/面接準備_s01.md", content, tags: [], stat: { ctime: 0, mtime: 0, size: content.length },
  frontmatter: { type: "interview-prep", prep_version: 2, company: "株式会社テスト", date: "2026-11-05", round: "一次面接", session_order: 1 },
};
const doc = parseInterviewPrepDoc(note, []);
assert.ok(doc);
const caseContent = "# 株式会社テスト — 案件原文の職位\n";
const jobCase = {
  path: "20_求職/テスト/案件.md", content: caseContent, tags: [], stat: { ctime: 0, mtime: 0, size: caseContent.length },
  frontmatter: { type: "job-case", company: "株式会社テスト", salary: "月給30万円", salary_min: 430, salary_max: 590, url: "https://example.com/apply/42" },
};
const carried = { label: "前轮保留来源", href: "https://example.com/previous-research", group: "前轮", starred: false };
const baseProps = {
  doc, series: [], selectedSeries: null, sources: [...doc.externalLinks, carried], today: "2026-10-25",
  contextPicker: createElement("span", null, "选择当前准备稿"), companyAction: null,
  companyOverview: createElement("section", null, "公司故事正文独有"),
  externalReviews: createElement("section", null, "外部评价正文独有"),
  briefing: createElement("p", null, "本轮复盘提醒独有"),
  onSelect() {}, onOpen() {}, onOpenWiki() {}, onOpenCard() {}, onOpenAsset() {},
};

const loaded = new Map();
async function render(search = "", overrides = {}, locale = "zh-CN") {
  if (!loaded.has(locale)) {
    const browser = { location: { search: "", pathname: "/interview" }, history: { state: null, replaceState() {} }, scrollY: 0 };
    const component = await loadAppModule("app/interview-session-v2.tsx", {
      globals: { window: browser },
      stubs: { "./ui-locale": { useUiLocale: () => ({ locale, setLocale() {} }) }, "./prep-material-reader": { default: () => null } },
    });
    loaded.set(locale, { browser, component });
  }
  const { browser, component } = loaded.get(locale);
  browser.location.search = search;
  return renderToStaticMarkup(createElement(component.default, { ...baseProps, ...overrides }));
}

function buttons(html) {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((match) => ({ attrs: match[1], text: match[2].replace(/<[^>]*>/g, "") }));
}
function tabs(html) {
  return buttons(html).filter((button) => /\brole="tab"/.test(button.attrs));
}
function assertTabs(html, selected, labels = ["面试故事", "外部评价", "面谈锦囊"]) {
  const actual = tabs(html);
  assert.equal(actual.length, 3, "主导航始终只有三个 tab");
  for (const [index, id] of ["story", "reviews", "kit"].entries()) {
    assert.match(actual[index].attrs, new RegExp(`\\bid="v2-tab-${id}"`));
    assert.match(actual[index].text, new RegExp(labels[index]));
    if (selected) assert.match(actual[index].attrs, new RegExp(`aria-selected="${id === selected}"`));
  }
}
function panel(html) {
  const match = html.match(/<main\b[^>]*\brole="tabpanel"[^>]*>([\s\S]*?)<\/main>/);
  assert.ok(match, "选中的主视图具有可访问的 tabpanel");
  return match[1];
}
function assertKitBody(body) {
  for (const marker of ["动机正文独有", "逆質問正文独有", "研究正文独有", "前轮保留来源"]) assert.match(body, new RegExp(marker));
  for (const id of ["motivation", "questions", "resources"]) assert.match(body, new RegExp(`id="v2-kit-${id}"`));
  assert.match(body, /href="https:\/\/example.com\/current-research"/);
  assert.match(body, /href="https:\/\/example.com\/previous-research"/);
  assert.ok(body.indexOf("动机正文独有") < body.indexOf("逆質問正文独有"));
  assert.ok(body.indexOf("逆質問正文独有") < body.indexOf("研究正文独有"));
}
function assertKitFocus(html, label) {
  const current = buttons(html).filter((button) => /\baria-current="location"/.test(button.attrs));
  assert.equal(current.length, 1, "锦囊副目录仅一个当前位置，且不增加主 tab 数量");
  assert.match(current[0].text, new RegExp(label));
}

test("面试故事合并公司故事和本轮纵览，并给公司组件传入外部评价切换回调", async () => {
  let openReviews;
  const html = await render("?prepTab=story", { companyOverview: (callback) => {
    openReviews = callback;
    return createElement("section", null, "公司回调渲染正文独有");
  } });
  assertTabs(html, "story");
  assert.equal(typeof openReviews, "function");
  const body = panel(html);
  assert.match(body, /公司回调渲染正文独有/);
  assert.match(body, /本轮纵览正文独有/);
  assert.match(body, /本轮复盘提醒独有/);
  assert.doesNotMatch(body, /外部评价正文独有|动机正文独有|逆質問正文独有|研究正文独有/);
});

test("默认首屏把本场岗位、案件求人年收和求人票直链放在公司资料之前", async () => {
  const html = await render("", { jobCase });
  assertTabs(html, "story");
  const header = html.match(/<header\b[^>]*\bclass="v2-header"[^>]*>([\s\S]*?)<\/header>/)?.[1];
  assert.ok(header);
  assert.match(header, /岗位[\s\S]*テスト・データ基盤[\s\S]*求人年收[\s\S]*430[〜～–-]590万[\s\S]*href="https:\/\/example.com\/jobs\/42"/);
  assert.doesNotMatch(header, /案件原文の職位|href="https:\/\/example.com\/apply\/42"/);
  const body = panel(html);
  const company = body.match(/<section[^>]+aria-labelledby="v2-company-links-heading"[^>]*>([\s\S]*?)<\/section>/)?.[1];
  assert.ok(company);
  assert.match(company, /href="https:\/\/example.com\/company"[^>]*>公司官网/);
  assert.match(company, /href="https:\/\/example.com\/blog\/platform"[^>]*>技术博客/);
  assert.ok(html.indexOf(header) < html.indexOf(company));
  assert.ok(body.indexOf(company) < body.indexOf("公司故事正文独有"));
  assert.ok(body.indexOf("公司故事正文独有") < body.indexOf("本轮纵览正文独有"));
});

test("准备稿未填岗位时沿用对应案件标题，不显示公司名冒充岗位", async () => {
  const withoutPosition = parseInterviewPrepDoc({ ...note, content: content.replace(/^\| 岗位 \|.*\n/m, "") }, []);
  assert.ok(withoutPosition);
  const html = await render("", { doc: withoutPosition, jobCase });
  assert.match(html, /岗位[\s\S]*案件原文の職位[\s\S]*430[〜～–-]590万/);
});

test("无对应案件时提示年收未记录，历史对照稿不借用现行案件年收", async () => {
  const unlinked = await render();
  assert.match(unlinked, /求人年收[\s\S]*年收未记录/);
  const replay = await render("", { doc: { ...doc, replayOf: "面接準備_s01" }, jobCase });
  assert.doesNotMatch(replay, /求人年收|430[〜～–-]590万|打开案件记录/);
});

test("完整岗位与面试分析有明确入口，正文保留分析和收尾段", async () => {
  const html = await render();
  assert.match(html, /<a\b[^>]*href="#v2-interview-overview"[^>]*>[^<]*完整岗位与面试分析/);
  const body = panel(html);
  const overview = body.slice(body.indexOf('id="v2-interview-overview"'));
  assert.match(overview, /本轮纵览正文独有[\s\S]*岗位分析正文独有[\s\S]*面试分析收尾独有/);
  assert.doesNotMatch(overview, /<details\b[^>]*>[\s\S]*岗位分析正文独有[\s\S]*<\/details>/);
});

test("外部评价独立显示传入内容，不混公司故事、纵览或锦囊正文", async () => {
  const html = await render("?prepTab=reviews");
  assertTabs(html, "reviews");
  const body = panel(html);
  assert.match(body, /外部评价正文独有/);
  assert.doesNotMatch(body, /公司故事正文独有|本轮纵览正文独有|动机正文独有|逆質問正文独有|研究正文独有|备用正文独有/);
  const empty = await render("?prepTab=reviews", { externalReviews: undefined });
  assertTabs(empty, "reviews");
  assert.doesNotMatch(panel(empty), /公司故事正文独有|本轮纵览正文独有|动机正文独有/);
});

test("面谈锦囊连续展示三节和跨轮资料，问题深链接保持全部内容并标出当前位置", async () => {
  const html = await render("?prepTab=kit&kitSection=questions");
  assertTabs(html, "kit");
  assertKitBody(panel(html));
  assertKitFocus(html, "逆質問");
  assert.doesNotMatch(panel(html), /公司故事正文独有|外部评价正文独有|本轮纵览正文独有/);
});

test("旧公司和纵览深链接都归入面试故事，保留原先入口的阅读顺序", async () => {
  for (const legacy of ["company", "overview"]) {
    const html = await render(`?prepTab=${legacy}`);
    assertTabs(html, "story");
    const body = panel(html);
    assert.match(body, /公司故事正文独有/);
    assert.match(body, /本轮纵览正文独有/);
    assert.equal(body.indexOf("公司故事正文独有") < body.indexOf("本轮纵览正文独有"), legacy === "company", legacy);
  }
});

test("旧动机、逆質問、研究深链接都归入锦囊，并保留各自聚焦章节", async () => {
  for (const [legacy, label] of [["motivation", "志望動機"], ["questions", "逆質問"], ["resources", "研究资料"]]) {
    const html = await render(`?prepTab=${legacy}`);
    assertTabs(html, "kit");
    assertKitBody(panel(html));
    assertKitFocus(html, label);
  }
});

test("临场备用保留为二级入口，不生成第四个主 tab", async () => {
  const html = await render("?prepTab=backup");
  assertTabs(html);
  assert.ok(buttons(html).some((button) => /临场备用/.test(button.text) && !/\brole="tab"/.test(button.attrs)));
  assert.match(html, /备用正文独有/);
});

test("日语三个主标签本地化，准备稿原始正文保持原语言", async () => {
  const html = await render("?prepTab=kit&kitSection=questions", {}, "ja");
  assertTabs(html, "kit", ["面接ストーリー", "外部評価", "面接ツール"]);
  assertKitBody(panel(html));
  assert.match(html, /株式会社テスト/);
});
