import assert from "node:assert/strict";
import test from "node:test";
import { buildQuickPool } from "../lib/language/quick-items.ts";
import { createQuickIndex } from "../lib/language/quick-cards.ts";
import { jstMidnightIso } from "../lib/language/quick-progress.ts";
import {
  QUICK_SELECT_RULES,
  quickHistory,
  quickNewTier,
  quickSourceOf,
  quickSummary,
  selectQuickSet,
} from "../lib/language/quick-select.ts";

// ── 虚构 fixture：公司名、句子与词表都是测试自编的通用内容 ─────────

const KEY = "2026-07-01|株式会社テスト|一次面接";
const KEY2 = "2026-07-08|テスト商事株式会社|二次面接";
const PATH = "20_求職/株式会社テスト/2026-07-01_一次面接_整理稿.md";

function li(kind, id, values) {
  return {
    id,
    canonicalKey: id,
    kind,
    titleZh: "",
    targetJa: "",
    reading: "",
    meaningZh: "",
    promptZh: "",
    originalJa: "",
    correctedJa: "",
    pattern: "",
    sourceInterviewKeys: [KEY],
    evidence: [{ path: PATH, interviewKey: KEY, sentenceId: id, excerpt: values.originalJa || values.targetJa || "" }],
    factSensitive: false,
    factSourcePaths: [],
    basePriority: 60,
    strategyTags: [],
    ...values,
  };
}

// 助词改错：同一动词一组（一个错误型），名词轮换。
const VERBS = [
  { verb: "参加する", pattern: "型_参加", nouns: ["説明会", "勉強会", "研修", "交流会", "朝会", "定例"] },
  { verb: "慣れる", pattern: "型_慣れ", nouns: ["環境", "業務", "職場", "手順", "社風", "現場"] },
  { verb: "目を通す", pattern: "型_目通し", nouns: ["資料", "議事録", "仕様書", "日報", "提案書", "手順書"] },
  { verb: "対応する", pattern: "型_対応", nouns: ["問い合わせ", "障害", "依頼", "要望", "変更", "相談"] },
  { verb: "興味がある", pattern: "型_興味", nouns: ["分析", "設計", "運用", "教育", "広報", "品質"] },
];
const PATCHES = VERBS.flatMap(({ verb, pattern, nouns }, group) =>
  nouns.map((noun, index) => {
    const id = `ep_${group}_${index}`;
    return li("error_patch", id, {
      targetJa: `${noun}を${verb} → ${noun}に${verb}`,
      correctedJa: `${noun}に${verb}`,
      originalJa: `来月から${noun}を${verb}予定です。`,
      meaningZh: `把「${noun}を」改为「${noun}に」`,
      pattern,
    });
  }),
);

const PHRASES = [
  ["段取り", "だんどり", "安排步骤"],
  ["見通し", "みとおし", "前景预期"],
  ["前倒し", "まえだおし", "提前进行"],
  ["先送り", "さきおくり", "推迟处理"],
  ["叩き台", "たたきだい", "讨论初稿"],
  ["落とし込む", "おとしこむ", "落实到具体"],
  ["持ち帰る", "もちかえる", "带回去研究"],
  ["詰める", "つめる", "敲定细节"],
  ["振り返り", "ふりかえり", "复盘回顾"],
  ["棚卸し", "たなおろし", "盘点梳理"],
  ["巻き取る", "まきとる", "接手承担"],
  ["切り出す", "きりだす", "单独拆出来"],
  ["引き継ぎ", "ひきつぎ", "工作交接"],
  ["立て付け", "たてつけ", "整体框架"],
  ["腹落ち", "はらおち", "真正理解"],
  ["手離れ", "てばなれ", "不再需要跟进"],
  ["地ならし", "じならし", "事前铺垫"],
  ["刺さる", "ささる", "打动对方"],
  ["巻き込む", "まきこむ", "拉人参与"],
  ["寄り添う", "よりそう", "贴近对方"],
  ["噛み砕く", "かみくだく", "通俗解释"],
  ["深掘り", "ふかぼり", "深入追问"],
  ["吸い上げる", "すいあげる", "收集意见"],
  ["温度感", "おんどかん", "热情程度"],
  ["肌感覚", "はだかんかく", "直观感受"],
].map(([targetJa, reading, meaningZh], index) =>
  li("interviewer_phrase", `ip_${index}`, {
    targetJa,
    reading,
    meaningZh,
    // 第 1 条跨两场面试，用来测 tier 3。
    ...(index === 1 ? { sourceInterviewKeys: [KEY, KEY2] } : {}),
  }),
);

