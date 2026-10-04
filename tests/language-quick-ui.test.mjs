import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAppModule } from "./helpers/render-tsx.mjs";
import { createQuickSession, quickSessionReducer } from "../lib/language/quick-session.ts";

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
  ready: true, stale: false, day: DAY, due: 7, lapsedToday: 1, newAvailable: 320, newToday: 4, dailyNewLimit: 40,
  answeredToday: 12, firstPassToday: 9, seedRemaining: { unknown: 30, uncertain: 12 },
  stageCounts: { unseen: 300, recognized: 40, correctable: 20, retrievable: 11, transferable: 0, stable: 5 },
  drillable: 376, excludedJaMeaning: 511, notebookParsed: 89,
  history: [{ id: "set-1", date: "2026-10-03", targetSize: 20, completedCount: 20, successCount: 16, completedAt: "2026-10-03T03:00:00Z" }],
  topIssues: [{ key: "particle", label: "助詞", interviewCount: 4, occurrenceCount: 21 }],
};

const overviewProps = (values = {}) => ({
  summary: SUMMARY, loading: false, error: "", notice: "", busy: "", settings: { size: 20, typing: true }, exhausted: false,
  tab: "today", fullState: null, stateLoading: false, stateError: "", today: DAY,
  onSettings: noop, onStart: noop, onRebuild: noop, onRetry: noop, onTab: noop, ...values,
});

test("总览：首次读取时数字显示「—」，不先闪一排 0；入口按钮不可用", () => {
  const html = renderToStaticMarkup(createElement(shell.default, { onVaultChanged: async () => {} }));
  assert.match(html, /<dt>今天到期<\/dt><dd>—<\/dd>/);
  assert.match(html, /<dt>训练稳定<\/dt><dd>—<\/dd>/);
  assert.match(html, /今天到期 — · 新题 — · 约 5 分钟/);
  assert.match(html, /<button type="button" class="quick-primary" disabled=""/);
  assert.doesNotMatch(html, /<dd>0<\/dd>/);
  const ja = renderToStaticMarkup(createElement(shellJa.default, { onVaultChanged: async () => {} }));
  assert.match(ja, /<dt>今日の復習<\/dt><dd>—<\/dd>/);
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
  assert.match(html, /<time>2026-10-03<\/time><strong>20 \/ 20<\/strong><em>命中 16<\/em>/);
  assert.match(html, /<dt>能主动提取<\/dt><dd>11<\/dd>/);
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
  assert.doesNotMatch(source, /=== "r"|=== "R"/, "R 留给外壳的全库重读");
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
  assert.deepEqual(sync.parseQuickSettings(null), { size: 20, typing: true });
  assert.deepEqual(sync.parseQuickSettings("{oops"), { size: 20, typing: true });
  assert.deepEqual(sync.parseQuickSettings(JSON.stringify({ size: 15, typing: "yes" })), { size: 20, typing: true });
  assert.deepEqual(sync.parseQuickSettings(JSON.stringify({ size: 30, typing: false })), { size: 30, typing: false });
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
