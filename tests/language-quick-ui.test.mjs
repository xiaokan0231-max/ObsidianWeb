import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAppModule } from "./helpers/render-tsx.mjs";
import { createQuickSession, quickSessionReducer, summarizeQuickSet } from "../lib/language/quick-session.ts";

/*
 * 快练界面：总览、七种卡片、反馈区、按键与样式契约。卡片与汇总全部是虚构内容。
 * 锁的是「怎么呈现」：翻卡未揭晓时背面不进 HTML、首次读取不闪 0、全程没有作文输入框、
 * 键盘守卫齐全、样式只用语义 token。出卡与判分规则由 language-quick-cards 等测试负责。
 */

const jaStub = { "./ui-locale": { useUiLocale: () => ({ locale: "ja", setLocale() {} }) } };
const shell = await loadAppModule("app/japanese-training.tsx");
const shellJa = await loadAppModule("app/japanese-training.tsx", { stubs: jaStub });
const drill = await loadAppModule("app/language-quick-drill.tsx");
const drillJa = await loadAppModule("app/language-quick-drill.tsx", { stubs: jaStub });
const overview = await loadAppModule("app/language-quick-overview.tsx");
const overviewJa = await loadAppModule("app/language-quick-overview.tsx", { stubs: jaStub });
const sync = await loadAppModule("app/language-quick-sync.ts");
const summaryView = await loadAppModule("app/language-quick-summary.tsx");
const summaryViewJa = await loadAppModule("app/language-quick-summary.tsx", { stubs: jaStub });
const triageView = await loadAppModule("app/language-quick-triage.tsx");
const triageViewJa = await loadAppModule("app/language-quick-triage.tsx", { stubs: jaStub });

const DAY = "2026-10-04";
const reveal = (values = {}) => ({ ja: "", reading: "", meaning: "", wrong: "", explain: "", evidence: [], ...values });
const card = (type, values) => ({
  cardId: `fx-${type}:${type}:${DAY}`,
  itemId: `fx-${type}`,
  group: "nb_term",
  type,
  grading: type === "flip" ? "self" : "auto",
  reason: "new",
  stage: "unseen",
  layer: "R",
  prompt: "meaning",
  stem: "",
  stemLang: "ja",
  options: [],
  answer: "",
  accepted: [],
  reveal: reveal(),
  ...values,
});

const CARDS = {
  meaning: card("meaning_choice", {
    stem: "打ち合わせ", options: ["开会商量", "出差", "加班", "请假"], answer: "开会商量", accepted: ["开会商量"],
    reveal: reveal({ ja: "打ち合わせ", reading: "うちあわせ", meaning: "开会商量", evidence: [{ path: "x.md", label: "単語文法帳 · B-1", excerpt: "" }] }),
  }),
  reading: card("reading_choice", {
    prompt: "reading", stem: "会議室", options: ["かいぎしつ", "かいきしつ", "がいぎしつ", "かいぎし"], answer: "かいぎしつ", accepted: ["かいぎしつ"],
  }),
  word: card("word_choice", {
    prompt: "word", stem: "日程调整", stemLang: "zh", options: ["日程調整", "日程変更", "調整中", "予定表"], answer: "日程調整", accepted: ["日程調整"],
  }),
  cloze: card("cloze_choice", {
    group: "error_patch", prompt: "cloze_particle", stem: "株式会社テスト＿＿入社しました。", options: ["に", "を", "∅", "で"], answer: "に", accepted: ["に"],
    reveal: reveal({
      ja: "株式会社テストに入社しました", wrong: "株式会社テストを入社しました", explain: "入社は「に」を取る",
      evidence: [{ path: "fixture.md", label: "2026-09-01 · 一次面接 · s001", excerpt: "株式会社テストを入社しました" }],
    }),
  }),
  natural: card("natural_choice", {
    group: "error_patch", prompt: "natural", stem: "はい、＿＿＿＿。", options: ["承知しました", "承知です"], optionMarks: [[2, 6], [2, 3]],
    answer: "承知しました", accepted: ["承知しました"],
  }),
  input: card("short_input", {
    prompt: "input_word", stem: "资料共享", stemLang: "zh", answer: "きょうゆう", accepted: ["共有", "きょうゆう"],
  }),
  flip: card("flip", {
    group: "nb_pattern", prompt: "flip_pattern", stem: "結論から……", answer: "結論から申し上げますと、〜です。",
    reveal: reveal({ ja: "結論から申し上げますと、〜です。", reading: "けつろんからもうしあげますと", meaning: "先说结论" }),
  }),
};

const noop = () => {};
const handlers = { onChoose: noop, onSubmit: noop, onReveal: noop, onRate: noop, onGiveUp: noop, onSuspend: noop, onNext: noop, onEnd: noop };
const entryOf = (value, round = 0) => ({ key: `${value.cardId}:${round}`, card: value, round });
const renderCard = (module, value, props = {}) => renderToStaticMarkup(createElement(module.QuickCardView, {
  entry: entryOf(value), phase: "question", revealed: false, ...handlers, ...props,
}));

const SUMMARY = {
  ready: true, stale: false, day: DAY, due: 7, dueTomorrow: 3, lapsedToday: 1, newAvailable: 320, newToday: 4, dailyNewLimit: 40,
  answeredToday: 12, firstPassToday: 9, seedRemaining: { unknown: 30, uncertain: 12 },
  stageCounts: { unseen: 300, recognized: 40, correctable: 20, retrievable: 11, transferable: 0, stable: 5 },
  drillable: 376, excludedJaMeaning: 511, notebookParsed: 89,
  history: [{ id: "set-1", date: "2026-10-03", targetSize: 20, completedCount: 20, successCount: 16, completedAt: "2026-10-03T03:00:00Z" }],
  topIssues: [{ key: "particle", label: "助詞", interviewCount: 4, occurrenceCount: 21 }],
};

const overviewProps = (values = {}) => ({
  summary: SUMMARY, loading: false, error: "", notice: "", busy: "", settings: { size: 20, typing: true, autoAdvance: true, autoAdvanceSeconds: 1 }, exhausted: false,
  tab: "today", fullState: null, stateLoading: false, stateError: "", today: DAY,
  onSettings: noop, onStart: noop, onRebuild: noop, onRetry: noop, onTab: noop, ...values,
});

test("总览：首次读取时数字显示「—」，不先闪一排 0；入口按钮不可用", () => {
  const html = renderToStaticMarkup(createElement(shell.default, { onVaultChanged: async () => {} }));
  assert.match(html, /<dt>今天已练<\/dt><dd>—<\/dd>/);
  assert.match(html, /<dt>已学会<\/dt><dd>—<\/dd>/);
  assert.match(html, /<dt>待复习<\/dt><dd>—<\/dd>/, "汇总没到时不带「明天 0」");
  assert.match(html, /今天到期 — · 新题 — · 约 5 分钟/);
  assert.match(html, /<button type="button" class="quick-primary" disabled=""/);
  assert.doesNotMatch(html, /<dd>0<\/dd>/);
  const ja = renderToStaticMarkup(createElement(shellJa.default, { onVaultChanged: async () => {} }));
  assert.match(ja, /<dt>今日の練習<\/dt><dd>—<\/dd>/);
  assert.match(ja, /<dt>復習待ち<\/dt><dd>—<\/dd>/);
  assert.match(ja, /クイック練習を始める/);
});