const STRATEGIES = Array.from({ length: 6 }, (_, index) =>
  li("answer_strategy", `as_${index}`, {
    targetJa: ["結論から申し上げます。", "具体例を一つ挙げます。", "背景を補足します。", "理由は二つあります。", "数字で言うと次の通りです。", "最後に一点だけ。"][index],
    meaningZh: ["先说结论", "举一个具体例子", "补充背景", "理由有两点", "用数字来说", "最后补充一点"][index],
  }),
);

const CURRICULUM = {
  version: 2,
  generatedAt: "2026-10-01T00:00:00.000Z",
  sourceFingerprint: "src",
  sourceCount: 2,
  summaryZh: "",
  profile: { interviewCount: 2, learnerErrorCount: 0, reviewedBlockCount: 0, listeningGapCount: 0, staleReviewPaths: [], topIssues: [] },
  items: [...PATCHES, ...PHRASES, ...STRATEGIES],
};

const NOTEBOOK = {
  path: "20_求職/_素材/単語文法帳.md",
  content: `---
type: material
---
# 単語・文法帳

## B-1. 用語

| 表記 | かな | 中文 | ★ |
|---|---|---|---|
| 面接官 | めんせつかん | 面试官 | ★★ |
| 書類選考 | しょるいせんこう | 简历筛选 | ★ |
| 求人票 | きゅうじんひょう | 招聘信息 | |
| 職務経歴書 | しょくむけいれきしょ | 工作履历书 | |
| 応募 | おうぼ | 投递申请 | |
| 年収 | ねんしゅう | 年薪 | |
| 勤務地 | きんむち | 工作地点 | |
| 入社日 | にゅうしゃび | 入职日期 | |
| 給与 | きゅうよ | 工资待遇 | |
| 残業 | ざんぎょう | 加班 | |
`,
};

const POOL = buildQuickPool(CURRICULUM, NOTEBOOK);
const INDEX = createQuickIndex(POOL.items);
const DAY = "2026-10-04";
const NONE = new Map();

function select(overrides = {}) {
  return selectQuickSet({
    pool: POOL,
    index: INDEX,
    progress: NONE,
    events: [],
    legacy: NONE,
    day: DAY,
    size: 20,
    typing: true,
    extra: false,
    setId: "set_test_1",
    ...overrides,
  });
}

function progressEntry(itemId, values = {}) {
  return {
    itemId,
    stage: "unseen",
    seenCount: 0,
    successCount: 0,
    failureCount: 0,
    successDates: [],
    rejected: false,
    postTrainingOccurrences: 0,
    ...values,
  };
}

/** 已做过、到期日为 dueDay 的进度。 */
function dueEntry(itemId, dueDay, values = {}) {
  return progressEntry(itemId, {
    stage: "correctable",
    seenCount: 1,
    successCount: 1,
    successDates: ["2026-09-30"],
    attemptCount: 1,
    nextDueAt: jstMidnightIso(dueDay),
    ...values,
  });
}

let serial = 0;
function answer(itemId, values = {}) {
  serial += 1;
  return {
    eventId: `ev_${serial}`,
    setId: "set_earlier",
    setSize: 20,
    itemId,
    type: "meaning_choice",
    action: "answer",
    response: "x",
    passed: true,
    first: true,
    at: "2026-10-04T01:00:00.000Z",
    ...values,
  };
}

