import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  allDeductions,
  carryOverSections,
  hasDeductionLedger,
  normalizeInterviewAnswerReview,
  parseInterviewAnswerReview,
  renderInterviewAnswerReview,
} from "../lib/review-deep.ts";

// deductions が無い schema v2 の既存レポート。再生成前でも読めることを担保する。
test("answer-quality review round-trips through its durable vault note", () => {
  const review = normalizeInterviewAnswerReview(
    {
      overallScore: 68,
      dimensions: {
        questionUnderstanding: {
          score: 72,
          rationaleZh: "多数问题听懂，但复合问题有遗漏。",
          evidenceBlockIds: ["q10"],
        },
        coverage: {
          score: 60,
          rationaleZh: "AI、MCP、DDD 三项只覆盖一项。",
          evidenceBlockIds: ["q10"],
        },
        directness: {
          score: 65,
          rationaleZh: "回答相关，但没有逐项先给结论。",
          evidenceBlockIds: ["q10"],
        },
        evidenceCredibility: {
          score: 80,
          rationaleZh: "DDD 的判断与原回答一致。",
          evidenceBlockIds: ["q10"],
        },
        riskControl: {
          score: 63,
          rationaleZh: "主动承认未跟进会放大弱项。",
          evidenceBlockIds: ["q10"],
        },
      },
      summaryZh: "复合问题有漏答。",
      strengths: ["有实际经验"],
      weaknesses: ["只回答了 DDD"],
      priorityBlockIds: ["q10"],
      blocks: [
        {
          blockId: "q10",
          questionTitle: "AI・MCP・DDD",
          interviewerIntentZh: "确认三个方向的跟进情况",
          askedPoints: ["AI", "MCP", "DDD"],
          answeredPoints: ["DDD"],
          missedPoints: ["AI", "MCP"],
          comprehension: "likely_missed",
          relevance: "partial",
          quality: "weak",
          strategyTags: ["compound-question-miss", "no-conclusion-first"],
          evidenceSentenceIds: ["s091", "s092"],
          evaluationZh: "回答相关，但只覆盖了三分之一。",
          improvementZh: "先逐项回答，再展开最有把握的一项。",
          improvedAnswerJa: "AIとMCPは継続的に試しています。DDDは勉強中です。",
        },
      ],
    },
    { generatedAt: "2026-07-22T00:00:00.000Z", model: "test-model" },
    new Map([["q10", new Set(["s091", "s092"])]]),
  );
  assert.equal(review.overallScore, 68);
  const note = renderInterviewAnswerReview(review, {
    company: "テスト社",
    date: "2026-07-01",
    round: "一次",
    sourceName: "整理稿",
    annotationName: "批注",
  });
  assert.deepEqual(parseInterviewAnswerReview(note), review);
  assert.match(note, /AIとMCPは継続的に試しています/);
  assert.match(note, /採点内訳（各20%）/);
  assert.match(note, /问题理解 72/);
  assert.match(note, /compound-question-miss/);
  assert.equal(hasDeductionLedger(review.dimensions), false);
});

function ledgerReview(deductionsByKey) {
  const dimension = (deductions) => ({
    deductions,
    rationaleZh: "理由。",
    evidenceBlockIds: ["q10"],
  });
  return normalizeInterviewAnswerReview(
    {
      dimensions: {
        questionUnderstanding: dimension(deductionsByKey.questionUnderstanding ?? []),
        coverage: dimension(deductionsByKey.coverage ?? []),
        directness: dimension(deductionsByKey.directness ?? []),
        evidenceCredibility: dimension(deductionsByKey.evidenceCredibility ?? []),
        riskControl: dimension(deductionsByKey.riskControl ?? []),
      },
      summaryZh: "摘要。",
      strengths: [],
      weaknesses: [],
      priorityBlockIds: ["q10"],
      blocks: [
        {
          blockId: "q10",
          questionTitle: "AI・MCP・DDD",
          interviewerIntentZh: "确认三个方向的跟进情况",
          askedPoints: ["AI", "MCP", "DDD"],
          answeredPoints: ["DDD"],
          missedPoints: ["AI", "MCP"],
          comprehension: "likely_missed",
          relevance: "partial",
          quality: "weak",
          strategyTags: ["compound-question-miss"],
          evidenceSentenceIds: ["s091"],
          evaluationZh: "只覆盖了三分之一。",
          improvementZh: "先逐项回答。",
          improvedAnswerJa: "",
        },
      ],
    },
    { generatedAt: "2026-08-04T00:00:00.000Z", model: "test-model" },
    new Map([["q10", new Set(["s091", "s092"])]]),
  );
}

