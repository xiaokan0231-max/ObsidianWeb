import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { APP_VIEWS, appViewHref } from "../app/app-route.ts";
import * as atlasData from "../lib/memory-atlas-data.ts";
import { createVaultReader } from "../lib/vault-reader.ts";
import { vaultScopeForView } from "../lib/vault-scope.ts";
import { loadAppModule } from "./helpers/render-tsx.mjs";

test("直达日历预加载专用摘要，其它页面预加载对应笔记范围", async () => {
  const { default: Section } = await loadAppModule("app/[section]/[[...rest]]/page.tsx", {
    stubs: {
      "next/navigation": { notFound() { throw new Error("not found"); }, redirect() { throw new Error("redirect"); } },
      "../../memory-atlas": { default: ({ initialView }) => createElement("main", { "data-view": initialView }) },
    },
  });
  for (const view of APP_VIEWS) {
    const [section, ...rest] = appViewHref(view).slice(1).split("/");
    const tree = await Section({ params: Promise.resolve({ section, rest }), searchParams: Promise.resolve({}) });
    const preload = tree.props.children.find((child) => child.type === "link");
    const shell = tree.props.children.find((child) => child.props.initialView);
    assert.equal(shell.props.initialView, view);
    assert.equal(preload.props.rel, "preload");
    assert.equal(preload.props.as, "fetch");
    assert.equal(preload.props.crossOrigin, "anonymous", "匹配普通 fetch 的 cors 模式与同源凭证");
    if (view === "calendar") {
      assert.equal(preload.props.href, "/api/calendar");
      assert.doesNotMatch(renderToStaticMarkup(tree), /\/api\/vault/);
      continue;
    }
    const requests = [];
    const reader = createVaultReader({ fetcher: async (url, options) => {
      requests.push({ url, options });
      return Response.json({ connected: true, notes: [], paths: [] });
    } });
    await reader.request({ scope: vaultScopeForView(shell.props.initialView) });
    assert.equal(requests.length, 1);
    assert.equal(preload.props.href, requests[0].url, `${view} 的预加载与正式读取应复用同一个 URL`);
    assert.equal(requests[0].options.credentials ?? "same-origin", "same-origin");
    assert.equal(requests[0].options.mode ?? "cors", "cors");
    assert.match(renderToStaticMarkup(tree), /<link\b[^>]*rel="preload"[^>]*as="fetch"/);
    reader.dispose();
  }
});

test("非时间线首屏不扫描全文派生统计，时间线仍在需要时计算", async () => {
  const derivedCalls = [];
  const { default: MemoryAtlas } = await loadAppModule("app/memory-atlas.tsx", {
    stubs: { "@/lib/memory-atlas-data": {
      ...atlasData,
      buildDerivedData(notes, now) {
        derivedCalls.push({ notes, now });
        return atlasData.buildDerivedData(notes, now);
      },
    } },
  });
  for (const initialView of APP_VIEWS.filter((view) => view !== "timeline")) {
    renderToStaticMarkup(createElement(MemoryAtlas, { initialView }));
    assert.equal(derivedCalls.length, 0, `${initialView} 不使用时间线结果，不应扫描全文`);
  }
  renderToStaticMarkup(createElement(MemoryAtlas, { initialView: "timeline" }));
  assert.equal(derivedCalls.length, 1);
  assert.deepEqual(derivedCalls[0].notes, []);
  assert.ok(derivedCalls[0].now instanceof Date);
});

test("刷新日历时服务端保留请求月份和周视图，重复参数不丢失", async () => {
  const { default: Section } = await loadAppModule("app/[section]/[[...rest]]/page.tsx", {
    stubs: { "next/navigation": { notFound() { throw new Error("not found"); }, redirect() { throw new Error("redirect"); } } },
  });
  const render = (search) => Section({ params: Promise.resolve({ section: "calendar" }), searchParams: Promise.resolve(search) });
  const month = await render({ month: "2026-07", tag: ["甲", "乙"], omitted: undefined });
  const shell = month.props.children.find((child) => child.props.initialView);
  assert.deepEqual([...new URLSearchParams(shell.props.initialSearch)], [["month", "2026-07"], ["tag", "甲"], ["tag", "乙"]]);
  assert.match(renderToStaticMarkup(month), /2026年7月/);
  const week = await render({ month: "2026-07", calview: "week", calweek: "2026-07-06" });
  const html = renderToStaticMarkup(week);
  assert.match(html, /class="calendar-week-view"/);
  assert.match(html, /7月6日 – 12日/);
  assert.doesNotMatch(html, /role="grid"/);
});