const sourceCount = (cards) => {
  const counts = { patch: 0, phrase: 0, notebook: 0, pattern: 0 };
  for (const card of cards) counts[quickSourceOf(card.group)] += 1;
  return counts;
};

// ── fixture 自检 ────────────────────────────────────────────────

test("fixture：四类来源都进了题库", () => {
  const counts = { patch: 0, phrase: 0, notebook: 0, pattern: 0 };
  for (const item of POOL.items) counts[quickSourceOf(item.group)] += 1;
  assert.equal(counts.patch, 30);
  assert.ok(counts.phrase >= 20, `phrase ${counts.phrase}`);
  assert.equal(counts.notebook, 10);
  assert.equal(counts.pattern, 6);
});

// ── 冷启动 ──────────────────────────────────────────────────────

test("冷启动：没有任何进度与事件也能出满一组，全是新题、一题一条", () => {
  for (const size of [10, 20, 30]) {
    const set = select({ size });
    assert.equal(set.cards.length, size);
    assert.equal(set.composition.new, size);
    assert.equal(new Set(set.cards.map((card) => card.itemId)).size, size);
    assert.equal(set.limits.dailyNewLimit, size * 2);
    assert.equal(set.limits.newToday, 0);
    for (const card of set.cards) {
      assert.equal(card.reason, "new");
      assert.ok(card.cardId.endsWith(`:${DAY}`));
    }
  }
});

test("同一输入同一结果；setId 不同只换顺序", () => {
  const first = select();
  const again = select();
  assert.deepEqual(again, first);
  const other = select({ setId: "set_test_2" });
  assert.deepEqual(
    other.cards.map((card) => card.itemId).sort(),
    first.cards.map((card) => card.itemId).sort(),
  );
});

test("组内顺序：相邻两张尽量不同组", () => {
  const set = select({ size: 30 });
  let adjacent = 0;
  for (let index = 1; index < set.cards.length; index += 1) {
    if (set.cards[index].group === set.cards[index - 1].group) adjacent += 1;
  }
  // 30 张里改错占多数时末尾可能被迫相邻，但不应成片连排。
  assert.ok(adjacent <= 3, `adjacent ${adjacent}`);
});

// ── 新题顺序与配额 ──────────────────────────────────────────────

test("新题顺序：旧批次「不会」→「犹豫」→ 其余", () => {
  const legacy = new Map([
    ["as_5", "uncertain"],
    ["ip_20", "unknown"],
    ["ep_4_5", "uncertain"],
    ["ip_10", "unknown"],
  ]);
  const frequent = new Set();
  const byId = new Map(POOL.items.map((item) => [item.id, item]));
  assert.equal(quickNewTier(byId.get("ip_20"), legacy, frequent), 0);
  assert.equal(quickNewTier(byId.get("as_5"), legacy, frequent), 1);
  assert.equal(quickNewTier(byId.get("ip_1"), legacy, frequent), 3, "跨两场面试");
  assert.equal(quickNewTier(byId.get("ip_23"), legacy, frequent), 6, "纯汉字面试官短语排最后");

  // size 10：新题配额 3，种子 4 条按来源分到各自名额里，都排在同来源的其他题之前。
  const set = select({ size: 10, legacy });
  const ids = new Set(set.cards.map((card) => card.itemId));
  for (const id of legacy.keys()) assert.ok(ids.has(id), `${id} 应进入第一组`);
});

test("同一来源内：旧批次「不会」先于「犹豫」，「犹豫」先于其余", () => {
  const unknown = ["ip_11", "ip_12", "ip_13", "ip_14"];
  const uncertain = ["ip_15", "ip_16", "ip_17", "ip_18"];
  const legacy = new Map([...unknown.map((id) => [id, "unknown"]), ...uncertain.map((id) => [id, "uncertain"])]);
  const phrases = (set) => set.cards.filter((card) => card.group === "interviewer_phrase").map((card) => card.itemId).sort();
  // 10 题：面试官名额 3 → 全是「不会」。
  const ten = phrases(select({ size: 10, legacy }));
  assert.equal(ten.length, 3);
  assert.ok(ten.every((id) => unknown.includes(id)), ten.join());
  // 20 题：面试官名额 6 → 4 条「不会」+ 2 条「犹豫」。
  const twenty = phrases(select({ size: 20, legacy }));
  assert.equal(twenty.length, 6);
  assert.deepEqual(twenty.filter((id) => unknown.includes(id)), unknown);
  assert.equal(twenty.filter((id) => uncertain.includes(id)).length, 2);
});

