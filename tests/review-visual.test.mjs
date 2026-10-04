import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAppModule } from "./helpers/render-tsx.mjs";
import { readAppCss } from "./css-source.mjs";
import {
  groupReviewsByCompany,
  historicalDimensionAverages,
  reviewScoreBand,
  reviewScoreTimeline,
} from "../lib/review-visual.ts";
import { practiceCompletedOn, practiceTokyoDay, stepPracticeKey } from "../lib/review-practice.ts";
import { reviewSiblingPath, reviewSourcePath } from "../lib/review-paths.ts";

function review(overallScore, scores) {
  const keys = ["questionUnderstanding", "coverage", "directness", "evidenceCredibility", "riskControl"];
  return {
    generatedAt: "",
    model: "",
    overallScore,
    dimensions: Object.fromEntries(keys.map((key, index) => [key, { score: scores[index], rationaleZh: "", evidenceBlockIds: [] }])),
    summaryZh: "",
    strengths: [],
    weaknesses: [],
    priorityBlockIds: [],
    blocks: [],
  };
}

const entries = [
  { key: "20_求職/株式会社テスト/2026-01-10_二次面接_整理稿.md", company: "株式会社テスト", date: "2026-01-10", round: "二次面接", review: review(70, [60, 70, 80, 90, 50]), result: "不採用" },
  { key: "20_求職/株式会社テスト/2026-01-02_一次面接_整理稿.md", company: "株式会社テスト", date: "2026-01-02", round: "一次面接", review: review(84, [80, 90, 70, 80, 100]) },
  { key: "20_求職/株式会社サンプル/2026-01-05_一次面接_整理稿.md", company: "株式会社サンプル", date: "2026-01-05", round: "一次面接", review: undefined },
];

test("分数档：80 / 65 两条线，无分数单独一档", () => {
  assert.equal(reviewScoreBand(80), "high");
  assert.equal(reviewScoreBand(79), "mid");
  assert.equal(reviewScoreBand(65), "mid");
  assert.equal(reviewScoreBand(64), "low");
  assert.equal(reviewScoreBand(null), "none");
  assert.equal(reviewScoreBand(Number.NaN), "none");
});

test("雷达的历史平均去掉本场；没有别的已复盘场次时不画比较线", () => {
  const averages = historicalDimensionAverages(entries, entries[0].key);
  // 只剩一次面接一场：平均就是它自己，本场的 60/70/… 不能混进来。
  assert.deepEqual(averages, { questionUnderstanding: 80, coverage: 90, directness: 70, evidenceCredibility: 80, riskControl: 100 });
  assert.equal(historicalDimensionAverages(entries.slice(0, 1), entries[0].key), null);
  assert.equal(historicalDimensionAverages([entries[2]], "other"), null);
});

test("回答分走势只取有深度复盘的场次，按日期从旧到新", () => {
  const points = reviewScoreTimeline(entries);
  assert.deepEqual(points.map((point) => [point.date, point.score]), [["2026-01-02", 84], ["2026-01-10", 70]]);
});

test("按公司分组：轮次从旧到新，末端结果取最后一场，公司按最近一场排序", () => {
  const groups = groupReviewsByCompany(entries);
  assert.deepEqual(groups.map((group) => group.company), ["株式会社テスト", "株式会社サンプル"]);
  assert.deepEqual(groups[0].rounds.map((item) => item.round), ["一次面接", "二次面接"]);
  assert.equal(groups[0].outcome, "不採用");
  assert.equal(groups[1].outcome, undefined);
});

test("重练进度按东京日期数「今天完成」，旧 UTC 记录不被算到前一天", () => {
  assert.equal(practiceTokyoDay("2026-08-20T10:05:00+09:00"), "2026-08-20");
  // UTC 的 8/19 16:30 是东京 8/20 凌晨。
  assert.equal(practiceTokyoDay("2026-08-19T16:30:00.000Z"), "2026-08-20");
  const items = [
    { attempts: [{ action: "attempt", at: "2026-08-20T09:00:00+09:00" }, { action: "complete", at: "2026-08-20T09:05:00+09:00" }] },
    { attempts: [{ action: "complete", at: "2026-08-19T16:30:00.000Z" }] },
    { attempts: [{ action: "complete", at: "2026-08-19T10:00:00+09:00" }] },
    { attempts: [{ action: "snooze", at: "2026-08-20T11:00:00+09:00", dueAt: "2026-08-21" }] },
  ];
  assert.equal(practiceCompletedOn(items, "2026-08-20"), 2);
});

