import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as review from "../lib/review.ts";
import { loadAppModule } from "./helpers/render-tsx.mjs";

// 用真实组件渲染验证正文和注释的边界，不依赖开发服务器或源码字符串断言。
// 全文阅读的外壳是通用 ReadingMode：它经 portal 挂到 body，服务端渲染时返回 null。
// 这里换成一个只把「调用方给的内容」原样排出来的替身，并记下传入的 props，正文仍是真实组件渲染的。
let readerProps = null;
function ReadingModeStub(props) {
  readerProps = props;
  return createElement("div", { "data-reader": props.documentKey },
    createElement("h1", null, props.title),
    createElement("p", { className: "stub-meta" }, props.metadata.join(" | ")),
    props.headerNote,
    props.children,
    createElement("footer", null, createElement("p", null, props.endLabel), createElement("span", null, props.endNote), props.footerActions));
}
const { default: InterviewNovelReader } = await loadAppModule("app/interview-novel-reader.tsx", {
  stubs: { "./reading-mode": { default: ReadingModeStub } },
});

const parsed = review.parseSeirikou(`## q01 技術経験
- 概:: 技術経験を確認する。
- **s001｜面**
    - 正:: 何を使いましたか。
    - 訳:: 使用过什么？
- **s002｜私**
    - 正:: 分散ストレージを使いました。
    - 原:: あの分散ストレージを使いました。
    - 訳:: 使用过分布式存储。
    - 注:: 本人事后补充：现场提到过HDFS，精确日语原句未保留。
    - 注:: 原转写缺少这一段，保留补充来源。
- **s003｜私**
    - 正:: 次に処理しました。
    - 訳:: 然后进行了处理。
- **s004｜面?**
    - 正:: いつも使っています。
    - 注:: 
`);

function render(language, decisionTasks = []) {
  return renderToStaticMarkup(createElement(InterviewNovelReader, {
    company: "株式会社テスト", date: "2026-01-01", round: "一次面接", parsed,
    decisionTasks, language, onLanguageChange() {}, onExit() {}, onBack() {},
  }));
}

for (const language of ["zh", "ja"]) {
  test(`全文阅读保留补充说明且与逐句正文分离：${language}`, () => {
    const html = render(language);
    const note = html.match(/<div id="nr-notes-s002"[\s\S]*?<\/div>/)?.[0];
    assert.ok(note, "注释必须常驻可见");
    assert.match(note, /role="note"/);
    assert.match(note, /HDFS/);
    assert.match(note, /原转写缺少这一段，保留补充来源。/);
    assert.match(note, language === "zh" ? /非逐字原话/ : /逐語録外/);
    const spoken = html.match(/<p class="nr-paragraph"[\s\S]*?<\/p>/g);
    assert.ok(spoken?.length);
    assert.doesNotMatch(spoken.join(""), /HDFS|本人事后补充|あの分散/);
    assert.match(spoken.join(""), language === "zh" ? /使用过分布式存储。/ : /分散ストレージを使いました。/);
    assert.match(html, /id="nr-sentence-s002"[^>]*aria-describedby="nr-notes-s002"/);
    assert.ok(html.indexOf('<div id="nr-notes-s002"') < html.indexOf('id="nr-sentence-s003"'), "补充紧随对应发言，位于下一句前");
    assert.doesNotMatch(spoken.find((paragraph) => paragraph.includes('id="nr-sentence-s002"')), /nr-sentence-s003/);
    for (const id of ["s001", "s002", "s003", "s004"]) {
      assert.equal((html.match(new RegExp(`id="nr-sentence-${id}"`, "g")) ?? []).length, 1);
    }
    assert.equal((html.match(/\bdata-novel-sentence=/g) ?? []).length, 4);
    assert.equal((html.match(/role="note"/g) ?? []).length, 1, "空注释不产生说明框");
    assert.match(html, /4 句对话 · 1 个章节/);
  });
}

