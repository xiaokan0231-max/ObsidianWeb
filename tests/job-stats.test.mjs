import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDailyFlow,
  buildStatsPayload,
  buildTimeline,
  parseAppliedKnownFrom,
  parseAppliedLedger,
  parseStatsPayload,
  reachRate,
  renderStatsBlock,
  SMALL_SAMPLE_THRESHOLD,
  STATS_BLOCK_ID,
} from "../lib/job-stats.mjs";

const SAMPLE = {
  total: 181,
  reached: 11,
  byChannel: new Map([
    ["Recruit Agent", { total: 163, reached: 8 }],
    ["企業直投/ATS", { total: 8, reached: 2 }],
    ["Green", { total: 10, reached: 1 }],
  ]),
  byMonth: new Map([
    ["2025-10", 26],
    ["2025-08", 34],
  ]),
  byReason: new Map([
    ["经验或技能不匹配", 42],
    ["其他候选人更匹配", 95],
  ]),
};

/** script が書いて Web が読む、その一往復。ここが崩れると画面が黙って空になる。 */
function roundTrip(payload) {
  const note = [
    "# 台帳",
    "",
    `<!-- generated:${STATS_BLOCK_ID} scripts/vault-stats.mjs が生成。手で書き換えない -->`,
    renderStatsBlock(payload),
    "<!-- /generated -->",
    "",
  ].join("\n");
  return parseStatsPayload(note);
}

test("buildStatsPayload sorts each breakdown so the chart order is stable", () => {
  const { rejections } = buildStatsPayload(SAMPLE);

  assert.equal(rejections.total, 181);
  assert.equal(rejections.reachedInterview, 11);
  // 経路は件数の多い順（棒グラフの並び順がそのまま決まる）
  assert.deepEqual(rejections.byChannel.map((c) => c.channel), ["Recruit Agent", "Green", "企業直投/ATS"]);
  // 月は時系列順。件数順に並べると折れ線が意味を失う
  assert.deepEqual(rejections.byMonth.map((m) => m.month), ["2025-08", "2025-10"]);
  assert.deepEqual(rejections.byReason.map((r) => r.count), [95, 42]);
});

test("the payload round-trips through the ledger note unchanged", () => {
  const payload = buildStatsPayload(SAMPLE);
  assert.deepEqual(roundTrip(payload), payload);
});

test("the rendered block carries no timestamp", () => {
  // タイムスタンプが入ると vault:stats --check が毎回 drift を出し、Stop hook が鳴き続ける。
  const first = renderStatsBlock(buildStatsPayload(SAMPLE));
  const second = renderStatsBlock(buildStatsPayload(SAMPLE));
  assert.equal(first, second);
  assert.ok(!/\d{4}-\d{2}-\d{2}T|generatedAt|fetchedAt/.test(first));
});

test("a note without the block yields empty counts instead of throwing", () => {
  const stats = parseStatsPayload("# 台帳\n\n本文だけ\n");
  assert.equal(stats.rejections.total, 0);
  assert.deepEqual(stats.rejections.byChannel, []);
});

test("broken JSON degrades to empty counts instead of taking the page down", () => {
  const note = [
    `<!-- generated:${STATS_BLOCK_ID} -->`,
    "```json",
    "{ これは JSON ではない",
    "```",
    "<!-- /generated -->",
  ].join("\n");
  assert.equal(parseStatsPayload(note).rejections.total, 0);
});

test("a payload missing rejections is treated as absent, not partially trusted", () => {
  const note = [
    `<!-- generated:${STATS_BLOCK_ID} -->`,
    "```json",
    JSON.stringify({ somethingElse: 1 }),
    "```",
    "<!-- /generated -->",
  ].join("\n");
  assert.equal(parseStatsPayload(note).rejections.total, 0);
});

test("parseStatsPayload survives null and undefined", () => {
  assert.equal(parseStatsPayload(null).rejections.total, 0);
  assert.equal(parseStatsPayload(undefined).rejections.total, 0);
});

test("reachRate never divides by zero", () => {
  assert.equal(reachRate(0, 0), 0);
  assert.equal(Math.round(reachRate(8, 163) * 1000) / 10, 4.9);
});

test("months before the backfill boundary report unknown, not zero", () => {
  // 応募日は 2026-07 から遡って入れた。それ以前を 0 と描くと
  //「昔は応募していなかった」という嘘のグラフになる。
  const rejected = new Map([["2025-08", 34], ["2026-06", 31], ["2026-07", 14]]);
  const applied = new Map([["2026-07", 23]]);
  const timeline = buildTimeline(rejected, applied, "2026-07");

  assert.equal(timeline.months.find((m) => m.month === "2025-08").applied, null);
  assert.equal(timeline.months.find((m) => m.month === "2026-06").applied, null);
  assert.equal(timeline.months.find((m) => m.month === "2026-07").applied, 23);
  // 不採用は全期間そろっている
  assert.equal(timeline.months.find((m) => m.month === "2025-08").rejected, 34);
});

