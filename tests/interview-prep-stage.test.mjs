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

const STAGE_BODY_11 = STAGE_BODY
  .replace("### 冒頭30秒", `### 本場の規律

- 結論→証拠二文→止める。
- 聞かれていない負号・謝罪・自己評価を出さない。

▷ 出典：[[面接傾向_横断#反復している戦略タグ（2 場以上で出たものだけ）]]。

### 冒頭30秒`)
  .replace("### 本場の懸念 TOP3 と先回り一言", `### HR事実カード

▷ 正本確認：在留・年収・他社は 2026-11-01 本人確認。

| 聞かれること | 最初の一文（【あなた】） | 正本 |
|---|---|---|
| 直近の役職 | 直近は株式会社テストでリードエンジニアを担当しました。 | [[面接標準回答集#p49 直近の役職・担当責任：先回答过去事实]] |

#### 逐社退職理由（聞かれた社だけ一句で）

| 社名 | 期間 | 【あなた】一句 |
|---|---|---|
| 株式会社テスト | 2020-04〜2023-03 | 事業の縮小に伴い、次の構築機会を求めて転職しました。 |

▷ 正本：[[転職理由台本#逐社一句(深掘り対策)]]。

### 本場の懸念 TOP3 と先回り一言`);

test("2026-11 的規律与事実カード上卡：規律→冒頭→事実カード→懸念…，規律留列表、事実カード留表与子表", async () => {
  const sections = prepV2StageSections(parseInterviewPrepDoc(prepNote(STAGE_BODY_11), []));
  assert.deepEqual(sections.map((section) => section.title), ["本場の規律", "冒頭30秒", "HR事実カード", "本場の懸念 TOP3 と先回り一言", "志望動機", "逆質問", "締めの一言", "临场备用"]);
  const [discipline, , facts] = sections;
  // 規律只留列表项，出处的 ▷ 不上卡。
  assert.deepEqual(discipline.blocks.map((block) => block.kind), ["list"]);
  assert.doesNotMatch(JSON.stringify(discipline.blocks), /出典/);
  // 事実カード：确认日期、主表、逐社子表标题与表、正本链接都在卡上；每行第一句就是要说的话。
  assert.deepEqual(facts.blocks.map((block) => block.kind), ["note", "table", "heading", "table", "note"]);
  assert.match(JSON.stringify(facts.blocks), /直近は株式会社テストでリードエンジニアを担当しました/);
  assert.match(JSON.stringify(facts.blocks), /"target":"転職理由台本"/);
  // 临场卡的阅读层照常把表画出来：被问「一つずつ」时看的就是这张表。
  const { default: Reader } = await loadAppModule("app/prep-material-reader.tsx", {
    stubs: {
      "./ui-locale": { useUiLocale: () => ({ locale: "zh-CN", setLocale() {} }) },
      "@/lib/reading-document": { headingPlainText: (value) => value },
      "./reading-mode": { default: ({ children }) => createElement("div", null, children) },
    },
  });
  const html = renderToStaticMarkup(createElement(Reader, {
    documentKey: "test:stage-11", title: "临场卡", sections: [facts], presentation: "stage", prepVersion: 2,
    onClose() {}, onOpenWiki() {}, onOpenCard() {},
  }));
  assert.match(html, /<table>[\s\S]*直近は株式会社テストでリードエンジニアを担当しました[\s\S]*<table>[\s\S]*事業の縮小に伴い/);
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
    assert.match(html, /id="v2-tab-story"[^>]*aria-selected="true"/);
  }
  const later = await render({ today: "2026-10-16" });
  assert.equal(later.opened.length, 0);
  assert.match(later.html, /id="v2-tab-story"[^>]*aria-selected="true"/);
  const fromUrl = await render({ today: "2026-10-20", search: "?prepTab=questions" });
  assert.equal(fromUrl.opened.length, 0);
  assert.match(fromUrl.html, /id="v2-tab-kit"[^>]*aria-selected="true"/);
  const bare = await render({ today: "2026-10-20", target: parseInterviewPrepDoc(prepNote(STAGE_BODY.replace(/^【あなた】.*\n/gm, "")), []) });
  assert.equal(bare.opened.length, 0);
  assert.match(bare.html, /id="v2-tab-story"[^>]*aria-selected="true"/);
});