test("总览：入口卡给出到期、新题、预计用时，组大小用 aria-pressed，打字题开关与暂不出题说明各一行", () => {
  const html = renderToStaticMarkup(createElement(overview.QuickOverview, overviewProps()));
  assert.match(html, /今天到期 7 · 新题 36 · 约 5 分钟/, "新题＝每日额度剩余 40−4 与题库 320 取小");
  assert.match(html, /<button type="button" aria-pressed="true">20 题<\/button>/);
  assert.equal((html.match(/aria-pressed="false">\d+ 题/g) ?? []).length, 2);
  assert.match(html, /开始 20 题<kbd aria-hidden="true">Enter<\/kbd>/);
  assert.match(html, /role="switch" class="quick-switch" aria-checked="true"/);
  assert.match(html, /还剩 42 条（不会 30 · 犹豫 12）/);
  assert.match(html, /待补中文释义 511 条/);
  assert.match(html, /単語文法帳已解析 89 条/);
  assert.match(html, /助詞[\s\S]*4 场 · 21 次证据/);
  // 改写理由：措辞随快练更名（批／命中 → 组／答对），并带上完成时刻的 JST 时分；没有 gradedCount 的旧历史只写答对数。
  assert.match(html, /<span>10-03 12:00 · 20 题 · 答对 16<\/span>/);
  // 顶部四格要练完一组就会动：今天已练（含答对数）、已学会（能修正及以上）、待复习（含明天）、未练新题。
  assert.match(html, /<dt>今天已练<\/dt><dd>12<small>答对 9<\/small><\/dd>/);
  assert.match(html, /<dt>已学会<\/dt><dd>36<\/dd>/, "20 能修正 + 11 能主动提取 + 0 + 5 稳定");
  assert.match(html, /<dt>待复习<\/dt><dd>7<small>明天 3<\/small><\/dd>/);
  assert.match(html, /<dt>未练新题<\/dt><dd>320<\/dd>/);
  assert.match(html, /class="focus-pulse-stage-note">能修正＝有 1 天首答答对/, "长期阶段的条件写在分布下面");
  // 节奏带的阶段分布来自 summary 的计数，不需要逐条进度。
  assert.match(html, /<small>掌握阶段分布<\/small><span>376<\/span>/);
  assert.doesNotMatch(html, /再加一组新题/, "额度没用完时不出现");
});

