import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseInterviewPrepDoc } from "../lib/interview-prep-doc.ts";
import { prepV2StageSections, stageCardBlocks } from "../lib/interview-prep-v2.ts";
import { loadAppModule } from "./helpers/render-tsx.mjs";

const text = (value) => [{ kind: "text", text: value }];

test("临场卡只留台词与紧邻的小标题，没有台词的标题一起丢掉", () => {
  const blocks = [
    { kind: "paragraph", inline: text("背景说明") },
    { kind: "heading", level: 3, depth: 3, inline: text("没有台词的小节") },
    { kind: "note", tone: "tip", inline: text("提醒") },
    { kind: "heading", level: 3, depth: 3, inline: text("20 秒版") },
    { kind: "paragraph", inline: text("为什么这样说") },
    { kind: "say", speaker: "you", inline: text("御社を志望した理由は二つあります。") },
    { kind: "say", speaker: "you", inline: text("一つ目は事業領域です。") },
    { kind: "list", ordered: false, items: [text("资料")] },
  ];
  const kept = stageCardBlocks(blocks);
  assert.deepEqual(kept.map((block) => block.kind), ["heading", "say", "say"]);
  assert.equal(kept[0].inline[0].text, "20 秒版");
  assert.deepEqual(stageCardBlocks([{ kind: "paragraph", inline: text("只有说明") }]), []);
});

const prepNote = (content, date = "2026-10-20") => ({
  path: "test-prep.md", tags: [], stat: { ctime: 0, mtime: 0, size: 0 },
  frontmatter: { type: "interview-prep", prep_version: 2, company: "株式会社テスト", date },
  content,
});

const STAGE_BODY = `# 株式会社テスト 面接準備

## 纵览与建议

正文。

## 志望動機

### 20秒版（既定）

【あなた】御社のデータ基盤事業に興味を持ちました。私の開発経験で貢献したいです。

▷ 根拠: [公司直接页面](https://example.com/company)

## 逆質問

### 1. 意欲・贡献型

【あなた】最初に期待される成果を教えていただけますか。

**目的**：说明。

## 研究资料

资料

## 临场备用

### 冒頭30秒

【あなた】本日はお時間をいただき、ありがとうございます。

自己紹介を求められたら：[[自己紹介_音読台本#30秒版]]

▷ 本场先讲数据基盘的经历。

### 本場の懸念 TOP3 と先回り一言

▷ 推断说明。

#### 1. 定着

▷ 推断依据：求人。

【あなた】腰を据えて長く取り組める環境を探しています。

#### 2. 立ち上がり

【あなた】まず既存の運用を理解し、三か月を目安に担当範囲を広げます。

### 締めの一言

【あなた】ぜひ選考に進ませていただきたいです。

▷ 不论对方问不问都要说。

#### 当日お礼メッセージ

本日はお時間をいただき、ありがとうございました。

▷ 当天经站内消息发出。

### 被问到经验时

【あなた】簡潔に説明します。

### 回答库入口

[[面接標準回答集]] · [[自己紹介_音読台本]]
`;

test("临场卡按面试流程排：冒頭→懸念→志望動機→逆質問→締め，其余备用垫底", () => {
  const sections = prepV2StageSections(parseInterviewPrepDoc(prepNote(STAGE_BODY), []));
  assert.deepEqual(sections.map((section) => section.title), ["冒頭30秒", "本場の懸念 TOP3 と先回り一言", "志望動機", "逆質問", "締めの一言", "临场备用"]);
  const [opening, concerns, , , closing, backup] = sections;
  // 冒頭留挨拶与朗读节链接；只讲策略的 ▷ 不上卡。
  assert.deepEqual(opening.blocks.map((block) => block.kind), ["say", "paragraph"]);
  assert.match(JSON.stringify(opening.blocks[1]), /"target":"自己紹介_音読台本","section":"30秒版"/);
  assert.doesNotMatch(JSON.stringify(opening.blocks), /数据基盘/);
  // 每个懸念保留自己的小标题，推断依据不上卡。
  assert.deepEqual(concerns.blocks.map((block) => block.kind), ["heading", "say", "heading", "say"]);
  assert.doesNotMatch(JSON.stringify(concerns.blocks), /推断/);
  // 締めの台词之后跟整段当日お礼（不是台词，但面试一结束就要发）。
  assert.deepEqual(closing.blocks.map((block) => block.kind), ["say", "heading", "paragraph", "note"]);
  assert.match(JSON.stringify(closing.blocks), /本日はお時間をいただき、ありがとうございました/);
  // 三块已取出，备用只剩被问到才用的短答。
  assert.deepEqual(backup.blocks.map((block) => block.kind), ["heading", "say"]);
  assert.doesNotMatch(JSON.stringify(backup.blocks), /冒頭|締め|定着/);
});

test("没有三个固定块的旧稿，临场卡顺序与内容不变", () => {
  const legacy = STAGE_BODY.slice(0, STAGE_BODY.indexOf("### 冒頭30秒")) + "### 被问到经验时\n\n【あなた】簡潔に説明します。\n";
  const doc = parseInterviewPrepDoc(prepNote(legacy), []);
  const sections = prepV2StageSections(doc);
  assert.deepEqual(sections.map((section) => section.title), ["志望動機", "逆質問", "临场备用"]);
  for (const section of sections) {
    assert.deepEqual(section.blocks, stageCardBlocks(doc.sections.find((item) => item.title === section.title).blocks));
  }
});

