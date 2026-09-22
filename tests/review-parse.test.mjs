import assert from "node:assert/strict";
import test from "node:test";
import {
  computeStats,
  latestListeningMarks,
  parseAnnotations,
  parseSeirikou,
  plainSei,
  reviewDecisionTasks,
  segmentSei,
  uniqueAnnotations,
} from "../lib/review.ts";

const SEIRIKOU_FIXTURE = `---
type: transcript-study
company: テスト社
---
# 見出し

> 凡例の引用行は無視される。

## q00 冒頭

- 概:: 挨拶の区間。
- **s001｜面**
    - 正:: こんにちは。
    - 訳:: 你好。
    - 語:: こんにちは＝挨拶
- **s002｜私**
    - 正:: 王明と«申しいます»。
    - 原:: 皇明と申しいます。
    - 訳:: 我叫王明。
    - 誤1:: «申しいます» → 申します ｜疑（転写か語形か）｜型:: 語形

## q01 志望理由

- 概:: 誤りが集中する区間。
- **s003｜私**
    - 正:: «感じしました»。«だから»応募しました。
    - 訳:: 有所感受。所以应聘了。
    - 誤1:: «感じしました» → 感じました ｜学習者｜型:: 感じします（既載）
    - 誤2:: «だから» → そのため ｜学習者｜型:: 文体
- **s004｜面?**
    - 正:: なるほど、そうですか。
    - 訳:: 原来如此。
    - 注:: 話者は推定。

## 集計メモ（参考）

- ここはブロックとして拾われるが文は無い
`;

test("parseSeirikou: ブロック・文・フィールドを構造化する", () => {
  const parsed = parseSeirikou(SEIRIKOU_FIXTURE);
  const [q00, q01] = parsed.blocks;

  assert.equal(q00.id, "q00");
  assert.equal(q00.title, "冒頭");
  assert.equal(q00.summary, "挨拶の区間。");
  assert.equal(q00.sentences.length, 2);

  const s001 = q00.sentences[0];
  assert.equal(s001.speaker, "面");
  assert.equal(s001.uncertainSpeaker, false);
  assert.equal(s001.go.length, 1);
  assert.equal(s001.yaku, "你好。");

  const s002 = q00.sentences[1];
  assert.equal(s002.gen, "皇明と申しいます。");
  assert.equal(s002.errors.length, 1);
  assert.equal(s002.errors[0].kind, "疑");
  assert.equal(s002.errors[0].span, "申しいます");
  assert.equal(s002.errors[0].correction, "申します");
  assert.equal(s002.errors[0].pattern, "語形");

  assert.equal(q01.sentences.length, 2);
  assert.equal(q01.sentences[1].uncertainSpeaker, true);
  assert.equal(q01.sentences[1].notes.length, 1);

  // 集計メモの見出しは q 形式でないため、文ゼロのブロックにもならない
  assert.equal(parsed.blocks.length, 2);
  assert.equal(parsed.sentences.length, 4);
});

test("segmentSei: «»スパンと誤りを順序で対応付ける", () => {
  const parsed = parseSeirikou(SEIRIKOU_FIXTURE);
  const s003 = parsed.sentences.find((item) => item.id === "s003");
  const segments = segmentSei(s003);

  assert.deepEqual(
    segments.map((segment) => segment.text),
    ["感じしました", "。", "だから", "応募しました。"],
  );
  assert.equal(segments[0].error?.pattern, "感じします（既載）");
  assert.equal(segments[2].error?.kind, "学習者");
  assert.equal(plainSei(s003), "感じしました。だから応募しました。");
});

test("computeStats: 話者・誤り種別・型を集計する", () => {
  const parsed = parseSeirikou(SEIRIKOU_FIXTURE);
  const stats = computeStats(parsed.sentences);

  assert.equal(stats.sentenceTotal, 4);
  assert.equal(stats.bySpeaker["面"], 2);
  assert.equal(stats.bySpeaker["私"], 2);
  assert.equal(stats.learnerErrors, 2);
  assert.equal(stats.uncertainErrors, 1);
  assert.equal(stats.uncertainSpeakers, 1);
  // 型スラッグは（）を落として集計される
  assert.deepEqual(stats.patterns.get("感じします"), { learner: 1, uncertain: 0 });
  assert.deepEqual(stats.patterns.get("語形"), { learner: 0, uncertain: 1 });
});

const ANNOTATION_FIXTURE = `---
type: study-annotation
---
# 批注

> 書き方の例（コピーして使う）：
> - **a001｜s001｜裁定｜open｜2026-07-22**
>     - 我:: 引用内の例は拾わない

## エントリ

- **a001｜s002｜裁定｜open｜2026-07-22**
    - 対象:: error:1
    - 我:: 「御社で」と言ったつもり → 転写扱い
- **a002｜s003｜批注｜answered｜2026-07-22**
    - 我:: この言い方は失礼？
    - AI:: 「そのため」に置き換えるのが安全です。
- **a003｜s001｜聴解｜open｜2026-07-22**
    - 我:: △推測で理解
- **a004｜s001｜聴解｜open｜2026-07-23**
    - 我:: ×聞き取れず
`;

test("parseAnnotations: エントリと返信を読む・引用は無視", () => {
  const annotations = parseAnnotations(ANNOTATION_FIXTURE);
  assert.equal(annotations.length, 4);
  assert.equal(annotations[0].kind, "裁定");
  assert.equal(annotations[0].target, "error:1");
  assert.equal(annotations[1].status, "answered");
  assert.equal(annotations[1].ai, "「そのため」に置き換えるのが安全です。");

  const marks = latestListeningMarks(annotations);
  assert.equal(marks.get("s001"), "×");
  assert.equal(marks.size, 1);
});