test("总览：新题额度用完时给「再加一组新题」；课程未建立时只显示建立入口；洞察标签取到前显示骨架", () => {
  const spent = renderToStaticMarkup(createElement(overview.QuickOverview, overviewProps({ summary: { ...SUMMARY, newToday: 40 } })));
  assert.match(spent, /再加一组新题/);
  assert.match(spent, /今天到期 7 · 新题 0/);

  const empty = renderToStaticMarkup(createElement(overview.QuickOverview, overviewProps({ summary: { ...SUMMARY, ready: false } })));
  assert.match(empty, /建立训练画像/);
  assert.doesNotMatch(empty, /quick-start/);

  const stale = renderToStaticMarkup(createElement(overview.QuickOverview, overviewProps({ summary: { ...SUMMARY, stale: true } })));
  assert.match(stale, /更新训练画像/);

  const profile = renderToStaticMarkup(createElement(overview.QuickOverview, overviewProps({ tab: "profile", stateLoading: true })));
  assert.match(profile, /focus-language-skeleton/);
  assert.match(profile, /复习 7|到期 7 · 新题 36/);
  assert.doesNotMatch(profile, /quick-start"/);
});

test("总览日文界面", () => {
  const html = renderToStaticMarkup(createElement(overviewJa.QuickOverview, overviewProps()));
  assert.match(html, /今日の復習 7・新規 36・約 5 分/);
  assert.match(html, /20 問を始める/);
  assert.match(html, /入力問題/);
  assert.match(html, /中国語訳の未整備 511 件/);
  assert.match(html, /クイック練習を始める/);
});

test("七种卡片 SSR：题面 lang 正确、选项带 <kbd> 序号、作答前不出现答案与读音", () => {
  const meaning = renderCard(drill, CARDS.meaning);
  assert.match(meaning, /选出这句日语的意思/);
  assert.match(meaning, /<p id="quick-stem-[^"]+" class="quick-stem" lang="ja">打ち合わせ<\/p>/);
  assert.equal((meaning.match(/<kbd aria-hidden="true">[1-4]<\/kbd>/g) ?? []).length, 4);
  assert.match(meaning, /<span lang="zh-CN">开会商量<\/span>/, "识义题的选项是中文");
  assert.doesNotMatch(meaning, /うちあわせ/, "读音只在答后显示");
  assert.match(meaning, /role="status"[^>]*>[\s\S]*答完这里显示对错/, "反馈区始终占位");

  const reading = renderCard(drill, CARDS.reading);
  assert.match(reading, /选出正确的读音/);
  assert.match(reading, /<span lang="ja">かいぎしつ<\/span>/);

  const word = renderCard(drill, CARDS.word);
  assert.match(word, /class="quick-stem" lang="zh-CN">日程调整/);

  const cloze = renderCard(drill, CARDS.cloze);
  assert.match(cloze, /选出空格里的助词/);
  assert.match(cloze, /∅ <small>不填<\/small>/);
  assert.doesNotMatch(cloze, /入社は「に」を取る/, "解释只在答后出现");

  const natural = renderCard(drill, CARDS.natural);
  assert.match(natural, /class="quick-options is-binary"/);
  assert.match(natural, /<span lang="ja">承知<mark>しました<\/mark><\/span>/, "二选一高亮差异核");
  assert.match(natural, /<span lang="ja">承知<mark>で<\/mark>す<\/span>/);

  const input = renderCard(drill, CARDS.input);
  assert.match(input, /<input lang="ja" type="text"/);
  assert.doesNotMatch(input, /きょうゆう|共有/, "短输入作答前不出现答案");
  assert.match(input, /假名即可/);

  const flip = renderCard(drill, CARDS.flip);
  assert.match(flip, /先回想完整句型，再揭晓/);
  assert.match(flip, /揭晓<kbd aria-hidden="true">Space<\/kbd>/);
  for (const html of [meaning, reading, word, cloze, natural, input, flip]) {
    assert.doesNotMatch(html, /<textarea/);
    assert.match(html, /不知道/);
    assert.match(html, /这题有问题，不再出/);
  }
});

test("翻卡：未揭晓时背面不进 HTML；揭晓后才有背面与 1/2/3 自评", () => {
  const hidden = renderCard(drill, CARDS.flip);
  assert.doesNotMatch(hidden, /申し上げますと/);
  assert.doesNotMatch(hidden, /けつろん/);
  assert.doesNotMatch(hidden, /先说结论/);
  assert.doesNotMatch(hidden, /quick-flip-back/);

  const shown = renderCard(drill, CARDS.flip, { revealed: true });
  assert.match(shown, /<p class="quick-flip-answer" lang="ja">結論から申し上げますと、〜です。<\/p>/);
  assert.match(shown, /けつろんからもうしあげますと/);
  assert.match(shown, /<kbd aria-hidden="true">1<\/kbd>记得[\s\S]*<kbd aria-hidden="true">2<\/kbd>模糊[\s\S]*<kbd aria-hidden="true">3<\/kbd>忘了/);
  assert.doesNotMatch(shown, /揭晓<kbd/);
});

test("反馈：答错显示正确答案、你当时说、解释、出处；自评不画 ✓/×；服务端判分不一致时以服务端为准", () => {
  const session = quickSessionReducer(createQuickSession({ setId: "s", day: DAY, size: 10, cards: [CARDS.cloze] }), { type: "answer", response: "を" });
  const record = session.records[0];
  const wrong = renderCard(drill, CARDS.cloze, { phase: "feedback", revealed: true, record });
  assert.match(wrong, /<b aria-hidden="true">×<\/b><strong>这次没对<\/strong>/);
  assert.match(wrong, /<dt>正确答案<\/dt><dd lang="ja">に<\/dd>/);
  assert.match(wrong, /<dt>你的回答<\/dt><dd lang="ja">を<\/dd>/);
  assert.match(wrong, /<dt>你当时说<\/dt><dd lang="ja"><s>株式会社テストを入社しました<\/s> → 株式会社テストに入社しました<\/dd>/);
  assert.match(wrong, /入社は「に」を取る/);
  assert.match(wrong, /2026-09-01 · 一次面接 · s001/);
  assert.match(wrong, /class="quick-option is-correct"[\s\S]*?に<\/span>/);
  assert.match(wrong, /class="quick-option is-wrong"[\s\S]*?を<\/span>/);
  assert.match(wrong, /class="quick-next"/);

  const overruled = renderCard(drill, CARDS.cloze, { phase: "feedback", revealed: true, record, serverPassed: true });
  assert.match(overruled, /<strong>答对了<\/strong>/);
  assert.match(overruled, /以服务端为准/);

  const flipSession = quickSessionReducer(
    quickSessionReducer(createQuickSession({ setId: "s", day: DAY, size: 10, cards: [CARDS.flip] }), { type: "reveal" }),
    { type: "answer", rating: "fuzzy" },
  );
  const rated = renderCard(drill, CARDS.flip, { phase: "feedback", revealed: true, record: flipSession.records[0] });
  const feedback = rated.match(/<div class="quick-feedback[^"]*" role="status"[\s\S]*$/)?.[0] ?? "";
  assert.match(feedback, /自评：模糊/);
  assert.doesNotMatch(feedback, /[✓×]/);

  const ja = renderToStaticMarkup(createElement(drillJa.QuickCardView, {
    entry: entryOf(CARDS.cloze), phase: "feedback", revealed: true, record, ...handlers,
  }));
  assert.match(ja, /不正解/);
  assert.match(ja, /当時の言い方/);
  assert.match(ja, /空欄に入る助詞を選んでください/);
});

test("练习屏：顶栏进度、保存状态、结束本组 Esc；右栏圆点与按键提示", () => {
  const session = createQuickSession({ setId: "s", day: DAY, size: 10, cards: [CARDS.meaning, CARDS.reading, CARDS.flip] });
  const html = renderToStaticMarkup(createElement(drill.QuickDrill, {
    session, saveStatus: { pending: 2, saving: false, failed: false, rejected: 0, error: "" }, results: new Map(), onAction: noop,
  }));
  assert.match(html, /<b>1<\/b> \/ 3/);
  assert.match(html, /role="progressbar" aria-valuemin="0" aria-valuemax="3" aria-valuenow="0"/);
  assert.match(html, /2 题待保存/);
  assert.match(html, /结束本组<kbd aria-hidden="true">Esc<\/kbd>/);
  assert.match(html, /role="timer"/);
  assert.equal((html.match(/<ol class="quick-dots">[\s\S]*?<\/ol>/)?.[0].match(/<li /g) ?? []).length, 3);
  assert.match(html, /class="is-current"/);
  assert.doesNotMatch(html, /<textarea/);

  const t = (key, values = {}) => sync.QUICK_COPY[key][0].replace(/\{(\w+)\}/g, (_, name) => String(values[name]));
  assert.equal(drill.quickSaveText({ pending: 0, saving: false, failed: false, rejected: 0, error: "" }, t), "已保存");
  assert.equal(drill.quickSaveText({ pending: 3, saving: false, failed: true, rejected: 0, error: "x" }, t), "保存失败，稍后重试 · 3 题待保存");
  assert.equal(drill.quickSaveText({ pending: 3, saving: true, failed: false, rejected: 1, error: "" }, t), "保存中 · 1 题未能保存（服务端拒收）");
});

test("键盘守卫：连发、组字、修饰键、输入场景、浮层都让出；焦点在按钮上时 Enter/Space 归原生", () => {
  const button = { tagName: "BUTTON", closest: (selector) => selector.includes("button") ? {} : null };
  const plain = { tagName: "DIV", closest: () => null };
  const event = (values) => ({ key: "1", target: plain, defaultPrevented: false, repeat: false, isComposing: false, keyCode: 49, metaKey: false, ctrlKey: false, altKey: false, ...values });
  assert.equal(drill.quickShortcutBlocked(event({})), false);
  for (const values of [{ repeat: true }, { isComposing: true }, { keyCode: 229 }, { metaKey: true }, { ctrlKey: true }, { altKey: true }, { defaultPrevented: true }, { target: { tagName: "INPUT", closest: () => null } }]) {
    assert.equal(drill.quickShortcutBlocked(event(values)), true, JSON.stringify(values));
  }
  assert.equal(drill.quickShortcutBlocked(event({ target: { tagName: "DIV", closest: (selector) => selector === "[inert]" ? {} : null } })), true);
  assert.equal(drill.yieldsToNative(event({ key: "Enter", target: button })), true);
  assert.equal(drill.yieldsToNative(event({ key: " ", target: button })), true);
  assert.equal(drill.yieldsToNative(event({ key: "Enter", target: plain })), false);
  assert.equal(drill.yieldsToNative(event({ key: "1", target: button })), false);
  let prevented = false;
  drill.swallowRepeat({ repeat: true, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
});

test("键盘契约（源码）：1–4、Space 揭晓、1/2/3 自评、Enter/Space/→ 下一题、? 不知道、X 不再出、Esc 结束；不绑定 R", async () => {
  const [source, overviewSource, summarySource] = await Promise.all([
    readFile("app/language-quick-drill.tsx", "utf8"),
    readFile("app/language-quick-overview.tsx", "utf8"),
    readFile("app/language-quick-summary.tsx", "utf8"),
  ]);
  assert.match(source, /const CHOICE_KEYS = \["1", "2", "3", "4"\] as const;/);
  assert.match(source, /RATING_KEYS: Record<string, QuickSelfRating> = \{ "1": "remembered", "2": "fuzzy", "3": "forgot" \}/);
  assert.match(source, /!session\.revealed && key === " "/);
  assert.match(source, /key === "Enter" \|\| key === " " \|\| key === "ArrowRight"/);
  assert.match(source, /key === "\?"/);
  assert.match(source, /letter === "x" && !event\.shiftKey/);
  assert.match(source, /key === "Escape"/);
  assert.match(source, /QUICK_NEXT_LOCK_MS = 250/);
  assert.match(source, /Date\.now\(\) - answeredAt\.current < QUICK_NEXT_LOCK_MS/);
  assert.match(source, /event\.nativeEvent\.isComposing \|\| event\.keyCode === 229/);
  assert.match(source, /document\.querySelector\('\[aria-modal="true"\]'\)/);
  assert.match(source, /from "@\/lib\/keyboard"/);
  // 改写理由：本人 2026-10-05 定了「练习中吞掉 R」（UI-14）。不再是「不绑定 R」，而是只在捕获阶段 preventDefault、
  // 不处理也不阻止传播：外壳的全库重读看到 defaultPrevented 就跳过（见 keyboard.test 对外壳的断言）。
  assert.match(source, /export function isShellReloadKey/);
  assert.match(source, /window\.addEventListener\("keydown", capture, true\)/);
  assert.doesNotMatch(source.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, ""), /stopPropagation|stopImmediatePropagation/);
  assert.match(overviewSource, /event\.key !== "Enter"[\s\S]{0,120}yieldsToNative\(event\)/);
  assert.match(summarySource, /event\.key === "Escape"[\s\S]*onLeave\(\)/);
  assert.match(summarySource, /againRef\.current\?\.focus/);
});

test("全程没有作文输入框；外壳直接 import 快练样式，不改 globals.css", async () => {
  const files = ["app/japanese-training.tsx", "app/language-quick-overview.tsx", "app/language-quick-drill.tsx", "app/language-quick-summary.tsx", "app/language-quick-sync.ts"];
  const sources = await Promise.all(files.map((file) => readFile(file, "utf8")));
  for (const [index, source] of sources.entries()) assert.doesNotMatch(source, /<textarea|textarea\b/, files[index]);
  assert.match(sources[0], /^"use client";\n\nimport "\.\/styles\/language-quick\.css";/);
  const globals = await readFile("app/globals.css", "utf8");
  assert.doesNotMatch(globals, /language-quick/);
});

test("样式契约：无十六进制色、文字色不用 --brand/--orange、px 字号 ≥11、动效只在 prefers-reduced-motion: no-preference 里", async () => {
  const css = await readFile("app/styles/language-quick.css", "utf8");
  const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(code, /#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(code, /(?:^|[\s;{])color:\s*[^;]*var\(--(?:brand|orange)\b/m);
  const sizes = [...code.matchAll(/font(?:-size)?:[^;]*?(\d+(?:\.\d+)?)px/g)].map((match) => Number(match[1]));
  assert.ok(sizes.length > 20, "确实扫到了字号声明");
  for (const size of sizes) assert.ok(size >= 11, `字号 ${size}px 小于 11px`);
  assert.match(code, /@media \(prefers-reduced-motion: no-preference\)/);
  const start = code.indexOf("@media (prefers-reduced-motion: no-preference)");
  let depth = 0;
  let end = start;
  for (let index = code.indexOf("{", start); index < code.length; index += 1) {
    if (code[index] === "{") depth += 1;
    if (code[index] === "}" && --depth === 0) { end = index + 1; break; }
  }
  const outside = code.slice(0, start) + code.slice(end);
  assert.doesNotMatch(outside, /\b(?:transition|animation)\s*:/, "动效声明都在减弱动效的保护里");
  assert.match(code, /\.quick-stem \{[\s\S]*?font-size: clamp\(22px, 2\.2vw, 30px\)/);
  assert.match(code, /@media \(min-width: 1100px\)[\s\S]*?\.quick-stage \{ grid-template-columns: minmax\(0, 1fr\) 248px; \}/);
});

test("设置：localStorage 内容坏了或越界时回到默认 {20, 打字开}", () => {
  // 改写理由：本人 2026-10-05 加了「答对自动下一题」设置（默认开），设置对象多一个 autoAdvance 键；旧存档没有这个键时按默认补上。
  // 再改写理由：本人 2026-10-05 要求等待秒数可选 1 / 3 / 5 秒，设置对象多一个 autoAdvanceSeconds（缺省 1 秒）。
  const D = { size: 20, typing: true, autoAdvance: true, autoAdvanceSeconds: 1 };
  assert.deepEqual(sync.parseQuickSettings(null), D);
  assert.deepEqual(sync.parseQuickSettings("{oops"), D);
  assert.deepEqual(sync.parseQuickSettings(JSON.stringify({ size: 15, typing: "yes" })), D);
  assert.deepEqual(sync.parseQuickSettings(JSON.stringify({ size: 30, typing: false })), { ...D, size: 30, typing: false });
  assert.deepEqual(sync.parseQuickSettings(JSON.stringify({ size: 10, typing: true, autoAdvance: false })), { ...D, size: 10, autoAdvance: false });
  assert.deepEqual(sync.parseQuickSettings(JSON.stringify({ autoAdvance: "no" })), D);
  assert.deepEqual(sync.parseQuickSettings(JSON.stringify({ autoAdvanceSeconds: 5 })), { ...D, autoAdvanceSeconds: 5 });
  assert.deepEqual(sync.parseQuickSettings(JSON.stringify({ autoAdvance: false, autoAdvanceSeconds: 3 })), { ...D, autoAdvance: false, autoAdvanceSeconds: 3 }, "关掉时记住上次的档位");
  assert.deepEqual(sync.parseQuickSettings(JSON.stringify({ autoAdvanceSeconds: 10 })), D, "不在三档里的秒数回到默认");
  assert.equal(sync.parseQuickSettings(JSON.stringify(D)), sync.DEFAULT_QUICK_SETTINGS, "与默认相同时复用同一个对象");
  assert.equal(sync.QUICK_SETTINGS_KEY, "echo:language-quick-settings:v1");
  assert.equal(sync.quickMinutes(20), 5);
  assert.equal(sync.quickMinutes(10), 3);
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

test("答案队列：串行发送、一次带上全部待发、按 eventId 去重、2s/5s/15s 退避、4xx 不重试、keepalive 按组补发", async () => {
  const calls = [];
  const timers = [];
  const statuses = [];
  const received = [];
  const queue = sync.createQuickAnswerQueue({
    post: (body) => {
      const pending = deferred();
      calls.push({ body, ...pending });
      return pending.promise;
    },
    keepalive: (body) => received.push(body),
    onResults: (results) => received.push(...results.map((result) => result.eventId)),
    onStatus: (status) => statuses.push(status),
    schedule: (run, ms) => {
      const timer = { run, ms, cancelled: false };
      timers.push(timer);
      return () => { timer.cancelled = true; };
    },
  });
  const answer = (eventId) => ({ eventId, itemId: `i-${eventId}`, type: "meaning_choice", response: "x" });
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  queue.enqueue("set-a", [answer("a.1")]);
  queue.enqueue("set-a", [answer("a.2"), answer("a.1")]);
  queue.enqueue("set-a", [answer("a.3")]);
  assert.equal(calls.length, 1, "同一时刻只有一个请求在途");
  assert.deepEqual(calls[0].body, { setId: "set-a", answers: [answer("a.1")] });
  assert.equal(queue.status().pending, 3);

  calls[0].resolve({ results: [{ eventId: "a.1", itemId: "i-a.1", status: "recorded", first: true, stageBefore: "unseen", stageAfter: "correctable" }] });
  await flush();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].body.answers.map((value) => value.eventId), ["a.2", "a.3"], "第二次把攒下的一起带上，重复的 a.1 不再发");

  calls[1].reject(new sync.QuickHttpError(503, "暂时不可用"));
  await flush();
  assert.equal(timers.at(-1).ms, 2000);
  assert.equal(queue.status().failed, true);
  assert.equal(queue.status().pending, 2);
  timers.at(-1).run();
  calls[2].reject(new Error("网络断开"));
  await flush();
  assert.equal(timers.at(-1).ms, 5000);
  timers.at(-1).run();
  calls[3].reject(new Error("网络断开"));
  await flush();
  assert.equal(timers.at(-1).ms, 15000);
  timers.at(-1).run();
  calls[4].reject(new Error("网络断开"));
  await flush();
  assert.equal(timers.at(-1).ms, 15000, "之后一直 15s");

  queue.enqueue("set-b", [answer("b.1")], 10);
  queue.flushKeepalive();
  assert.equal(received.find((value) => value?.setId === "set-b")?.setSize, 10, "带上组大小，服务端不必从 setId 里猜");
  assert.deepEqual(received.filter((value) => typeof value === "object").map((body) => [body.setId, body.answers.map((value) => value.eventId)]), [
    ["set-a", ["a.2", "a.3"]],
    ["set-b", ["b.1"]],
  ]);

  queue.retryNow();
  assert.equal(timers.at(-2).cancelled || timers.at(-1).cancelled, true);
  calls[5].resolve({ results: [] });
  await flush();
  assert.equal(calls[6].body.setId, "set-b", "不同组各发各的");
  assert.equal(calls[6].body.setSize, 10);
  calls[6].reject(new sync.QuickHttpError(400, "type 不合法"));
  await flush();
  assert.equal(queue.status().rejected, 1, "服务端明确拒收的不再重试");
  assert.equal(queue.status().pending, 0);
  assert.equal(calls.length, 7);
  assert.ok(received.includes("a.1"));
  queue.dispose();
});

test("答案队列：整批被 4xx 拒收时拆开逐条重发，只放弃真正被拒的那条", async () => {
  const calls = [];
  const queue = sync.createQuickAnswerQueue({
    post: (body) => {
      const pending = deferred();
      calls.push({ body, ...pending });
      return pending.promise;
    },
    keepalive: () => undefined,
    schedule: () => () => undefined,
  });
  const answer = (eventId) => ({ eventId, itemId: `i-${eventId}`, type: "meaning_choice", response: "x" });
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  queue.enqueue("set-c", [answer("c.1")]);
  queue.enqueue("set-c", [answer("c.2"), answer("c.3")]);
  calls[0].resolve({ results: [] });
  await flush();
  assert.deepEqual(calls[1].body.answers.map((value) => value.eventId), ["c.2", "c.3"]);
  calls[1].reject(new sync.QuickHttpError(400, "题型对不上"));
  await flush();
  assert.equal(queue.status().rejected, 0, "整批拒收先拆开，不直接全丢");
  assert.deepEqual(calls[2].body.answers.map((value) => value.eventId), ["c.2"], "拆开后按原顺序一条一条发");
  calls[2].resolve({ results: [] });
  await flush();
  assert.deepEqual(calls[3].body.answers.map((value) => value.eventId), ["c.3"]);
  calls[3].reject(new sync.QuickHttpError(400, "题型对不上"));
  await flush();
  assert.equal(queue.status().rejected, 1);
  assert.equal(queue.status().pending, 0);
  assert.equal(calls.length, 4);
  queue.dispose();
});

test("答案队列：drained 等到落盘或退避才返回，超时也返回，取下一组不会被卡住", async () => {
  const calls = [];
  const timers = [];
  const queue = sync.createQuickAnswerQueue({
    post: (body) => {
      const pending = deferred();
      calls.push({ body, ...pending });
      return pending.promise;
    },
    keepalive: () => undefined,
    schedule: (run, ms) => {
      const timer = { run, ms, cancelled: false };
      timers.push(timer);
      return () => { timer.cancelled = true; };
    },
  });
  const answer = (eventId) => ({ eventId, itemId: `i-${eventId}`, type: "meaning_choice", response: "x" });
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  let settled = 0;

  await queue.drained(4000);
  queue.enqueue("set-d", [answer("d.1")]);
  queue.drained(4000).then(() => { settled += 1; });
  await flush();
  assert.equal(settled, 0, "还有在途的作答时先等");
  calls[0].resolve({ results: [] });
  await flush();
  assert.equal(settled, 1, "落盘后立即返回");
  assert.equal(timers.at(-1).cancelled, true, "超时计时被撤掉");

  queue.enqueue("set-d", [answer("d.2")]);
  queue.drained(4000).then(() => { settled += 1; });
  calls[1].reject(new Error("网络断开"));
  await flush();
  assert.equal(settled, 2, "进入退避就不再等");

  queue.retryNow();
  queue.drained(4000).then(() => { settled += 1; });
  await flush();
  assert.equal(settled, 3, "退避中调用直接返回");
  queue.dispose();
});

// ── 2026-10-05 第六轮：本人拍板的界面项（数字讲清楚、太简单、撤销、回看、自动下一题、分流、练这个、小结、角标） ──

const IDLE = { pending: 0, saving: false, failed: false, rejected: 0, error: "" };
const drillProps = (session, values = {}) => ({ session, saveStatus: IDLE, results: new Map(), onAction: noop, ...values });

test("入口卡：有 nextSet 时写「本组 N 题＝复习 a＋新题 b」，额度退成小字，不满时说原因；待复习副数字写 7 天内", () => {
  const next = { ...SUMMARY, nextSet: { total: 20, due: 2, lapsed: 1, fresh: 17, early: 0 }, dueSoon: [7, 0, 4, 0, 2, 0, 0] };
  const html = renderToStaticMarkup(createElement(overview.QuickOverview, overviewProps({ summary: next })));
  assert.match(html, /本组 20 题＝复习 3＋新题 17 · 约 5 分钟/);
  assert.match(html, /class="quick-start-quota">今天还可学新题 36/);
  assert.doesNotMatch(html, /今天到期 7 · 新题 36/, "有 nextSet 时不再把每日额度当成本组新题数");
  assert.doesNotMatch(html, /本组只有/, "本组满额时不写原因");
  // [0] 是今天，主数字已经算过；副数字只加之后 6 天。
  assert.match(html, /<dt>待复习<\/dt><dd>7<small>7 天内 6<\/small><\/dd>/);

  // 额度卡住：题库还有新题，今天只剩 2 条额度，本组 5 题。
  const quota = { ...SUMMARY, newToday: 38, nextSet: { total: 5, due: 3, lapsed: 0, fresh: 2, early: 0 } };
  assert.match(renderToStaticMarkup(createElement(overview.QuickOverview, overviewProps({ summary: quota }))), /今天剩下的新题额度不够，本组只有 5 题/);
  // 题源卡住：能出的新题只剩 2 条。
  const dry = { ...SUMMARY, newAvailable: 2, nextSet: { total: 5, due: 3, lapsed: 0, fresh: 2, early: 0 } };
  assert.match(renderToStaticMarkup(createElement(overview.QuickOverview, overviewProps({ summary: dry }))), /没有更多到期题，能出的新题也只剩这些，本组只有 5 题/);

  const ja = renderToStaticMarkup(createElement(overviewJa.QuickOverview, overviewProps({ summary: next })));
  assert.match(ja, /このセット 20 問＝復習 3＋新規 17・約 5 分/);
  assert.match(ja, /今日あと新規 36 問まで/);
  assert.match(ja, /7日以内 6/);
});

test("最近练习写「时间 · N 题 · 答对 x / y」；能力画像用 summary.stageCounts 并写范围说明", () => {
  const graded = { ...SUMMARY, history: [{ ...SUMMARY.history[0], completedCount: 10, successCount: 7, gradedCount: 9, completedAt: "2026-10-04T14:53:00Z" }] };
  const html = renderToStaticMarkup(createElement(overview.QuickOverview, overviewProps({ summary: graded })));
  assert.match(html, /<span>10-04 23:53 · 10 题 · 答对 7 \/ 9<\/span>/);

  const state = {
    history: [], progress: [{ itemId: "x", stage: "recognized" }],
    curriculum: {
      items: [],
      profile: { interviewCount: 3, learnerErrorCount: 9, reviewedBlockCount: 12, listeningGapCount: 0, staleReviewPaths: [], topIssues: [] },
    },
  };
  const profile = renderToStaticMarkup(createElement(overview.QuickOverview, overviewProps({ tab: "profile", fullState: state })));
  assert.match(profile, /统计范围：快练可出题的 376 条（含単語文法帳 89 条），与今日训练同一口径/);
  assert.match(profile, /<strong>40<\/strong><span>能识别<\/span><small>翻卡自评、「太简单」与旧扫描自报最多到这里<\/small>/);
  assert.match(profile, /<strong>300<\/strong><span>未见过<\/span>/, "阶段格读 summary，不数完整状态的逐条进度");
  const profileJa = renderToStaticMarkup(createElement(overviewJa.QuickOverview, overviewProps({ tab: "profile", fullState: state })));
  assert.match(profileJa, /集計範囲：クイック練習で出題できる 376 件/);
  assert.match(profileJa, /構造化した面接/);
  assert.doesNotMatch(profileJa, /结构化面试|已确认本人错误|能力画像/, "日文界面下洞察标签不留中文");
});

test("「现在最值得修」：标签用服务端中文，语言类有 focus 才给「练这个」，策略类只写场数并说明去哪练", () => {
  const issues = [
    { key: "particle", label: "助詞", kind: "language", focus: "助詞", itemCount: 12, interviewCount: 4, occurrenceCount: 21 },
    { key: "no-conclusion-first", label: "结论没有先说", kind: "strategy", interviewCount: 6, occurrenceCount: 12, itemCount: 1 },
    { key: "tense", label: "時制", kind: "language", interviewCount: 2, occurrenceCount: 3 },
    // 旧服务端：不给 kind、label 还是英文 slug——按正本表翻译，也按策略类处理。
    { key: "role-mismatch", label: "role-mismatch", interviewCount: 5, occurrenceCount: 12 },
  ];
  const html = renderToStaticMarkup(createElement(overview.QuickTodayColumns, { summary: { ...SUMMARY, topIssues: issues }, onFocus: noop }));
  assert.equal((html.match(/>练这个</g) ?? []).length, 1, "只有带 focus 的语言类行有按钮");
  assert.match(html, /aria-label="针对「助詞」练一组"/);
  assert.match(html, /4 场 · 21 次证据 · 可练 12 条/);
  assert.match(html, /<strong title="结论没有先说">结论没有先说<\/strong><span>6 场<\/span>/, "策略类不写被截断的证据次数");
  assert.doesNotMatch(html, /role-mismatch</, "英文 slug 不原样显示");
  assert.match(html, /回答结构类问题在快练里只有模板卡；整段回答去「回答重练」练。/);
  const ja = renderToStaticMarkup(createElement(overviewJa.QuickTodayColumns, { summary: { ...SUMMARY, topIssues: issues }, onFocus: noop }));
  assert.match(ja, />これを練習</);
  assert.match(ja, /職種への期待とずれる/);
});

test("练这个与针对练习（源码）：以 focus 取一组、组大小用当前设置；取不到卡时按 emptyReason 写中日两份", async () => {
  const shellSource = await readFile("app/japanese-training.tsx", "utf8");
  assert.match(shellSource, /if \(focus\) params\.set\("focus", focus\.focus\)/);
  assert.match(shellSource, /size: String\(settings\.size\)/);
  assert.match(shellSource, /onFocus=\{\(focus, label\) => void startSet\(false, \{ focus, label \}\)\}/);
  for (const reason of ["unknown_focus", "no_items", "nothing_now"]) assert.match(shellSource, new RegExp(`${reason}: "针对练习：`));
  assert.doesNotMatch(shellSource, /response\.emptyMessage/, "不直接显示服务端的中文 emptyMessage");
  for (const key of ["针对练习：没有这一类", "针对练习：没有可出题", "针对练习：现在没题"]) {
    const [zh, ja] = sync.QUICK_COPY[key];
    assert.ok(zh && ja && zh !== ja, key);
  }
  const session = createQuickSession({ setId: "s", day: DAY, size: 10, cards: [CARDS.meaning] });
  const html = renderToStaticMarkup(createElement(drill.QuickDrill, drillProps(session, { focusLabel: "助詞" })));
  assert.match(html, /class="quick-focus-chip">针对练习 · 助詞</);
});

test("太简单 E：题目与反馈阶段都有按钮与键位；X 之后出现「已不再出这题 · 撤销 Z」", async () => {
  const question = renderCard(drill, CARDS.meaning, { onEasy: noop });
  assert.match(question, /aria-keyshortcuts="E" title="太简单：30 天后用辨析题验证一次，不算答对"><kbd aria-hidden="true">E<\/kbd>太简单<\/button>/);
  const answered = quickSessionReducer(createQuickSession({ setId: "s", day: DAY, size: 10, cards: [CARDS.meaning] }), { type: "answer", response: "出差" });
  const feedback = renderCard(drill, CARDS.meaning, { phase: "feedback", revealed: true, record: answered.records[0], onEasy: noop });
  assert.match(feedback, /aria-keyshortcuts="E"/, "反馈阶段也能按太简单");

  const suspended = quickSessionReducer(createQuickSession({ setId: "s", day: DAY, size: 10, cards: [CARDS.meaning, CARDS.reading] }), { type: "suspend" });
  const html = renderToStaticMarkup(createElement(drill.QuickDrill, drillProps(suspended)));
  assert.match(html, /<p class="quick-undo"><span>已不再出这题<\/span><button type="button" class="quick-inline-action" aria-keyshortcuts="Z">撤销<kbd aria-hidden="true">Z<\/kbd><\/button><\/p>/);
  assert.match(html, /<kbd>E<\/kbd><\/dt><dd>太简单/, "右栏键位提示");
  assert.match(html, /<kbd>Z<\/kbd><\/dt><dd>撤销/);
  // 下一题作答之后撤销入口消失：之后的恢复交给小结与总览的已排除清单。
  const moved = quickSessionReducer(suspended, { type: "answer", response: "かいぎしつ" });
  assert.doesNotMatch(renderToStaticMarkup(createElement(drill.QuickDrill, drillProps(moved))), /已不再出这题/);
  // 题面阶段撤销：那张卡重新成为当前题，右栏圆点不能还是「跳过」色。
  const undone = quickSessionReducer(suspended, { type: "undoSuspend" });
  const undoneHtml = renderToStaticMarkup(createElement(drill.QuickDrill, drillProps(undone)));
  assert.doesNotMatch(undoneHtml, /class="is-skip/);
  assert.match(undoneHtml, /<li class="is-current" title="第 1 题"><\/li>/);
  const ja = renderToStaticMarkup(createElement(drillJa.QuickDrill, drillProps(suspended)));
  assert.match(ja, /この問題は今後出しません/);
  assert.match(ja, /簡単すぎ/);

  const [source, shellSource] = await Promise.all([readFile("app/language-quick-drill.tsx", "utf8"), readFile("app/japanese-training.tsx", "utf8")]);
  assert.match(source, /letter === "e" && !event\.shiftKey/);
  assert.match(source, /letter === "z" && !event\.shiftKey/);
  // easy 与撤销也要像作答一样拿到带随机串的 eventId，否则会退回「setId.序号」与上一组撞号被当成重复丢掉。
  assert.match(shellSource, /RECORDING_ACTIONS = new Set<QuickSessionAction\["type"\]>\(\["answer", "gaveUp", "suspend", "easy", "undoSuspend"\]\)/);
});

test("回看 ←：只读显示当时的作答，标「回看中」，数字键无效；→ 或 Enter 回到当前题", async () => {
  let session = createQuickSession({ setId: "s", day: DAY, size: 10, cards: [CARDS.meaning, CARDS.reading] });
  session = quickSessionReducer(session, { type: "answer", response: "出差" });
  session = quickSessionReducer(session, { type: "next" });
  const peeked = quickSessionReducer(session, { type: "back" });
  assert.equal(peeked.peek, 0);
  assert.equal(quickSessionReducer(peeked, { type: "answer", response: "かいぎしつ" }), peeked, "回看时作答不生效");
  const html = renderToStaticMarkup(createElement(drill.QuickDrill, drillProps(peeked)));
  assert.match(html, /class="quick-card type-meaning_choice is-answered is-peeking"/);
  assert.match(html, /<p class="quick-peek-banner" role="status">回看中 · 只读，不能改答案<\/p>/);
  assert.match(html, /打ち合わせ/, "显示的是上一题");
  assert.match(html, /class="quick-option is-wrong"[\s\S]*?出差/, "当时选的错项照样着色");
  assert.doesNotMatch(html, /aria-keyshortcuts="[1-4]"/, "回看时选项不收数字键");
  assert.match(html, /往后看<kbd aria-hidden="true">→<\/kbd>/);
  assert.match(html, /回到当前题<kbd aria-hidden="true">Enter<\/kbd>/);
  assert.match(html, /<li class="is-fail is-peek" title="第 1 题">/, "右栏圆点标出正在看的那题");
  const current = renderToStaticMarkup(createElement(drill.QuickDrill, drillProps(session)));
  assert.match(current, /aria-keyshortcuts="ArrowLeft"><kbd aria-hidden="true">←<\/kbd>回看上一题/);
  assert.match(renderToStaticMarkup(createElement(drillJa.QuickDrill, drillProps(peeked))), /振り返り中/);

  const source = await readFile("app/language-quick-drill.tsx", "utf8");
  const peekBlock = source.slice(source.indexOf("if (peeking) {"), source.indexOf("if (key === \"ArrowLeft\") {\n        if (backable)"));
  assert.match(peekBlock, /actions\.back\(\)[\s\S]*actions\.forward\(\)[\s\S]*actions\.toCurrent\(\)/);
  assert.doesNotMatch(peekBlock, /actions\.(choose|rate|suspend|easy|giveUp)/, "回看分支里没有任何作答动作");
});

test("答对自动下一题：关 / 1 / 3 / 5 秒同一组、默认 1 秒；答对才显示倒计时，答错、关掉都不显示；线长随秒数，减弱动效下不动", async () => {
  // 改写理由：本人 2026-10-05 要求等待可选 1 / 3 / 5 秒，开关与秒数合成一组按钮。
  const on = renderToStaticMarkup(createElement(overview.QuickOverview, overviewProps()));
  assert.match(on, /<div class="quick-auto-setting" role="group" aria-label="答对自动下一题">/);
  assert.match(on, /<button type="button" aria-pressed="false">关<\/button><button type="button" aria-pressed="true">1 秒<\/button><button type="button" aria-pressed="false">3 秒<\/button><button type="button" aria-pressed="false">5 秒<\/button>/);
  const off = renderToStaticMarkup(createElement(overview.QuickOverview, overviewProps({ settings: { size: 20, typing: true, autoAdvance: false, autoAdvanceSeconds: 3 } })));
  assert.match(off, /<button type="button" aria-pressed="true">关<\/button><button type="button" aria-pressed="false">1 秒<\/button><button type="button" aria-pressed="false">3 秒<\/button>/, "关掉时三档都不亮");
  const five = renderToStaticMarkup(createElement(overview.QuickOverview, overviewProps({ settings: { size: 20, typing: true, autoAdvance: true, autoAdvanceSeconds: 5 } })));
  assert.match(five, /aria-pressed="true">5 秒<\/button>/);
  assert.equal(sync.DEFAULT_QUICK_SETTINGS.autoAdvance, true);
  assert.equal(sync.DEFAULT_QUICK_SETTINGS.autoAdvanceSeconds, 1);

  const base = createQuickSession({ setId: "s", day: DAY, size: 10, cards: [CARDS.meaning, CARDS.reading] });
  const right = quickSessionReducer(base, { type: "answer", response: "开会商量" });
  const wrong = quickSessionReducer(base, { type: "answer", response: "出差" });
  const render = (session, autoAdvance, autoAdvanceSeconds) => renderToStaticMarkup(createElement(drill.QuickDrill, drillProps(session, { autoAdvance, autoAdvanceSeconds })));
  assert.match(render(right, true), /<p class="quick-auto" data-seconds="1"><span class="quick-auto-track" aria-hidden="true"><i><\/i><\/span><span>答对了 · 1 秒后下一题，按任意键或点击停留<\/span><\/p>/);
  assert.match(render(right, true, 3), /data-seconds="3"[\s\S]*答对了 · 3 秒后下一题/);
  assert.doesNotMatch(render(right, false), /quick-auto"/);
  assert.doesNotMatch(render(wrong, true), /quick-auto"/, "答错停下来看解释");
  const gaveUp = quickSessionReducer(base, { type: "gaveUp" });
  assert.doesNotMatch(render(gaveUp, true), /quick-auto"/, "不知道也停下");

  const [source, css] = await Promise.all([readFile("app/language-quick-drill.tsx", "utf8"), readFile("app/styles/language-quick.css", "utf8")]);
  assert.deepEqual([1, 3, 5].map(sync.quickAutoAdvanceMs), [1000, 3000, 5000]);
  assert.match(source, /const autoMs = quickAutoAdvanceMs\(autoAdvanceSeconds\);/);
  assert.match(source, /window\.setTimeout\(\(\) => onAction\(\{ type: "next" \}\), autoMs\)/);
  assert.match(source, /!shouldPauseAfter\(record\) && serverPassed !== false/);
  assert.match(source, /onPointerDown=\{hold\}/, "点击打断并停留");
  const motion = css.slice(css.indexOf("@media (prefers-reduced-motion: no-preference)"));
  assert.match(motion, /\.quick-auto-track i \{ animation: quick-auto-drain 1s/, "倒计时动画只在允许动效时播放");
  assert.match(motion, /\.quick-auto\[data-seconds="3"\] \.quick-auto-track i \{ animation-duration: 3s; \}/);
  assert.match(motion, /\.quick-auto\[data-seconds="5"\] \.quick-auto-track i \{ animation-duration: 5s; \}/);
});

test("计时与结束：每题用时封顶 120 秒、读同一只表；Esc 少于一半时要 2 秒内再按一次", async () => {
  const clock = sync.createQuickFocusClock();
  clock.start(1_000);
  clock.pause(4_000);
  assert.equal(clock.read(60_000), 3_000, "页面隐藏时不走");
  clock.resume(70_000);
  assert.equal(clock.stop(72_000), 5_000);
  assert.equal(clock.read(99_000), 5_000, "停表后读数不变");
  assert.equal(sync.QUICK_ELAPSED_CAP_MS, 120_000);
  assert.equal(sync.QUICK_END_CONFIRM_MS, 2_000);
  const source = await readFile("app/language-quick-drill.tsx", "utf8");
  assert.match(source, /Math\.min\(QUICK_ELAPSED_CAP_MS, /);
  assert.match(source, /handled \* 2 < firstTotal && now - endArmedAt\.current > QUICK_END_CONFIRM_MS/);
  assert.equal(sync.quickDueSoonTotal({ dueSoon: [5, 1, 2] }), 3);
  assert.equal(sync.quickDueSoonTotal({}), 0);
});

/** 一组：答对 1 题（升到能修正）、太简单 1 题、排除 1 题；服务端应答全部到齐。 */
function finishedSet() {
  let session = createQuickSession({ setId: "s", day: DAY, size: 10, cards: [CARDS.meaning, CARDS.reading, CARDS.word] });
  session = quickSessionReducer(session, { type: "answer", response: "开会商量" });
  session = quickSessionReducer(session, { type: "next" });
  session = quickSessionReducer(session, { type: "easy" });
  session = quickSessionReducer(session, { type: "suspend" });
  const results = session.records.map((record) => ({
    eventId: record.input.eventId, itemId: record.itemId, status: "recorded", first: true,
    stageBefore: "unseen",
    stageAfter: record.action === "answer" ? "correctable" : record.action === "easy" ? "recognized" : "unseen",
    ...(record.action === "answer" ? { passed: true, nextDueAt: "2026-10-07T19:00:00.000Z" } : {}),
  }));
  return { session, data: summarizeQuickSet(session, results) };
}

test("小结：下次复习、太简单单列、本组排除可恢复、升阶可展开；「再来一组」挂载后 600ms 内不响应", async () => {
  const { session, data } = finishedSet();
  assert.equal(session.phase, "ended");
  const props = {
    summary: data, remaining: { due: 2, fresh: 10 }, focusMs: 65_000,
    nextDue: [{ days: 1, count: 3 }, { days: 3, count: 7 }], onAgain: noop, onLeave: noop, onRestore: noop,
  };
  const html = renderToStaticMarkup(createElement(summaryView.QuickSetSummary, props));
  assert.match(html, /<span>下次复习<\/span>明天 3 题 · 3 天后 7 题/);
  assert.match(html, /class="is-easy">太简单 1 题（30 天后验证，不计正确率）/);
  assert.match(html, /本组排除的条目 <span>1<\/span>[\s\S]*日程调整[\s\S]*>恢复<\/button>/);
  assert.match(html, /<summary>展开升阶条目<\/summary>[\s\S]*打ち合わせ[\s\S]*未见过 → 能修正/);
  assert.match(html, /本次专注 01:05/, "与练习屏顶栏同一只表");
  assert.match(html, /答对 1 \/ 判分 1/, "太简单与排除不进正确率");
  const pending = renderToStaticMarkup(createElement(summaryView.QuickSetSummary, { ...props, nextDue: null, summary: { ...data, stages: { ...data.stages, known: false, pending: 2 } } }));
  assert.match(pending, /<span>下次复习<\/span>保存完后显示/);
  const ja = renderToStaticMarkup(createElement(summaryViewJa.QuickSetSummary, props));
  assert.match(ja, /明日 3 問・3 日後 7 問/);
  assert.match(ja, /このセットで除外した項目/);
  assert.match(ja, /上がった項目を表示/);

  const [source, shellSource] = await Promise.all([readFile("app/language-quick-summary.tsx", "utf8"), readFile("app/japanese-training.tsx", "utf8")]);
  assert.equal(sync.QUICK_AGAIN_LOCK_MS, 600);
  // 按钮 onClick 与全局 Enter 共用同一个判断：最后一题多按的 Enter 跳不过小结。
  assert.match(source, /!mountedAt\.current \|\| Date\.now\(\) - mountedAt\.current < QUICK_AGAIN_LOCK_MS/);
  assert.match(source, /onClick=\{again\}/);
  assert.match(source, /latestAgain\.current\(\)/);
  assert.match(shellSource, /nextDueGroups\(\[\.\.\.results\.values\(\)\], answerDay, \{ exclude: session\.suspended \}\)/);
  assert.match(shellSource, /onRestore=\{\(itemId\) => onAction\(\{ type: "undoSuspend", itemId \}\)\}/);
});

const BRIEFS = [
  { itemId: "fx-a", group: "nb_term", ja: "打ち合わせ", reading: "うちあわせ", meaning: "开会商量" },
  { itemId: "fx-b", group: "error_patch", ja: "株式会社テストに入社しました", reading: "", meaning: "", wrong: "株式会社テストを入社しました" },
];

test("分流屏：一屏一条、1 会 / 2 不确定 / 3 不会、← 改判、Esc 结束；改错条目显示「✗ → ✓」；说明讲清不算成绩", async () => {
  const html = renderToStaticMarkup(createElement(triageView.QuickTriage, { items: BRIEFS, saveStatus: IDLE, onJudge: noop, onEnd: noop }));
  assert.match(html, /<p id="quick-triage-fx-a" class="quick-triage-ja" lang="ja">打ち合わせ<\/p>/);
  assert.match(html, /<dt>读音<\/dt><dd lang="ja">うちあわせ<\/dd>/);
  assert.match(html, /<dt>意思<\/dt><dd lang="zh-CN">开会商量<\/dd>/);
  assert.match(html, /aria-keyshortcuts="1"[^>]*><kbd aria-hidden="true">1<\/kbd>会<\/button>[\s\S]*aria-keyshortcuts="2"[^>]*><kbd aria-hidden="true">2<\/kbd>不确定<\/button>[\s\S]*aria-keyshortcuts="3"[^>]*><kbd aria-hidden="true">3<\/kbd>不会<\/button>/);
  assert.match(html, /不算成绩，只决定新题的出题先后；标「会」的以后会抽查验证/);
  assert.match(html, /<b>1<\/b> \/ 2/, "顶部进度");
  assert.match(html, /role="progressbar" aria-valuemin="0" aria-valuemax="2" aria-valuenow="0"/);
  assert.match(html, /结束<kbd aria-hidden="true">Esc<\/kbd>/);
  assert.match(html, /<kbd aria-hidden="true">←<\/kbd>上一条（改判）/);
  assert.doesNotMatch(html, /fx-b|入社しました/, "一屏只显示一条");
  assert.match(renderToStaticMarkup(createElement(triageView.QuickTriage, { items: [BRIEFS[1]], saveStatus: IDLE, onJudge: noop, onEnd: noop })),
    /<s>株式会社テストを入社しました<\/s><span aria-hidden="true"> → <\/span>株式会社テストに入社しました/);
  assert.match(renderToStaticMarkup(createElement(triageView.QuickTriage, { items: [], loading: true, saveStatus: IDLE, onJudge: noop, onEnd: noop })), /正在取条目/);
  assert.match(renderToStaticMarkup(createElement(triageView.QuickTriage, { items: [], saveStatus: IDLE, onJudge: noop, onEnd: noop })), /没有还没过的新条目了/);
  const ja = renderToStaticMarkup(createElement(triageViewJa.QuickTriage, { items: BRIEFS, saveStatus: IDLE, onJudge: noop, onEnd: noop }));
  assert.match(ja, /ざっと仕分け/);
  assert.match(ja, />分かる<\/button>[\s\S]*>あいまい<\/button>[\s\S]*>分からない<\/button>/);
  assert.match(ja, /成績には入らず/);

  const [source, shellSource] = await Promise.all([readFile("app/language-quick-triage.tsx", "utf8"), readFile("app/japanese-training.tsx", "utf8")]);
  assert.match(source, /JUDGMENT_KEYS: Record<string, QuickTriageJudgment> = \{ "1": "known", "2": "uncertain", "3": "unknown" \}/);
  assert.match(source, /quickShortcutBlocked\(event\)/, "与练习屏同一套键盘守卫（输入场景、浮层都让出）");
  assert.match(source, /useSwallowShellReload\(\)/);
  assert.match(source, /key === "Escape"[\s\S]{0,80}onEnd\(\)/);
  // 判断进同一个答案队列：action triage、合法的占位题型、一次最多 QUICK_TRIAGE_SIZE 条。
  assert.match(shellSource, /action: "triage", judgment/);
  assert.match(shellSource, /size: String\(QUICK_TRIAGE_SIZE\)/);
  assert.match(shellSource, /\.slice\(0, QUICK_TRIAGE_SIZE\)/);
  assert.equal(sync.QUICK_META_TYPE, "flip");
  assert.equal(sync.QUICK_ANSWER_BATCH, 30);
  assert.match(sync.quickLooseSetId("triage", "ab-c_d!"), /^triage\.abcd$/);
  assert.match(sync.quickLooseSetId("restore", "x".repeat(40)), /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
});

test("总览：「快速过一遍」入口、已排除清单逐条恢复、Enter 只在今日训练标签下开始", async () => {
  const summary = {
    ...SUMMARY, triageRemaining: 120, suspendedCount: 3,
    suspended: [BRIEFS[0], BRIEFS[1]],
  };
  const html = renderToStaticMarkup(createElement(overview.QuickOverview, overviewProps({ summary, onTriage: noop, onRestore: noop })));
  assert.match(html, /quick-triage-entry"[^>]*>快速过一遍（还剩 120 条）<\/button>/);
  assert.match(html, /<details class="quick-excluded"><summary>已排除 3 条<\/summary>/);
  assert.match(html, /只列最近 2 条/);
  assert.equal((html.match(/>恢复<\/button>/g) ?? []).length, 2);
  // 已点过恢复的条目在汇总重取前先从清单里拿掉。
  const restored = renderToStaticMarkup(createElement(overview.QuickOverview, overviewProps({ summary, onRestore: noop, restored: new Set(["fx-a"]) })));
  assert.match(restored, /已排除 2 条/);
  assert.equal((restored.match(/>恢复<\/button>/g) ?? []).length, 1);
  // 保存应答带回的汇总已不含刚恢复的条目：本地 restored 还没清，也不能再扣一次。
  const settled = { ...summary, suspendedCount: 2, suspended: [BRIEFS[1]] };
  const afterSave = renderToStaticMarkup(createElement(overview.QuickOverview, overviewProps({ summary: settled, onRestore: noop, restored: new Set(["fx-a"]) })));
  assert.match(afterSave, /已排除 2 条/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(overview.QuickOverview, overviewProps({ onTriage: noop }))), /快速过一遍/, "没有剩余时不出入口");

  const [source, shellSource] = await Promise.all([readFile("app/language-quick-overview.tsx", "utf8"), readFile("app/japanese-training.tsx", "utf8")]);
  assert.match(source, /if \(!canStart \|\| tab !== "today"\) return;/);
  assert.match(shellSource, /type: QUICK_META_TYPE, action: "restore"/);
  // 节奏带的「今天」是练习日（04:00 起算），与历史的归日同一口径，不用日历日。
  assert.match(source, /const jstTodaySnapshot = \(\) => quickDay\(new Date\(\)\.toISOString\(\)\)/);
});

test("外壳：练完一组作废洞察标签的完整状态；把最新汇总交给侧栏角标", async () => {
  const shellSource = await readFile("app/japanese-training.tsx", "utf8");
  assert.match(shellSource, /before\.phase !== "ended" && next\.phase === "ended"[\s\S]{0,200}setFullState\(null\)/);
  assert.match(shellSource, /if \(summary\?\.ready\) onQuickSummary\?\.\(summary\)/);
});
