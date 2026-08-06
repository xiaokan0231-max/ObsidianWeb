import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPrepKillQuestions,
  cardIdFromRef,
  collectPrepExternalLinks,
  extractPrepKillMap,
  extractPrepTalentMap,
  findInterviewPrepDocs,
  groupPrepSections,
  PREP_KILL_MAP_LABEL,
  PREP_TALENT_LABEL,
  parseInline,
  parseInterviewPrepDoc,
  prepBlockText,
  prepInlineText,
} from "../lib/interview-prep-doc.ts";

function note(path, frontmatter, content) {
  return {
    path,
    stat: { ctime: 0, mtime: 0, size: content.length },
    tags: [],
    frontmatter,
    content,
  };
}

function prepNote(content, frontmatter = {}) {
  return note(
    "20_求職/テスト社/面接準備_2026-08-01.md",
    { type: "interview-prep", company: "テスト社", date: "2026-08-01", ...frontmatter },
    content,
  );
}

const PHRASES = note(
  "20_求職/_素材/当日フレーズ集.md",
  { type: "material" },
  `---
type: material
---
# 当日フレーズ集

## A. オンライン

【あなた】**お世話（せわ）になっております。**

## B. 対面

- ノック3回
`,
);

const SCRIPT = note(
  "20_求職/_素材/転職理由台本.md",
  { type: "material" },
  `---
type: material
---
# 転職理由台本

> ⚠️ 本文件含【内部】层。

## 音読用スクリプト

### 30秒版

【あなた】社数（しゃすう）が多いのは事実です。

## 逐社一句

| # | 社名 | 【台本】 | 【内部・言わない】 |
|---|---|---|---|
| 1 | A社 | 経営が不安定 | 給与遅配 |
`,
);

test("章ラベルは番号を残し、括弧・読点以降を落として核だけにする", () => {
  const label = (title) =>
    parseInterviewPrepDoc(prepNote(`# T\n\n## ${title}\n\n本文\n`), []).sections[0].navLabel;
  assert.equal(label("３．求人の正体と、そこから逆算した戦い方"), "３．求人の正体と");
  assert.equal(label("１．速査（面談前5分でここだけ）"), "１．速査");
  // 途中で切れたラベルは読めないので、区切り（読点・中黒・空白・括弧）で切ってから丸める
  assert.equal(label("１２．NG集と暗記 one-liner"), "１２．NG集と暗記");
  assert.equal(label("８．転職理由・転職回数の台本"), "８．転職理由");
  assert.equal(label("⭐ 音読用スクリプト（注音つき）"), "音読用スクリプト");
  // 区切りが無く長すぎる時だけ省略記号をつける
  assert.equal(label("７．こちらから聞くことのすべて"), "７．こちらから聞くこ…");
});

test("素テキスト化は検索用にルビの親字と表のセルを拾う", () => {
  const doc = parseInterviewPrepDoc(
    prepNote(`# T

## １．速査

冪等（べきとう）な書き込み

| 表記 | 読み |
|---|---|
| Flink | フリンク |
`),
    [],
  );
  const text = doc.sections[0].blocks.map(prepBlockText).join(" ");
  assert.match(text, /冪等/, "ルビの親字（探す語はこちら側）");
  assert.doesNotMatch(text, /べきとう/, "読みは検索対象にしない");
  assert.match(text, /Flink/, "表のセルも拾う");
  assert.match(text, /フリンク/);
});

test("ruby 注音は base と reading に分かれ、補足の括弧は素のテキストのまま残る", () => {
  const nodes = parseInline("約4年（やくよねん）はCTR約300%（やくさんびゃくパーセント）です（比較群あり）");
  assert.deepEqual(nodes[0], { kind: "ruby", base: "約4年", reading: "やくよねん" });
  assert.deepEqual(nodes[2], {
    kind: "ruby",
    base: "CTR約300%",
    reading: "やくさんびゃくパーセント",
  });
  const flat = nodes.map((item) => (item.kind === "text" ? item.text : `<${item.kind}>`)).join("");
  assert.match(flat, /（比較群あり）/, "仮名以外を含む括弧はルビにしない");
});