// 這份契約の要：分数は 100 − Σ から導出される。
// 説明できない減点は「存在できない」ことをここで固定する。
test("dimension scores are derived from the deduction ledger, never asserted", () => {
  const review = ledgerReview({
    questionUnderstanding: [
      {
        blockId: "q10",
        points: 14,
        severity: "major",
        labelZh: "複合質問の AI・MCP を聞き落とした",
        detailZh: "三つ聞かれたのに DDD だけ答えた。",
        fixZh: "復唱してから一問ずつ答える。",
        evidenceSentenceIds: ["s091"],
      },
      {
        blockId: "q10",
        points: 3,
        severity: "minor",
        labelZh: "一度聞き返した",
        detailZh: "確認後は正しく答えている。",
        fixZh: "要点を復唱して一往復で揃える。",
        evidenceSentenceIds: ["s092"],
      },
    ],
  });

  assert.equal(hasDeductionLedger(review.dimensions), true);
  assert.equal(review.dimensions.questionUnderstanding.score, 100 - 14 - 3);
  // 減点ゼロは満点。「なんとなく 86」はもう作れない。
  assert.equal(review.dimensions.coverage.score, 100);
  assert.equal(review.overallScore, Math.round((83 + 100 * 4) / 5));

  const flat = allDeductions(review.dimensions);
  assert.deepEqual(flat.map((item) => item.points), [14, 3]);
  assert.equal(flat[0].dimension, "questionUnderstanding");

  const note = renderInterviewAnswerReview(review, {
    company: "テスト社",
    date: "2026-08-04",
    round: "一次",
    sourceName: "整理稿",
    annotationName: "批注",
  });
  assert.deepEqual(parseInterviewAnswerReview(note), review);
  assert.match(note, /annotation_note: "\[\[批注\]\]"/);
  assert.match(note, /100 − 14 − 3 = 83/);
  assert.match(note, /次はこうする：復唱してから一問ずつ答える。/);
  assert.match(note, /減点なし（100）/);
});

// 批注ノートが無い回もある（裁定対象ゼロ、あるいは compact 済み）。
// リンクを書いてしまうと vault:check が壊れリンクで落ちる。
test("a missing annotation note leaves out the frontmatter link instead of dangling it", () => {
  const note = renderInterviewAnswerReview(ledgerReview({}), {
    company: "テスト社",
    date: "2026-08-04",
    round: "カジュアル面談",
    sourceName: "整理稿",
    annotationName: null,
  });
  assert.doesNotMatch(note, /annotation_note/);
  assert.match(note, /source_note: "\[\[整理稿\]\]"\ngenerated_at:/);
});

test("deduction points are clamped to their severity band and unusable rows drop out", () => {
  const review = ledgerReview({
    riskControl: [
      // minor なのに 40 点：帯の上限 4 まで戻す。同じ語が場ごとに別の重さになると比較できない。
      { blockId: "q10", points: 40, severity: "minor", labelZh: "語気が強い", detailZh: "", fixZh: "", evidenceSentenceIds: [] },
      // 説明が一つも無い＝追跡不能。点を持って行かせない。
      { blockId: "q10", points: 20, severity: "major", labelZh: "", detailZh: "", fixZh: "", evidenceSentenceIds: [] },
      // 存在しない qNN でも点は残す（消すと減点が静かに消えて分数が水増しされる）。
      { blockId: "q99", points: 6, severity: "moderate", labelZh: "根拠が薄い", detailZh: "", fixZh: "", evidenceSentenceIds: [] },
    ],
  });

  const deductions = review.dimensions.riskControl.deductions;
  assert.equal(deductions.length, 2);
  assert.deepEqual(deductions.map((item) => item.points), [4, 6]);
  assert.equal(deductions[1].blockId, "");
  assert.equal(review.dimensions.riskControl.score, 90);
});

// 実際に 2 場でこれが起きた（q11 が s111 を、q12 が s046 を引いた）。
// 落とさないと「証拠句」ボタンが別の設問へ飛び、根拠を確かめに行った人を騙す。
test("a deduction citing another question's sentence loses the citation, not the points", () => {
  const review = ledgerReview({
    directness: [
      {
        blockId: "q10",
        points: 5,
        severity: "moderate",
        labelZh: "結論が後ろに回った",
        detailZh: "背景から入り、結論は段末。",
        fixZh: "先に結論を一文で置く。",
        // s091 はこの設問のもの、s999 は別設問のもの。
        evidenceSentenceIds: ["s091", "s999"],
      },
    ],
  });

  const [deduction] = review.dimensions.directness.deductions;
  assert.deepEqual(deduction.evidenceSentenceIds, ["s091"]);
  assert.equal(review.dimensions.directness.score, 95);
});