test("reviewDecisionTasks: 構造化対象と旧裁定から未処理だけを残す", () => {
  const parsed = parseSeirikou(SEIRIKOU_FIXTURE);
  const annotations = parseAnnotations(ANNOTATION_FIXTURE);
  const tasks = reviewDecisionTasks(parsed.sentences, annotations);

  assert.equal(tasks.length, 2);
  assert.equal(tasks.find((item) => item.id === "s002:error:1")?.resolvedBy, "a001");
  assert.equal(tasks.find((item) => item.id === "s004:speaker")?.resolvedBy, undefined);
});

test("reviewDecisionTasks: 同じ文の二つの疑を別々に裁定する", () => {
  const parsed = parseSeirikou(`## q00 複数疑\n- **s010｜私**\n    - 正:: «甲»と«乙»\n    - 誤1:: «甲» → A ｜疑\n    - 誤2:: «乙» → B ｜疑\n`);
  const annotations = parseAnnotations(`## エントリ\n- **a001｜s010｜裁定｜open｜2026-07-22**\n    - 対象:: error:1\n    - 我:: «甲»は転写誤りで確定（実際は「A」と発話した）\n`);
  const tasks = reviewDecisionTasks(parsed.sentences, annotations);

  assert.equal(tasks.length, 2);
  assert.equal(tasks.find((item) => item.target === "error:1")?.resolution, "transcript");
  assert.equal(tasks.find((item) => item.target === "error:2")?.resolvedBy, undefined);
});

test("uniqueAnnotations: 連打でできた同一追記を一件として扱う", () => {
  const annotations = parseAnnotations(`${ANNOTATION_FIXTURE}\n- **a005｜s001｜聴解｜open｜2026-07-24**\n    - 我:: ×聞き取れず\n`);
  assert.equal(annotations.length, 5);
  assert.equal(uniqueAnnotations(annotations).length, 4);
});

const DECISION_SENTENCES = parseSeirikou(`## q00 裁定の更新
- **s010｜私?**
    - 正:: «甲»と«乙»。
    - 誤1:: «甲» → A ｜疑
    - 誤2:: «乙» → B ｜疑
`).sentences;

function decision(id, mine, target = "speaker") {
  return { id, sentenceId: "s010", kind: "裁定", status: "open", date: "2026-01-01", target, mine };
}

test("reviewDecisionTasks: 最新の話者訂正が旧確認を上書きする（open でも明示的確認は有効）", () => {
  const annotations = [
    decision("a001", "話者裁定：この文は自分の発言"),
    decision("a002", "話者裁定：この文は面接官の発言"),
  ];
  const speaker = reviewDecisionTasks(DECISION_SENTENCES, annotations).find((task) => task.target === "speaker");
  assert.equal(speaker.resolution, "speaker-interviewer");
  assert.equal(speaker.resolvedBy, "a002");
  assert.deepEqual(annotations.map((item) => item.id), ["a001", "a002"], "入力の追記順を変えない");
});

test("reviewDecisionTasks: 最新の不確かな話者申告は旧確認に戻らず未解決になる", () => {
  for (const mine of ["这句好像不是我说的，不过也可能我记错了。", "話者裁定：自分の発言か覚えていない", "話者裁定：この文は自分の発言ではない"] ) {
    const annotations = [
      decision("a001", "話者裁定：この文は自分の発言"),
      decision("a002", mine),
    ];
    const speaker = reviewDecisionTasks(DECISION_SENTENCES, annotations).find((task) => task.target === "speaker");
    assert.equal(speaker.resolution, "unknown", mine);
    assert.equal(speaker.resolvedBy, undefined, mine);
  }
});

test("reviewDecisionTasks: 同じ文の別対象は独立し、旧自由文の誤り裁定も保つ", () => {
  const annotations = [
    decision("a001", "話者裁定：この文は自分の発言"),
    decision("a002", "«甲»は学習者誤りで確定", "error:1"),
    decision("a003", "誰の発言か記憶が曖昧です"),
    decision("a004", "«甲»は転写誤りで確定", "error:1"),
    { ...decision("a005", "«乙»と言ったつもり → 転写扱い", "error:2"), target: undefined },
  ];
  const tasks = reviewDecisionTasks(DECISION_SENTENCES, annotations);
  assert.equal(tasks.find((task) => task.target === "speaker").resolvedBy, undefined);
  assert.equal(tasks.find((task) => task.target === "error:1").resolvedBy, "a004");
  assert.equal(tasks.find((task) => task.target === "error:1").resolution, "transcript");
  assert.equal(tasks.find((task) => task.target === "error:2").resolvedBy, "a005");
  assert.equal(tasks.find((task) => task.target === "error:2").resolution, "unknown");
});

test("reviewDecisionTasks: A→B→A の最新確認を上流の去重後も保つ", () => {
  const annotations = [
    decision("a001", "話者裁定：この文は自分の発言"),
    decision("a002", "話者裁定：この文は面接官の発言"),
    decision("a003", "話者裁定：この文は自分の発言"),
  ];
  const unique = uniqueAnnotations(annotations);
  assert.deepEqual(unique.map((item) => item.id), ["a002", "a003"]);
  for (const input of [annotations, unique]) {
    const speaker = reviewDecisionTasks(DECISION_SENTENCES, input).find((task) => task.target === "speaker");
    assert.equal(speaker.resolution, "speaker-self");
    assert.equal(speaker.resolvedBy, "a003");
  }
});
