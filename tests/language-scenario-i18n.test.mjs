import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAppModule } from "./helpers/render-tsx.mjs";
import { scenarioRevision } from "../lib/language-scenario.ts";
import { commitScenarioAnswer, createScenarioDraft, scenarioStorageKey } from "../app/language-scenario-state.ts";

const lesson = {
  durationMinutes: 24, introZh: "用中文解释任务，再用日语回答。",
  evidence: ["transcript", "study", "annotation", "review", "recollection", "fact"].map((kind) => ({
    kind, path: `测试素材/${kind}.md`, locator: "L1–3", excerpt: "原始记录：担当しました。",
  })),
  observationsZh: ["这里只记录实际回答。"],
  hypotheses: ["confirmed-misunderstanding", "possible-partial-understanding", "expression-limited", "focus-shift", "asr-uncertain"].map((kind, index) => ({
    kind, confidence: ["high", "medium", "low"][index % 3], detailZh: "保留来源的不确定性。",
  })),
  counterexamplesZh: ["其他场次可以说明任务。"],
  steps: [{ id: "listen-01", kind: "listen", titleZh: "听题后用自己的话说明", instructionZh: "写下已经理解的部分。", promptJa: "昨日は何をしましたか。",
    expectedZh: ["说明问题要求的时间范围。"], hintsZh: ["注意时间词。"], examplesJa: ["昨日は資料を読みました。"], choicesZh: ["过去的行动", "未来的计划"], factBoundaryZh: "只写真实经历。" }],
};
const course = { courseId: "scenario-test", title: "测试情境", scenario: lesson };

