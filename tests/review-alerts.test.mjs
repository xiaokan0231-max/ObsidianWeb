import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readAppCss } from "./css-source.mjs";

/**
 * 复盘页的写入结果只在固定层 .rv-write-alerts 一处显示。
 * 这条容器规则在 globals.css 拆分时丢过一次：容器变回普通块，提示掉到页面最底部，
 * 页面照常渲染、console 无声，只有「按了没反应」这一个症状。这里把它钉住。
 */
test("复盘的写入提示容器固定在视口，不随正文流", async () => {
  const css = await readAppCss();
  const container = css.match(/(?:^|\n)\.rv-write-alerts\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(container, /position:\s*fixed/);
  assert.match(container, /z-index:\s*230/);
});

test("成功与找不到证据句的通知走固定层，不再渲染在隐藏的原文面板里", () => {
  const source = readFileSync(new URL("../app/interview-review.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /setMessage\(/);
  assert.match(source, /showNotice\(`evidence-missing:/);
  assert.match(source, /tone === "info"/);
});
