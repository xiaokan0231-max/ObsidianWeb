import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAppModule } from "./helpers/render-tsx.mjs";
import * as model from "../lib/language-expression-course.ts";

const chunk = (id, level = "core") => ({
  id, level, title: "测试词块", learningBasis: "foundation", japanese: "条件を確認する", reading: "じょうけんをかくにんする",
  meaningZh: "确认条件的中文解释", explanationZh: "先找需要确认的对象。", exampleJa: "条件を確認しました。",
  collocations: ["条件を確認する"], alternativesJa: ["内容を確かめる"], topics: ["测试主题"], factBoundary: "只说真实经历。", evidenceRefs: ["[[测试原稿|测试出处]]"],
});
const course = {
  courseId: "test-expression", title: "保留原文的测试课程", topic: "测试话题", notePath: "20_求職/_素材/测试表达.md", schemaVersion: 1,
  chunks: [chunk("c01"), chunk("c02"), chunk("c03", "extended")],
  patterns: [{ id: "s01", title: "测试句型", level: "core", learningBasis: "natural-upgrade", functionZh: "表达自己的判断", explanationZh: "先说判断，再说明理由。", patternJa: "〜と考えています", slotsZh: "替换为真实判断", contrastJa: "必要です／必要だと考えます", alternativesJa: ["必要だと思います"], examplesJa: ["確認が必要だと考えています。"], topics: [], evidenceRefs: ["[[测试原稿|测试出处]]"] }],
  ideaCards: [
    { id: "i01", title: "测试原因", category: "cause", keywords: ["确认", "范围"], descriptionZh: "中文原因解释", relatedChunkIds: ["c01"] },
    { id: "i02", title: "测试对策", category: "solution", keywords: ["沟通", "记录"], descriptionZh: "中文对策解释", relatedChunkIds: ["c01"] },
    { id: "i03", title: "测试边界", category: "boundary", keywords: [], descriptionZh: "不能虚构经历。", relatedChunkIds: [] },
  ],
  corrections: [{ id: "e01", title: "原文修正标题", originalJa: "明確的に", correctedJa: "明確に", replacementPractice: "替换为自己的短句。", evidenceRefs: [] }],
  safeRewrites: [{ id: "n01", title: "原文改写标题", riskyJa: "全員が同じです", safeJa: "人によって異なります", reasonZh: "保留个体差异。", replacementPractice: "换一个具体对象。" }],
  recipes: [{ id: "r04", title: "测试抽题", causeCategories: ["cause"], solutionCategories: ["solution"], patternLevels: ["core"], promptZh: "保留中文教学任务，不翻译成界面语言。" }],
  itemIds: ["c01", "c02", "c03", "s01", "i01", "i02", "i03", "e01", "n01", "r04"],
};
const walk = value => !value || typeof value !== "object" ? [] : Array.isArray(value) ? value.flatMap(walk) : [value, ...walk(value.props?.children)];
const textOf = value => typeof value === "string" || typeof value === "number" ? String(value) : Array.isArray(value) ? value.map(textOf).join("") : value?.props ? textOf(value.props.children) : "";
const sameDeps = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));