test("↑↓ 切题在两端停住，不在队列里绕圈", () => {
  const keys = ["a", "b", "c"];
  assert.equal(stepPracticeKey(keys, "b", 1), "c");
  assert.equal(stepPracticeKey(keys, "c", 1), "c");
  assert.equal(stepPracticeKey(keys, "a", -1), "a");
  assert.equal(stepPracticeKey(keys, "missing", 1), "a");
  assert.equal(stepPracticeKey([], "a", 1), null);
});

test("练习笔记能回到同一场的整理稿，接尾辞不对时不猜", () => {
  const source = "20_求職/株式会社テスト/2026-01-02_一次面接_整理稿.md";
  assert.equal(reviewSourcePath(reviewSiblingPath(source, "practice"), "practice"), source);
  assert.equal(reviewSourcePath("20_求職/株式会社テスト/メモ.md", "practice"), null);
});

test("回答重练：进度条、快捷键帽与证据句链接", async () => {
  const { default: InterviewPractice } = await loadAppModule("app/interview-practice.tsx");
  const practicePath = "20_求職/株式会社テスト/2026-01-02_一次面接_回答練習.md";
  const content = `---\ntype: interview-answer-practice\n---\n# 回答練習\n
- **q2｜queued｜2026-08-20T10:00:00+09:00**
    - 質問:: 転職理由を教えてください
    - 改善回答:: より大きな責任を担いたいです。
    - 証拠:: s010

- **q3｜queued｜2026-08-19T10:00:00+09:00**
    - 質問:: 強みは何ですか
    - 改善回答:: 設計から運用まで担えることです。
    - 証拠:: s020

- **q3｜complete｜2026-08-20T11:00:00+09:00**
`;
  const note = { path: practicePath, name: "2026-01-02_一次面接_回答練習.md", content, tags: [], stat: { mtime: 1, ctime: 1, size: 0 },
    frontmatter: { type: "interview-answer-practice", company: "株式会社テスト", date: "2026-01-02", round: "一次面接" } };
  const html = renderToStaticMarkup(createElement(InterviewPractice, { notes: [note], today: "2026-08-20", onNoteWritten() {} }));
  assert.match(html, /<strong>1 \/ 2<\/strong>/, "今日完成 1 题、还剩 1 题");
  assert.match(html, /待练 1 · 今日已完成 1/);
  assert.match(html, /role="tab" aria-selected="true"/);
  assert.match(html, /<kbd>Space<\/kbd>/);
  const source = await readFile(new URL("../app/interview-practice.tsx", import.meta.url), "utf8");
  assert.match(source, /isTypingTarget\(event\.target\)/);
  assert.match(source, /appViewHref\("review", reviewEvidenceSearch\(ref\)\)/);
});

test("复盘：句卡按场次加 key、草稿留在卡内，全文阅读不在 tablist 里", async () => {
  const [ui, css] = await Promise.all([readFile(new URL("../app/interview-review.tsx", import.meta.url), "utf8"), readAppCss()]);
  assert.match(ui, /key=\{`\$\{doc\.key\}:\$\{sentence\.id\}`\}/);
  assert.match(ui, /const SentenceCard = memo\(/);
  assert.doesNotMatch(ui, /noteDraft=\{/, "草稿不再从父级逐字传下来");
  const tablist = ui.slice(ui.indexOf('className="rv-mode" role="tablist"'), ui.indexOf("</div>", ui.indexOf('className="rv-mode" role="tablist"')));
  assert.doesNotMatch(tablist, /data-novel-entry/);
  assert.match(ui, /data-novel-entry/);
  assert.match(ui, /aria-expanded=\{revealed\}/);
  assert.doesNotMatch(css, /\.rv-hero|\.prep-hero/, "死样式已删");
  for (const selector of [".prep-doc-body rt", ".session-v2 rt", ".reading-mode .reader-prose rt", ".shared-asset-v2 .prep-doc-body rt"]) {
    const rule = css.slice(css.indexOf(`${selector} {`), css.indexOf("}", css.indexOf(`${selector} {`)));
    assert.match(rule, /var\(--ruby-size\)/, `${selector} 统一用 --ruby-size`);
  }
});