test("面试当天和前一天默认打开临场卡，底下停在纵览；URL 的 prepTab 与无台词稿不弹", async () => {
  const doc = parseInterviewPrepDoc(prepNote(STAGE_BODY), []);
  const render = async ({ today, search = "", target = doc }) => {
    const opened = [];
    const { default: Session } = await loadAppModule("app/interview-session-v2.tsx", {
      stubs: {
        "./ui-locale": { useUiLocale: () => ({ locale: "zh-CN", setLocale() {} }) },
        "./prep-material-reader": { default: (props) => { opened.push(props); return null; } },
      },
      ...(search ? { globals: { window: { location: { search, pathname: "/session" } } } } : {}),
    });
    const html = renderToStaticMarkup(createElement(Session, {
      doc: target, series: [], selectedSeries: null, sources: [], today,
      onSelect() {}, onOpen() {}, onOpenWiki() {}, onOpenCard() {}, onOpenAsset() {},
      companyOverview: null, contextPicker: null, companyAction: null,
    }));
    return { html, opened };
  };
  for (const today of ["2026-10-20", "2026-10-19"]) {
    const { html, opened } = await render({ today });
    assert.equal(opened.length, 1, today);
    assert.equal(opened[0].presentation, "stage");
    assert.deepEqual(opened[0].sections.map((section) => section.title).slice(0, 2), ["冒頭30秒", "本場の懸念 TOP3 と先回り一言"]);
    assert.match(html, /id="v2-tab-overview"[^>]*aria-selected="true"/);
  }
  const later = await render({ today: "2026-10-16" });
  assert.equal(later.opened.length, 0);
  assert.match(later.html, /id="v2-tab-company"[^>]*aria-selected="true"/);
  const fromUrl = await render({ today: "2026-10-20", search: "?prepTab=questions" });
  assert.equal(fromUrl.opened.length, 0);
  assert.match(fromUrl.html, /id="v2-tab-questions"[^>]*aria-selected="true"/);
  const bare = await render({ today: "2026-10-20", target: parseInterviewPrepDoc(prepNote(STAGE_BODY.replace(/^【あなた】.*\n/gm, "")), []) });
  assert.equal(bare.opened.length, 0);
  assert.match(bare.html, /id="v2-tab-overview"[^>]*aria-selected="true"/);
});

test("本场面试页头显示倒计时，临场卡入口只在有台词章节时出现", async () => {
  const note = {
    path: "test-prep.md", tags: [], stat: { ctime: 0, mtime: 0, size: 0 },
    frontmatter: { type: "interview-prep", prep_version: 2, company: "株式会社テスト", date: "2026-10-04" },
    content: "# 准备稿\n\n## 纵览与建议\n\n正文。\n\n## 志望動機\n\n### 20 秒版\n\n> 【あなた】御社を志望した理由は二つあります。\n\n## 逆質問\n\n提问\n\n## 研究资料\n\n资料\n\n## 临场备用\n\n备用\n",
  };
  const doc = parseInterviewPrepDoc(note, []);
  assert.ok(doc);
  // 面试在明天之内默认打开临场卡、底下落在纵览，右栏（含临场卡入口）可见；更远时落在公司总览，没有右栏。
  for (const [locale, today, label, rail] of [["zh-CN", "2026-10-03", "明天", true], ["ja", "2026-10-04", "今日", true], ["zh-CN", "2026-09-30", "4 天后", false]]) {
    const { default: Session } = await loadAppModule("app/interview-session-v2.tsx", {
      stubs: { "./ui-locale": { useUiLocale: () => ({ locale, setLocale() {} }) }, "./prep-material-reader": { default: () => null } },
    });
    const html = renderToStaticMarkup(createElement(Session, {
      doc, series: [], selectedSeries: null, sources: [], today,
      onSelect() {}, onOpen() {}, onOpenWiki() {}, onOpenCard() {}, onOpenAsset() {},
      companyOverview: null, contextPicker: null, companyAction: null,
    }));
    assert.match(html, new RegExp(`class="v2-countdown [a-z]+">${label}<`));
    assert.equal(/v2-stage-entry/.test(html), rail);
    assert.match(html, /class="v2-tab-indicator"/);
  }
  // 三章都没有台词时不出入口：点进去只会看到一句空提示。
  const bare = parseInterviewPrepDoc({ ...note, content: note.content.replace(/> 【あなた】.*\n/, "") }, []);
  const { default: Session } = await loadAppModule("app/interview-session-v2.tsx", {
    stubs: { "./ui-locale": { useUiLocale: () => ({ locale: "zh-CN", setLocale() {} }) }, "./prep-material-reader": { default: () => null } },
  });
  const bareHtml = renderToStaticMarkup(createElement(Session, {
    doc: bare, series: [], selectedSeries: null, sources: [], today: "2026-10-03",
    onSelect() {}, onOpen() {}, onOpenWiki() {}, onOpenCard() {}, onOpenAsset() {},
    companyOverview: null, contextPicker: null, companyAction: null,
  }));
  assert.match(bareHtml, /class="v2-rail"/);
  assert.doesNotMatch(bareHtml, /v2-stage-entry/);
});

test("临场卡的阅读层：←/→ 在台词之间跳；打印样式写在本场面试页自己的样式里", async () => {
  const [reader, css] = await Promise.all([
    readFile(new URL("../app/reading-mode.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/styles/interview-session-v2.css", import.meta.url), "utf8"),
  ]);
  assert.match(reader, /presentation === "stage"[\s\S]{0,200}ArrowRight/);
  assert.match(reader, /\[data-stage-line\]/);
  assert.match(css, /@media print \{[\s\S]*\.v2-rail[\s\S]*display: none/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,6}\b|rgb\(/i, "打印也不写颜色字面量");
});