// 保留每个组件的 hook 状态并执行依赖未变时不重跑的 effect，检查语言切换是否意外写日志。
async function harness({ locale: initialLocale = "zh-CN", source = course, response } = {}) {
  let locale = initialLocale;
  let frame;
  let pendingEffects = [];
  const frames = new Map();
  const writes = [];
  const requests = [];
  const refreshes = [];
  const listeners = new Map();
  const react = {
    ...React,
    useState(initial) {
      const owner = frame;
      if (!owner) return [typeof initial === "function" ? initial() : initial, () => {}];
      const index = owner.index++;
      if (!(index in owner.slots)) {
        const slot = { value: typeof initial === "function" ? initial() : initial };
        slot.set = value => { slot.value = typeof value === "function" ? value(slot.value) : value; };
        owner.slots[index] = slot;
      }
      return [owner.slots[index].value, owner.slots[index].set];
    },
    useMemo(create, deps) {
      if (!frame) return create();
      const index = frame.index++;
      if (!sameDeps(frame.slots[index]?.deps, deps)) frame.slots[index] = { value: create(), deps };
      return frame.slots[index].value;
    },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(effect, deps) {
      if (!frame) return;
      const owner = frame;
      const index = owner.index++;
      if (!sameDeps(owner.slots[index]?.deps, deps)) {
        const old = owner.slots[index];
        owner.slots[index] = { deps };
        pendingEffects.push(() => { old?.cleanup?.(); owner.slots[index].cleanup = effect(); });
      }
    },
    useSyncExternalStore(_subscribe, snapshot) { return snapshot(); },
  };
  const browser = {
    location: new URL("http://localhost:3000/training/topics?course=test-expression"),
    localStorage: { getItem: () => null, setItem: (...args) => writes.push(args) },
    addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type),
  };
  const component = await loadAppModule("app/language-expression-courses.tsx", {
    globals: { window: browser },
    stubs: {
      react,
      "./ui-locale": { useUiLocale: () => ({ locale }) },
      "./use-textbook-position": { useTextbookSearch: () => browser.location.search },
      "@/lib/language-expression-course": { ...model, findLanguageExpressionCourses: () => [source] },
      "@/lib/client-api": { postJson: async (url, body) => {
        requests.push({ url, body: structuredClone(body) });
        return response ? response(body) : { ok: true, deduplicated: false, state: { completedKeys: body.action === "reopened" ? [] : [`${body.exercise}:${body.itemId}`], improvCount: 1234 }, path: "测试进度.md" };
      } },
    },
  });
  const props = { notes: [], onOpen() {}, onOpenWiki() {}, onVaultChanged: async () => { refreshes.push(true); } };
  const page = component.default.type(props);
  const workbench = walk(page).find(node => node.type?.name === "CourseWorkbench");
  assert.ok(workbench, "显式课程链接应加载表达工作台");
  const workbenchProps = { ...workbench.props, positionReady: true, onPositionChange: (id, position) => writes.push([id, structuredClone(position)]) };
  function expand(value, path = "root") {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map((node, i) => {
      const child = expand(node, `${path}.${i}`);
      return React.isValidElement(child) ? React.cloneElement(child, { key: node?.key ?? i }) : child;
    });
    const fn = typeof value.type === "function" ? value.type : value.type?.type;
    if (typeof fn === "function") {
      const key = `${path}:${fn.name}`;
      const owner = frames.get(key) ?? { index: 0, slots: [] };
      frames.set(key, owner); owner.index = 0;
      const previous = frame; frame = owner;
      const result = fn(value.props); frame = previous;
      return expand(result, key);
    }
    return value.props ? React.cloneElement(value, {}, expand(value.props.children, `${path}.children`)) : value;
  }
  const render = () => {
    const result = expand(React.createElement(workbench.type, workbenchProps));
    const effects = pendingEffects; pendingEffects = []; effects.forEach(run => run());
    return result;
  };
  const button = label => {
    const node = walk(render()).find(item => item.type === "button" && textOf(item.props.children).includes(label));
    assert.ok(node, `缺少按钮：${label}`); return node;
  };
  return {
    render, html: () => renderToStaticMarkup(render()), requests, writes, refreshes, listeners,
    locale: next => { locale = next; }, button,
    click: async label => { button(label).props.onClick(); for (let i = 0; i < 8; i += 1) await Promise.resolve(); },
  };
}

test("旧表达工作台使用真实日语界面，中文讲解与日语原例分别标注语言", async () => {
  const h = await harness({ locale: "ja" });
  let html = h.html();
  for (const text of ["専門トレーニングの練習方式", "基本文型", "前の問題", "次の問題", "ショートカット：Space", "伝える意図を見て、日本語で言ってみる"]) assert.ok(html.includes(text), text);
  assert.match(html, /<main[^>]*lang="ja"/);
  assert.match(html, /<h4 lang="zh-CN">确认条件的中文解释/);
  assert.match(html, /保留原文的测试课程/);
  await h.click("表現を確認する"); html = h.html();
  assert.match(html, /<strong lang="ja">条件を確認する/);
  assert.match(html, /class="expression-learning-note" lang="zh-CN"><b lang="ja">基礎の解説<\/b>先找需要确认的对象。/);
  assert.match(html, /面談記録から/);
  assert.match(html, /基礎の復習/);
  assert.deepEqual(h.requests, []);
});