test("太字の中のルビも解析され、[[…]] は出典表示になる", () => {
  const nodes = parseInline("**通算（つうさん）で約4年**は [[技術スタック]] が正本");
  assert.equal(nodes[0].kind, "strong");
  assert.deepEqual(nodes[0].children[0], { kind: "ruby", base: "通算", reading: "つうさん" });
  const ref = nodes.find((item) => item.kind === "ref");
  assert.deepEqual(ref, { kind: "ref", text: "技術スタック", target: "技術スタック", section: "" });
});

test("[[ノート#節]] は表示テキストと飛び先の両方を持つ", () => {
  assert.deepEqual(parseInline("[[面接標準回答集#p27 在留資格]]").at(0), {
    kind: "ref",
    text: "p27 在留資格",
    target: "面接標準回答集",
    section: "p27 在留資格",
  });
  assert.deepEqual(parseInline("[[面接標準回答集#p27 在留資格|在留の台本]]").at(0), {
    kind: "ref",
    text: "在留の台本",
    target: "面接標準回答集",
    section: "p27 在留資格",
  });
});

test("回答库のカード参照からだけ カードID を取り出す（他ノートは Obsidian を開く）", () => {
  assert.equal(cardIdFromRef({ target: "面接標準回答集", section: "p27 在留資格と就労可能時期" }), "p27");
  assert.equal(cardIdFromRef({ target: "面接標準回答集", section: "" }), null, "節指定なしはカードではない");
  assert.equal(cardIdFromRef({ target: "技術スタック", section: "経験年数の基準" }), null);
  assert.equal(cardIdFromRef({ target: "面接標準回答集", section: "未統合の差分" }), null);
});

test("【あなた】【面接官】▷ ▶ > と表・リストがブロックに分かれる", () => {
  const doc = parseInterviewPrepDoc(
    prepNote(`# テスト社 面談準備

## １．速査

| 項目 | 内容 |
|---|---|
| 日時 | 8月1日 |

【面接官】**転職回数が多いですね。**
【あなた】社数（しゃすう）は多いです。
▷ 事実として認めてから軸の話へ。
▶ 追撃は §8 を見る。
> ⚠️ 自分から切り出さない。

- 一つ目
- 二つ目
`),
    [],
  );
  const [section] = doc.sections;
  assert.equal(section.title, "１．速査");
  // 節番号は残す（12節あるので「何番目か」が一番速い手がかり）。括弧・読点以降は落とす
  assert.equal(section.navLabel, "１．速査");
  const kinds = section.blocks.map((block) => block.kind);
  assert.deepEqual(kinds, ["table", "say", "say", "note", "note", "note", "list"]);
  const [table, interviewer, you, zh, follow, tip, list] = section.blocks;
  assert.deepEqual(table.head[0][0], { kind: "text", text: "項目" });
  assert.equal(table.rows.length, 1);
  assert.equal(interviewer.speaker, "interviewer");
  assert.equal(you.speaker, "you");
  assert.equal(zh.tone, "zh");
  assert.equal(follow.tone, "follow");
  assert.equal(tip.tone, "tip");
  assert.equal(list.items.length, 2);
  assert.equal(list.ordered, false);
});

test("番号付きリストは順序を保ち、箇条書きと混ざらない", () => {
  const doc = parseInterviewPrepDoc(
    prepNote(`# テスト社

## ７．逆質問

1. 一問目
2. 二問目

- 補足
`),
    [],
  );
  const lists = doc.sections[0].blocks.filter((block) => block.kind === "list");
  assert.deepEqual(
    lists.map((list) => [list.ordered, list.start, list.items.length]),
    [[true, 1, 2], [false, undefined, 1]],
  );
});

test("会社研究リンク集を用途付きで抽出し、★と重複を保持しない", () => {
  const doc = parseInterviewPrepDoc(
    prepNote(`# テスト社

## １．速査

[Teams](https://teams.example/meeting)

## １１．会社研究リンク集

### ① 求人・採用

- [求人](https://example.com/job)

### ② 公式

- ⭐ [公式発表](https://example.com/news)
- [重複](https://example.com/news)
`),
    [],
  );
  assert.deepEqual(collectPrepExternalLinks(doc.sections), [
    { label: "求人", href: "https://example.com/job", group: "求人・採用", starred: false },
    { label: "公式発表", href: "https://example.com/news", group: "公式", starred: true },
  ]);
  assert.deepEqual(doc.externalLinks, collectPrepExternalLinks(doc.sections));
});

