import assert from "node:assert/strict";
import test from "node:test";

import { findDayNote, findRoundNote, joinReviewNotes } from "../lib/review-join.ts";

function note(path, frontmatter, content = "") {
  return { path, name: path.split("/").pop(), frontmatter, content, stat: { mtime: 0 } };
}

const SEIRIKOU_1 = note(
  "20_求職/テスト社/2026-08-01_一次面接_整理稿.md",
  { type: "transcript-study", company: "テスト社", date: "2026-08-01", round: "一次面接" },
);
const SEIRIKOU_2 = note(
  "20_求職/テスト社/2026-08-01_二次面接_整理稿.md",
  { type: "transcript-study", company: "テスト社", date: "2026-08-01", round: "二次面接" },
);
// 批注は日ごとに1本。同じ日の一次・二次はこの1本を共有する。
const ANNOTATION = note(
  "20_求職/テスト社/2026-08-01_一次面接_批注.md",
  { type: "study-annotation", company: "テスト社", date: "2026-08-01" },
);
// 回答品質復盤は回ごと。二次にだけ在る状態を作る。
const DEEP_2 = note(
  "20_求職/テスト社/2026-08-01_二次面接_回答品質復盤.md",
  {
    type: "interview-answer-review",
    company: "テスト社",
    date: "2026-08-01",
    round: "二次面接",
  },
);

test("批注は日ごと・回答品質復盤は回ごとに紐づく", () => {
  const joined = joinReviewNotes([SEIRIKOU_1, SEIRIKOU_2, ANNOTATION, DEEP_2]);
  assert.equal(joined.length, 2);

  const first = joined.find((item) => item.round === "一次面接");
  const second = joined.find((item) => item.round === "二次面接");

  // 批注は round を見ないので、同じ日の両方に同じ1本が付く。
  assert.equal(first.annotationNote?.path, ANNOTATION.path);
  assert.equal(second.annotationNote?.path, ANNOTATION.path);

  // 復盤は round まで見るので、二次にだけ付く。ここが day 照合に緩むと
  // 一次の画面に二次の採点が出る——数字が出てしまうぶん、無いより悪い。
  assert.equal(first.deepReviewNote, undefined);
  assert.equal(second.deepReviewNote?.path, DEEP_2.path);
});

test("整理稿の無い面接は出さない（復盤だけ在っても数えない）", () => {
  const orphan = note(
    "20_求職/テスト社/2026-09-09_一次面接_回答品質復盤.md",
    {
      type: "interview-answer-review",
      company: "テスト社",
      date: "2026-09-09",
      round: "一次面接",
    },
  );
  const joined = joinReviewNotes([SEIRIKOU_1, orphan]);
  assert.deepEqual(joined.map((item) => item.key), [SEIRIKOU_1.path]);
});

test("日付の新しい順に並ぶ（呼ぶ側で並べ直さない前提）", () => {
  const older = note(
    "20_求職/テスト社/2026-07-01_一次面接_整理稿.md",
    { type: "transcript-study", company: "テスト社", date: "2026-07-01", round: "一次面接" },
  );
  const joined = joinReviewNotes([older, SEIRIKOU_1]);
  assert.deepEqual(joined.map((item) => item.date), ["2026-08-01", "2026-07-01"]);
});

test("findRoundNote は round まで見る／findDayNote は見ない", () => {
  const [first] = joinReviewNotes([SEIRIKOU_1]);
  const result = note(
    "20_求職/テスト社/2026-08-01_復盤.md",
    { type: "review", company: "テスト社", date: "2026-08-01", round: "二次面接" },
  );
  const practice = note(
    "20_求職/テスト社/2026-08-01_二次面接_回答練習.md",
    {
      type: "interview-answer-practice",
      company: "テスト社",
      date: "2026-08-01",
      round: "二次面接",
    },
  );
  // 結果ノートは round が違っても同じ日として拾う。
  assert.equal(findDayNote([result], "review", first)?.path, result.path);
  // 練習キューは round が違えば拾わない（一次の画面に二次の練習が出ない）。
  assert.equal(findRoundNote([practice], "interview-answer-practice", first), undefined);
});

test("会社名の表記揺れ（法人格・全角・略記）でも同じ回として束ねる", () => {
  // 実データで起きた形：整理稿は「株式会社ＧＳＩ」、批注はディレクトリ名由来の「GSI」。
  // 厳密一致だとこの批注が復盤画面から静かに消える（実際に消えていた）。
  const seirikou = note(
    "20_求職/GSI/2026-08-10_カジュアル面談_整理稿.md",
    { type: "transcript-study", company: "株式会社ＧＳＩ", date: "2026-08-10", round: "カジュアル面談" },
  );
  const annotation = note(
    "20_求職/GSI/2026-08-10_カジュアル面談_批注.md",
    { type: "study-annotation", company: "GSI", date: "2026-08-10" },
  );
  const [joined] = joinReviewNotes([seirikou, annotation]);
  assert.equal(joined.annotationNote?.path, annotation.path);

  // 緩めるのは表記だけ。別の会社（語そのものが違う）は束ねない。
  const other = note(
    "20_求職/GSX/2026-08-10_カジュアル面談_批注.md",
    { type: "study-annotation", company: "株式会社GSX", date: "2026-08-10" },
  );
  const [joinedOther] = joinReviewNotes([seirikou, other]);
  assert.equal(joinedOther.annotationNote, undefined);
});
