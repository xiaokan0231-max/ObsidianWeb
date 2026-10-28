import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAppModule } from "./helpers/render-tsx.mjs";

const { default: SelectionNoticePanel } = await loadAppModule("app/selection-notice.tsx");
const original = "選考結果のご連絡\n\n慎重に検討した結果、今回は見送らせていただきます。";
const notice = {
  id: "notice-test", date: "2026-10-28", time: "12:20", stage: "書類選考", outcome: "rejected",
  channel: "テスト採用窓口", reasonStatus: "not-stated", capture: "full", original,
};
const render = (props = {}) => renderToStaticMarkup(React.createElement(SelectionNoticePanel, { notices: [notice], locale: "zh-CN", rejected: true, ...props }));

test("缺失拒绝原文与原文确实未说明原因分别呈现", () => {
  const missing = render({ notices: [] });
  assert.match(missing, /已记录不採用，通知原文尚未收录/);
  assert.match(missing, /无法据此判断企业是否说明了原因/);
  assert.doesNotMatch(missing, /这则通知未说明具体原因/);
  assert.doesNotMatch(missing, /<blockquote>/);

  const collected = render();
  assert.match(collected, /这则通知未说明具体原因/);
  assert.doesNotMatch(collected, /尚未收录/);
  assert.match(collected, /完整原文/);
});

test("已有通过通知不能掩盖拒绝原文尚未收录的缺口", () => {
  const earlier = { ...notice, id: "notice-earlier", outcome: "passed", reasonStatus: "unknown", original: "書類選考を通過されました。" };
  const html = render({ notices: [earlier] });
  assert.match(html, /已记录不採用，通知原文尚未收录/);
  assert.match(html, /書類選考を通過されました。/);
  assert.match(html, /data-outcome="passed"/);
  assert.doesNotMatch(html, /这则通知未说明具体原因/);
});

test("节选的原因说明只涉及收录部分，不能声称全文未说明", () => {
  const html = render({ notices: [{ ...notice, capture: "excerpt" }] });
  assert.match(html, /收录的原文节选未说明具体原因/);
  assert.match(html, /原文节选/);
  assert.doesNotMatch(html, /这则通知未说明具体原因|完整原文/);
  const ja = render({ locale: "ja", notices: [{ ...notice, capture: "excerpt" }] });
  assert.match(ja, /収録した抜粋には、具体的な理由の記載がありません/);
  assert.doesNotMatch(ja, /この通知には、具体的な理由の記載がありません|原文全文/);
});

test("中日界面切换不翻译或改写企业原文", () => {
  const zh = render();
  const ja = render({ locale: "ja" });
  assert.match(zh, /选考结果与企业原文/);
  assert.match(ja, /選考結果と企業からの原文/);
  assert.equal(zh.match(/<blockquote>([\s\S]*?)<\/blockquote>/)?.[1], original);
  assert.equal(ja.match(/<blockquote>([\s\S]*?)<\/blockquote>/)?.[1], original);
  assert.match(ja, /面談と通知では、選考段階が異なる場合があります/);
});

test("原文中的HTML始终作为文字显示，不能生成可执行标记", () => {
  const html = render({ notices: [{ ...notice, original: '<script>alert("test")</script>\n<img src=x onerror=alert(1)> & ご連絡' }] });
  assert.match(html, /&lt;script&gt;alert\(&quot;test&quot;\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; &amp; ご連絡/);
  assert.doesNotMatch(html, /<script|<img/);
});

test("首条通知原文默认展开，后续通知保留独立开关", () => {
  const html = render({ notices: [notice, { ...notice, id: "notice-older", original: "先の選考通知です。" }] });
  const details = [...html.matchAll(/<details\b([^>]*)>([\s\S]*?)<\/details>/g)];
  assert.equal(details.length, 2);
  assert.match(details[0][1], /\bopen=""/);
  assert.doesNotMatch(details[1][1], /\bopen=/);
  assert.match(details[0][2], /<blockquote>選考結果のご連絡/);
});

test("未核实原因保持未知，不自动归类套话或推断能力", () => {
  const html = render({ notices: [{ ...notice, reasonStatus: "unknown" }] });
  assert.doesNotMatch(html, /这则通知未说明具体原因|通知含具体说明|selection-notice-reason/);
  assert.match(html, /是否属于套话，可结合这次选考一起判断/);
  assert.equal(render({ notices: [], rejected: false }), "");
});
