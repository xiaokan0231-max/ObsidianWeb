import assert from "node:assert/strict";
import test from "node:test";

import {
  auditJobCaseCompleteness,
  detectVerification,
  validateJobCaseFrontmatter,
} from "../lib/job-case-schema.ts";

const valid = {
  case_id: "Acme_Data",
  company: "Acme",
  origin: "manual",
  status: "応募済（2026-08-01・Green）",
  status_updated: "2026-08-01",
  channel: "Green",
};

const complete = [
  "## 推荐理由",
  "8分。",
  "## 匹配点",
  "- 必須「Spark」＝ 8年",
  "## 注意点",
  "- クラウド実務が薄い",
  "## 主打材料",
  "- 職務経歴書",
  "## ✅ 原文核対済み",
  "necessary",
].join("\n");

test("schema：形の正しい job-case は問題なし", () => {
  assert.deepEqual(validateJobCaseFrontmatter(valid), []);
});

test("schema：status の列挙外は列挙を添えて落とす", () => {
  const problems = validateJobCaseFrontmatter({ ...valid, status: "選考中" });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /status "選考中" は列挙に無い/u);
});

test("schema：channel と status_updated は status 次第で必須になる", () => {
  const problems = validateJobCaseFrontmatter({
    case_id: "A",
    company: "B",
    origin: "manual",
    status: "面接中",
  });
  assert.ok(problems.some((p) => /`channel` が要る/u.test(p)));
  assert.ok(problems.some((p) => /`status_updated` が要る/u.test(p)));
});

test("schema：保留は日付が定まらない状態なので status_updated を要求しない", () => {
  // 無い日付を作らせないための例外。ここを必須にすると嘘の日付が入る。
  const problems = validateJobCaseFrontmatter({
    case_id: "A",
    company: "B",
    origin: "manual",
    status: "保留（募集終了）",
  });
  assert.deepEqual(problems, []);
});

test("schema：実在しない日付・範囲外 rating・依存フィールド欠落を捕まえる", () => {
  const problems = validateJobCaseFrontmatter({
    ...valid,
    status_updated: "2026-02-30",
    rating: 11,
    follow_up_at: "2026-08-20",
    next_event_at: "2026-08-05 25:00",
  });
  assert.ok(problems.some((p) => /status_updated .*実在する YYYY-MM-DD ではない/u.test(p)));
  assert.ok(problems.some((p) => /rating .*0〜10 の数値ではない/u.test(p)));
  assert.ok(problems.some((p) => /follow_up_at があるなら waiting_for も必要/u.test(p)));
  assert.ok(problems.some((p) => /next_event_at .*YYYY-MM-DD HH:MM ではない/u.test(p)));
});

test("完成度：進行中なのに未採点・節なし・核対マークなしを警告する", () => {
  // 2026-08-04 実証：一次面接が確定している案件が rating も評価節も無いまま
  // 3週間 Web に並んでいた。形式検査は全部通っていた。
  const warnings = auditJobCaseCompleteness({ ...valid, status: "面接中" }, "## 経緯\n本文");
  assert.ok(warnings.some((w) => /rating が無い/u.test(w)));
  assert.ok(warnings.some((w) => /推荐理由・匹配点・注意点・主打材料/u.test(w)));
  assert.ok(warnings.some((w) => /`## ✅` で始まる見出しが無い/u.test(w)));
});

test("完成度：揃っていれば警告ゼロ", () => {
  const warnings = auditJobCaseCompleteness({ ...valid, rating: 8 }, complete);
  assert.deepEqual(warnings, []);
});

test("完成度：⚠️ 見出しは「要確認」なので核対マーク欠落として二重に鳴らさない", () => {
  const content = complete.replace("## ✅ 原文核対済み", "## ⚠️ 英語要件が未確認");
  const warnings = auditJobCaseCompleteness({ ...valid, rating: 8 }, content);
  assert.deepEqual(warnings, []);
});

test("完成度：終わった案件は採点も節も要求しない", () => {
  // 不採用・未応募まで巻き込むと警告が数十件になり、誰も読まなくなる。
  for (const status of ["不採用（2026-07-30・書類選考）", "未応募"]) {
    assert.deepEqual(auditJobCaseCompleteness({ ...valid, status }, "本文だけ"), []);
  }
});

test("核対判定：逐語ブロックの節は ✅ 見出しと同じく原文確認済みとみなす", () => {
  // 2026-08-04 実測：38件が逐語ブロックを持ちながら「未核对」と出ていた。
  // ✅ を持つのは 07-20 頃の retrofit ノートだけで、確認の有無ではなく世代の差だった。
  assert.equal(
    detectVerification("## 必須要件（求人原文・逐語）\n```\n・Spark 経験\n```"),
    "verified",
  );
  assert.equal(detectVerification("## ✅ 原文核対済み"), "verified");
  assert.equal(detectVerification("## 経緯\n応募した"), "unchecked");
});

test("核対判定：⚠️ と「未検証」はリスク側なので逐語ブロックがあっても要確認に倒す", () => {
  // 古い「確認済」と新しい「要確認」が同居した時に後者を勝たせる。
  const content = "## 必須要件（求人原文・逐語）\n```\n・Spark\n```\n## ⚠️ 語学欄が未取得";
  assert.equal(detectVerification(content), "warned");
  assert.equal(detectVerification("## 必須要件（求人原文・逐語）\n未検証の項目あり"), "warned");
});

test("完成度：過ぎた next_event_at は進行中の案件でだけ指摘する", () => {
  const stale = auditJobCaseCompleteness(
    { ...valid, status: "面接中", rating: 8, next_event_at: "2026-08-01 10:00" },
    complete,
    { today: "2026-08-04" },
  );
  assert.ok(stale.some((w) => /2026-08-01 が過ぎている/u.test(w)));

  const future = auditJobCaseCompleteness(
    { ...valid, status: "面接中", rating: 8, next_event_at: "2026-08-10 10:00" },
    complete,
    { today: "2026-08-04" },
  );
  assert.deepEqual(future, []);
});
