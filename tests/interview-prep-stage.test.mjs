import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseInterviewPrepDoc } from "../lib/interview-prep-doc.ts";
import { loadAppModule } from "./helpers/render-tsx.mjs";

const text = (value) => [{ kind: "text", text: value }];

test("临场卡只留台词与紧邻的小标题，没有台词的标题一起丢掉", async () => {
  // 只测台词筛选：阅读层与标题工具换成替身，不把整条阅读模块链（含 lib/notes）拉进来。
  const { stageCardBlocks } = await loadAppModule("app/prep-material-reader.tsx", {
    stubs: {
      "@/lib/reading-document": { headingPlainText: (value) => value },
      "./reading-mode": { default: () => null },
    },
  });
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

test("本场面试页头显示倒计时，临场卡入口只在有台词章节时出现", async () => {
  const note = {
    path: "test-prep.md", tags: [], stat: { ctime: 0, mtime: 0, size: 0 },
    frontmatter: { type: "interview-prep", prep_version: 2, company: "株式会社テスト", date: "2026-10-04" },
    content: "# 准备稿\n\n## 纵览与建议\n\n正文。\n\n## 志望動機\n\n### 20 秒版\n\n> 【あなた】御社を志望した理由は二つあります。\n\n## 逆質問\n\n提问\n\n## 研究资料\n\n资料\n\n## 临场备用\n\n备用\n",
  };
  const doc = parseInterviewPrepDoc(note, []);
  assert.ok(doc);
  // 面试在明天之内默认落在纵览，右栏（含临场卡入口）可见；更远时落在公司总览，没有右栏。
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
