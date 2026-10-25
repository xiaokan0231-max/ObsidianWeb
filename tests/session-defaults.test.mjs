import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compileFunction } from "node:vm";
import ts from "typescript";
import { PREP_V2_SECTIONS } from "../lib/interview-prep-doc.ts";

// 本场面试页的既定与 URL 状态：v2 落在临场卡、纵览还是公司总览由 ?prepTab=／面试临近程度决定，
// v1 的模式写进 ?prepMode=；两者都不能借用殻的 ?section=（原笔记抽屉的锚点）和看板的 ?mode=。
const v2 = await readFile(new URL("../app/interview-session-v2.tsx", import.meta.url), "utf8");
const v1 = await readFile(new URL("../app/interview-session.tsx", import.meta.url), "utf8");

test("v2：URL 的 prepTab 优先，面试在明天之内默认打开临场卡（底下是纵览）；切换标签与关掉临场卡都写回 URL；纵览顶部渲染本轮提醒", () => {
  assert.match(v2, /get\("prepTab"\)/);
  assert.doesNotMatch(v2, /get\("section"\)|set\("section"/, "不能占用殻的 ?section=");
  assert.match(v2, /tab: imminent \|\| doc\.replayOf \? "overview" : "company", stage: imminent && hasStageLines/);
  assert.doesNotMatch(v2, /params\.delete\("prepTab"\)/, "公司总览也要写进 URL，否则面试当天刷新会再弹临场卡");
  assert.match(v2, /rememberTab\(next\)/);
  assert.match(v2, /onClose=\{closeStage\}/);
  assert.match(v2, /briefing\?: ReactNode/);
});

test("v2：切换后刷新恢复同一章节，保留原笔记锚点并清除上一标签的子章节", () => {
  // 执行组件实际使用的 URL 函数，避免把标签合并前的代码写法当作行为契约。
  const source = ts.createSourceFile("session.tsx", v2, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = new Set(["KIT_SECTIONS", "primaryTab", "tabFromUrl", "rememberTab"]);
  const declarations = [];
  function visit(node) {
    if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && names.has(node.name?.getText(source))) {
      declarations.push(ts.isVariableDeclaration(node) ? `const ${node.getText(source)};` : node.getText(source));
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(declarations.length, names.size);
  const browser = {
    location: { pathname: "/interview", search: "?section=source&mode=board" },
    history: { state: { marker: "retained" }, replaceState(state, _, url) {
      assert.equal(state, this.state);
      browser.location.search = new URL(url, "https://example.com").search;
    } },
  };
  const { outputText } = ts.transpileModule(declarations.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } });
  const { rememberTab, tabFromUrl } = compileFunction(`${outputText}\nreturn { rememberTab, tabFromUrl };`, ["window", "PREP_V2_SECTIONS"])(browser, PREP_V2_SECTIONS);
  for (const [section, tab, childKey] of [
    ["overview", "story", "storySection"], ["company", "story"], ["questions", "kit", "kitSection"],
    ["resources", "kit", "kitSection"], ["motivation", "kit", "kitSection"], ["reviews", "reviews"], ["backup", "backup"],
  ]) {
    rememberTab(section);
    const params = new URLSearchParams(browser.location.search);
    assert.equal(params.get("prepTab"), tab);
    assert.equal(params.get("section"), "source");
    assert.equal(params.get("mode"), "board");
    for (const key of ["storySection", "kitSection"]) assert.equal(params.get(key), key === childKey ? section : null);
    assert.equal(tabFromUrl(), section);
  }
});

test("v1：模式从 ?prepMode= 读、点击时写回；本轮提醒传给 v2；同页不再有第二个原生 select 切换器", () => {
  assert.match(v1, /get\("prepMode"\)/);
  assert.match(v1, /params\.set\("prepMode", mode\)/);
  assert.match(v1, /briefing=\{digestBand\}/);
  assert.doesNotMatch(v1, /<select\s+aria-label="切换公司、案件或面谈"/, "原生 select 已被 ContextPicker 取代");
});