test("新题来源配额：改错 0.4 / 面试官 0.3 / 単語文法帳 0.2 / 句型 0.1（最大余数法）", () => {
  const set = select({ size: 20 });
  assert.deepEqual(sourceCount(set.cards), { patch: 8, phrase: 6, notebook: 4, pattern: 2 });
  const ten = select({ size: 10 });
  assert.deepEqual(sourceCount(ten.cards), { patch: 4, phrase: 3, notebook: 2, pattern: 1 });
});

test("来源配额用不完的名额让给别家；同一错误型新题 ≤2", () => {
  // 句型只剩 0 条、単語文法帳只剩 1 条：让出的名额按先后顺序补给其余来源。
  const progress = new Map([
    ...STRATEGIES.map((item) => [item.id, progressEntry(item.id, { rejected: true })]),
    ...POOL.items.filter((item) => item.source === "notebook").slice(1)
      .map((item) => [item.id, progressEntry(item.id, { rejected: true })]),
  ]);
  const set = select({ size: 30, progress });
  assert.equal(set.cards.length, 30);
  const counts = sourceCount(set.cards);
  assert.equal(counts.pattern, 0);
  assert.equal(counts.notebook, 1);
  const patterns = new Map();
  for (const card of set.cards.filter((entry) => entry.group === "error_patch")) {
    const pattern = INDEX.byId.get(card.itemId).pattern;
    patterns.set(pattern, (patterns.get(pattern) ?? 0) + 1);
  }
  for (const [pattern, count] of patterns) assert.ok(count <= QUICK_SELECT_RULES.newPatternCap, `${pattern} ${count}`);
  assert.equal(counts.patch, 10, "5 个错误型 × 每型 2 条");
});

test("rejected（含旧批次 reject）的条目不出", () => {
  const rejected = new Set(["ip_0", "ip_2", "ep_0_0"]);
  const progress = new Map([...rejected].map((id) => [id, progressEntry(id, { rejected: true })]));
  const legacy = new Map([["as_0", "reject"]]);
  for (const size of [10, 20, 30]) {
    const set = select({ size, progress, legacy });
    for (const card of set.cards) {
      assert.ok(!rejected.has(card.itemId));
      assert.notEqual(card.itemId, "as_0");
    }
  }
});

// ── 到期、追赶与每日额度 ───────────────────────────────────────

test("到期优先：到期日早的在前，今天答过的不再算到期", () => {
  const progress = new Map([
    ["ip_3", dueEntry("ip_3", "2026-10-01")],
    ["ip_4", dueEntry("ip_4", "2026-10-04")],
    ["ip_5", dueEntry("ip_5", "2026-10-05")], // 明天到期
    ["ip_6", dueEntry("ip_6", "2026-10-02")],
  ]);
  const events = [answer("ip_6", { passed: false })]; // 今天答错过 → 算「今天答错」而不是到期
  const set = select({ size: 10, progress, events });
  const reason = new Map(set.cards.map((card) => [card.itemId, card.reason]));
  assert.equal(reason.get("ip_3"), "due");
  assert.equal(reason.get("ip_4"), "due");
  assert.equal(reason.get("ip_6"), "lapsed");
  assert.equal(set.composition.due, 2);
  assert.equal(set.composition.lapsed, 1);
  // 新题 3 条后仍有空位：先补明天到期，再补新题。
  assert.equal(reason.get("ip_5"), "early");
  assert.equal(set.cards.length, 10);
});

