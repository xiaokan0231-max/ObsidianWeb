import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAppModule } from "./helpers/render-tsx.mjs";

const point = {
  id: "test-roles", titleZh: "测试知识点", patternJa: "担当する", meaningZh: "负责", explanationZh: ["区分负责与说明。"],
  contrasts: [
    { leftJa: "設計を担当しました。", leftZh: "负责了设计。", rightJa: "設計について説明しました。", rightZh: "说明了设计。", explanationZh: "第一句说明职责，第二句说明讲述的话题。" },
    { leftJa: "資料を確認します。", leftZh: "确认资料。", rightJa: "資料を作成します。", rightZh: "制作资料。", explanationZh: "确认与制作是不同的动作。" },
  ],
  examples: [
    { ja: "条件を確認しました。", zh: "确认了条件。", labelZh: "最小口语" },
    { ja: "条件について相談したいです。", zh: "想就条件进行商量。", labelZh: "另一种表达" },
  ],
  cautionZh: "练习句不是本人经历；未负责的事情不能写成负责过。",
};
const walk = value => !value || typeof value !== "object" ? [] : Array.isArray(value) ? value.flatMap(walk) : [value, ...walk(value.props?.children)];
const textOf = value => typeof value === "string" || typeof value === "number" ? String(value) : Array.isArray(value) ? value.map(textOf).join("") : value?.props ? textOf(value.props.children) : "";

async function harness(name, { locale: initialLocale = "zh-CN", source = point, pointIndex = 0 } = {}) {
  let locale = initialLocale;
  let currentPoint = source;
  const states = [];
  let cursor = 0;
  const writes = [];
  const network = [];
  const components = await loadAppModule("app/textbook-practice-cards.tsx", {
    globals: {
      window: { localStorage: { getItem() { return null; }, setItem: (...args) => writes.push(args) } },
      fetch: (...args) => { network.push(args); throw new Error("阅读卡片不能发送请求"); },
    },
    stubs: {
      react: { ...React, useState(initial) {
        const slot = cursor++;
        if (!(slot in states)) states[slot] = typeof initial === "function" ? initial() : initial;
        return [states[slot], value => { states[slot] = typeof value === "function" ? value(states[slot]) : value; }];
      } },
      "./ui-locale": { useUiLocale: () => ({ locale }) },
    },
  });
  const view = () => { cursor = 0; return components[name]({ point: currentPoint, pointIndex }); };
  const button = text => {
    const node = walk(view()).find(item => item.type === "button" && textOf(item.props.children).includes(text));
    assert.ok(node, `未找到按钮：${text}`);
    return node;
  };
  return {
    view, html: () => renderToStaticMarkup(view()), button,
    click: text => button(text).props.onClick(), locale: value => { locale = value; }, point: value => { currentPoint = value; },
    noWrites() { assert.deepEqual(writes, []); assert.deepEqual(network, []); },
  };
}

test("对比每次只给一组日语，选择后显示各自含义和说明，不判唯一答案", async () => {
  const h = await harness("ContrastStep");
  let html = h.html();
  assert.match(html, /第 1 \/ 2 对/);
  assert.match(html, /lang="zh-CN">负责了设计。/);
  assert.match(html, /lang="ja">設計を担当しました。/);
  assert.match(html, /lang="ja">設計について説明しました。/);
  for (const hidden of ["说明了设计。", "第一句说明职责", "資料を確認します。", "资料"]) assert.equal(html.includes(hidden), false, hidden);
  assert.equal(h.button("← 上一对").props.disabled, true);
  h.click("設計について説明しました。"); html = h.html();
  assert.match(html, /你选了 B。看看两句各自强调什么。/);
  assert.equal(html.includes("教材中对应的选项"), false);
  assert.equal(html.includes("所选句对应另一条含义"), false);
  assert.match(html, /<span class="learning-option-meaning" lang="zh-CN">说明了设计。/);
  assert.match(html, /第一句说明职责，第二句说明讲述的话题。/);
  assert.equal(html.split("設計を担当しました。").length - 1, 1);
  assert.equal(html.split("設計について説明しました。").length - 1, 1);
  assert.match(html, /role="status"/);
  assert.equal(h.button("設計について説明しました。").props["aria-pressed"], true);
  h.click("重新试一遍");
  assert.equal(h.html().includes("第一句说明职责"), false);
  assert.equal(h.button("設計について説明しました。").props["aria-pressed"], false);
  h.click("設計を担当しました。"); assert.match(h.html(), /你选了 A。看看两句各自强调什么。/);
  h.noWrites();
});

test("知识点只有一组时仍交替提示不同含义，展开后保留两句且不判语法对错", async () => {
  const single = { ...point, contrasts: [point.contrasts[0]] };
  const h = await harness("ContrastStep", { source: single, pointIndex: 1 });
  assert.match(h.html(), /class="learning-example-chinese" lang="zh-CN">说明了设计。/);
  assert.equal(h.html().includes("负责了设计。"), false);
  h.click("設計を担当しました。");
  for (const text of ["负责了设计。", "说明了设计。", "第一句说明职责"]) assert.ok(h.html().includes(text));
  for (const text of ["正解", "不正解", "回答错误"]) assert.equal(h.html().includes(text), false);
  h.noWrites();
});