test("12節は用途別の6主模块に畳み、各節を一度だけ所属させる", () => {
  const headings = [
    "速査",
    "勝ち筋と地雷",
    "求人の正体",
    "面接官の人物像",
    "自己紹介",
    "想定問答",
    "こちらから聞くこと",
    "転職理由",
    "当日フレーズ集",
    "単語・文法帳",
    "会社研究リンク集",
    "NG集",
  ].map((title, index) => `## ${index + 1}．${title}\n\n本文`);
  const doc = parseInterviewPrepDoc(prepNote(`# テスト社\n\n${headings.join("\n\n")}\n`), []);
  const groups = groupPrepSections(doc.sections);
  assert.deepEqual(
    groups.map((group) => [group.label, group.sectionIndexes]),
    [
      ["临战速查", [0]],
      ["公司与岗位", [1, 2, 3, 10]],
      ["自我叙事", [4, 7]],
      ["想定问答", [5]],
      ["反向提问", [6]],
      ["当日工具", [8, 9, 11]],
    ],
  );
  assert.deepEqual(groups.flatMap((group) => group.sectionIndexes).sort((a, b) => a - b), [...Array(12).keys()]);
});

// §6 の小節を第7主模块として出す。vault は12節契約のままにしたいので、
// 13個目の ## を作らず表示層だけで昇格させる——この分離が壊れると Web と HTML がずれる。
test("殺傷質問7題は §6 の小節から仮想節として切り出せる", () => {
  const doc = parseInterviewPrepDoc(
    prepNote(`# テスト社

## ６．想定問答

### 殺傷質問7題・当日の型

1. 転職理由 → §8
2. 年収 → p19

### 今回持ち込む共通題

- p17

## ７．逆質問

- 一問目
`),
    [],
  );
  const killMap = extractPrepKillMap(doc.sections);
  assert.equal(killMap.navLabel, PREP_KILL_MAP_LABEL);
  assert.match(killMap.title, /^殺傷質問7題/);
  // 見出しの次から、次の ### 手前までだけを持つ（共通題を巻き込まない）
  const text = killMap.blocks.map(prepBlockText).join("\n");
  assert.match(text, /転職理由/);
  assert.doesNotMatch(text, /今回持ち込む共通題|p17/);
  // §6 側は削らない。第7模块はあくまで写し
  const six = doc.sections.find((section) => section.title.startsWith("６"));
  assert.match(six.blocks.map(prepBlockText).join("\n"), /転職理由/);
});

// 索引だけでは当日7回ジャンプすることになる。答案は各所の正本から参照で引き込み、
// コピーは作らない——コピーすると口径が二重管理になり、必ず片方だけ直される。
test("殺傷質問は問い・答案・解読を1枚に組み、答案は正本からの参照で埋める", () => {
  const doc = parseInterviewPrepDoc(
    prepNote(`# テスト社

## ６．想定問答

### 殺傷質問7題・当日の型

#### 希望年収を教えてください
- 出題:: T4・7場中3場
- 答案:: Q. 希望年収は？
- 地雷:: 自分から金額を先に出す
▷ 低アンカーが直近の失点。

#### 答案が見つからない題
- 答案:: Q. 存在しない見出し
▷ 解読だけはある。

### 会社特化の質問

#### Q. 希望年収は？（既定・これだけで止める）

【あなた】**御社（おんしゃ）の規定（きてい）に合わせてご相談させてください。**

##### 「レンジのどのあたり」と押された時だけ

【あなた】**レンジの中央以上を希望しております。**

## ８．転職理由

本文
`),
    [],
  );
  const questions = buildPrepKillQuestions(doc.sections);
  assert.equal(questions.length, 2);

  const [salary, missing] = questions;
  assert.equal(salary.ask, "希望年収を教えてください");
  assert.equal(salary.meta, "T4・7場中3場");
  assert.equal(salary.resolved, true);
  // 答案は台詞だけ。ロケータ行そのものは落とす（カード見出しが既に問いを出している）
  assert.match(salary.answer.map(prepBlockText).join("\n"), /御社の規定に合わせて/);
  assert.doesNotMatch(salary.answer.map(prepBlockText).join("\n"), /Q\. 希望年収は？/);
  // 「〜と押された時だけ」以降は追問層へ回す
  assert.match(salary.followUp.map(prepBlockText).join("\n"), /レンジの中央以上/);
  assert.doesNotMatch(salary.answer.map(prepBlockText).join("\n"), /レンジの中央以上/);
  assert.match(prepInlineText(salary.mine), /自分から金額を先に出す/);
  assert.match(prepInlineText(salary.why[0]), /低アンカー/);

  // 参照が外れた題は黙って空にせず、resolved=false で拾えるようにする
  assert.equal(missing.resolved, false);
  assert.equal(missing.source, "Q. 存在しない見出し");
  assert.match(prepInlineText(missing.why[0]), /解読だけはある/);
});