test("五种练法及揭示内容都随locale切换，材料正文保留且不保存作答", async () => {
  const h = await harness({ locale: "ja" });
  await h.click("定型表現の穴埋め");
  assert.match(h.html(), /定型表現を完成させる/);
  await h.click("組み合わせを見る"); assert.match(h.html(), /組み合わせの確認/);
  await h.click("文型の置き換え");
  assert.match(h.html(), /文型を保ち、内容を置き換える/);
  await h.click("短い例文を2つ見る");
  assert.match(h.html(), /<p class="expression-contrast" lang="ja"><b lang="ja">間違えやすい表現の比較/);
  await h.click("適切な言い換え");
  assert.match(h.html(), /実際の言い間違いを直す/);
  await h.click("短文を確認する"); assert.match(h.html(), /<strong lang="ja">明確に/);
  await h.click("ランダム発話");
  assert.match(h.html(), /3枚のカードを使い、自由に2〜4文話す/);
  assert.match(h.html(), /<p lang="zh-CN">保留中文教学任务，不翻译成界面语言。/);
  await h.click("言葉に詰まったら素材を見る"); assert.match(h.html(), /ほかに使える文型/);
  const written = structuredClone(h.writes);
  h.locale("zh-CN"); const html = h.html();
  assert.match(html, /还可换用的句型/);
  assert.match(html, /收起可用素材/);
  assert.deepEqual(h.writes, written, "仅切语言不能重写练习位置");
  assert.deepEqual(h.requests, [], "浏览练法和揭示示例不发进度POST");
});

test("保存后的消息按当前locale重绘，计数格式化但payload和已有进度不改写", async () => {
  const h = await harness();
  await h.click("随机表达"); await h.click("完成一次表达");
  assert.match(h.html(), /已记录第 1,234 次随机表达/);
  assert.equal(h.requests.length, 1);
  const request = h.requests[0];
  assert.equal(request.url, "/api/language/topics/progress");
  assert.deepEqual(Object.keys(request.body).sort(), ["action", "courseId", "eventId", "exercise", "itemId"]);
  assert.equal(request.body.courseId, "test-expression"); assert.equal(request.body.itemId, "r04");
  assert.equal(request.body.exercise, "improv"); assert.equal(request.body.action, "completed");
  const requests = structuredClone(h.requests); const writes = structuredClone(h.writes);
  h.locale("ja"); const html = h.html();
  assert.match(html, /role="status"/);
  assert.match(html, /ランダム発話の練習を 1,234 回目として記録しました/);
  assert.equal(html.includes("已记录第"), false);
  assert.deepEqual(h.requests, requests); assert.deepEqual(h.writes, writes);
  assert.equal(h.refreshes.length, 1);
  h.locale("zh-CN"); assert.match(h.html(), /已记录第 1,234 次随机表达/);
  assert.deepEqual(h.requests, requests);
});

test("保存失败消息和已完成状态可切换语言，失败不推进、不自动重试", async () => {
  const h = await harness({ response: () => { throw new Error("课程中不存在这个项目。"); } });
  await h.click("下一题");
  assert.match(h.html(), /无法保存进度/);
  assert.match(h.html(), /c01/);
  const writes = structuredClone(h.writes);
  h.locale("ja"); const html = h.html();
  assert.match(html, /role="alert"/);
  assert.match(html, /進捗を保存できませんでした/);
  assert.match(html, /この項目はコース内にありません。/);
  assert.match(html, /c01/);
  assert.deepEqual(h.writes, writes); assert.equal(h.requests.length, 1);
  assert.deepEqual(h.refreshes, []);

  const completed = await harness();
  await completed.click("下一题"); await completed.click("上一题");
  completed.locale("ja"); assert.match(completed.html(), /練習済みを取り消す/);
  await completed.click("練習済みを取り消す"); assert.match(completed.html(), /練習を再開できる状態に戻しました/);
  assert.equal(completed.requests.at(-1).body.action, "reopened");
  const count = completed.requests.length;
  completed.locale("zh-CN"); assert.match(completed.html(), /已重新打开练习/);
  assert.equal(completed.requests.length, count);
});

test("请求进行中切换语言只更新忙碌提示，空素材也有日语说明", async () => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const h = await harness({ response: () => pending });
  await h.click("下一题"); assert.match(h.html(), /正在保存…/);
  h.locale("ja"); assert.match(h.html(), /保存中…/);
  assert.equal(h.button("保存中…").props.disabled, true);
  assert.equal(h.requests.length, 1);
  resolve({ ok: true, state: { completedKeys: ["recall:c01"], improvCount: 0 }, path: "测试进度.md" });
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  assert.match(h.html(), /次の問題/);
  const empty = await harness({ locale: "ja", source: { ...course, chunks: [] } });
  assert.match(empty.html(), /この練習方式の素材はまだありません/);
  assert.match(empty.html(), /この範囲にはまだ表現がありません。/);
  assert.deepEqual(empty.requests, []);
});