test("对比允许跳过选择直接看解释，翻页清除临时状态并交替目标，边界不循环", async () => {
  const h = await harness("ContrastStep");
  h.click("直接看解释");
  assert.match(h.html(), /第一句说明职责/);
  assert.equal(h.html().includes('role="status"'), false);
  assert.equal(h.button("設計を担当しました。").props["aria-pressed"], false);
  h.click("下一对");
  assert.match(h.html(), /第 2 \/ 2 对/);
  assert.match(h.html(), /class="learning-example-chinese" lang="zh-CN">制作资料。/);
  assert.equal(h.html().includes("确认与制作是不同的动作"), false);
  assert.equal(h.button("資料を作成します。").props["aria-pressed"], false);
  assert.equal(h.button("下一对").props.disabled, true);
  h.click("資料を作成します。"); assert.match(h.html(), /你选了 B。看看两句各自强调什么。/);
  h.click("上一对");
  assert.equal(h.html().includes("第一句说明职责"), false);
  assert.equal(h.button("設計を担当しました。").props["aria-pressed"], false);
  h.noWrites();
});

test("对比切换日语保留选择，等义和含义包含关系都不强判唯一答案", async () => {
  const h = await harness("ContrastStep");
  h.click("設計を担当しました。");
  h.locale("ja"); const html = h.html();
  assert.match(html, /lang="ja"/);
  assert.match(html, /A を選びました。それぞれが何を強調しているか確認しましょう。/);
  assert.match(html, /<span class="learning-option-meaning" lang="zh-CN">负责了设计。/);
  assert.equal(h.button("設計を担当しました。").props["aria-pressed"], true);
  assert.equal(html.includes("你选了 A"), false);
  h.point({ ...point, id: "test-equal", contrasts: [{ ...point.contrasts[0], rightZh: point.contrasts[0].leftZh }] });
  assert.equal(h.html().includes("role=\"status\""), false);
  h.click("設計について説明しました。");
  assert.match(h.html(), /B を選びました/);
  assert.equal(h.html().includes("教材中"), false);
  assert.equal(walk(h.view()).some(node => node.type === "nav"), false, "只有一组素材时不显示翻页");
  h.point({ ...point, id: "test-overlap", contrasts: [{ leftJa: "開発に参加しました。", leftZh: "参与开发。", rightJa: "開発を担当しました。", rightZh: "负责开发。", explanationZh: "参与说明有参与，负责说明职责；两句可能都适用。" }] });
  h.locale("zh-CN"); h.click("開発を担当しました。");
  assert.match(h.html(), /你选了 B/);
  assert.match(h.html(), /两句可能都适用/);
  for (const absent of ["另一条含义", "教材中对应", "所选句与", "正解", "不正解"]) assert.equal(h.html().includes(absent), false, absent);
  h.noWrites();
});

test("例句先中文口头尝试，可显示收起参考，切换语言保留展开状态", async () => {
  const h = await harness("ExampleStep");
  assert.match(h.html(), /先试着用日语说一句/);
  assert.match(h.html(), /lang="zh-CN">确认了条件。/);
  assert.equal(h.html().includes("条件を確認しました。"), false);
  assert.match(h.html(), /教学例句不代表本人的经历/);
  assert.equal(h.html().includes(point.cautionZh), false, "本轮边界总结由外层展示，不重复堆叠");
  const referenceId = h.button("显示日语").props["aria-controls"];
  h.click("显示日语");
  assert.equal(h.button("收起日语").props["aria-expanded"], true);
  assert.ok(walk(h.view()).some(node => node.props?.id === referenceId));
  assert.match(h.html(), /<p lang="ja">条件を確認しました。/);
  h.locale("ja");
  assert.match(h.html(), /日本語の参考表現/);
  assert.match(h.html(), /学習用の例文であり、本人の経験を示すものではありません。/);
  assert.match(h.html(), /<p lang="ja">条件を確認しました。/);
  assert.equal(h.button("日本語を閉じて中国語を見る").props["aria-expanded"], true);
  h.click("日本語を閉じて中国語を見る");
  assert.equal(h.html().includes("条件を確認しました。"), false);
  h.locale("zh-CN"); assert.equal(h.button("显示日语").props["aria-expanded"], false);
  h.noWrites();
});

test("例句前后翻页清空参考展开，换知识点、单条与空素材可安全显示", async () => {
  const h = await harness("ExampleStep");
  h.click("显示日语"); h.click("下一例句");
  assert.match(h.html(), /例句 2 \/ 2/);
  assert.match(h.html(), /想就条件进行商量。/);
  assert.equal(h.html().includes("条件について相談したいです。"), false);
  assert.equal(h.html().includes("当前选择"), false);
  assert.equal(h.button("下一例句").props.disabled, true);
  h.click("显示日语"); h.click("上一例句");
  assert.equal(h.html().includes("条件を確認しました。"), false);
  assert.equal(h.html().includes("当前选择"), false);
  h.click("显示日语");
  h.point({ ...point, id: "another-point" });
  assert.equal(h.html().includes("条件を確認しました。"), false);
  for (const marker of ["<textarea", "<input", "已掌握", "正解", "不正解", "提交答案", "还要再看", "可以换一句"]) assert.equal(h.html().includes(marker), false);
  h.point({ ...point, id: "single", examples: [point.examples[0]] });
  assert.equal(walk(h.view()).some(node => node.type === "nav"), false, "单条例句无需翻页按钮");
  h.point({ ...point, id: "empty", examples: [] }); h.locale("ja");
  assert.match(h.html(), /この項目には例文がまだありません。/);
  const emptyContrast = await harness("ContrastStep", { locale: "ja", source: { ...point, contrasts: [] } });
  assert.match(emptyContrast.html(), /この項目には比較用の素材がまだありません。/);
  h.noWrites(); emptyContrast.noWrites();
});
