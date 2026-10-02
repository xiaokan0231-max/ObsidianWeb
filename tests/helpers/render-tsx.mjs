import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compileFunction } from "node:vm";
import ts from "typescript";

/*
 * app/ 下的 .tsx/.ts 在 node:test 里直接渲染用的加载器。
 *
 * 为什么需要它：app 组件用 "@/lib/…" 别名、JSX、不带扩展名的相对 import，node 自己加载不了；
 * 以前每个 UI 测试都手抄一遍 transpileModule + runInNewContext + 手写 require 映射，
 * 组件多 import 一个模块，测试就要跟着改映射表。这里按统一规则解析，测试只写「真的想替换」的桩。
 *
 * 规则：
 * - "@/lib/x"、落在 app/ 以外的相对路径 → 真 ESM 的 import()。和测试文件顶上
 *   `import * as model from "../lib/x.ts"` 是同一个模块实例，测试拿来比对的函数就是组件用的那个。
 * - "@/app/x"、app/ 内的相对路径（.tsx/.ts）→ 递归转译加载（除非给了桩）。
 * - .css → 空对象（样式不参与渲染断言）。
 * - react 等裸包 → createRequire，用到时才 require（动态 import() 被 TS 降级成 require，不该预先把它们拉进来）。
 *
 * 为什么先扫描再执行：转译成 CommonJS 后 require 是同步的，而 ESM 的 import() 是异步的。
 * 所以先把代码里出现的 require("…") 全部预加载好，执行时 require 只是查表。
 * 预加载失败不立刻抛：组件里的动态 import() 同样会被扫到，只有真正 require 到时才报错。
 *
 * 为什么用 compileFunction 而不是 runInNewContext：同一个 realm，数组・Map 等可以直接 deepEqual，
 * 注入的 globals（例如 window）以函数参数的形式传给图里的每个模块，而不是污染全局。
 */

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const APP_DIR = resolve(ROOT, "app") + sep;
const nodeRequire = createRequire(import.meta.url);
const COMPILER_OPTIONS = { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 };
const EXTENSIONS = [".tsx", ".ts", ".mjs", ".js"];

// 对话框焦点管理只在浏览器里有意义（要真实 DOM 与 focus()），SSR 渲染里一律置空。
const DEFAULT_STUBS = { "./use-dialog-focus": { useDialogFocus() {} } };

/**
 * @param {string} relPath 相对仓库根，例如 "app/calendar-view.tsx"
 * @param {{
 *   stubs?: Record<string, unknown> | ((specifier: string, from: string) => unknown),
 *   globals?: Record<string, unknown>,
 * }} [options]
 *   stubs：按 import 里写的原样说明符替换（对图里所有文件生效）。函数形式返回 undefined 表示不替换。
 *   globals：注入给图里每个模块的自由变量（例如 { window, URLSearchParams }）。
 * @returns {Promise<Record<string, any>>} 模块的 exports（default 即默认导出）
 */
export async function loadAppModule(relPath, { stubs = {}, globals = {} } = {}) {
  // 缓存按一次调用的模块图隔离：不同测试可以给同一个文件不同的桩。
  const graph = { cache: new Map(), stubs, globals };
  return loadTranspiled(resolve(ROOT, relPath), graph, new Set());
}

function stubFor(specifier, from, graph) {
  if (typeof graph.stubs === "function") {
    const stub = graph.stubs(specifier, from);
    if (stub !== undefined) return { stub };
  } else if (Object.hasOwn(graph.stubs, specifier)) {
    return { stub: graph.stubs[specifier] };
  }
  if (Object.hasOwn(DEFAULT_STUBS, specifier)) return { stub: DEFAULT_STUBS[specifier] };
  return null;
}

function resolveFile(base) {
  const candidates = extname(base) ? [base] : [];
  candidates.push(...EXTENSIONS.map((ext) => base + ext), ...EXTENSIONS.map((ext) => `${base}/index${ext}`));
  const found = candidates.find((path) => existsSync(path) && statSync(path).isFile());
  if (!found) throw new Error(`render-tsx：找不到模块 ${base}`);
  return found;
}

/** 一个说明符 → 执行时 require 该返回的东西。返回 thunk，预加载的失败推迟到真正 require 时。 */
async function preload(specifier, from, graph, stack) {
  const hit = stubFor(specifier, from, graph);
  if (hit) return () => hit.stub;
  if (specifier.endsWith(".css")) return () => ({});
  const local = specifier.startsWith("@/")
    ? resolve(ROOT, specifier.slice(2))
    : specifier.startsWith("./") || specifier.startsWith("../") ? resolve(dirname(from), specifier) : null;
  if (!local) return () => nodeRequire(specifier);
  try {
    const file = resolveFile(local);
    const transpile = file.startsWith(APP_DIR) && (file.endsWith(".tsx") || file.endsWith(".ts"));
    const loaded = transpile ? await loadTranspiled(file, graph, stack) : await import(pathToFileURL(file).href);
    return () => loaded;
  } catch (error) {
    return () => { throw error; };
  }
}

async function loadTranspiled(file, graph, stack) {
  const cached = graph.cache.get(file);
  // 循环 import：沿用 CommonJS 语义，把尚未填完的 exports 交出去。TS 的输出在调用时才读 `mod_1.x`，不会读到空值。
  if (cached) return stack.has(file) ? cached.exports : cached.ready;
  const exports = {};
  const entry = { exports, ready: null };
  graph.cache.set(file, entry);
  entry.ready = (async () => {
    const source = await readFile(file, "utf8");
    const { outputText } = ts.transpileModule(source, { compilerOptions: COMPILER_OPTIONS, fileName: file });
    const nextStack = new Set(stack).add(file);
    const specifiers = [...new Set([...outputText.matchAll(/\brequire\("([^"]+)"\)/g)].map((match) => match[1]))];
    const table = new Map(await Promise.all(specifiers.map(async (specifier) => [specifier, await preload(specifier, file, graph, nextStack)])));
    const require = (specifier) => {
      const thunk = table.get(specifier);
      if (!thunk) throw new Error(`render-tsx：${file} 在运行时 require 了未预加载的 ${specifier}`);
      return thunk();
    };
    const moduleObject = { exports };
    const globalNames = Object.keys(graph.globals);
    const run = compileFunction(outputText, ["exports", "require", "module", "__filename", "__dirname", ...globalNames], { filename: file });
    run(exports, require, moduleObject, file, dirname(file), ...globalNames.map((name) => graph.globals[name]));
    return moduleObject.exports;
  })();
  return entry.ready;
}
