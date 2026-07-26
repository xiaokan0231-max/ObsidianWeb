import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCardCoverage,
  buildInterviewTrends,
  interviewKeyFromNoteName,
  renderInterviewTrends,
} from "../lib/interview-trends.mjs";

function review({ overall = 80, dims = {}, blocks = [], priority = [] }) {
  const base = {
    questionUnderstanding: 90,
    coverage: 85,
    directness: 80,
    evidenceCredibility: 85,
    riskControl: 70,
  };
  return {
    generatedAt: "",
    model: "",
    overallScore: overall,
    dimensions: Object.fromEntries(
      Object.entries({ ...base, ...dims }).map(([key, score]) => [
        key,
        { score, rationaleZh: "", evidenceBlockIds: [] },
      ]),
    ),
    summaryZh: "",
    strengths: [],
    weaknesses: [],
    priorityBlockIds: priority,
    blocks,
  };
}

function block(blockId, questionTitle, strategyTags = []) {
  return {
    blockId,
    questionTitle,
    interviewerIntentZh: "",
    askedPoints: [],
    answeredPoints: [],
    missedPoints: [],
    comprehension: "clear",
    relevance: "direct",
    quality: "mixed",
    strategyTags,
    evidenceSentenceIds: [],
    evaluationZh: "",
    improvementZh: "",
    improvedAnswerJa: "",
  };
}

const ENTRIES = [
  {
    key: "2026-06-25_一次面接",
    company: "A社",
    date: "2026-06-25",
    round: "一次面接",
    review: review({
      overall: 68,
      dims: { riskControl: 63, directness: 60 },
      priority: ["q01"],
      blocks: [
        block("q01", "経歴評価と転職回数", ["negative-oversharing", "weak-evidence"]),
        block("q02", "強み", ["weak-evidence"]),
      ],
    }),
  },
  {
    key: "2026-07-16_カジュアル面談",
    company: "B社",
    date: "2026-07-16",
    round: "カジュアル面談",
    review: review({
      overall: 87,
      dims: { riskControl: 85 },
      priority: ["q11"],
      blocks: [block("q11", "仕事選びの軸", ["weak-evidence"])],
    }),
  },
  {
    key: "2026-07-24_エージェント面談",
    company: "C社",
    date: "2026-07-24",
    round: "エージェント面談",
    review: review({
      overall: 85,
      dims: { riskControl: 74 },
      priority: ["q25", "q11"],
      blocks: [
        block("q25", "SES/派遣", []),
        block("q11", "経験社数・転職回数", ["negative-oversharing"]),
      ],
    }),
  },
];

test("ノート名から面接キーを取り出す（復盤も整理稿も同じキーになる）", () => {
  assert.equal(interviewKeyFromNoteName("2026-07-24_エージェント面談_回答品質復盤"), "2026-07-24_エージェント面談");
  assert.equal(interviewKeyFromNoteName("2026-07-24_エージェント面談_整理稿"), "2026-07-24_エージェント面談");
  assert.equal(interviewKeyFromNoteName("2026-07-24_エージェント面談"), "2026-07-24_エージェント面談");
});

test("カードの対応は「证据」に実在する出典からのみ作り、推測しない", () => {
  const coverage = buildCardCoverage(`# 面试标准回答库

## p08 如何解释转职次数较多
### 证据
- [[2026-06-25_一次面接_整理稿#q01 経歴評価と転職回数]]：本人が裸で「転職が多い」と足した。

## p26 SES・派遣（客先常駐）への可否
### 证据
- [[2026-07-24_エージェント面談_整理稿#q25 SES/派遣]]：可否の結論を出せなかった。
- [[2026-07-24_エージェント面談_整理稿#q25 SES/派遣]]：重複しても1件に畳む。

## p99 出典なしのカード
### 证据
- 出典リンクを書いていない。
`);
  assert.deepEqual(coverage.get("2026-06-25_一次面接#q01"), [
    { id: "p08", title: "如何解释转职次数较多" },
  ]);
  assert.deepEqual(coverage.get("2026-07-24_エージェント面談#q25"), [
    { id: "p26", title: "SES・派遣（客先常駐）への可否" },
  ]);
  assert.equal(coverage.get("2026-07-24_エージェント面談#q11"), undefined, "出典が無い設問は対応なし");
});