test("殺傷質問7題の小節が無い準備稿では第7主模块を出さない", () => {
  const doc = parseInterviewPrepDoc(
    prepNote(`# テスト社\n\n## ６．想定問答\n\n### 今回持ち込む共通題\n\n- p17\n`),
    [],
  );
  assert.equal(extractPrepKillMap(doc.sections), null);
});

// 人材育成も杀伤7题と同じ仕組みで第8主模块に昇格させる。責任者面接の中心題を
// 当日ワンタップで開くための表示層ショートカットで、正本は §6 の小節のまま。
test("人材育成の小節は §6 から第8主模块として切り出せる", () => {
  const doc = parseInterviewPrepDoc(
    prepNote(`# テスト社

## ６．想定問答

### 殺傷質問7題・当日の型

1. 転職理由 → §8

### 人材育成（育成方針を問われたら）

#### Q. 人材育成で大切にしていることは何ですか

【あなた】**適性（てきせい）を見極（みきわ）めます。**

## ７．逆質問

- 一問目
`),
    [],
  );
  const talent = extractPrepTalentMap(doc.sections);
  assert.equal(talent.navLabel, PREP_TALENT_LABEL);
  assert.match(talent.title, /^人材育成/);
  const text = talent.blocks.map(prepBlockText).join("\n");
  assert.match(text, /適性を見極めます/);
  assert.doesNotMatch(text, /転職理由/);
  // 前にある杀伤7题の切り出しは、人材育成の小節を巻き込まない
  const killMap = extractPrepKillMap(doc.sections);
  assert.doesNotMatch(killMap.blocks.map(prepBlockText).join("\n"), /適性を見極めます/);
  // §6 側は削らない。第8模块はあくまで写し
  const six = doc.sections.find((section) => section.title.startsWith("６"));
  assert.match(six.blocks.map(prepBlockText).join("\n"), /適性を見極めます/);
});

test("人材育成の小節が無い準備稿では第8主模块を出さない", () => {
  const doc = parseInterviewPrepDoc(
    prepNote(`# テスト社\n\n## ６．想定問答\n\n### 今回持ち込む共通題\n\n- p17\n`),
    [],
  );
  assert.equal(extractPrepTalentMap(doc.sections), null);
});

test("表のセル内の [[ノート#節\\|別名]] は途中で切れずリンクとして残る", () => {
  // Obsidian は表内の別名指定に `\|` を要求する。素の split("|") で切ると
  // カード参照が壊れて「回答库へ飛べない表」になる（実際に踏んだ）
  const doc = parseInterviewPrepDoc(
    prepNote(`# テスト社

## ６．想定問答

| カード | なぜ今回必要か |
|---|---|
| [[面接標準回答集#p09 日语环境下的客户折衝\\|p09]] 顧客折衝 | 必須要件 |
`),
    [],
  );
  const table = doc.sections[0].blocks.find((block) => block.kind === "table");
  assert.equal(table.rows.length, 1, "セルが増えていない（途中で切れていない）");
  assert.equal(table.rows[0].length, 2);
  const ref = table.rows[0][0].find((node) => node.kind === "ref");
  assert.deepEqual(ref, {
    kind: "ref",
    text: "p09",
    target: "面接標準回答集",
    section: "p09 日语环境下的客户折衝",
  });
  assert.equal(cardIdFromRef(ref), "p09", "カードへ飛べる");
});