// 実害があった：Web からの再生成が、Vault モードのスキルや人が書いた
// 「次回面接で主に伝えること」を黙って消し、翌日の面接準備ノートのリンクが死んだ。
// 再生成は派生値を作り直す操作で、作り直せないものを捨てる権利は無い。
test("regeneration carries over sections the renderer cannot recreate", () => {
  const previous = [
    "---",
    "type: interview-answer-review",
    "---",
    "# 2026-07-28 テスト社 回答品質復盤",
    "",
    "## 全体評価",
    "",
    "**84 / 100** — 古い要約。",
    "",
    "### 強み",
    "- 古い強み",
    "",
    "### 弱み",
    "- 古い弱み",
    "",
    "### 次回面接で主に伝えること",
    "",
    "責任者候補へ定位を一段上げる。",
    "",
    "## 旧復盤から修正すべき点",
    "",
    "- 懸念は定着性と日本語の二点（原稿上の事実）。",
    "",
    "## q10 AI・MCP・DDD",
    "",
    "### 評価",
    "",
    "古い評価。",
    "",
    "<!-- interview-answer-review-data -->",
    "```json",
    "{}",
    "```",
  ].join("\n");

  const carried = carryOverSections(previous);
  assert.match(carried, /### 次回面接で主に伝えること/);
  assert.match(carried, /責任者候補へ定位を一段上げる。/);
  assert.match(carried, /## 旧復盤から修正すべき点/);
  // レンダラが必ず書き直す節と qNN 節は持ち越さない（古い数字が二重に残る）。
  assert.doesNotMatch(carried, /古い強み|古い弱み|古い要約|古い評価/);
  assert.doesNotMatch(carried, /q10/);

  const note = renderInterviewAnswerReview(ledgerReview({}), {
    company: "テスト社",
    date: "2026-07-28",
    round: "カジュアル面談",
    sourceName: "整理稿",
    annotationName: null,
    carriedSections: carried,
  });
  assert.match(note, /### 次回面接で主に伝えること/);
  assert.match(note, /## 旧復盤から修正すべき点/);
  assert.equal(carryOverSections(""), "");
});

test("deep review stays locked behind completed human decisions and an allowlisted task", async () => {
  const [route, bridge, client, annotate] = await Promise.all([
    readFile("app/api/review/deep/route.ts", "utf8"),
    readFile("scripts/codex-bridge.mjs", "utf8"),
    readFile("lib/server/codex-bridge.ts", "utf8"),
    readFile("app/api/review/annotate/route.ts", "utf8"),
  ]);
  assert.match(route, /unresolved\.length > 0/);
  assert.match(route, /review_interview_answers/);
  assert.match(bridge, /review_interview_answers: \{ model: SOL_MODEL, timeoutMs: 480_000 \}/);
  assert.match(bridge, /AI、MCP、DDD/);
  assert.match(bridge, /"dimensions"/);
  assert.match(bridge, /"strategyTags"/);
  // 分数を返させない・扣分を逐条举证させる、が review_interview_answers の契約の核。
  assert.match(bridge, /\*\*不要输出任何分数\*\*/);
  assert.match(bridge, /说不出扣在哪一题、扣多少、为什么，就不能扣分/);
  assert.doesNotMatch(bridge, /reviewDimension = \{[^}]*score: number/s);
  assert.match(client, /review_interview_answers/);
  assert.match(annotate, /inAnnotationQueue/);
  // 去重は共通骨格（upsertAppendNote）の duplicate 分岐＋応答の deduplicated で表現される。
  assert.match(annotate, /duplicate: \{ id: duplicate\.id \}/);
  assert.match(annotate, /deduplicated: outcome\.deduplicated/);
  // 批注ノートが未作成でも初回の裁定が 404 で落ちないこと（面接ごとに一度必ず踏んでいた）。
  assert.match(annotate, /annotationSkeleton/);
  assert.match(annotate, /type: study-annotation/);
  assert.doesNotMatch(annotate, /const note = await readNote/);
});

test("five-dimension scores stay visible before the full report is expanded", async () => {
  const [client, css] = await Promise.all([
    readFile("app/interview-review.tsx", "utf8"),
    readFile("app/globals.css", "utf8"),
  ]);
  const stageStart = client.indexOf("rv-deep-stage");
  const collapsedReportStart = client.indexOf("doc.deepReview && deepOpen", stageStart);
  const glanceStart = client.indexOf("rv-score-glance", stageStart);

  assert.ok(stageStart >= 0);
  assert.ok(glanceStart > stageStart);
  assert.ok(glanceStart < collapsedReportStart);
  assert.match(client, /五维评分/);
  assert.match(client, /Object\.keys\(REVIEW_DIMENSION_META\)/);
  assert.match(css, /\.rv-score-glance > div \{[^}]*repeat\(5/);
  assert.match(css, /\.rv-dimension-track em\.low/);
});

test("the report shows where each point went, and says so when it cannot", async () => {
  const [client, css] = await Promise.all([
    readFile("app/interview-review.tsx", "utf8"),
    readFile("app/globals.css", "utf8"),
  ]);
  // 概览の各维は扣分明细へのボタン、報告側は算式＋逐条依据。
  assert.match(client, /setDeepFocusDimension\(key\)/);
  assert.match(client, /rv-glance-deductions/);
  assert.match(client, /id=\{`rv-dimension-\$\{key\}`\}/);
  assert.match(client, /rv-ledger-formula/);
  assert.match(client, /DEDUCTION_SEVERITY_META\[item\.severity\]\.label/);
  assert.match(client, /onEvidenceClick\(sentenceId\)/);
  // 旧レポートは黙って空欄にせず、再生成すれば見えると明示する。
  assert.match(client, /旧格式报告没有扣分明细，重新生成后可见/);
  assert.match(css, /\.rv-deduction-list > li\.sev-major/);
  assert.match(css, /\.rv-deduction-fix/);
});