test("五維は日付昇順に並び、平均の最低が最弱維になる", () => {
  const trends = buildInterviewTrends(ENTRIES);
  assert.deepEqual(trends.interviews.map((item) => item.date), [
    "2026-06-25",
    "2026-07-16",
    "2026-07-24",
  ]);
  assert.equal(trends.dimensionAverages.riskControl, 74, "(63+85+74)/3");
  assert.equal(trends.dimensionAverages.directness, 73, "(60+80+80)/3");
  assert.equal(trends.weakestDimension, "directness", "74 より 73 の方が低い");
});

test("2場以上で出たタグだけを癖として扱い、1場だけのものは分ける", () => {
  const trends = buildInterviewTrends(ENTRIES);
  const negative = trends.tags.find((item) => item.tag === "negative-oversharing");
  assert.equal(negative.interviews, 2);
  assert.equal(negative.occurrences, 2);
  assert.equal(negative.repeated, true);
  assert.equal(negative.inLatest, true, "直近にも出ている");
  assert.equal(negative.label, "主动暴露负面信息");

  const weak = trends.tags.find((item) => item.tag === "weak-evidence");
  assert.equal(weak.interviews, 2);
  assert.equal(weak.occurrences, 3, "同一面接で2問あれば2として数える");
  assert.equal(weak.inLatest, false);
});

test("直近2場に出ていない反復タグだけを「静かになった」に入れる", () => {
  const trends = buildInterviewTrends(ENTRIES);
  // weak-evidence は 07-16 に出ている＝直近2場に含まれるので対象外
  assert.deepEqual(trends.quietRecently.map((item) => item.tag), []);
  assert.deepEqual(trends.recentKeys, ["2026-07-16_カジュアル面談", "2026-07-24_エージェント面談"]);
});

test("優先復習ブロックは出典のあるカードに紐づき、無いものは未カバーとして残る", () => {
  const coverage = buildCardCoverage(`## p26 SES可否
### 证据
- [[2026-07-24_エージェント面談_整理稿#q25 SES/派遣]]：結論を出せなかった。
`);
  const trends = buildInterviewTrends(ENTRIES, coverage);
  const latest = trends.interviews.at(-1);
  assert.deepEqual(latest.priorityBlocks[0], {
    blockId: "q25",
    title: "SES/派遣",
    cards: [{ id: "p26", title: "SES可否" }],
  });
  assert.deepEqual(
    trends.uncoveredBlocks.map((item) => `${item.date}#${item.blockId}`),
    ["2026-06-25#q01", "2026-07-16#q11", "2026-07-24#q11"],
  );
});

test("生成本文はタイムスタンプを含まない（含むと vault:stats --check が毎回 drift する）", () => {
  const body = renderInterviewTrends(buildInterviewTrends(ENTRIES));
  assert.doesNotMatch(body, /\d{2}:\d{2}:\d{2}/);
  assert.doesNotMatch(body, /GMT|UTC|generatedAt/);
  // 同じ入力なら必ず同じ出力
  assert.equal(body, renderInterviewTrends(buildInterviewTrends(ENTRIES)));
});

test("生成本文は最弱維と反復タグを明示し、標本が無いときは正直に書く", () => {
  const body = renderInterviewTrends(buildInterviewTrends(ENTRIES));
  assert.match(body, /⚠️最弱/);
  assert.match(body, /风险控制/);
  assert.match(body, /主动暴露负面信息/);
  assert.match(body, /2 場以上で出たものだけ/);
  assert.equal(
    renderInterviewTrends(buildInterviewTrends([])),
    "まだ回答品質復盤がありません（`type: interview-answer-review` のノートが 0 件）。",
  );
});
