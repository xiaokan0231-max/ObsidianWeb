import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { textbookPositionKey } from "../lib/language-textbook-position.ts";
import { loadAppModule } from "./helpers/render-tsx.mjs";

const point = (id, titleZh) => ({
  id, titleZh, patternJa: "設計を担当する", readingJa: "せっけいをたんとうする", meaningZh: "负责设计的表达",
  collocationsJa: ["設計を担当する", "運用を担当する"],
  explanationZh: ["中文说明：先确定职责范围。", "中文接续说明保持原文。"],
  examples: [{ ja: "設計を担当しました。", zh: "教学例句：负责设计。", labelZh: "最小口语" }, { ja: "運用を担当しました。", zh: "教学例句：负责运维。" }],
  contrasts: [{ leftJa: "設計を担当しました。", leftZh: "承担设计职责", rightJa: "設計について説明しました。", rightZh: "说明设计这一话题", explanationZh: "含义不同，不能互换。" }],
  cautionZh: "只说真实工作，不能扩大职责。",
  source: { speaker: "interviewer", originalJa: "設計について教えてください。", revisionJa: "設計の内容を教えてください。", naturalJa: "設計について、もう少し教えていただけますか。",
    explanationZh: "这是对问题含义的整理。没有认定本人说错。", reliabilityZh: "只有转写，没有核验原音。", natureZh: "语义说明，不是纠错。",
    refs: ["[[20_求職/株式会社テスト/原稿#q01|原始出处]]", "[[20_求職/株式会社テスト/批注]]", "https://example.org/grammar"] },
});
const learningModule = { summaryZh: "围绕职责学习两种关系。", points: [point("object", "动作对象与职责"), point("role", "身份与承担范围")], recapZh: ["回顾原文保持中文。"] };
const chapter = (chapterId, title, module) => ({
  chapterId, title, order: 10, group: "基础表达", summary: "原教材摘要保持中文。", studyMinutes: 18, exerciseCourseId: "practice-test", module,
  note: { path: `20_求職/_素材/${chapterId}.md`, frontmatter: {}, content: `# ${title}\n\n## 原文讲解\n\n完整中文教材正文保持原样。`, tags: [], stat: { ctime: 1, mtime: 1, size: 1 } },
});
const chapters = [chapter("test-chapter", "中文教材标题", learningModule), chapter("next-chapter", "第二章原文标题")];
const noops = { onSelectChapter() {}, onPractice() {}, onOpenWiki() {}, hasPractice: true, hasChapterPractice: true };
const walk = value => !value || typeof value !== "object" ? [] : Array.isArray(value) ? value.flatMap(walk) : [value, ...walk(value.props?.children)];
const text = value => typeof value === "string" || typeof value === "number" ? String(value) : Array.isArray(value) ? value.map(text).join("") : value?.props ? text(value.props.children) : "";
function button(tree, label) {
  const found = walk(tree).find(node => node.type === "button" && text(node).includes(label));
  assert.ok(found, label);
  return found;
}
async function load(locale = "ja", view = "source") {
  return loadAppModule("app/language-textbook.tsx", { stubs: {
    "./ui-locale": { useUiLocale: () => ({ locale }) },
    "./use-textbook-position": { useTextbookPosition: () => [{ knowledge: "object", lessonView: view }, () => {}] },
  } });
}
const render = (View, props = {}) => renderToStaticMarkup(React.createElement(View, { ...noops, chapters, chapter: chapters[0], ...props }));

async function interactiveContrast() {
  const states = []; let cursor = 0;
  const { default: View } = await loadAppModule("app/language-textbook-module.tsx", { stubs: {
    "./ui-locale": { useUiLocale: () => ({ locale: "ja" }) },
    "./use-textbook-position": { useTextbookPosition: () => [{ knowledge: "object", lessonView: "contrast" }, () => {}] },
    react: { ...React, useRef: initial => ({ current: initial }), useEffect() {},
      useState(initial) { const slot = cursor++; if (!(slot in states)) states[slot] = initial; return [states[slot], value => { states[slot] = value; }]; },
    },
  } });
  const root = View({ chapterId: "test-chapter", chapterIds: ["test-chapter"], module: learningModule, onOpenWiki() {} });
  const element = walk(root).find(node => typeof node.type === "function" && node.type.name === "ContrastStep");
  assert.ok(element);
  const step = () => { cursor = 0; return element.type(element.props); };
  return { step, html: () => renderToStaticMarkup(step()) };
}

