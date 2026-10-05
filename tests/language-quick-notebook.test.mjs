import assert from "node:assert/strict";
import test from "node:test";
import { stableId } from "../lib/dojo/utils.ts";
import { normalizeQuickAnswer } from "../lib/language/quick-text.ts";
import { buildQuickPool, completeMisreading, parseVocabNotebook } from "../lib/language/quick-items.ts";

// 全部虚构内容：表格结构仿单語文法帳，词条与备注是测试自编的。
const PATH = "20_求職/_素材/単語文法帳.md";
const NOTEBOOK = `---
type: material
---
# 単語・文法帳

## A. 中国語式の日本語 → 自然な日本語

| ✗ 出やすい言い方 | ✓ 自然な日本語 | 中文 |
|---|---|---|
| 拉通する | すり合わせる／調整する | 拉通 |
| 工程（＝engineering の意で） | エンジニアリング | 工程 |

## B-1. エージェント用語

| 表記 | かな | 中文 | ★ |
|---|---|---|---|
| 求人票 | きゅうじんひょう | 招聘票 | ★ |
| エージェント／リクルーター | ー | 猎头顾问 | ★★ |
| 一次面接／最終面接 | いちじ／さいしゅうめんせつ | 一面/终面 | |

## B-2. 面接用語（列の順番を入れ替えたテーブル）

| 中文 | ★ | かな | 表記 |
|---|---|---|---|
| 反问环节 | ★ | ぎゃくしつもん | 逆質問 |

## C. カタカナ発音

| 表記 | 読み | ★ |
|---|---|---|
| Kafka | カフカ | ★ |
| パイプライン | ー | ★ |
| 冪等 | べきとう | ★（「べきどう」✗） |

## D. 敬語

| 表記 | かな | 用途 |
|---|---|---|
| 恐れ入りますが | おそれいりますが | 请求前缀 |
| 差し支えなければ | さしつかえなければ | 提问缓冲 ★ |

## E. 本人事実（読まない）

| 表記 | かな | 中文 |
|---|---|---|
| 架空資格 | かくうしかく | 虚构资格 ★ |

## F. 訓読みの動詞

| 表記 | かな | 中文 |
|---|---|---|
| 担う | になう | 承担 ★ |

## G. 数字の読み方

| 数字 | 読み | ★ |
|---|---|---|
| 99件 | きゅうじゅうきゅうけん | ★★ |
| 約9冊 | やくきゅうさつ | ★（「きゅうさつ」。きゅさつ✗） |
| 7キロ | ななきろ | ★（[[架空ノート]]参照・**例** 2026-01-01 確認） |
| 謎の数 | ー | ★ |

## H. 構文の型

- **結論（けつろん）から申（もう）し上（あ）げますと、〜です。** ★★（先に言い切る）
- **〜と理解（りかい）しております。** ★

## Z. 未知の小節

| 表記 | かな | 中文 |
|---|---|---|
| 謎語 | なぞご | 谜语 |
`;

// 本人 2026-10-05 拍板 G 表（实绩数字读法）进快练、只考读音（A6-14）：原用例断言 G 表不产出条目、跳过 3 个小节，
// 规则变了，改成「八张表都解析，只有 E 与未知小节不读」。
test("八张表都解析，E 与未知小节不产出任何条目", () => {
  const { items, skipped } = parseVocabNotebook(NOTEBOOK, PATH);
  const tables = new Set(items.map((item) => item.pattern));
  assert.deepEqual([...tables].sort(), ["A", "B-1", "B-2", "C", "D", "F", "G", "H"]);
  const surfaces = items.map((item) => item.ja);
  for (const forbidden of ["架空資格", "謎語"]) {
    assert.ok(!surfaces.includes(forbidden), `${forbidden} 不应出现`);
  }
  assert.equal(skipped.notebook_section, 2, "E、Z 两个小节被跳过");
  assert.equal(items.every((item) => item.source === "notebook"), true);
});

test("按表头名取列：列序调换的 B-2 仍能读对表記、かな、中文", () => {
  const { items } = parseVocabNotebook(NOTEBOOK, PATH);
  const item = items.find((value) => value.pattern === "B-2");
  assert.equal(item.ja, "逆質問");
  assert.equal(item.reading, "ぎゃくしつもん");
  assert.equal(item.meaning, "反问环节");
  assert.equal(item.stars, 1);
  assert.equal(item.group, "nb_term");
});

test("かな「ー」＝无读音；C 表無読音的行跳过；表記多段时缩写注音不当完整读音", () => {
  const { items, skipped } = parseVocabNotebook(NOTEBOOK, PATH);
  const agent = items.find((value) => value.ja === "エージェント／リクルーター");
  assert.equal(agent.reading, "");
  assert.deepEqual(agent.jaAlts, ["エージェント／リクルーター", "エージェント", "リクルーター"]);
  assert.ok(!items.some((value) => value.ja === "パイプライン"));
  assert.equal(skipped.notebook_no_reading, 2, "C 表与 G 表各一行没有读音");
  const rounds = items.find((value) => value.ja === "一次面接／最終面接");
  assert.equal(rounds.reading, "");
  assert.match(rounds.note, /よみ：いちじ／さいしゅうめんせつ/u);
});

test("★ 计数与备注：★★ 记 2，★（注）的注进 note，用途/中文里的 ★ 被剥掉", () => {
  const { items } = parseVocabNotebook(NOTEBOOK, PATH);
  const byJa = new Map(items.map((value) => [value.ja, value]));
  assert.equal(byJa.get("エージェント／リクルーター").stars, 2);
  assert.equal(byJa.get("求人票").stars, 1);
  assert.equal(byJa.get("一次面接／最終面接").stars, 0);
  assert.equal(byJa.get("冪等").note, "「べきどう」✗");
  assert.equal(byJa.get("差し支えなければ").meaning, "提问缓冲");
  assert.equal(byJa.get("差し支えなければ").stars, 1);
  assert.equal(byJa.get("担う").meaning, "承担");
  assert.equal(byJa.get("求人票").priority, 80);
});