test("a month inside the known range with no applications is 0, not unknown", () => {
  const timeline = buildTimeline(new Map([["2026-07", 5]]), new Map(), "2026-06");
  assert.equal(timeline.months[0].applied, 0, "境界より後の空月は本当に0件");
});

test("with no backfill at all every month is unknown", () => {
  const timeline = buildTimeline(new Map([["2026-07", 5]]), new Map(), null);
  assert.equal(timeline.months[0].applied, null);
});

test("daily flow tracks pending as applications land and resolve", () => {
  const flow = buildDailyFlow([
    { appliedOn: "2026-07-01", resolvedOn: "2026-07-03" },
    { appliedOn: "2026-07-02", resolvedOn: null },
    { appliedOn: "2026-07-02", resolvedOn: null },
  ]);

  assert.deepEqual(flow.map((d) => d.date), ["2026-07-01", "2026-07-02", "2026-07-03"]);
  assert.deepEqual(flow.map((d) => d.pending), [1, 3, 2]);
  assert.deepEqual(flow.map((d) => d.appliedCum), [1, 3, 3]);
  assert.deepEqual(flow.map((d) => d.resolvedCum), [0, 0, 1]);
});

test("daily flow fills the gap days so the line has no holes", () => {
  const flow = buildDailyFlow([{ appliedOn: "2026-07-01", resolvedOn: "2026-07-05" }]);
  assert.equal(flow.length, 5, "応募日から解決日まで毎日ある");
  assert.deepEqual(flow.map((d) => d.pending), [1, 1, 1, 1, 0]);
});

test("pending never goes negative when the window has no resolutions", () => {
  // 窓の外（181社の過去の不採用）を混ぜるとここがマイナスに振れる。混ぜていないことの確認。
  const flow = buildDailyFlow([
    { appliedOn: "2026-07-20", resolvedOn: null },
    { appliedOn: "2026-07-21", resolvedOn: null },
  ]);
  assert.ok(flow.every((d) => d.pending >= 0));
  assert.equal(flow.at(-1).pending, 2);
});

test("an empty ledger yields no flow instead of throwing", () => {
  assert.deepEqual(buildDailyFlow([]), []);
});

test("the timeline survives the round-trip through the ledger", () => {
  const payload = buildStatsPayload({
    ...SAMPLE,
    timeline: buildTimeline(new Map([["2026-07", 14]]), new Map([["2026-07", 23]]), "2026-07"),
  });
  assert.deepEqual(roundTrip(payload).timeline, payload.timeline);
});

test("the applied ledger falls back to the literal name when no match name is given", () => {
  const note = [
    "| 応募日 | 会社名 | 照合名 | 職種名 | 経路 | 証拠 |",
    "|---|---|---|---|---|---|",
    "| 2026-07-20 | 株式会社ＳＵＮＰＩＮ　ＪＡＰＡＮ |  | データPFエンジニア | Recruit Agent | K2026 |",
    "| 2026-07-20 | ＦＰＴジャパンホールディングス株式会社 | FPTソフトウェアジャパン株式会社 | DE | 企業直投/ATS | 応募ID |",
  ].join("\n");
  const rows = parseAppliedLedger(note);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].matchName, "株式会社ＳＵＮＰＩＮ　ＪＡＰＡＮ", "空なら会社名をそのまま使う");
  // 受理メールの社名が持株会社で、不採用台帳側の社名と違うケース
  assert.equal(rows[1].matchName, "FPTソフトウェアジャパン株式会社");
});

test("the applied ledger ignores the duplicate-receipt table and other tables", () => {
  const note = [
    "| 求人No | 会社名 | 1回目 | 2回目 |",
    "| K20250820-283-01-027 | スカイゲート | 2026-07-21 18:35 | 2026-07-22 09:56 |",
    "| 項目 | 値 |",
    "| Gmail 走査の開始 | **2026-06-23** |",
  ].join("\n");
  assert.deepEqual(parseAppliedLedger(note), [], "応募日列が ISO 日付の行だけを採る");
});

test("parseAppliedKnownFrom reads the boundary that decides unknown-vs-zero", () => {
  const note = "| 応募数が**完全に分かる最初の月** | **2026-07** |";
  assert.equal(parseAppliedKnownFrom(note), "2026-07");
  assert.equal(parseAppliedKnownFrom("何も無い"), null, "読めなければ null＝全月不明扱い");
});

test("the small-sample threshold flags the channels that actually mislead", () => {
  // 実データ：直投 8社・Green 10社 は注記が要る／RA 163社 は要らない。
  assert.ok(8 < SMALL_SAMPLE_THRESHOLD);
  assert.ok(10 < SMALL_SAMPLE_THRESHOLD);
  assert.ok(163 >= SMALL_SAMPLE_THRESHOLD);
});