test("日语教材界面翻译目录、步骤、导航和来源角色，原教材内容与证据两轴保留中文", async () => {
  const { default: View } = await load();
  const before = JSON.stringify(chapters);
  const html = render(View);
  for (const value of ["面接日本語：文法・助詞・自然な表現", "使い方を一つずつ理解し、意味を比べて、一文話してみます。", "解説は中国語、引用・例文は日本語です。", "学習する章", "2 項目", "第 1 章 / 全 2 章", "約 18 分", "学習項目 1 / 2", "ステップ 1 / 4", "面接官が実際に使った表現", "意味の整理", "資料の信頼性と出典", "出典 2", "公開されている学習資料", "学習後の練習（任意）", "次の章 →", "この章で学ぶこと", "学ぶ項目を変える", "資料から確認できること"]) assert.ok(html.includes(value), value);
  for (const label of ["面接日本語の学習", "学習する章の一覧", "学習項目の表示切り替え", "学習ステップの移動", "章の移動"]) assert.ok(html.includes(`aria-label="${label}"`), label);
  assert.match(html, /class="language-textbook" aria-label="面接日本語の学習" lang="ja"/);
  assert.match(html, /<nav class="learning-point-picker" aria-label="学ぶ項目を変える"/);
  assert.ok(html.includes("学ぶ項目を選ぶ · 2 項目"));
  for (const value of ["中文教材标题", "动作对象与职责", "围绕职责学习两种关系。", "语义说明，不是纠错。", "只有转写，没有核验原音。", "这是对问题含义的整理。", "原始出处"]) assert.ok(html.includes(`lang="zh-CN">${value}`), value);
  for (const value of ["設計について教えてください。", "設計の内容を教えてください。", "設計について、もう少し教えていただけますか。"]) assert.ok(html.includes(`lang="ja">${value}`), value);
  assert.match(html, /class="reader-prose textbook-prose" lang="zh-CN"/);
  assert.ok(html.includes("完整中文教材正文保持原样。"));
  assert.ok(html.includes('href="https://example.org/grammar" target="_blank" rel="noreferrer"'));
  for (const absent of ["你的错误", "表示できません", "<textarea", "<details open"]) assert.equal(html.includes(absent), false);
  assert.equal(JSON.stringify(chapters), before);
});