test("到期超过 2N 时进入追赶模式：本组新题为 0", () => {
  const dueItems = POOL.items.filter((item) => item.group !== "answer_strategy").slice(0, 45);
  assert.ok(dueItems.length > 40);
  const progress = new Map(dueItems.map((item) => [item.id, dueEntry(item.id, "2026-10-03")]));
  const set = select({ size: 20, progress });
  assert.equal(set.cards.length, 20);
  assert.equal(set.composition.new, 0);
  assert.equal(set.limits.newExhausted, false, "追赶模式不是额度用完");
});

test("到期不多时仍给新题留 2 个位子；同一错误型到期软上限 4（不满时放回）", () => {
  // 18 条到期：12 条同一错误型 + 6 条面试官用语
  const patchDue = PATCHES.slice(0, 6).concat(PATCHES.slice(6, 12)).map((item) => item.id);
  const phraseDue = PHRASES.slice(0, 6).map((item) => item.id);
  const progress = new Map([...patchDue, ...phraseDue].map((id) => [id, dueEntry(id, "2026-10-03")]));
  const set = select({ size: 20, progress });
  assert.ok(set.composition.new >= 2, `new ${set.composition.new}`);
  const due = set.cards.filter((card) => card.reason === "due");
  const perPattern = new Map();
  for (const card of due) {
    const pattern = INDEX.byId.get(card.itemId).pattern;
    if (pattern) perPattern.set(pattern, (perPattern.get(pattern) ?? 0) + 1);
  }
  // 两个错误型各 6 条到期：先各取 4，再出新题（新题也不再进这两个型）；组满了就不放回。
  assert.deepEqual([...perPattern.values()], [4, 4]);
  assert.equal(due.length, 14);
  assert.equal(set.composition.new, 6);
  assert.equal(set.cards.length, 20);

  // 30 题：新题 9 条后仍有空位，被软上限挡下的 4 条放回，再补新题到满。
  const big = select({ size: 30, progress });
  assert.equal(big.cards.filter((card) => card.reason === "due").length, 18);
  assert.equal(big.cards.length, 30);
});

test("每日新题额度 2N：今天已引入的新题计入；extra 本组再放宽 N", () => {
  const introduced = POOL.items.slice(0, 40).map((item, index) =>
    answer(item.id, { eventId: `intro_${index}`, at: "2026-10-04T02:00:00.000Z" })
  );
  const progress = new Map(introduced.map((event) => [event.itemId, dueEntry(event.itemId, "2026-10-07")]));
  const set = select({ size: 20, progress, events: introduced });
  assert.equal(set.limits.newToday, 40);
  assert.equal(set.composition.new, 0);
  assert.equal(set.limits.newExhausted, true);
  assert.ok(set.cards.length < 20, "额度用完且没有到期题时返回不足 N 张");

  const extra = select({ size: 20, progress, events: introduced, extra: true });
  assert.equal(extra.limits.dailyNewLimit, 60);
  assert.ok(extra.composition.new > 0);
  assert.ok(extra.composition.new <= 20);

  // 昨天引入的不占今天的额度。
  const yesterday = introduced.map((event) => ({ ...event, at: "2026-10-03T02:00:00.000Z" }));
  const fresh = select({ size: 10, progress, events: yesterday });
  assert.equal(fresh.limits.newToday, 0);
  assert.ok(fresh.composition.new > 0);
});

test("JST 日界：UTC 前一天 15:00 之后的作答算今天", () => {
  const events = [answer("ip_0", { at: "2026-10-03T15:30:00.000Z" })];
  const set = select({ size: 10, events, progress: new Map([["ip_0", dueEntry("ip_0", "2026-10-07")]]) });
  assert.equal(set.limits.newToday, 1);
});

test("打字题每组 ≤ round(N×0.2)，超出的退回点选", () => {
  const progress = new Map(
    POOL.items.map((item) => [item.id, dueEntry(item.id, "2026-10-03", { stage: "retrievable", successDates: ["2026-09-20", "2026-09-27"] })]),
  );
  for (const size of [10, 20, 30]) {
    const set = select({ size, progress });
    const typed = set.cards.filter((card) => card.type === "short_input").length;
    assert.ok(typed <= Math.round(size * 0.2), `size ${size} typed ${typed}`);
    assert.ok(typed > 0);
    assert.equal(set.cards.length, size);
  }
  const off = select({ size: 20, progress, typing: false });
  assert.equal(off.cards.filter((card) => card.type === "short_input").length, 0);
});