test("A 表：✗ 去括注作错形，✓ 按／切成可接受形，中文作释义", () => {
  const { items } = parseVocabNotebook(NOTEBOOK, PATH);
  const calque = items.find((value) => value.patch?.wrong === "拉通する");
  assert.equal(calque.group, "nb_calque");
  assert.equal(calque.meaning, "拉通");
  assert.deepEqual(calque.patch.fixes, ["すり合わせる", "調整する"]);
  assert.ok(calque.jaAlts.includes("調整する"));
  const engineering = items.find((value) => value.patch?.wrong === "工程");
  assert.equal(engineering.note, "＝engineering の意で");
});

test("H 表：去 ruby 得句型，ruby 换成假名得读音，括注进 note", () => {
  const { items } = parseVocabNotebook(NOTEBOOK, PATH);
  const pattern = items.find((value) => value.pattern === "H" && value.stars === 2);
  assert.equal(pattern.ja, "結論から申し上げますと、〜です。");
  assert.equal(pattern.reading, "けつろんからもうしあげますと、〜です。");
  assert.equal(pattern.note, "先に言い切る");
  assert.equal(pattern.hasSlot, true);
  assert.equal(pattern.group, "nb_pattern");
});

test("ID 稳定：nb_ + hash(表|归一化键)，只看键，不随其它列变化", () => {
  const { items } = parseVocabNotebook(NOTEBOOK, PATH);
  const term = items.find((value) => value.ja === "求人票");
  assert.equal(term.id, stableId("nb", `B-1|${normalizeQuickAnswer("求人票")}`));
  const calque = items.find((value) => value.patch?.wrong === "工程");
  assert.equal(calque.id, stableId("nb", `A|${normalizeQuickAnswer("工程")}`));
  const pattern = items.find((value) => value.ja === "〜と理解しております。");
  assert.equal(pattern.id, stableId("nb", `H|${normalizeQuickAnswer("〜と理解しております。")}`));

  const edited = NOTEBOOK.replace("| 求人票 | きゅうじんひょう | 招聘票 | ★ |", "| 求人票 | きゅうじんひょう | 职位说明 | |");
  const again = parseVocabNotebook(edited, PATH).items.find((value) => value.ja === "求人票");
  assert.equal(again.id, term.id, "改释义与 ★ 不改 ID");
  assert.equal(new Set(items.map((value) => value.id)).size, items.length, "ID 互不相同");
});

test("buildQuickPool：没有课程也能只用単語文法帳组题库，并报告解析条数", () => {
  const pool = buildQuickPool(undefined, { path: PATH, content: NOTEBOOK });
  assert.equal(pool.notebookParsed, pool.items.length);
  assert.ok(pool.items.length >= 10);
  assert.equal(pool.excludedJaMeaning, 0);
  assert.equal(pool.items[0].evidence[0].label.startsWith("単語文法帳 · "), true);
});

test("G 表：表記列叫「数字」，只有读音没有中文；★ 注进 note（链接与加粗只留文字），✗ 误读补成完整读音", () => {
  const { items } = parseVocabNotebook(NOTEBOOK, PATH);
  const numbers = items.filter((item) => item.pattern === "G");
  assert.deepEqual(numbers.map((item) => item.ja), ["99件", "約9冊", "7キロ"]);
  assert.ok(numbers.every((item) => item.group === "nb_number" && item.meaning === ""));
  const nine = numbers.find((item) => item.ja === "約9冊");
  assert.equal(nine.reading, "やくきゅうさつ");
  assert.equal(nine.note, "「きゅうさつ」。きゅさつ✗");
  assert.deepEqual(nine.misreadings, ["やくきゅさつ"], "片段「きゅさつ」替换掉正解里最像的「きゅうさつ」");
  assert.equal(numbers.find((item) => item.ja === "7キロ").note, "架空ノート参照・例 2026-01-01 確認");
  assert.equal(numbers.find((item) => item.ja === "99件").stars, 2);
  const kanji = items.find((item) => item.ja === "冪等");
  assert.deepEqual(kanji.misreadings, ["べきどう"], "C 表的 ✗ 同样当误读");
  assert.equal(items.find((item) => item.ja === "求人票").misreadings, undefined);
});

test("completeMisreading：只写出错那一段时在正解里找最像的一段替换；差太远或与正解相同不补", () => {
  assert.equal(completeMisreading("やくななねん", "さんぜん"), null, "差太远（超过片段长度三分之一）不补");
  assert.equal(completeMisreading("ろっぴゃくえん", "ろくぴゃく"), "ろくぴゃくえん");
  assert.equal(completeMisreading("やくよんほん", "よほん"), "やくよほん", "首尾对得上的「よんほん」优先于「んほん」，也不换成「よん」");
  assert.equal(completeMisreading("ごかげつ", "ごげつ"), "ごげつ");
  assert.equal(completeMisreading("ティーエス", "ティエス"), "ティエス");
  assert.equal(completeMisreading("やくななねん", "やくななねん"), null);
  assert.equal(completeMisreading("", "よん"), null);
});

test("buildQuickPool：notebookParsed 含 G 表条数", () => {
  const pool = buildQuickPool(undefined, { path: PATH, content: NOTEBOOK });
  assert.equal(pool.items.filter((item) => item.group === "nb_number").length, 3);
  assert.equal(pool.notebookParsed, pool.items.length);
});