test("日语讲解、对比和例句页翻译操作标签，中文讲解与日语句保留独立语言标记", async () => {
  const { default: Explain } = await load("ja", "explain");
  const explain = render(Explain);
  for (const value of ["読み方", "この使い方の理由", "接続と詳しい説明を見る", "よく使う組み合わせ", "使える範囲", "ステップ 2 / 4"]) assert.ok(explain.includes(value), value);
  for (const value of ["中文说明：先确定职责范围。", "中文接续说明保持原文。", "只说真实工作，不能扩大职责。", "最小口语"]) assert.ok(explain.includes(`lang="zh-CN">${value}`), value);
  for (const value of ["せっけいをたんとうする", "運用を担当する", "設計を担当しました。"]) assert.ok(explain.includes(`lang="ja">${value}`), value);
  assert.match(explain, /<details class="learning-source-drawer"><summary>実際の発言との比較・判断の根拠/);
  assert.match(explain, /<div class="learning-inline-example"><small>例文を見る/);
  for (const value of ["使い方をつかむ", "意味を見分ける", "一文話してみる"]) assert.ok(explain.includes(value), value);
  const { default: Compare } = await load("ja", "contrast");
  const compare = render(Compare);
  for (const value of ["比較 1 / 1", "この項目の表現を比較", "この意味を伝えたいとき、どちらを選びますか？", "解説を直接見る"]) assert.ok(compare.includes(value), value);
  assert.match(compare, /aria-label="二つの日本語の選択肢"/);
  assert.equal(compare.includes('aria-label="表現の比較を切り替える"'), false);
  for (const value of ["说明设计这一话题", "含义不同，不能互换。"]) assert.equal(compare.includes(value), false);
  assert.ok(compare.includes('lang="zh-CN">承担设计职责'));
  assert.ok(compare.includes('lang="ja">設計について説明しました。'));
  const ui = await interactiveContrast();
  button(ui.step(), "解説を直接見る").props.onClick();
  const revealed = ui.html();
  for (const value of ["承担设计职责", "说明设计这一话题", "含义不同，不能互换。"]) assert.ok(revealed.includes(`lang="zh-CN">${value}`), value);
  for (const value of ["違いのポイント", "もう一度試す"]) assert.ok(revealed.includes(value), value);
  assert.equal(revealed.includes("教材で対応する選択肢"), false);
  assert.ok(revealed.includes('lang="ja">設計を担当しました。'));
  assert.ok(revealed.includes('lang="ja">設計について説明しました。'));
  const { default: Examples } = await load("ja", "examples");
  const examples = render(Examples);
  for (const value of ["例文 1 / 2", "伝えたい意味", "日本語を表示", "学習用の例文であり、本人の経験を示すものではありません。", "まず日本語で一文話してみましょう。参考を直接見ても構いません。", "今回覚えておくこと", "もう一度意味を比較する"]) assert.ok(examples.includes(value), value);
  assert.match(examples, /aria-label="例文を切り替える"/);
  assert.match(examples, /class="learning-example-chinese" lang="zh-CN">教学例句：负责设计。/);
  assert.equal(examples.includes('class="learning-example-japanese"'), false);
});

test("无来源教学起点和本人来源使用各自日语标签，不改变证据性质", async () => {
  const data = structuredClone(learningModule);
  delete data.points[0].source;
  const { default: View } = await load("ja", "explain");
  const html = render(View, { chapter: { ...chapters[0], module: data } });
  assert.match(html, /aria-label="学習用例文から始める"/);
  assert.ok(html.includes("本人の実際の発言ではありません。"));
  assert.ok(html.includes('lang="ja">設計を担当しました。'));
  assert.equal(html.includes('id="learning-tab-source"'), false);
  data.points[0].source = { ...learningModule.points[0].source, speaker: "self" };
  const { default: Source } = await load();
  const original = render(Source, { chapter: { ...chapters[0], module: data } });
  for (const value of ["原稿にある表現", "最小限の整理", "整理の理由と使える範囲を開く", "语义说明，不是纠错。"]) assert.ok(original.includes(value), value);
  assert.equal(original.includes("面接官が実際に使った表現"), false);
});

test("切换语言只变显示文案，章节和可选练习回调仍使用原ID", async () => {
  let locale = "zh-CN";
  const selected = []; const practiced = [];
  const { default: View } = await loadAppModule("app/language-textbook.tsx", { stubs: {
    react: { ...React, useRef: initial => ({ current: initial }), useEffect() {} },
    "./ui-locale": { useUiLocale: () => ({ locale }) },
    "./use-textbook-position": { useTextbookPosition: () => [{ knowledge: "object", lessonView: "source" }, () => {}] },
  } });
  const props = { ...noops, chapters, chapter: chapters[0], onSelectChapter: (...args) => selected.push(args), onPractice: (...args) => practiced.push(args) };
  assert.ok(text(View(props)).includes("查看可选练习"));
  locale = "ja";
  const tree = View(props);
  button(tree, "任意の練習を見る").props.onClick();
  button(tree, "この章の練習へ").props.onClick();
  button(tree, "次の章 →").props.onClick();
  assert.deepEqual(practiced, [[], ["practice-test"]]);
  assert.deepEqual(selected, [["next-chapter"]]);
  assert.match(render(View, { chapter: chapters[1] }), /<p lang="zh-CN">原教材摘要保持中文。<\/p>/);
  assert.ok(render(View, { chapter: chapters[1] }).includes("解説は中国語、引用・例文は日本語です。"));
});