// ── 历史与汇总 ──────────────────────────────────────────────────

test("quickHistory：按组合成，首答 ≥5 的组才产出，新 → 旧", () => {
  const make = (setId, count, start, passEvery = 2) =>
    Array.from({ length: count }, (_, index) =>
      answer(`ip_${index}`, {
        eventId: `${setId}_${index}`,
        setId,
        setSize: 10,
        passed: index % passEvery === 0,
        at: new Date(Date.parse(start) + index * 60_000).toISOString(),
      })
    );
  const retry = answer("ip_0", { eventId: "a_retry", setId: "set_a", first: false, passed: true, at: "2026-10-03T16:30:00.000Z" });
  const events = [
    ...make("set_a", 6, "2026-10-03T15:50:00.000Z"),
    retry,
    ...make("set_b", 4, "2026-10-04T03:00:00.000Z"),
    ...make("set_c", 5, "2026-10-04T05:00:00.000Z"),
  ];
  const history = quickHistory(events);
  assert.deepEqual(history.map((entry) => entry.id), ["set_c", "set_a"]);
  const a = history[1];
  assert.equal(a.date, "2026-10-04", "首事件按 JST 归日");
  assert.equal(a.targetSize, 10);
  assert.equal(a.completedCount, 6, "重出不计");
  assert.equal(a.successCount, 3);
  assert.equal(a.completedAt, "2026-10-03T16:30:00.000Z");
});

test("quickSummary：阶段分布只数可出题条目，到期、新题、种子与今日数字", () => {
  const progress = new Map([
    ["ip_3", dueEntry("ip_3", "2026-10-02")],
    ["ip_4", dueEntry("ip_4", "2026-10-09", { stage: "retrievable" })],
    ["ip_5", progressEntry("ip_5", { rejected: true })],
    ["ip_6", dueEntry("ip_6", "2026-10-05")],
  ]);
  const legacy = new Map([["ip_7", "unknown"], ["ip_8", "uncertain"], ["ip_9", "uncertain"], ["ip_4", "unknown"]]);
  // ip_6 昨天首次引入、今天到期后答错：今天的首答不算新引入。
  const events = [
    answer("ip_6", { at: "2026-10-01T03:00:00.000Z" }),
    answer("ip_6", { passed: false }),
  ];
  const summary = quickSummary({
    pool: POOL, index: INDEX, progress, events, legacy, day: DAY,
    topIssues: Array.from({ length: 10 }, (_, index) => ({ key: `k${index}`, label: `k${index}`, interviewCount: 3, occurrenceCount: 4 })),
    stale: true,
  });
  const drillable = POOL.items.length - 1;
  assert.equal(summary.drillable, drillable);
  assert.equal(Object.values(summary.stageCounts).reduce((sum, value) => sum + value, 0), drillable);
  assert.equal(summary.stageCounts.retrievable, 1);
  assert.equal(summary.due, 1);
  // ip_6 今天答错、排到明天：明天到期要算上今天答过的题。
  assert.equal(summary.dueTomorrow, 1);
  assert.equal(summary.lapsedToday, 1);
  assert.equal(summary.newAvailable, drillable - 3);
  assert.deepEqual(summary.seedRemaining, { unknown: 1, uncertain: 2 });
  assert.equal(summary.answeredToday, 1);
  assert.equal(summary.firstPassToday, 0);
  assert.equal(summary.newToday, 0);
  assert.equal(summary.dailyNewLimit, 40);
  assert.equal(summary.topIssues.length, 8);
  assert.equal(summary.ready, true);
  assert.equal(summary.stale, true);
  assert.equal(summary.notebookParsed, 10);
});