// 驱动同一组件实例的 hooks，语言变化只触发重渲染；真实的草稿和保存逻辑不替换。
async function harness({ lesson: material = lesson, seed, readFails = false, writeFails = false, voices = [], post, refresh } = {}) {
  let locale = "zh-CN";
  let cursor = 0;
  let identity;
  const slots = [], effects = [], requests = [], storage = Object.create(null);
  const key = scenarioStorageKey(course.courseId, scenarioRevision(material));
  if (seed) storage[key] = JSON.stringify(seed);
  Object.defineProperties(storage, {
    getItem: { value: (name) => { if (readFails) throw new Error("blocked"); return storage[name] ?? null; } },
    setItem: { value: (name, value) => { if (writeFails) throw new Error("quota"); storage[name] = value; } },
  });
  let utterance;
  const speech = { getVoices: () => voices, addEventListener() {}, removeEventListener() {}, cancel() {}, speak(value) { utterance = value; } };
  class Utterance { constructor(text) { this.text = text; } }
  const hooks = {
    ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (next) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect(effect, dependencies) {
      const index = cursor++;
      if (!(index in slots) || dependencies.some((value, i) => !Object.is(value, slots[index][i]))) effects.push(effect);
      slots[index] = dependencies;
    },
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
  };
  const { default: Component } = await loadAppModule("app/language-scenario-course.tsx", {
    stubs: { react: hooks, "./ui-locale": { useUiLocale: () => ({ locale }) }, "@/lib/client-api": {
      async postJson(url, body) {
        requests.push({ url, body: structuredClone(body) });
        if (post) return post(body, requests.length);
        return { ok: true, event: { ...body.payload, eventId: body.eventId, courseId: body.courseId, action: body.action, at: "2026-01-01T15:30:00.000Z" } };
      },
    } },
    globals: { localStorage: storage, window: { speechSynthesis: speech }, SpeechSynthesisUtterance: Utterance, setTimeout: () => 1, clearTimeout() {} },
  });
  const api = {
    storage, key, requests,
    render(nextLocale = locale) {
      locale = nextLocale;
      const shell = Component({ course: { ...course, scenario: material }, notes: [], onVaultChanged: refresh ?? (async () => {}) });
      if (identity) assert.deepEqual([shell.type, shell.key], identity, "语言切换不能替换课程实例");
      identity = [shell.type, shell.key];
      cursor = 0;
      api.tree = shell.type(shell.props);
      return api.tree;
    },
    async flush() { for (const effect of effects.splice(0)) effect(); await new Promise((resolve) => setImmediate(resolve)); api.render(); },
    html() { return renderToStaticMarkup(api.tree); },
    nodes(type) {
      const found = [];
      function visit(node) {
        if (Array.isArray(node)) return node.forEach(visit);
        if (!node || typeof node !== "object") return;
        if (typeof node.type === "function") return visit(node.type(node.props));
        if (node.type === type) found.push(node);
        visit(node.props?.children);
      }
      visit(api.tree);
      return found;
    },
    button(text) {
      const found = api.nodes("button").find((node) => nodeText(node) === text);
      assert.ok(found, `找不到按钮：${text}`);
      return found;
    },
    input(value) { api.nodes("textarea")[0].props.onChange({ target: { value } }); api.render(); },
    draft() { return JSON.parse(storage[key]); },
    get utterance() { return utterance; },
  };
  api.render();
  await api.flush();
  return api;
}
function nodeText(node) {
  if (node == null || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(nodeText).join("");
  return typeof node === "object" ? nodeText(node.props?.children) : String(node);
}
function answered(material = lesson) {
  const draft = createScenarioDraft(course.courseId, material, scenarioRevision(material), "attempt-test");
  draft.responses[material.steps[0].id] = "问题询问昨天做过的事。";
  return commitScenarioAnswer(draft, 0);
}

test("情境课服务端加载提示沿用界面语言", async () => {
  for (const [locale, expected] of [["zh-CN", "正在恢复本机训练草稿…"], ["ja", "この端末の練習下書きを復元しています…"]]) {
    const { default: Component } = await loadAppModule("app/language-scenario-course.tsx", {
      stubs: { "./ui-locale": { useUiLocale: () => ({ locale }) } },
    });
    const html = renderToStaticMarkup(React.createElement(Component, { course, notes: [], onVaultChanged: async () => {} }));
    assert.ok(html.includes(expected));
    assert.ok(html.includes(`lang="${locale}"`));
  }
});

test("未确认输入跨语言切换和刷新保留，题文仍隐藏且不写入翻译文案", async () => {
  const ui = await harness();
  ui.input("只听清昨日，还不确定行动。");
  const before = ui.storage[ui.key], textareaKey = ui.nodes("textarea")[0].key;
  ui.render("ja");
  assert.equal(ui.nodes("textarea")[0].props.value, "只听清昨日，还不确定行动。");
  assert.equal(ui.nodes("textarea")[0].key, textareaKey);
  assert.equal(ui.storage[ui.key], before);
  assert.ok(ui.html().includes('aria-label="場面別の練習"'));
  assert.ok(ui.html().includes("聞き取れない部分や、まだ分からない部分も書けます。"));
  assert.equal(ui.html().includes(lesson.steps[0].promptJa), false);
  const restored = await harness({ seed: ui.draft() });
  assert.equal(restored.nodes("textarea")[0].props.value, "只听清昨日，还不确定行动。");
  ui.button("回答を確定して確認ポイントを見る").props.onClick(); ui.render();
  const payload = structuredClone(ui.draft().payload);
  assert.equal(payload.steps[0].answer, "只听清昨日，还不确定行动。");
  ui.render("zh-CN");
  assert.deepEqual(ui.draft().payload, payload);
  assert.equal(ui.nodes("textarea")[0].props.readOnly, true);
});

test("日语界面翻译证据与双轴标签，原题和中文讲解保持原文及语言标记", async () => {
  const ui = await harness({ seed: answered() });
  ui.render("ja");
  const html = ui.html();
  for (const text of ["今回の自己評価", "聞き取り・質問内容の理解", "日本語での表現", "自力でできた", "判断材料なし", "逐語記録", "整理した記録", "本人の注記", "振り返り記録", "記憶に基づく再構成", "事実の基準資料", "聞き違い", "一部のみ理解した可能性", "表現上の制約", "回答の焦点のずれ", "音声認識が不確か", "確信度：高", "確信度：中", "確信度：低"]) assert.ok(html.includes(text), text);
  assert.ok(html.includes(`<blockquote lang="ja">${lesson.steps[0].promptJa}</blockquote>`));
  assert.ok(html.includes('<p lang="zh-CN">写下已经理解的部分。</p>'));
  assert.ok(html.includes('<ul lang="zh-CN"><li>说明问题要求的时间范围。</li></ul>'));
  assert.ok(html.includes('<blockquote lang="und">原始记录：担当しました。</blockquote>'));
  assert.equal(ui.nodes("input").filter((node) => node.props.name.endsWith("-listening") && node.props.value !== "no-evidence").every((node) => node.props.disabled), true);
  ui.render("zh-CN");
  assert.ok(ui.html().includes("本轮自评 · 两项分别记录"));
});

test("保存失败提示随语言变化，完成重试保持同一payload和请求ID，时间按JST显示", async () => {
  const ui = await harness({ seed: answered(), post: (body, count) => {
    if (count === 1) throw new Error("原始服务器细节 <test>");
    return { ok: true, event: { ...body.payload, eventId: body.eventId, courseId: body.courseId, action: body.action, at: "2026-01-01T15:30:00.000Z" } };
  } });
  ui.button("保存本轮作答与自评").props.onClick(); await ui.flush();
  assert.ok(ui.html().includes("保存失败。"));
  const pending = ui.storage[ui.key];
  ui.render("ja");
  assert.equal(ui.storage[ui.key], pending);
  assert.equal(ui.nodes("textarea")[0].props.readOnly, true);
  assert.ok(ui.html().includes("保存できませんでした。"));
  assert.ok(ui.html().includes("同じ保存リクエスト"));
  const detail = ui.nodes("details").find((node) => nodeText(node).includes("原始服务器细节"));
  assert.ok(detail);
  assert.equal(detail.props.open, undefined);
  assert.ok(ui.html().includes("原始服务器细节 &lt;test&gt;"));
  ui.button("今回の結果の保存を再試行").props.onClick(); await ui.flush();
  assert.deepEqual(ui.requests[0], ui.requests[1]);
  assert.deepEqual(Object.keys(ui.requests[0].body).sort(), ["action", "courseId", "eventId", "exercise", "payload"]);
  assert.equal(ui.requests[0].body.exercise, "scenario");
  assert.equal(ui.draft().savedAt, "2026-01-01T15:30:00.000Z");
  assert.ok(ui.html().includes("Vault への最終保存：2026年1月2日 00:30"));
  assert.ok(ui.html().includes("今回の回答と2項目の自己評価を Vault に保存しました。"));
  const saved = ui.storage[ui.key];
  ui.render("zh-CN");
  assert.equal(ui.storage[ui.key], saved);
  assert.ok(ui.html().includes("本轮作答和两项自评已写入 Vault。"));
  assert.ok(ui.html().includes("最近写入 Vault：2026年1月2日 00:30"));
});

test("存储失败警告不污染作答，既有警告和保存后刷新提示可即时切换", async () => {
  const ui = await harness({ writeFails: true });
  ui.input("保留这段未确认输入。");
  assert.ok(ui.html().includes("浏览器未能保存本机草稿。"));
  ui.render("ja");
  assert.ok(ui.html().includes("この端末に下書きを保存できませんでした。"));
  assert.equal(ui.nodes("textarea")[0].props.value, "保留这段未确认输入。");
  ui.button("回答を確定して確認ポイントを見る").props.onClick(); ui.render();
  ui.button("確定済みの回答を Vault に保存").props.onClick(); await ui.flush();
  assert.equal(ui.requests[0].body.payload.steps[0].answer, "保留这段未确认输入。");
  assert.equal(JSON.stringify(ui.requests).includes("下書きを保存できません"), false);
  const refreshed = await harness({ seed: answered(), refresh: async () => { throw new Error("refresh failed"); } });
  refreshed.button("保存已确认作答到 Vault").props.onClick(); await refreshed.flush();
  refreshed.render("ja");
  assert.ok(refreshed.html().includes("回答は Vault に保存されましたが、画面の更新は完了していません。"));
  const unreadable = await harness({ readFails: true });
  unreadable.render("ja");
  assert.ok(unreadable.html().includes("ブラウザーの下書きを読み込めません。"));
});

test("播放中切换语言保留音频回调和输入，文字模式消息即时翻译且不变更听力规则", async () => {
  const ui = await harness({ voices: [{ name: "Test local voice", lang: "ja-JP", localService: true }] });
  ui.input("听题前的记录");
  ui.button("播放练习句").props.onClick(); ui.render("ja");
  assert.equal(ui.utterance.text, lesson.steps[0].promptJa);
  assert.ok(ui.html().includes("端末内の合成音声で練習文を再生しています…"));
  assert.equal(ui.nodes("textarea")[0].props.value, "听题前的记录");
  ui.utterance.onend(); ui.render();
  assert.ok(ui.html().includes("合成音声の再生が終了しました。"));
  assert.equal(ui.draft().payload.steps[0].audio, "synthetic-completed");
  ui.button("文字モードに切り替える").props.onClick(); ui.render();
  assert.ok(ui.html().includes("文字モードに切り替えました。"));
  assert.equal(ui.draft().payload.steps[0].usedHintBeforeAnswer, true);
  const before = ui.storage[ui.key];
  ui.render("zh-CN");
  assert.ok(ui.html().includes("已进入文字模式。"));
  assert.equal(ui.storage[ui.key], before);
});

test("回应所用中文上下文仅翻译标签，原答与语言标记保持不变", async () => {
  const material = { ...lesson, steps: [
    { ...lesson.steps[0], id: "stance", kind: "stance", promptJa: undefined },
    { ...lesson.steps[0], id: "respond", kind: "respond" },
  ] };
  const seed = answered(material); seed.stepIndex = 1;
  const ui = await harness({ lesson: material, seed });
  ui.render("ja");
  assert.ok(ui.html().includes("先ほど中国語で書いた自分の考え"));
  assert.ok(ui.html().includes('<p lang="und">问题询问昨天做过的事。</p>'));
  assert.equal(ui.nodes("textarea")[0].props.lang, "und");
});
