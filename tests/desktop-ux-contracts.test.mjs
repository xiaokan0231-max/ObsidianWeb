import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const memoryAtlas = readFileSync(new URL("../app/memory-atlas.tsx", import.meta.url), "utf8");
const searchPalette = readFileSync(new URL("../app/search-palette.tsx", import.meta.url), "utf8");
const dialogFocus = readFileSync(new URL("../app/use-dialog-focus.ts", import.meta.url), "utf8");
const graphView = readFileSync(new URL("../app/graph-view.tsx", import.meta.url), "utf8");
const jobsView = readFileSync(new URL("../app/jobs-view.tsx", import.meta.url), "utf8");
const timelineView = readFileSync(new URL("../app/timeline-view.tsx", import.meta.url), "utf8");
const baseCss = readFileSync(new URL("../app/styles/base.css", import.meta.url), "utf8");
const uxRefreshCss = readFileSync(new URL("../app/styles/ux-refresh.css", import.meta.url), "utf8");
const timelineCss = readFileSync(new URL("../app/styles/timeline.css", import.meta.url), "utf8");

test("note overlays are deep-linkable, close through Back, and restore focus", () => {
  assert.match(memoryAtlas, /params\.set\("note", note\.path\)/);
  assert.match(memoryAtlas, /window\.history\.pushState\([\s\S]*__echoNote/);
  assert.match(memoryAtlas, /window\.history\.state\?\.__echoNote[\s\S]*window\.history\.back\(\)/);
  assert.match(dialogFocus, /child\.setAttribute\("inert", ""\)/);
  assert.match(dialogFocus, /previous\?\.focus/);
  assert.match(jobsView, /params\.set\("case", path\)/);
  assert.match(jobsView, /window\.history\.state\?\.__echoJob[\s\S]*window\.history\.back\(\)/);
});

test("command palette supports keyboard selection and page commands", () => {
  assert.match(searchPalette, /event\.key === "ArrowDown"/);
  assert.match(searchPalette, /event\.key === "ArrowUp"/);
  assert.match(searchPalette, /event\.key === "Enter"/);
  assert.match(searchPalette, /view: "practice", label: "回答重练"/);
});

test("relationship map starts from search or a local neighborhood", () => {
  assert.match(graphView, /function graphNeighborhood/);
  assert.match(graphView, /renderer === "map" && !focusedNode/);
  assert.match(graphView, /先从一个对象开始/);
  assert.match(graphView, /slice\(0, 28\)/);
});

test("进入 3D 就把页面高度让给舞台，两个 3D 视图共用同一套开关", () => {
  // 页面标题只供读屏定位，列表和 3D 都直接从工具栏开始。
  assert.match(graphView, /renderer === "space" \? " stage-immersive" : ""/);
  assert.match(timelineView, /renderer === "corridor" \? " stage-immersive" : ""/);
  assert.match(graphView, /<h1 className="sr-only">关系图<\/h1>/);
  assert.match(timelineView, /<h1 className="sr-only">时间线<\/h1>/);
  // 顶部 sticky 区的高度只允许写一次：横幅出现时靠 --stage-offset 联动。
  assert.match(uxRefreshCss, /min-height: calc\(100dvh - var\(--stage-offset\)\)/);
  assert.match(uxRefreshCss, /body:has\(\.stale-data-banner\) \{\s*--stage-offset/);
  assert.match(uxRefreshCss, /\.stale-data-banner,[\s\S]{0,160}top: var\(--chrome-top\)/);
  // 舞台自身的 min-height 必须解开，否则它顶着壳把页面撑出滚动条。
  assert.match(
    uxRefreshCss,
    /\.stage-immersive \.space-graph-stage[\s\S]{0,220}min-height: 0;/,
  );
  // 航道壳是 grid：子元素靠拉伸拿高度。写成 height:100% 会在 flex 壳里解析成 0。
  assert.match(timelineCss, /\.time-corridor-layout \{\n  display: grid;/);
});

function channel(value) {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const value = hex.replace("#", "");
  return 0.2126 * channel(Number.parseInt(value.slice(0, 2), 16))
    + 0.7152 * channel(Number.parseInt(value.slice(2, 4), 16))
    + 0.0722 * channel(Number.parseInt(value.slice(4, 6), 16));
}

function contrast(left, right) {
  const [lighter, darker] = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

test("core text and filled interaction colors meet AA contrast", () => {
  const paper = baseCss.match(/--paper:\s*(#[0-9a-f]{6})/i)?.[1];
  const secondary = baseCss.match(/--text-secondary:\s*(#[0-9a-f]{6})/i)?.[1];
  const interactive = baseCss.match(/--interactive:\s*(#[0-9a-f]{6})/i)?.[1];
  assert.ok(paper && secondary && interactive);
  assert.ok(contrast(secondary, paper) >= 4.5);
  assert.ok(contrast(interactive, "#ffffff") >= 4.5);
});
