import assert from "node:assert/strict";
import test from "node:test";
import { languageChapterHref } from "../lib/language-textbook.ts";
import { normalizeTextbookPosition, resolveTextbookPosition, textbookChapterLink, textbookPositionKey } from "../lib/language-textbook-position.ts";
import { loadAppModule } from "./helpers/render-tsx.mjs";

const learningModule = { points: [{ id: "one" }, { id: "two", source: {} }] };
test("显式 URL 优先于缓存，部分链接不拼接本机另一点的页签", () => {
  const saved = { knowledge: "two", lessonView: "source" };
  assert.deepEqual(resolveTextbookPosition(learningModule, "", saved), saved);
  assert.deepEqual(resolveTextbookPosition(learningModule, "?knowledge=one", saved), { knowledge: "one", lessonView: "explain" });
  assert.deepEqual(resolveTextbookPosition(learningModule, "?lessonView=examples", saved), { knowledge: "one", lessonView: "examples" });
  assert.deepEqual(resolveTextbookPosition(learningModule, "?knowledge=two&lessonView=contrast", saved), { knowledge: "two", lessonView: "contrast" });
  assert.deepEqual(normalizeTextbookPosition(learningModule, { knowledge: "removed", lessonView: "examples" }), { knowledge: "one", lessonView: "explain" });
  assert.deepEqual(resolveTextbookPosition(learningModule, "?lessonView=source"), { knowledge: "one", lessonView: "explain" });
});

test("章导航保留目标位置，内部链接只接受已知本站教材章节", () => {
  const href = languageChapterHref("?chapter=a&course=old&note=old&ui=ja", "b", { knowledge: "two", lessonView: "contrast" });
  assert.equal(href, "/training/topics?chapter=b&ui=ja&knowledge=two&lessonView=contrast");
  for (const link of [href, `http://localhost:3000${href}`]) assert.equal(textbookChapterLink(link, "http://localhost:3000", ["a", "b"]).chapterId, "b");
  for (const link of ["https://example.org/training/topics?chapter=b", "/training/topics?chapter=removed", "/training/topics?chapter=b&course=old", "/training/topics?chapter=b#part", "javascript:alert(1)", "/other?chapter=b"]) {
    assert.equal(textbookChapterLink(link, "http://localhost:3000", ["a", "b"]), null);
  }
});

test("真实位置写入覆盖换章返回、刷新、back 与过期 effect，不写完成状态", async () => {
  const saved = new Map();
  const effects = [];
  const fakeWindow = {
    location: new URL("http://localhost:3000/training/topics"),
    localStorage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) },
    history: { state: { preserved: true }, replaceState(state, _title, href) { this.state = state; fakeWindow.location = new URL(href, fakeWindow.location); } },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  };
  const original = globalThis.window;
  globalThis.window = fakeWindow;
  try {
    const hooks = await loadAppModule("app/use-textbook-position.ts", {
      globals: { window: fakeWindow },
      stubs: { react: { useCallback: callback => callback, useSyncExternalStore: (_subscribe, snapshot) => snapshot(), useEffect: effect => effects.push(effect) } },
    });
    const render = id => hooks.useTextbookPosition(id, ["a", "b"], learningModule);
    const [, selectA] = render("a");
    const staleInitialA = effects.pop();
    staleInitialA();
    const [, freshSelectA] = render("a");
    freshSelectA({ knowledge: "two", lessonView: "contrast" });
    const aUrl = fakeWindow.location.href;
    fakeWindow.location = new URL(languageChapterHref(fakeWindow.location.search, "b", { knowledge: "one", lessonView: "explain" }), fakeWindow.location);
    const [, selectB] = render("b");
    selectB({ knowledge: "two", lessonView: "examples" });
    const staleB = effects.pop();
    const aSaved = JSON.parse(saved.get(textbookPositionKey("a")));
    fakeWindow.location = new URL(languageChapterHref(fakeWindow.location.search, "a", aSaved), fakeWindow.location);
    staleB();
    assert.deepEqual(render("a")[0], { knowledge: "two", lessonView: "contrast" });
    assert.equal(fakeWindow.location.search.includes("lessonView=contrast"), true);
    // 刷新只重新初始化；显式链接压过本机保存的位置。
    fakeWindow.location = new URL("http://localhost:3000/training/topics?chapter=a&knowledge=one&lessonView=examples");
    assert.deepEqual(render("a")[0], { knowledge: "one", lessonView: "examples" });
    fakeWindow.location = new URL(aUrl);
    assert.deepEqual(render("a")[0], aSaved);
    fakeWindow.location = new URL("http://localhost:3000/training/topics");
    staleB();
    assert.equal(fakeWindow.location.search, "");
    fakeWindow.location = new URL("http://localhost:3000/jobs");
    selectA({ knowledge: "two", lessonView: "source" });
    assert.equal(fakeWindow.location.pathname, "/jobs");
    assert.equal(fakeWindow.location.search, "");
    assert.deepEqual(fakeWindow.history.state, { preserved: true });
    assert.ok([...saved.keys()].every(key => key.startsWith("obsidianweb:textbook-position:v1:")));
    assert.ok([...saved.values()].every(value => Object.keys(JSON.parse(value)).sort().join() === "knowledge,lessonView"));
  } finally { if (original === undefined) delete globalThis.window; else globalThis.window = original; }
});
