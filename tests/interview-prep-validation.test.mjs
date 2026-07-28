import assert from "node:assert/strict";
import test from "node:test";
import {
  companyMotivationIssues,
  findCompanyMotivationHeading,
} from "../lib/interview-prep-validation.mjs";

function prep({ quick = true, question = true, short = true, answer, source = true } = {}) {
  const spoken =
    answer ??
    "【あなた】**御社がデータ事業を始める点に魅力を感じました。**\n" +
      "【あなた】**私はデータ基盤を約8年作ってきました。**\n" +
      "【あなた】**その経験で新事業に貢献したいです。**";
  return `---
type: interview-prep
---
# テスト社

## １．速査

| 使う場面 | 最初の一言 |
|---|---|
${quick ? "| 志望動機 | **データ事業の新設 × 約8年の経験** |" : ""}

## ６．想定問答

${question ? "#### Q. 志望動機／なぜ当社に興味を持たれたのですか" : ""}

${short ? "##### 20秒版（既定）" : ""}

${spoken}

${source ? "▷ 根拠: [公式発表](https://example.com/news/data-business)" : ""}

![[面接標準回答集#p11 志望动机：为什么是这家公司]]
`;
}

test("会社固有の速査・20秒回答・公式根拠が揃えば通る", () => {
  assert.deepEqual(companyMotivationIssues(prep()), []);
});

test("Web shortcut 用に §6 の会社固有 H4 見出しだけを返す", () => {
  assert.equal(
    findCompanyMotivationHeading(prep()),
    "Q. 志望動機／なぜ当社に興味を持たれたのですか",
  );
  assert.equal(
    findCompanyMotivationHeading(prep().replace("## ６．想定問答", "## ５．自己紹介")),
    null,
  );
});

test("§1 のキーワードだけ、または p11 の参照だけでは完成扱いにしない", () => {
  const onlyQuick = prep({ question: false, short: false, answer: "", source: false });
  assert.match(companyMotivationIssues(onlyQuick).join("\n"), /会社特化回答が無い/);

  const onlyP11 = prep({ quick: false, question: false, short: false, answer: "", source: false });
  const issues = companyMotivationIssues(onlyP11).join("\n");
  assert.match(issues, /面談直前の一枚/);
  assert.match(issues, /会社特化回答が無い/);
});

test("志望動機の朗読稿が §6 の外にあっても完成扱いにしない", () => {
  const misplaced = prep().replace("## ６．想定問答", "## ５．自己紹介");
  assert.match(companyMotivationIssues(misplaced).join("\n"), /§6/);
});

test("20秒見出し・本人の台詞・公式根拠の欠落を個別に検出する", () => {
  assert.match(companyMotivationIssues(prep({ short: false })).join("\n"), /20秒版/);
  assert.match(companyMotivationIssues(prep({ answer: "説明だけです。" })).join("\n"), /【あなた】/);
  assert.match(companyMotivationIssues(prep({ source: false })).join("\n"), /公式の直接ページ/);
});

test("占位符と、1句または4句の長さを通さない", () => {
  assert.match(
    companyMotivationIssues(prep({ answer: "【あなた】**{{会社固有の回答}}。{{経験}}。**" })).join("\n"),
    /置換済み/,
  );
  assert.match(
    companyMotivationIssues(prep({ answer: "【あなた】**一文だけです。**" })).join("\n"),
    /2〜3句/,
  );
  assert.match(
    companyMotivationIssues(
      prep({ answer: "【あなた】**一文目です。二文目です。三文目です。四文目です。**" }),
    ).join("\n"),
    /2〜3句/,
  );
});
