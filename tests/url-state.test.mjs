import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  enumCodec,
  readUrlParam,
  SHELL_URL_KEYS,
  textCodec,
  writeUrlParam,
} from "../app/use-url-state.ts";

// 页内状态写进 URL 时，最容易出事的是「顺手把别人的参数或 history.state 弄丢」：
// 外壳靠 history.state 里的 __echoAppView 判断返回到哪一页，丢了就回错页。
function withFakeWindow(url, run) {
  const parsed = new URL(url, "https://example.test");
  const calls = [];
  const fake = {
    location: { pathname: parsed.pathname, search: parsed.search, hash: parsed.hash },
    history: {
      state: { __echoAppView: "timeline" },
      replaceState(state, _title, next) {
        calls.push({ state, next });
        const target = new URL(next, "https://example.test");
        fake.location.pathname = target.pathname;
        fake.location.search = target.search;
        fake.location.hash = target.hash;
        fake.history.state = state;
      },
    },
  };
  const previous = globalThis.window;
  globalThis.window = fake;
  try {
    run(fake, calls);
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
}

test("readUrlParam 读出指定键，缺省时为 null", () => {
  withFakeWindow("/timeline?tq=%E9%9D%A2%E8%AF%95&month=2026-09", () => {
    assert.equal(readUrlParam("tq"), "面试");
    assert.equal(readUrlParam("month"), "2026-09");
    assert.equal(readUrlParam("day"), null);
  });
});

test("writeUrlParam 只改一个键，保留其它参数、hash 与 history.state", () => {
  withFakeWindow("/review?review=a.md&filter=err#s3", (fake, calls) => {
    writeUrlParam("pattern", "敬語");
    assert.equal(calls.length, 1);
    const next = new URL(calls[0].next, "https://example.test");
    assert.equal(next.pathname, "/review");
    assert.equal(next.searchParams.get("review"), "a.md");
    assert.equal(next.searchParams.get("filter"), "err");
    assert.equal(next.searchParams.get("pattern"), "敬語");
    assert.equal(next.hash, "#s3");
    assert.deepEqual(calls[0].state, { __echoAppView: "timeline" });
    assert.deepEqual(fake.history.state, { __echoAppView: "timeline" });
  });
});

test("writeUrlParam 以 null 或空串删除键；删光后不留孤零零的 ?", () => {
  withFakeWindow("/graph?mode=all&focus=x.md", (fake) => {
    writeUrlParam("mode", null);
    assert.equal(fake.location.search, "?focus=x.md");
    writeUrlParam("focus", "");
    assert.equal(fake.location.search, "");
    assert.equal(fake.location.pathname, "/graph");
  });
});

test("writeUrlParam 值没变时不调用 replaceState", () => {
  withFakeWindow("/graph?mode=all", (_fake, calls) => {
    writeUrlParam("mode", "all");
    writeUrlParam("focus", null);
    assert.equal(calls.length, 0);
  });
});

test("enumCodec 只认白名单，手改写错的值落回默认（null）", () => {
  const codec = enumCodec(["all", "note", "event"]);
  assert.equal(codec.parse("note"), "note");
  assert.equal(codec.parse("Note"), null);
  assert.equal(codec.parse(""), null);
  assert.equal(codec.serialize, undefined);
});

test("textCodec 原样接收任意字符串", () => {
  assert.equal(textCodec.parse("p07"), "p07");
  assert.equal(textCodec.parse(""), "");
  assert.equal(textCodec.parse("全部"), "全部");
});

// 视图的键与外壳的键同名时，两边会互相覆盖（例如关系图若用 q，就会和外壳的全局检索打架）。
test("各视图 useUrlState 的键不与外壳撞名，且同一文件内不重复", () => {
  const appDir = new URL("../app/", import.meta.url);
  const files = readdirSync(appDir).filter((name) => name.endsWith(".tsx"));
  const shellKeys = new Set(SHELL_URL_KEYS);
  let total = 0;
  for (const name of files) {
    const source = readFileSync(new URL(name, appDir), "utf8");
    const calls = source.match(/useUrlState\s*(?:<[^(]*?>)?\s*\(/g) ?? [];
    const keys = [...source.matchAll(/useUrlState\s*(?:<[^(]*?>)?\s*\(\s*"([^"]+)"/g)].map((match) => match[1]);
    // 键必须是字面量：变量键无法被这里检查，撞名就会漏网。
    assert.equal(keys.length, calls.length, `${name}: useUrlState 的键必须写成字符串字面量`);
    for (const key of keys) {
      assert.ok(!shellKeys.has(key), `${name}: 键 "${key}" 属于外壳（SHELL_URL_KEYS）`);
    }
    const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
    assert.deepEqual(duplicates, [], `${name}: 同一文件内重复使用了键 ${duplicates.join(", ")}`);
    total += keys.length;
  }
  // 正则失效时上面的断言会全部空转；至少要扫到本次接入的那些视图。
  assert.ok(total >= 10, `只扫到 ${total} 个 useUrlState 调用`);
});
