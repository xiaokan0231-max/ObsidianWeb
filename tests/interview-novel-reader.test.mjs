import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as review from "../lib/review.ts";

// 用真实组件渲染验证正文和注释的边界，不依赖开发服务器或源码字符串断言。
const source = await readFile(new URL("../app/interview-novel-reader.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const require = createRequire(import.meta.url);
const componentExports = {};
runInNewContext(compiled.outputText, {
  exports: componentExports,
  require: (specifier) => specifier === "@/lib/review" ? review : require(specifier),
});
const InterviewNovelReader = componentExports.default;

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
