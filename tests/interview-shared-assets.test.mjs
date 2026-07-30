import assert from "node:assert/strict";
import test from "node:test";
import {
  companyMotivationAssetTarget,
  parseSharedAssetDocument,
} from "../lib/interview-shared-assets.ts";
import { prepBlockText } from "../lib/interview-prep-doc.ts";

function note(content) {
  return {
    path: "20_求職/_素材/共通資産.md",
    stat: { ctime: 0, mtime: 0, size: content.length },
    tags: [],
    frontmatter: { type: "material" },
    content,
  };
}

test("共通資産を H2 ごとの索引と本文に分ける", () => {
  const parsed = parseSharedAssetDocument(note(`---
type: material
---
# 自己紹介 音読台本

> 使い分けの説明。

## 60秒版

【あなた】約（やく）12年間（ねんかん）の経験です。

## 30秒版

【あなた】短い回答です。
`));

  assert.ok(parsed);
  assert.equal(parsed.title, "自己紹介 音読台本");
  assert.equal(parsed.sections.length, 2);
  assert.deepEqual(parsed.sections.map((section) => section.title), ["60秒版", "30秒版"]);
  assert.equal(parsed.intro.map(prepBlockText).join(""), "使い分けの説明。");
  assert.equal(parsed.sections[0].plainText, "約12年間の経験です。");
});

test("転職理由は指定した公開朗読区段の内側だけを返す", () => {
  const parsed = parseSharedAssetDocument(
    note(`# 転職理由台本

## 内部・絶対に外に出さない

給与遅配の詳細。

## ⭐ 音読用スクリプト

### 総論60秒版

【あなた】積み上げを大切にしています。

### 30秒版

【あなた】短い公開回答です。

## 逐社一句

内部の個社事情。
`),
    "⭐ 音読用スクリプト",
  );

  assert.ok(parsed);
  assert.equal(parsed.restrictedToSection, true);
  assert.deepEqual(parsed.sections.map((section) => section.title), ["総論60秒版", "30秒版"]);
  const visible = parsed.sections.map((section) => section.plainText).join("\n");
  assert.match(visible, /積み上げ/);
  assert.doesNotMatch(visible, /給与遅配|内部の個社事情/);
});

test("H2 が一つだけの長文は H3 を実用上の索引へ昇格する", () => {
  const parsed = parseSharedAssetDocument(note(`# 面接傾向

## 使い方

最初に読む。

### 五維スコア

推移。

### 反復タグ

繰り返し。
`));

  assert.ok(parsed);
  assert.deepEqual(
    parsed.sections.map((section) => section.title),
    ["使い方", "五維スコア", "反復タグ"],
  );
});

test("存在しない指定区段は null にして内部全文へフォールバックしない", () => {
  assert.equal(
    parseSharedAssetDocument(note("# 台本\n\n## 内部\n\n秘密\n"), "公開台本"),
    null,
  );
});

test("本場専属の志望動機は準備ノートの exact path と §6 H4 を開く", () => {
  const prepNote = {
    ...note(`# テスト社 面接準備

## ６．想定問答

#### Q. 志望動機／なぜ当社ですか（本社版）

##### 20秒版（既定）

【あなた】御社の新事業に興味を持ちました。私の経験を活かせます。ここで貢献したいです。

##### 追問されたら

【あなた】追加回答です。

#### Q. 次の質問

【あなた】ここは出さない。
`),
    path: "20_求職/テスト社/面接準備_2026-07-28.md",
    frontmatter: { type: "interview-prep" },
  };
  const target = companyMotivationAssetTarget({
    note: prepNote,
    title: "テスト社 面接準備",
    company: "テスト社",
    date: "2026-07-28",
    round: "",
    format: "",
    interviewers: "",
    caseLink: "",
    sections: [],
    embeds: [],
    externalLinks: [],
  });

  assert.ok(target);
  assert.equal(target.note, prepNote.path);
  assert.equal(target.scope, "round");
  assert.equal(target.section, "Q. 志望動機／なぜ当社ですか（本社版）");

  const parsed = parseSharedAssetDocument(prepNote, target.section);
  assert.ok(parsed);
  assert.equal(parsed.sections[0].title, "20秒版（既定）");
  const visible = parsed.sections.map((section) => section.plainText).join("\n");
  assert.match(visible, /新事業/);
  assert.doesNotMatch(visible, /次の質問|ここは出さない/);
});