test("全文阅读交给通用阅读层：章节即目录、语言切换与位置记忆键都传过去", () => {
  const changed = [];
  renderToStaticMarkup(createElement(InterviewNovelReader, {
    company: "株式会社テスト", date: "2026-01-01", round: "一次面接", parsed, decisionTasks: [],
    language: "ja", onLanguageChange(value) { changed.push(value); }, onExit() {}, onBack() {}, documentKey: "review-novel:test",
    overlay: createElement("div", { className: "rv-write-alerts" }),
  }));
  assert.equal(readerProps.documentKey, "review-novel:test");
  assert.equal(readerProps.title, "株式会社テスト");
  assert.deepEqual(readerProps.metadata, ["2026-01-01", "一次面接", "1 章 · 4 句"]);
  // 目录 id 必须是章节 section 的 id：ReadingMode 按它高亮「正在读哪一章」并滚动跳转。
  assert.deepEqual(readerProps.headings, [{ id: "nr-chapter-q01", text: "技術経験", lang: "ja" }]);
  assert.equal(readerProps.languageSwitch.value, "ja");
  assert.deepEqual(readerProps.languageSwitch.options.map((option) => option.value), ["zh", "ja"]);
  readerProps.languageSwitch.onChange("zh");
  assert.deepEqual(changed, ["zh"]);
  assert.equal(readerProps.presentation, undefined, "页面版阅读层，不是临场卡或场景版");
  assert.equal(readerProps.endLabel, "本场全文完");
  // 阅读层打开时外壳 inert，复盘的写入提示必须随阅读层挂进去才点得到。
  assert.equal(readerProps.overlay?.props.className, "rv-write-alerts");
});

test("全文阅读继续应用话者裁定，并为缺译句保留日语", () => {
  const html = render("zh", [{
    id: "s004:speaker", sentenceId: "s004", target: "speaker", label: "话者待确认",
    resolvedBy: "a001", resolution: "speaker-self",
  }]);
  assert.doesNotMatch(html, /话者待确认/);
  const finalTurn = html.match(/<div class="nr-turn">[\s\S]*?(?=<div class="nr-turn">|<\/section>)/g)?.find((turn) => turn.includes('id="nr-sentence-s004"'));
  assert.match(finalTurn, /<p class="nr-speaker">我<\/p>/);
  assert.match(html, /id="nr-sentence-s004"[^>]*lang="ja">[^<]*いつも使っています。<small class="nr-missing">（暂无译文）/);
  assert.match(html, /1 句暂无中文译文/);
  assert.equal((html.match(/\bdata-novel-sentence=/g) ?? []).length, 4);
});

test("全文阅读把最新撤回的旧话者确认重新显示为待确认", () => {
  const annotations = review.parseAnnotations(`## エントリ
- **a001｜s004｜裁定｜open｜2026-01-01**
    - 対象:: speaker
    - 我:: 話者裁定：この文は自分の発言
- **a002｜s004｜裁定｜open｜2026-01-02**
    - 対象:: speaker
    - 我:: 这句我记不清是谁说的。
`);
  const tasks = review.reviewDecisionTasks(parsed.sentences, review.uniqueAnnotations(annotations));
  const html = render("zh", tasks);
  const finalTurn = html.match(/<div class="nr-turn">[\s\S]*?(?=<div class="nr-turn">|<\/section>)/g)?.find((turn) => turn.includes('id="nr-sentence-s004"'));
  assert.match(finalTurn, /面试官<span> · 话者待确认<\/span>/);
  assert.doesNotMatch(finalTurn, /<p class="nr-speaker">我<\/p>/);
  assert.equal(tasks.find((task) => task.target === "speaker").resolvedBy, undefined);
});

test("界面为日语时阅读层外框换成日文，正文标签仍跟正文语言走", async () => {
  let props = null;
  const { default: Reader } = await loadAppModule("app/interview-novel-reader.tsx", {
    stubs: {
      "./reading-mode": { default: (value) => { props = value; return ReadingModeStub(value); } },
      "./ui-locale": { useUiLocale: () => ({ locale: "ja", setLocale() {} }) },
    },
  });
  const html = renderToStaticMarkup(createElement(Reader, {
    company: "株式会社テスト", date: "2026-01-01", round: "一次面接", parsed, decisionTasks: [],
    language: "zh", onLanguageChange() {}, onExit() {}, onBack() {},
  }));
  assert.equal(props.eyebrow, "面接の記録");
  assert.equal(props.backLabel, "振り返りに戻る");
  assert.equal(props.endNote, "4 文の会話 · 1 章");
  assert.match(html, /1 文は中国語訳がないため/);
  assert.match(html, /<p class="nr-reading-note">中国語訳<span> · <\/span>会話の順に/);
  assert.match(html, /別の面接を選ぶ/);
  // 正文是中文译文版：话者与补充说明标签照旧是中文。
  assert.match(html, /<p class="nr-speaker">面试官<\/p>/);
  assert.match(html, /补充说明（非逐字原话）/);
});
