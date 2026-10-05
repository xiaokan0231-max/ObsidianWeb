import assert from "node:assert/strict";
import test from "node:test";
import { buildQuickPool } from "../lib/language/quick-items.ts";
import { availableCardTypes, createQuickIndex } from "../lib/language/quick-cards.ts";
import { quickDayStartIso } from "../lib/language/quick-progress.ts";
import {
  annotateQuickTopIssues,
  mergeJudgments,
  QUICK_KNOWN_TIER,
  QUICK_SELECT_RULES,
  quickDailyNewLimit,
  quickFocusOptions,
  quickHistory,
  quickNewTier,
  quickNextSet,
  quickSourceOf,
  quickSummary,
  selectQuickSet,
  selectTriageItems,
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
    nextDueAt: quickDayStartIso(dueDay),
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

// 原断言是「种子按来源配额分（10 题里面试官名额 3 → 只出 3 条种子）」；本人改为种子先取、不受来源配额限制（M1）。
test("种子先取：「不会」先于「犹豫」，不受来源配额限制", () => {
  const unknown = ["ip_11", "ip_12", "ip_13", "ip_14", "ip_15", "ip_16"];
  const uncertain = ["ip_17", "ip_18", "ip_19", "ip_20", "ip_21", "ip_22"];
  const legacy = new Map([...unknown.map((id) => [id, "unknown"]), ...uncertain.map((id) => [id, "uncertain"])]);
  const phrases = (set) => set.cards.filter((card) => card.group === "interviewer_phrase").map((card) => card.itemId).sort();
  // 10 题全是种子：6 条「不会」+ 4 条「犹豫」，面试官用语占满一组也不按 0.3 截。
  const ten = phrases(select({ size: 10, legacy }));
  assert.equal(ten.length, 10);
  assert.deepEqual(ten.filter((id) => unknown.includes(id)), unknown);
  assert.equal(ten.filter((id) => uncertain.includes(id)).length, 4);
  // 20 题：12 条种子全进，剩下 8 个名额再按来源配额分。
  const twenty = select({ size: 20, legacy });
  const ids = new Set(twenty.cards.map((card) => card.itemId));
  for (const id of legacy.keys()) assert.ok(ids.has(id), id);
  assert.ok(sourceCount(twenty.cards).patch >= 3, "其余名额仍按来源配额分给改错");
});

test("种子不受来源配额限制，但同一错误型新题上限仍在", () => {
  const legacy = new Map(PATCHES.filter((item) => item.pattern === "型_参加").map((item) => [item.id, "unknown"]));
  const set = select({ size: 10, legacy });
  const picked = set.cards.filter((card) => legacy.has(card.itemId));
  assert.equal(picked.length, QUICK_SELECT_RULES.newPatternCap);
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
  // 原断言是「新题 3 条后仍有空位：先补明天到期」；本人改为先补新题（仍受每日额度）再补明天到期（Q4）。
  assert.equal(reason.get("ip_5"), undefined, "新题还有额度时不提前出明天的题");
  assert.equal(set.composition.new, 7);
  assert.equal(set.composition.early, 0);
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

// 原用例是「UTC 前一天 15:00（JST 零点）之后算今天」；本人改为练习日从日本时间 04:00 起算（Q3）。
test("练习日界：JST 04:00 之后的作答算今天，之前算昨天", () => {
  const progress = new Map([["ip_0", dueEntry("ip_0", "2026-10-07")]]);
  const after = select({ size: 10, progress, events: [answer("ip_0", { at: "2026-10-03T19:00:00.000Z" })] });
  assert.equal(after.limits.newToday, 1);
  const before = select({ size: 10, progress, events: [answer("ip_0", { at: "2026-10-03T18:59:00.000Z" })] });
  assert.equal(before.limits.newToday, 0, "JST 03:59 仍属前一个练习日");
  const midnight = select({ size: 10, progress, events: [answer("ip_0", { at: "2026-10-03T15:30:00.000Z" })] });
  assert.equal(midnight.limits.newToday, 0, "JST 00:30 不再算今天");
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
  // 原断言是 10-04（JST 日历日）；首事件在 JST 10-04 00:50，按练习日（04:00 起算）归到 10-03。
  assert.equal(a.date, "2026-10-03", "首事件按练习日归日");
  assert.equal(a.targetSize, 10);
  assert.equal(a.completedCount, 6, "重出不计");
  assert.equal(a.successCount, 3);
  assert.equal(a.gradedCount, 6, "自动判分首答数：重出不计");
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

// ── 判断合并、自报「会」与验证 ──────────────────────────────────

test("mergeJudgments：分流覆盖旧批次判断，其余照旧", () => {
  const legacy = new Map([["a", "known"], ["b", "reject"], ["c", "unknown"]]);
  const triage = new Map([["a", "unknown"], ["b", "known"], ["d", "uncertain"]]);
  const merged = mergeJudgments(legacy, triage);
  assert.deepEqual(Object.fromEntries(merged), { a: "unknown", b: "known", c: "unknown", d: "uncertain" });
  assert.equal(legacy.get("a"), "known", "不改入参");
});

test("自报「会」排在所有新题之后（第 7 档）", () => {
  const byId = new Map(POOL.items.map((item) => [item.id, item]));
  const known = new Map(PHRASES.slice(0, 15).map((item) => [item.id, "known"]));
  assert.equal(quickNewTier(byId.get("ip_0"), known, new Set()), QUICK_KNOWN_TIER);
  assert.equal(QUICK_KNOWN_TIER, 7);
  assert.ok(quickNewTier(byId.get("ip_23"), known, new Set()) < QUICK_KNOWN_TIER, "送分题也排在「会」之前");
  // 10 题里面试官名额 3：出的是没标「会」的那几条。
  const set = select({ size: 10, legacy: known });
  const phrases = set.cards.filter((card) => card.group === "interviewer_phrase");
  assert.equal(phrases.length, 3);
  for (const card of phrases) assert.ok(!known.has(card.itemId), card.itemId);
  // 某个来源只剩「会」：来源配额不把它们提前拉出来，名额让给别的来源的普通新题。
  const strategiesKnown = new Map(STRATEGIES.map((item) => [item.id, "known"]));
  assert.equal(sourceCount(select({ size: 20 }).cards).pattern, 2, "对照：不标「会」时句型拿 2 个名额");
  const twenty = select({ size: 20, legacy: strategiesKnown });
  assert.equal(sourceCount(twenty.cards).pattern, 0);
  assert.equal(twenty.cards.length, 20);
});

test("自报「会」的新题与「太简单」回来的条目用辨析层验证（面试官用语：识义 → 识词）", () => {
  // 只留 ip_3、ip_4 两条可出：其余全部排除。
  const progress = new Map(POOL.items.map((item) => [item.id, progressEntry(item.id, { rejected: true })]));
  progress.set("ip_3", progressEntry("ip_3", { stage: "recognized" }));
  progress.set("ip_4", dueEntry("ip_4", "2026-10-04", { stage: "recognized", lastOutcome: "easy", successDates: [] }));
  const plain = select({ size: 10, progress });
  assert.equal(plain.cards.find((card) => card.itemId === "ip_3").type, "meaning_choice", "没自报时从识义起步");
  assert.equal(plain.cards.find((card) => card.itemId === "ip_4").type, "word_choice", "太简单回来：直接识词");
  const set = select({ size: 10, progress, legacy: new Map([["ip_3", "known"]]) });
  assert.equal(set.cards.find((card) => card.itemId === "ip_3").type, "word_choice");
});

// ── 多组：先新题、后提前出 ───────────────────────────────────────

test("不满时先补新题再补明天到期；额度用完才提前出，且每组 ≤ round(N×0.3)", () => {
  const tomorrow = PHRASES.slice(0, 8).map((item) => item.id);
  const progress = new Map(tomorrow.map((id) => [id, dueEntry(id, "2026-10-05")]));
  const set = select({ size: 10, progress });
  assert.equal(set.composition.new, 10);
  assert.equal(set.composition.early, 0);
  // 今天已引入 20 条（10 题的额度用完）：明天到期的提前出，但最多 3 条。
  const introduced = POOL.items.filter((item) => !tomorrow.includes(item.id)).slice(0, 20)
    .map((item, index) => answer(item.id, { eventId: `in_${index}` }));
  for (const event of introduced) progress.set(event.itemId, dueEntry(event.itemId, "2026-10-07"));
  const later = select({ size: 10, progress, events: introduced });
  assert.equal(later.composition.new, 0);
  assert.equal(later.composition.early, Math.round(10 * QUICK_SELECT_RULES.earlyShare));
  assert.equal(later.cards.length, 3, "组不满也不再多提前");
  assert.equal(later.limits.newExhausted, true);
});

// ── 二选一上限 ──────────────────────────────────────────────────

test("每组「哪个更自然」二选一 ≤ round(N×0.4)，超出的换别的条目补", () => {
  const nouns = ["資料", "日報", "議事録", "仕様書", "提案書", "手順書", "報告書", "設計書", "見積書", "計画書", "企画書", "契約書"];
  // 虚构的措辞改错（非助词）：只能出二选一。每条一个错误型，不受同型上限影响。
  const binary = nouns.map((noun, index) => li("error_patch", `bin_${index}`, {
    targetJa: `${noun}を見ます → ${noun}を拝見します`,
    correctedJa: `${noun}を拝見します`,
    originalJa: `明日${noun}を見ます。`,
    meaningZh: "改成谦让语",
    pattern: `型_措辞${index}`,
  }));
  const pool = buildQuickPool({ ...CURRICULUM, items: [...binary, ...PHRASES] }, undefined);
  const index = createQuickIndex(pool.items);
  for (const item of pool.items.filter((entry) => entry.group === "error_patch")) {
    assert.deepEqual(availableCardTypes(item, index, { typing: true }), ["natural_choice"], "fixture：只有二选一");
  }
  const set = select({ pool, index, size: 10 });
  const natural = set.cards.filter((card) => card.type === "natural_choice").length;
  // 不设上限时按来源配额改错会拿 6 张（面试官 4 张）。
  assert.equal(natural, Math.round(10 * QUICK_SELECT_RULES.naturalShare));
  assert.equal(set.cards.length, 10, "空出来的位子由面试官用语补上");
});

// ── 针对练习 ────────────────────────────────────────────────────

test("focus：只出该错误型的条目，放开同型上限与来源配额；返回的组带 focus", () => {
  const set = select({ size: 10, focus: "型_参加" });
  assert.equal(set.focus, "型_参加");
  assert.equal(set.cards.length, 6, "这一型只有 6 条");
  for (const card of set.cards) assert.equal(INDEX.byId.get(card.itemId).pattern, "型_参加");
  assert.equal(set.composition.new, 6, "同型新题上限 2 不适用");
  assert.equal(select({ size: 10 }).focus, undefined);
});

test("focus：到期先出，再今日答错，再新题；新题计入每日额度", () => {
  const ids = PATCHES.filter((item) => item.pattern === "型_慣れ").map((item) => item.id);
  const progress = new Map([
    [ids[0], dueEntry(ids[0], "2026-10-02")],
    [ids[1], dueEntry(ids[1], "2026-10-07")],
  ]);
  const events = [answer(ids[1], { passed: false, type: "cloze_choice" })];
  const set = select({ size: 10, focus: "型_慣れ", progress, events });
  const reason = new Map(set.cards.map((card) => [card.itemId, card.reason]));
  assert.equal(reason.get(ids[0]), "due");
  assert.equal(reason.get(ids[1]), "lapsed");
  assert.equal(set.composition.new, 4);
  // 今天已引入 39 条（20 题额度 40）：针对练习也只能再出 1 条新题。
  const introduced = POOL.items.filter((item) => item.pattern !== "型_慣れ").slice(0, 39)
    .map((item, index) => answer(item.id, { eventId: `fx_${index}` }));
  const capped = select({ size: 20, focus: "型_慣れ", events: introduced });
  assert.equal(capped.composition.new, 1);
  assert.equal(capped.limits.newExhausted, true);
});

test("quickFocusOptions 与 annotateQuickTopIssues：每个改错型可出题条数，只给有条目的问题填 focus", () => {
  const progress = new Map([["ep_0_0", progressEntry("ep_0_0", { rejected: true })]]);
  const options = quickFocusOptions(POOL, INDEX, progress, true);
  assert.equal(options.get("型_参加"), 5, "排除的不算");
  assert.equal(options.get("型_慣れ"), 6);
  assert.equal(options.size, 5);
  const issues = annotateQuickTopIssues([
    { key: "型_参加", label: "参加", interviewCount: 3, occurrenceCount: 9 },
    { key: "structure", label: "型_慣れ", interviewCount: 2, occurrenceCount: 4, kind: "language" },
    { key: "conclusion_first", label: "结论先行", interviewCount: 4, occurrenceCount: 6, kind: "strategy" },
  ], options);
  assert.deepEqual(issues.map((issue) => [issue.focus, issue.itemCount, issue.kind]), [
    ["型_参加", 5, "language"],
    ["型_慣れ", 6, "language"],
    [undefined, undefined, "strategy"],
  ]);
});

// ── 分流列表 ────────────────────────────────────────────────────

test("selectTriageItems：只取没作答、没判断、未排除、可出题的条目，按新题队列顺序", () => {
  const legacy = new Map([["ip_0", "known"], ["ip_1", "unknown"], ["as_0", "reject"]]);
  const progress = new Map([
    ["ip_2", dueEntry("ip_2", "2026-10-07")],
    ["ip_3", progressEntry("ip_3", { rejected: true })],
  ]);
  const input = { pool: POOL, index: INDEX, progress, legacy, typing: true };
  const all = selectTriageItems({ ...input, size: 1000 });
  const ids = all.map((brief) => brief.itemId);
  for (const id of ["ip_0", "ip_1", "as_0", "ip_2", "ip_3"]) assert.ok(!ids.includes(id), id);
  assert.equal(all.length, POOL.items.length - 5);
  const head = selectTriageItems({ ...input, size: 7 });
  assert.deepEqual(head, all.slice(0, 7), "前 size 条");
  const tiers = all.map((brief) => quickNewTier(INDEX.byId.get(brief.itemId), legacy, new Set()));
  assert.deepEqual(tiers, [...tiers].sort((a, b) => a - b), "档位不降");
  const patch = all.find((brief) => brief.group === "error_patch");
  assert.ok(patch.wrong && patch.ja && patch.wrong !== patch.ja, "改错条目带错形");
  const phrase = all.find((brief) => brief.itemId === "ip_5");
  assert.deepEqual(phrase, { itemId: "ip_5", group: "interviewer_phrase", ja: "落とし込む", reading: "おとしこむ", meaning: "落实到具体" });
});

// ── 今天：「太简单」与练习日 ─────────────────────────────────────

test("今天按了「太简单」的条目：不再出、占新题额度、不算今天答错", () => {
  const events = [
    answer("ip_7", { passed: false, at: "2026-10-04T01:00:00.000Z" }),
    answer("ip_7", { action: "easy", passed: undefined, first: false, at: "2026-10-04T01:00:05.000Z" }),
    answer("ip_8", { action: "easy", passed: undefined, first: false, at: "2026-10-04T01:01:00.000Z" }),
    answer("ip_9", { action: "triage", judgment: "unknown", passed: undefined, first: false }),
  ];
  const set = select({ size: 30, events });
  const ids = new Set(set.cards.map((card) => card.itemId));
  assert.ok(!ids.has("ip_7") && !ids.has("ip_8"));
  assert.equal(set.limits.newToday, 2, "分流不占新题额度");
  const summary = quickSummary({ pool: POOL, index: INDEX, progress: NONE, events, legacy: NONE, day: DAY });
  assert.equal(summary.lapsedToday, 0);
  assert.equal(summary.answeredToday, 2);
});

// ── 汇总的新字段 ────────────────────────────────────────────────

function summarize(overrides = {}) {
  return quickSummary({ pool: POOL, index: INDEX, progress: NONE, events: [], legacy: NONE, day: DAY, size: 10, ...overrides });
}

test("nextSet 与实际 GET set 的构成一致（冷启动、有到期、有今日答错、额度用完、追赶模式）", () => {
  const dueMany = new Map(POOL.items.slice(0, 45).map((item) => [item.id, dueEntry(item.id, "2026-10-03")]));
  const introduced = POOL.items.slice(0, 20).map((item, index) => answer(item.id, { eventId: `nx_${index}` }));
  const scenarios = [
    {},
    { progress: new Map([["ip_3", dueEntry("ip_3", "2026-10-01")], ["ip_5", dueEntry("ip_5", "2026-10-05")]]) },
    { events: [answer("ip_6", { passed: false })], progress: new Map([["ip_6", dueEntry("ip_6", "2026-10-05")]]) },
    { events: introduced, progress: new Map(introduced.map((event) => [event.itemId, dueEntry(event.itemId, "2026-10-05")])) },
    { progress: dueMany },
    { legacy: new Map([["ip_11", "unknown"], ["ip_12", "known"]]) },
  ];
  for (const [index, scenario] of scenarios.entries()) {
    for (const size of [10, 20]) {
      const set = select({ size, ...scenario });
      const expected = {
        total: set.cards.length,
        due: set.composition.due,
        lapsed: set.composition.lapsed,
        fresh: set.composition.new,
        early: set.composition.early,
      };
      assert.deepEqual(summarize({ size, ...scenario }).nextSet, expected, `场景 ${index} size ${size}`);
      assert.deepEqual(quickNextSet({ pool: POOL, index: INDEX, progress: NONE, events: [], legacy: NONE, day: DAY, size, typing: true, ...scenario }), expected);
    }
  }
});

test("dueSoon：7 天，[0] 含逾期、不含今天已答；[1] 等于 dueTomorrow", () => {
  const progress = new Map([
    ["ip_3", dueEntry("ip_3", "2026-09-28")],
    ["ip_4", dueEntry("ip_4", "2026-10-04")],
    ["ip_5", dueEntry("ip_5", "2026-10-05")],
    ["ip_6", dueEntry("ip_6", "2026-10-05")],
    ["ip_7", dueEntry("ip_7", "2026-10-10")],
    ["ip_8", dueEntry("ip_8", "2026-10-11")],
    ["ip_9", dueEntry("ip_9", "2026-10-02")],
  ]);
  const events = [answer("ip_9", { passed: true })];
  const summary = summarize({ progress, events });
  assert.deepEqual(summary.dueSoon, [2, 2, 0, 0, 0, 0, 1]);
  assert.equal(summary.due, summary.dueSoon[0]);
  assert.equal(summary.dueTomorrow, summary.dueSoon[1]);
});

test("suspended：排除清单（新 → 旧，最多 50 条）与总数；撤销后回到题库", () => {
  const progress = new Map([
    ["ip_3", progressEntry("ip_3", { rejected: true, lastSeenAt: "2026-10-04T01:00:00.000Z" })],
    ["ep_0_0", progressEntry("ep_0_0", { rejected: true, lastSeenAt: "2026-10-04T02:00:00.000Z" })],
    // 旧批次标过 reject、之后在快练里撤销：有回放进度时以进度为准。
    ["as_0", progressEntry("as_0", { rejected: false })],
  ]);
  const legacy = new Map([["as_0", "reject"], ["as_1", "reject"]]);
  const summary = summarize({ progress, legacy });
  assert.equal(summary.suspendedCount, 3);
  assert.deepEqual(summary.suspended.map((brief) => brief.itemId), ["ep_0_0", "ip_3", "as_1"]);
  assert.ok(summary.suspended[0].wrong, "改错条目带错形，方便判断要不要恢复");
  const set = select({ size: 30, progress, legacy });
  const ids = new Set(set.cards.map((card) => card.itemId));
  assert.ok(!ids.has("as_1") && !ids.has("ip_3"));

  const many = new Map(POOL.items.slice(0, 60).map((item) => [item.id, progressEntry(item.id, { rejected: true })]));
  const big = summarize({ progress: many });
  assert.equal(big.suspended.length, 50);
  assert.equal(big.suspendedCount, 60);
});

test("triageRemaining、orphanEvents、glossed、dailyNewLimit 口径", () => {
  const legacy = new Map([["ip_0", "known"]]);
  const progress = new Map([["ip_1", dueEntry("ip_1", "2026-10-07")]]);
  const events = [answer("ip_1", { at: "2026-10-01T01:00:00.000Z" }), answer("li2_gone"), answer("nb_gone", { action: "triage", judgment: "known" })];
  const summary = summarize({ progress, legacy, events, size: 20 });
  assert.equal(summary.triageRemaining, POOL.items.length - 2);
  assert.equal(summary.orphanEvents, 2);
  assert.equal(summary.glossed, 0);
  assert.equal(summarize({ pool: { ...POOL, glossed: 12 } }).glossed, 12);
  assert.equal(summary.dailyNewLimit, quickDailyNewLimit(20));
  assert.equal(summary.dailyNewLimit, select({ size: 20 }).limits.dailyNewLimit, "与 GET set 同一口径");
  assert.equal(quickDailyNewLimit(10, true), 30);
});

test("topIssues 在 summary 里带上 focus 与 itemCount", () => {
  const summary = summarize({ topIssues: [{ key: "型_対応", label: "对应", interviewCount: 3, occurrenceCount: 5 }] });
  assert.equal(summary.topIssues[0].focus, "型_対応");
  assert.equal(summary.topIssues[0].itemCount, 6);
});
