import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { prefersReducedMotion, REDUCED_MOTION_QUERY, reducedMotionFrom } from "../lib/motion.ts";
import { DEFAULT_UI_MOTION, resolveUiMotion, UI_MOTION_KEY } from "../lib/ui-theme.ts";
import { loadAppModule } from "./helpers/render-tsx.mjs";

/**
 * 减弱动效「跟随系统 / 总是减弱」。钉住三条路：
 * CSS 兜底（motion.css 与 base.css 的系统兜底逐条一致）、首帧脚本（刷新后第一帧就静止）、
 * JS 判定（显式 smooth 滚动、数字滚动、退场计时都经 lib/motion.ts，不再各问各的系统设置）。
 */
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const motionCss = readFileSync(new URL("../app/styles/motion.css", import.meta.url), "utf8");
const baseCss = readFileSync(new URL("../app/styles/base.css", import.meta.url), "utf8");

function declarations(source) {
  return Object.fromEntries([...source.matchAll(/([\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));
}

test("偏好只认 system / reduce，其余回落到跟随系统", () => {
  assert.equal(UI_MOTION_KEY, "echo:motion");
  assert.equal(DEFAULT_UI_MOTION, "system");
  assert.equal(resolveUiMotion("reduce"), "reduce");
  assert.equal(resolveUiMotion("system"), "system");
  for (const value of [undefined, null, "", "on", "REDUCE", true, 1]) assert.equal(resolveUiMotion(value), "system");
});

test("判定：<html data-motion=reduce> 或系统要求减弱，任一为真就减弱", () => {
  const scope = (motion, matches) => ({
    document: { documentElement: { dataset: motion ? { motion } : {} } },
    matchMedia: (query) => ({ matches: query === REDUCED_MOTION_QUERY && matches }),
  });
  assert.equal(reducedMotionFrom(scope("reduce", false)), true);
  assert.equal(reducedMotionFrom(scope(undefined, true)), true);
  assert.equal(reducedMotionFrom(scope(undefined, false)), false);
  assert.equal(reducedMotionFrom(scope("system", false)), false);
  // matchMedia 不存在或抛错（旧浏览器、隐私模式）时不能把调用方一起拖垮。
  assert.equal(reducedMotionFrom({ document: { documentElement: { dataset: {} } } }), false);
  assert.equal(reducedMotionFrom({ matchMedia: () => { throw new Error("blocked"); } }), false);
  assert.equal(reducedMotionFrom(null), false);
  // SSR / node 里没有 window：不减弱，与服务端首帧一致。
  assert.equal(prefersReducedMotion(), false);
});

test("motion.css：data-motion=reduce 的全局兜底与 base.css 的系统兜底逐条一致", () => {
  const forced = motionCss.match(/:root\[data-motion="reduce"\] \*,\s*:root\[data-motion="reduce"\] \*::before,\s*:root\[data-motion="reduce"\] \*::after \{([^}]*)\}/);
  assert.ok(forced, "缺少 :root[data-motion=\"reduce\"] *, ::before, ::after 的兜底规则");
  const system = baseCss.match(/@media \(prefers-reduced-motion: reduce\) \{\s*\*, \*::before, \*::after \{([^}]*)\}/);
  assert.ok(system, "base.css 的系统兜底不见了");
  const forcedDecls = declarations(forced[1]);
  assert.deepEqual(forcedDecls, declarations(system[1]));
  for (const [name, value] of [
    ["animation-duration", "0.01ms !important"],
    ["transition-duration", "0.01ms !important"],
    ["animation-iteration-count", "1 !important"],
    ["scroll-behavior", "auto !important"],
  ]) assert.equal(forcedDecls[name], value, `${name} 应为 ${value}`);
});

test("motion.css：页面转场伪元素单独关（:root * 选不中它们）", () => {
  assert.match(motionCss, /:root\[data-motion="reduce"\]::view-transition-group\(\*\),\s*:root\[data-motion="reduce"\]::view-transition-old\(\*\),\s*:root\[data-motion="reduce"\]::view-transition-new\(\*\) \{\s*animation: none !important;/);
});

/* ===== 首帧脚本 ===== */

async function renderLayout() {
  const { default: RootLayout } = await loadAppModule("app/layout.tsx", {
    stubs: {
      "next/headers": {
        cookies: async () => ({ get: () => undefined }),
        headers: async () => new Headers({ host: "localhost:3000" }),
      },
      "next/font/google": { Geist: () => ({ variable: "font-sans" }), Geist_Mono: () => ({ variable: "font-mono" }) },
    },
  });
  return renderToStaticMarkup(await RootLayout({ children: createElement("main", null, "正文") }));
}

function bootScript(html) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  const script = scripts.find((source) => source.includes(UI_MOTION_KEY));
  assert.ok(script, "layout 的首帧内联脚本没有读 echo:motion");
  return script;
}

/** 在假的 document / localStorage 里执行首帧脚本，返回它写到 <html> 上的 dataset。 */
function runBootScript(script, storage) {
  const dataset = {};
  const localStorage = {
    getItem(key) {
      if (storage instanceof Error) throw storage;
      return Object.hasOwn(storage, key) ? storage[key] : null;
    },
  };
  new Function("document", "localStorage", script)({ documentElement: { dataset } }, localStorage);
  return dataset;
}

test("首帧脚本：本机存了「总是减弱」就在第一帧前写 data-motion", async () => {
  const script = bootScript(await renderLayout());
  assert.equal(runBootScript(script, { [UI_MOTION_KEY]: "reduce" }).motion, "reduce");
  assert.equal(runBootScript(script, { [UI_MOTION_KEY]: "system" }).motion, undefined);
  assert.equal(runBootScript(script, {}).motion, undefined);
  // 侧栏折叠态照旧恢复，两件事互不影响。
  assert.deepEqual(runBootScript(script, { "echo:rail": "collapsed", [UI_MOTION_KEY]: "reduce" }), { rail: "collapsed", motion: "reduce" });
  // 存储被禁用时静默跳过，不能让脚本报错挡住后面的页面。
  assert.deepEqual(runBootScript(script, new Error("SecurityError")), {});
});

/* ===== JS 判定的唯一入口 ===== */

/**
 * 还没换成 lib/motion.ts 的已知调用点。现已清零；名单只许为空：
 * 新代码一律 import { prefersReducedMotion } from "@/lib/motion"，否则设置里的「总是减弱」管不到它。
 */
const PENDING = new Set([]);

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

test("JS 里不再各自 matchMedia(prefers-reduced-motion)：统一走 lib/motion.ts", () => {
  const offenders = [...sourceFiles(join(ROOT, "app")), ...sourceFiles(join(ROOT, "lib"))]
    .map((path) => relative(ROOT, path).split("\\").join("/"))
    .filter((path) => path !== "lib/motion.ts" && !PENDING.has(path))
    .filter((path) => /matchMedia\??\.?\(\s*["'`]\(prefers-reduced-motion/.test(readFileSync(join(ROOT, path), "utf8")));
  assert.deepEqual(offenders, []);
});