test("真实阅读位置在语言切换后保留URL、缓存、页签与已展开的当前例句", async () => {
  let locale = "zh-CN";
  const saved = new Map([[textbookPositionKey("test-chapter"), JSON.stringify({ knowledge: "role", lessonView: "examples" })]]);
  const effects = []; const refs = []; const states = [];
  let refCursor = 0; let stateCursor = 0;
  const fakeWindow = {
    location: new URL("http://localhost:3000/training/topics?chapter=test-chapter&knowledge=role&lessonView=examples&ui=ja#reading"),
    localStorage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) },
    history: { state: { reading: true }, replaceState(state, _title, href) { this.state = state; fakeWindow.location = new URL(href, fakeWindow.location); } },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  };
  const originalWindow = globalThis.window;
  globalThis.window = fakeWindow;
  try {
    const { default: View } = await loadAppModule("app/language-textbook-module.tsx", {
      globals: { window: fakeWindow }, stubs: {
        "./ui-locale": { useUiLocale: () => ({ locale }) },
        react: { ...React, useCallback: callback => callback, useSyncExternalStore: (_subscribe, snapshot) => snapshot(), useEffect: effect => effects.push(effect),
          useRef(initial) { return refs[refCursor++] ??= { current: initial }; },
          useState(initial) { const slot = stateCursor++; if (!(slot in states)) states[slot] = initial; return [states[slot], value => { states[slot] = value; }]; },
        },
      },
    });
    const props = { chapterId: "test-chapter", chapterIds: ["test-chapter", "next-chapter"], module: learningModule, onOpenWiki() {} };
    const root = () => { refCursor = 0; const tree = View(props); for (const effect of effects.splice(0)) effect(); return tree; };
    const step = tree => {
      const element = walk(tree).find(node => typeof node.type === "function" && node.type.name === "ExampleStep");
      assert.ok(element); stateCursor = 0;
      return element.type(element.props);
    };
    let tree = root();
    assert.ok(text(tree).includes("当前知识点 2 / 2"));
    button(step(tree), "下一例句 →").props.onClick();
    button(step(tree), "显示日语").props.onClick();
    const beforeUrl = fakeWindow.location.href;
    const beforeSaved = [...saved.entries()];
    const mountedStepKey = walk(tree).find(node => typeof node.type === "function" && node.type.name === "ExampleStep").key;
    locale = "ja";
    tree = root();
    assert.equal(walk(tree).find(node => typeof node.type === "function" && node.type.name === "ExampleStep").key, mountedStepKey);
    const html = renderToStaticMarkup(step(tree));
    for (const value of ["例文 2 / 2", "日本語を閉じて中国語を見る", "学習用の例文"]) assert.ok(html.includes(value), value);
    assert.ok(text(tree).includes("学習項目 2 / 2"));
    assert.match(html, /id="learning-example-japanese-role-1"><small>日本語の参考表現<\/small><p lang="ja">運用を担当しました。/);
    assert.match(html, /lang="zh-CN">教学例句：负责运维。/);
    assert.equal(fakeWindow.location.href, beforeUrl);
    assert.deepEqual([...saved.entries()], beforeSaved);
    assert.deepEqual(fakeWindow.history.state, { reading: true });
    button(tree, "使い方をつかむ").props.onClick();
    assert.equal(fakeWindow.location.searchParams.get("knowledge"), "role");
    assert.equal(fakeWindow.location.searchParams.get("lessonView"), "explain");
    assert.equal(fakeWindow.location.searchParams.get("ui"), "ja");
    assert.equal(fakeWindow.location.hash, "#reading");
    assert.deepEqual(JSON.parse(saved.get(textbookPositionKey("test-chapter"))), { knowledge: "role", lessonView: "explain" });
    locale = "zh-CN";
    assert.ok(text(root()).includes("当前知识点 2 / 2"));
    assert.equal(fakeWindow.location.searchParams.get("lessonView"), "explain");
    assert.deepEqual([...saved.keys()], [textbookPositionKey("test-chapter")]);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