test("![[ノート]] は本文を取り込み、見出しは埋め込み先の1つ下にぶら下がる", () => {
  const doc = parseInterviewPrepDoc(
    prepNote(`# テスト社 面談準備

## ９．当日フレーズ集

![[当日フレーズ集]]

## １０．次の節
`),
    [PHRASES],
  );
  assert.equal(doc.sections.length, 2, "埋め込んだ ## が新しい章にならない");
  const [phrases] = doc.sections;
  assert.equal(phrases.title, "９．当日フレーズ集");
  const headings = phrases.blocks.filter((block) => block.kind === "heading");
  assert.deepEqual(
    headings.map((block) => block.inline[0].text),
    ["A. オンライン", "B. 対面"],
  );
  // 埋め込み先が ## なので、取り込んだ ## はその下の ###（小見出し）になる。
  // build_interview_html.py の h3.big と同じ扱い
  assert.ok(headings.every((block) => block.level === 3), "## は ### に下がる");
  assert.ok(phrases.blocks.some((block) => block.kind === "say" && block.speaker === "you"));
  assert.deepEqual(doc.embeds, [
    { raw: "![[当日フレーズ集]]", target: "当日フレーズ集", section: "", resolved: true },
  ]);
});

test("節指定の埋め込みはその節だけを取り込む（内外二層ノートの内部層を持ち込まない）", () => {
  const doc = parseInterviewPrepDoc(
    prepNote(`# テスト社 面談準備

## ８．転職理由

![[転職理由台本#音読用スクリプト]]
`),
    [SCRIPT],
  );
  const rendered = JSON.stringify(doc.sections);
  assert.match(rendered, /社数/, "指定した節は取り込まれる");
  assert.doesNotMatch(rendered, /内部/, "内部層の節は取り込まれない");
  assert.doesNotMatch(rendered, /給与遅配/, "逐社一句の内部列も入らない");
  assert.equal(doc.embeds[0].resolved, true);
});

test("解決できない埋め込みは黙って消えず、警告ブロックとして残る", () => {
  const missingNote = parseInterviewPrepDoc(
    prepNote(`# テスト社

## ９．フレーズ

![[存在しないノート]]
`),
    [],
  );
  assert.equal(missingNote.embeds[0].resolved, false);
  const warning = missingNote.sections[0].blocks.find((block) => block.kind === "note");
  assert.match(JSON.stringify(warning), /解決できません/);

  const missingSection = parseInterviewPrepDoc(
    prepNote(`# テスト社

## ８．転職理由

![[転職理由台本#無い節]]
`),
    [SCRIPT],
  );
  assert.equal(missingSection.embeds[0].resolved, false);
  assert.match(JSON.stringify(missingSection.sections[0].blocks), /という節がありません/);
});

test("作業メモ（HTML コメント）は成果物に出ず、その中の埋め込み例も展開しない", () => {
  const doc = parseInterviewPrepDoc(
    prepNote(`# テスト社
<!--
改修マップ：![[当日フレーズ集]] は §9 で埋め込む
-->

## １．速査

本文だけが残る。
`),
    [PHRASES],
  );
  assert.deepEqual(doc.embeds, [], "コメント内の例は埋め込みとして数えない");
  const rendered = JSON.stringify(doc.sections);
  assert.doesNotMatch(rendered, /改修マップ/);
  assert.doesNotMatch(rendered, /お世話/);
});

test("frontmatter から会社・日付・面接官を取り、interview-prep 以外は解析しない", () => {
  const doc = parseInterviewPrepDoc(
    prepNote("# テスト社\n\n## １．速査\n\n本文\n", {
      round: "最終面接",
      format: "対面",
      interviewers: "佐藤様・本部長",
      case: "[[テスト社_データエンジニア|案件正本]]",
      session_id: "test-data-s03",
      session_order: 3,
      session_status: "scheduled",
    }),
    [],
  );
  assert.equal(doc.company, "テスト社");
  assert.equal(doc.round, "最終面接");
  assert.equal(doc.interviewers, "佐藤様・本部長");
  assert.equal(doc.caseLink, "テスト社_データエンジニア");
  assert.equal(doc.sessionOrder, 3);
  assert.equal(doc.sessionStatus, "scheduled");
  assert.equal(parseInterviewPrepDoc(PHRASES, []), null);
});

test("準備ドキュメントは日付の新しい順に並ぶ", () => {
  const notes = [
    prepNote("# 古い\n\n## １．速査\n\n本文\n", { date: "2026-07-01" }),
    prepNote("# 当日\n\n## １．速査\n\n本文\n", { date: "2026-08-01" }),
    prepNote("# 先\n\n## １．速査\n\n本文\n", { date: "2026-09-09" }),
  ];
  const docs = findInterviewPrepDocs(notes);
  assert.deepEqual(docs.map((doc) => doc.date), ["2026-09-09", "2026-08-01", "2026-07-01"]);
});