test("临场卡里逆質問的预想回答是提示行、不进 ←/→，接话缩进成组；问法与收住仍是主行", async () => {
  const { default: Reader } = await loadAppModule("app/prep-material-reader.tsx", {
    stubs: {
      "./ui-locale": { useUiLocale: () => ({ locale: "zh-CN", setLocale() {} }) },
      "@/lib/reading-document": { headingPlainText: (value) => value },
      "./reading-mode": { default: ({ children }) => createElement("div", null, children) },
    },
  });
  const say = (speaker, value) => ({ kind: "say", speaker, inline: text(value) });
  const blocks = [
    { kind: "heading", level: 3, depth: 3, inline: text("1. 〔面接官本人型〕主题") },
    say("you", "どんな共通点がありましたか。"),
    say("interviewer", "関係づくりを大事にする方です。"),
    say("you", "具体的には、どんな場面でしたか。"),
    say("interviewer", "最初の案件です。"),
    say("you", "最初はどの工程を担当されることが多いですか。"),
    say("you", "ありがとうございます。よく分かりました。"),
  ];
  const html = renderToStaticMarkup(createElement(Reader, {
    documentKey: "test:stage", title: "临场卡", sections: [{ id: "q", title: "逆質問", blocks }], presentation: "stage", prepVersion: 2,
    onClose() {}, onOpenWiki() {}, onOpenCard() {},
  }));
  assert.equal((html.match(/data-stage-line/g) ?? []).length, 4, "问法、两句接话、收住");
  assert.equal((html.match(/class="reader-stage-cue"/g) ?? []).length, 2);
  assert.equal((html.match(/reader-stage-line reader-stage-reply/g) ?? []).length, 2);
  assert.doesNotMatch(html.slice(html.indexOf("reader-stage-cue")), /^[^>]*data-stage-line/, "提示行不是 ←/→ 的落点");
  // 收住一句跟在接话后面，回到主行，不缩进。
  assert.match(html, /class="reader-stage-line" data-stage-line="true" data-reading-anchor="[^"]+"><div[^>]*><p class="prep-doc-say you"[^>]*><span>あなた<\/span><span>ありがとうございます。よく分かりました。/);
});

test("本场面试页头显示倒计时，临场卡入口只在有台词章节时出现", async () => {
  const note = {
    path: "test-prep.md", tags: [], stat: { ctime: 0, mtime: 0, size: 0 },
    frontmatter: { type: "interview-prep", prep_version: 2, company: "株式会社テスト", date: "2026-10-04" },
    content: "# 准备稿\n\n## 纵览与建议\n\n正文。\n\n## 志望動機\n\n### 20 秒版\n\n> 【あなた】御社を志望した理由は二つあります。\n\n## 逆質問\n\n提问\n\n## 研究资料\n\n资料\n\n## 临场备用\n\n备用\n",
  };
  const doc = parseInterviewPrepDoc(note, []);
  assert.ok(doc);
  // 自动打开仍按日期判断；手动入口始终留在三标签旁，便于提前练习。
  for (const [locale, today, label] of [["zh-CN", "2026-10-03", "明天"], ["ja", "2026-10-04", "今日"], ["zh-CN", "2026-09-30", "4 天后"]]) {
    const { default: Session } = await loadAppModule("app/interview-session-v2.tsx", {
      stubs: { "./ui-locale": { useUiLocale: () => ({ locale, setLocale() {} }) }, "./prep-material-reader": { default: () => null } },
    });
    const html = renderToStaticMarkup(createElement(Session, {
      doc, series: [], selectedSeries: null, sources: [], today,
      onSelect() {}, onOpen() {}, onOpenWiki() {}, onOpenCard() {}, onOpenAsset() {},
      companyOverview: null, contextPicker: null, companyAction: null,
    }));
    assert.match(html, new RegExp(`class="v2-countdown [a-z]+">${label}<`));
    assert.match(html, /class="v2-stage-nav"/);
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
  assert.equal((bareHtml.match(/role="tab" /g) ?? []).length, 3);
  assert.doesNotMatch(bareHtml, /v2-stage-(entry|nav)/);
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
