import assert from "node:assert/strict";
import test from "node:test";
import { QUICK_EMPTY } from "../lib/language/quick-types.ts";
import {
  cleanGoMeaning,
  clipContext,
  clipContextRange,
  dice,
  diffSpan,
  isKanjiOnly,
  meaningLanguage,
  normalizeQuickAnswer,
  seededShuffle,
  splitGoEntries,
  splitMeaningNotes,
} from "../lib/language/quick-text.ts";
import {
  buildQuickPool,
  parsePatch,
  quickItemsFromCurriculum,
  reliableReading,
} from "../lib/language/quick-items.ts";
import {
  acceptedAnswers,
  availableCardTypes,
  buildQuickCard,
  checkQuickCard,
  chooseCardType,
  createQuickIndex,
  gradeQuickAnswer,
  gradeQuickCard,
  isBinaryOnly,
  layerOf,
  mutateReading,
  particleOptions,
} from "../lib/language/quick-cards.ts";

// ── 虚构 fixture：句子、公司名与词条全部是测试自编的 ─────────────

const KEY = "2026-07-01|株式会社テスト|一次面接";
const PATH = "20_求職/株式会社テスト/2026-07-01_一次面接_整理稿.md";

function li(kind, id, values) {
  return {
    id,
    canonicalKey: id,
    kind,
    titleZh: "",
    targetJa: "",
    reading: "",
    meaningZh: "",
    promptZh: "",
    originalJa: "",
    correctedJa: "",
    pattern: "",
    sourceInterviewKeys: [KEY],
    evidence: [{ path: PATH, interviewKey: KEY, sentenceId: "s001", excerpt: values.originalJa || values.targetJa || "" }],
    factSensitive: false,
    factSourcePaths: [],
    basePriority: 60,
    strategyTags: [],
    ...values,
  };
}

function patchItem(id, wrong, corrected, original, pattern = "助詞") {
  const first = corrected.split("／")[0];
  return li("error_patch", id, {
    targetJa: `${wrong} → ${first}`,
    correctedJa: corrected,
    originalJa: original,
    meaningZh: `把「${wrong}」改为「${first}」`,
    pattern,
    evidence: [{ path: PATH, interviewKey: KEY, sentenceId: id, excerpt: `${original} → ${corrected}` }],
  });
}

const phrase = (id, targetJa, meaningZh, reading = "") =>
  li("interviewer_phrase", id, { targetJa, meaningZh, reading });

const CURRICULUM = {
  version: 2,
  generatedAt: "2026-10-01T00:00:00.000Z",
  sourceFingerprint: "src",
  sourceCount: 1,
  summaryZh: "",
  profile: { interviewCount: 1, learnerErrorCount: 0, reviewedBlockCount: 0, listeningGapCount: 0, staleReviewPaths: [], topIssues: [] },
  items: [
    patchItem("ep_particle", "資料を目を通す", "資料に目を通す", "毎朝、資料を目を通すようにしています。"),
    patchItem("ep_two", "それを", "それは／それが", "それを一番の課題だと考えました。"),
    patchItem("ep_delete", "大きいの会議室", "大きい会議室", "来週は大きいの会議室を予約しました。"),
    patchItem("ep_verb", "感じします", "感じます", "その仕事にやりがいを感じします。", "感じします"),
    patchItem("ep_kana", "だから", "なので／ですので", "まだ勉強中だから。", "文体"),
    patchItem("ep_long", "とても大切だと思っていることがあります", "重視している点があります", "仕事ではとても大切だと思っていることがあります。", "語彙"),
    patchItem("ep_fix_anchor", "足りないだと思います", "足りないと思います", "練習量はまだ足りないと思います。", "い形だと"),
    li("error_patch", "ep_deleted", { targetJa: "えっと → （削除）", correctedJa: "（削除）えっと", originalJa: "えっと、はい。", meaningZh: "删掉口头禅" }),
    li("error_patch", "ep_no_arrow", { targetJa: "いろいろ", correctedJa: "いろいろ（と）", originalJa: "いろいろがあります。", meaningZh: "使用更自然的表达" }),
    patchItem("ep_ellipsis", "会社が…関心がある", "会社に…関心がある", "その会社が昔から関心があるんです。"),
    phrase("ip_ok", "承知しました", "收到"),
    phrase("ip_ok2", "かしこまりました", "收到（更礼貌）"),
    phrase("ip_ask", "ご教示ください", "请教"),
    phrase("ip_visit", "伺う", "请教/拜访", "うかがう"),
    phrase("ip_plan", "段取り", "安排、步骤", "だんどり"),
    phrase("ip_outlook", "見通し", "前景、预期", "みとおし"),
    phrase("ip_early", "前倒し", "提前进行", "まえだおし"),
    phrase("ip_delay", "先送り", "推迟处理", "さきおくり"),
    phrase("ip_draft", "叩き台", "讨论用的初稿", "たたきだい"),
    phrase("ip_check", "確認", "核对"),
    phrase("ip_check2", "確認する", "进行核实"),
    phrase("ip_hours", "工数", "工时", "こうすう"),
    phrase("ip_req", "要件", "需求条件", "ようけん"),
    phrase("ip_slot1", "〜に関しては", "关于……"),
    phrase("ip_slot2", "〜という形で", "以……的形式"),
    phrase("ip_slot3", "〜次第", "一……就"),
    phrase("ip_slot4", "〜にあたって", "在……之际"),
    phrase("ip_partial", "全社展開", "推广到全公司", "てんかい"),
    phrase("ip_ja", "なるほど", "相手の話を受け止める相槌"),
    phrase("ip_transcript", "「試験」", "「施策」の転写"),
    phrase("ip_echo", "抽象的", "抽象的"),
    phrase("ip_noisy", "踏み込む", "深入（「文末」は転写）。再確認＝重新确认", "ふみこむ"),
    phrase("ip_broken", "こしゅうする）", "固执"),
    li("active_chunk", "ac_focus", { targetJa: "〜を重視しています", meaningZh: "表达自己重视的判断标准", pattern: "表达升级" }),
    li("active_chunk", "ac_generic", { targetJa: "〜を通じて", meaningZh: "在「自己紹介」中可直接调用的新表达", pattern: "表达升级" }),
    li("answer_strategy", "as_conclusion", { targetJa: "結論から申し上げます。", meaningZh: "先给结论，再补理由和例子", pattern: "no-conclusion-first" }),
    li("technical_term", "tt_kafka", { targetJa: "Kafka", meaningZh: "能识别并使用 Kafka" }),
    li("fact_anchor", "fa_number", { targetJa: "99件", meaningZh: "稳定表达已确认的数字", factSensitive: true }),
  ],
};

const NOTEBOOK = {
  path: "20_求職/_素材/単語文法帳.md",
  content: `# 単語・文法帳

## A. 中国語式の日本語 → 自然な日本語

| ✗ 出やすい言い方 | ✓ 自然な日本語 | 中文 |
|---|---|---|
| 拉通する | すり合わせる／調整する | 拉通 |
| 撮合する | マッチング | 匹配 |
| 対接する | 連携する／つなぐ | 对接 |
| 交付する | 納品する | 交付 |

## B-1. エージェント用語

| 表記 | かな | 中文 | ★ |
|---|---|---|---|
| 求人票 | きゅうじんひょう | 招聘票 | ★ |
| 推薦 | すいせん | 推荐（给企业） | ★ |
| 打診 | だしん | 试探性询问 | ★ |
| 内諾 | ないだく | 口头承诺接受 | |
| 見送り | みおくり | 不通过（婉转） | ★ |

## C. カタカナ発音

| 表記 | 読み | ★ |
|---|---|---|
| Kafka | カフカ | ★ |
| Spark | スパーク | ★ |

## F. 訓読みの動詞

| 表記 | かな | 中文 |
|---|---|---|
| 携わる | たずさわる | 参与/从事 ★ |
| 担う | になう | 承担 ★ |
| 培う | つちかう | 培养 ★ |
| 見極める | みきわめる | 看清/判断 ★ |

## H. 構文の型

- **〜と理解（りかい）しております。** ★
`,
};

const pool = buildQuickPool(CURRICULUM, NOTEBOOK);
const index = createQuickIndex(pool.items);
const byId = new Map(pool.items.map((item) => [item.id, item]));
const nb = (ja) => pool.items.find((item) => item.source === "notebook" && item.ja === ja);
const DAYS = ["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"];
const card = (item, type, day = DAYS[0], stage = "unseen") =>
  buildQuickCard(item, type, { index, day, reason: "new", stage });

// ── 文本工具 ────────────────────────────────────────────────────

test("normalizeQuickAnswer：NFKC、小写、去符号与占位符、片假名折成平假名", () => {
  assert.equal(normalizeQuickAnswer("　ニナウ "), "になう");
  assert.equal(normalizeQuickAnswer("ＡＢＣ…＿_、。"), "abc");
  assert.equal(normalizeQuickAnswer("「スパーク」"), "すぱーく", "长音保留");
  assert.equal(normalizeQuickAnswer("〜を通じて"), "を通じて");
  assert.equal(normalizeQuickAnswer(QUICK_EMPTY), QUICK_EMPTY, "∅ 不被当成符号去掉");
});

test("splitGoEntries：按「／」「｜」切段，「；」后只有像词条的片才独立", () => {
  assert.deepEqual(splitGoEntries("段取り（だんどり）＝安排；前倒し＝提前进行"), ["段取り（だんどり）＝安排", "前倒し＝提前进行"]);
  assert.deepEqual(splitGoEntries("見通し＝前景；也指预期"), ["見通し＝前景；也指预期"]);
  assert.deepEqual(splitGoEntries("🔴 **甲＝一**／乙＝二｜丙＝三"), ["甲＝一", "乙＝二", "丙＝三"]);
  assert.deepEqual(splitGoEntries("叩き台＝初稿／讨论用"), ["叩き台＝初稿／讨论用"], "没有＝的段并回前一词条");
  assert.deepEqual(splitGoEntries("先送り＝推迟（「延期；中止」の意）"), ["先送り＝推迟（「延期；中止」の意）"], "括号里的；不切");
  assert.deepEqual(splitGoEntries("説明（せつめい）＝说明。以下は補足、詳細＝細節"), ["説明（せつめい）＝说明。以下は補足、詳細＝細節"]);
  assert.deepEqual(splitGoEntries("ただの説明文"), []);
});

test("cleanGoMeaning：删转写注记、兜底截断吞进来的下一词条、整条转写订正 drop", () => {
  assert.deepEqual(cleanGoMeaning("深入（「文末」は転写）"), { meaning: "深入", rest: "「文末」は転写", drop: false });
  const swallowed = cleanGoMeaning("深入。再確認＝重新确认");
  assert.equal(swallowed.meaning, "深入");
  assert.equal(swallowed.rest, "再確認＝重新确认");
  assert.equal(cleanGoMeaning("密切相关。「テスト」はASRの誤り").meaning, "密切相关");
  assert.equal(cleanGoMeaning("安排；前倒し＝提前").meaning, "安排");
  assert.deepEqual(cleanGoMeaning("明确表态。后半句是用法补充"), { meaning: "明确表态", rest: "后半句是用法补充", drop: false }, "释义只留第一句");
  assert.equal(cleanGoMeaning("「施策」の転写", "「試験」").drop, true);
  assert.equal(cleanGoMeaning("「施策」の転写", "試験").drop, false);
});

test("meaningLanguage：去掉引用与括注后仍有平假名才算日文", () => {
  assert.equal(meaningLanguage("公司内部（書面寄り）"), "zh");
  assert.equal(meaningLanguage("相手の話を受け止める相槌"), "ja");
  assert.equal(meaningLanguage("「見る」的谦让语"), "zh");
  assert.equal(meaningLanguage("トレーニング"), "ja", "片假名释义不是中文");
  assert.equal(meaningLanguage("「〜という枠に収まらず」"), "ja", "整条只是日文引用");
  assert.equal(meaningLanguage("东京证交所 Growth 市场"), "zh");
  assert.equal(isKanjiOnly("工数"), true);
  assert.equal(isKanjiOnly("前倒し"), false);
});

test("reliableReading：半截读音不当完整读音", () => {
  assert.equal(reliableReading("工数", "こうすう"), true);
  assert.equal(reliableReading("見極める", "みきわめる"), true);
  assert.equal(reliableReading("持ち帰って検討", "もちかえってけんとう"), true);
  assert.equal(reliableReading("全社展開", "てんかい"), false, "四字只注两字");
  assert.equal(reliableReading("拝見する", "はいけん"), false, "送假名没注上");
  assert.equal(reliableReading("〜次第", "しだい"), false);
});

test("diffSpan：公共前后缀 + 差异核，后缀不与前缀重叠", () => {
  assert.deepEqual(diffSpan("感じします", "感じます"), { pre: "感じ", aCore: "し", bCore: "", post: "ます" });
  assert.deepEqual(diffSpan("資料を目を通す", "資料に目を通す"), { pre: "資料", aCore: "を", bCore: "に", post: "目を通す" });
  assert.deepEqual(diffSpan("ああ", "あああ"), { pre: "ああ", aCore: "", bCore: "あ", post: "" });
});

test("clipContext：只取目标所在分句，太短才借句；超长以目标为中心、不切断片假名串", () => {
  const context = "本日はお忙しいところ、オンラインでの面談の機会をいただきまして、誠にありがとうございました。";
  assert.equal(clipContext(context, context.indexOf("機会"), 2), "オンラインでの面談の機会をいただきまして");
  const short = "はい、そうです、資料を見ました。";
  const range = clipContextRange(short, short.indexOf("資料"), 2);
  assert.equal(range.text.slice(range.start, range.end), "資料");
  assert.ok(range.text.length >= 8, "短分句向相邻分句借字");

  const long = "当時はデータプラットフォームエンジニアリングチームの立ち上げと既存システムの全面的な移行計画を同時に担当していました";
  const target = long.indexOf("移行計画");
  const clipped = clipContextRange(long, target, 4, { max: 30 });
  assert.ok(clipped.text.length <= 30, `≤30 字：${clipped.text}`);
  assert.equal(clipped.text.slice(clipped.start, clipped.end), "移行計画");
  assert.match(clipped.text, /^…/u);
  const katakana = "私たちはクラウドネイティブアーキテクチャへの移行を担当しました、それから運用も";
  const cut = clipContextRange(katakana, katakana.indexOf("移行"), 2, { max: 16 });
  assert.equal(cut.text, "…への移行を担当しまし…", "切口在片假名串中间时挪到串尾，不留半个词");
});

test("dice 与 seededShuffle：确定性", () => {
  assert.equal(dice("收到", "收到"), 1);
  assert.ok(dice("技術スタック", "技術スタッフ") > 0.5);
  assert.equal(dice("あ", "い"), 0);
  const items = [1, 2, 3, 4, 5, 6];
  assert.deepEqual(seededShuffle(items, "seed"), seededShuffle(items, "seed"));
  assert.deepEqual([...seededShuffle(items, "seed")].sort(), items);
  assert.deepEqual(items, [1, 2, 3, 4, 5, 6], "不改入参");
});

// ── 改错条目 ────────────────────────────────────────────────────

test("parsePatch：错形取「 → 」左侧，修正按／切，可省助词生成两形", () => {
  const particle = parsePatch("資料を目を通す → 資料に目を通す", "資料に目を通す", "毎朝、資料を目を通すようにしています。");
  assert.equal(particle.ok, true);
  assert.deepEqual(
    { ...particle.patch, context: undefined },
    {
      wrong: "資料を目を通す", fixes: ["資料に目を通す"], pre: "資料", post: "目を通す",
      wrongCore: "を", rightCores: ["に"], particle: true, context: undefined, anchor: "wrong",
    },
  );
  const two = parsePatch("それを → それは", "それは／それが", "それを一番の課題だと考えました。");
  assert.deepEqual(two.patch.rightCores, ["は", "が"]);
  const optional = parsePatch("考えましたか → 考えたのか", "考えたのか（を）", "なぜ考えましたか。");
  assert.deepEqual(optional.patch.fixes, ["考えたのか", "考えたのかを"]);
  const noted = parsePatch("終身 → 生涯", "生涯（しょうがい）", "終身の仕事です。");
  assert.deepEqual(noted.patch.fixes, ["生涯"]);
  assert.deepEqual(noted.notes, ["（しょうがい）"]);
});

test("parsePatch：删除型、没有箭头、两段都不同的 … 不出题；原句里只有修正时锚到修正", () => {
  assert.deepEqual(parsePatch("えっと → （削除）", "（削除）えっと", "えっと。"), { ok: false, reason: "deleted" });
  assert.deepEqual(parsePatch("いろいろ", "いろいろ（と）", ""), { ok: false, reason: "no_arrow" });
  assert.deepEqual(parsePatch("甲が…乙を → 甲に…乙が", "甲に…乙が", ""), { ok: false, reason: "ellipsis" });
  const ellipsis = parsePatch("会社が…関心がある → 会社に…関心がある", "会社に…関心がある", "その会社が昔から関心があるんです。");
  assert.equal(ellipsis.patch.wrong, "会社が");
  assert.deepEqual(ellipsis.patch.fixes, ["会社に"]);
  const anchored = parsePatch("足りないだと思います → 足りないと思います", "足りないと思います", "練習量はまだ足りないと思います。");
  assert.equal(anchored.patch.anchor, "fix");
  assert.equal(anchored.patch.particle, false);
});

test("quickItemsFromCurriculum：技术词与事实锚点不出题，日文释义只计数，改错 meaning 为空", () => {
  const { items, skipped, excludedJaMeaning } = quickItemsFromCurriculum(CURRICULUM);
  assert.equal(skipped.technical_term, 1);
  assert.equal(skipped.fact_anchor, 1);
  assert.equal(skipped.patch_deleted, 1);
  assert.equal(skipped.patch_no_arrow, 1);
  assert.equal(skipped.transcript_note, 1);
  assert.equal(skipped.bad_target, 1, "残缺括号的目标不出题");
  assert.equal(skipped.generic_meaning, 1);
  assert.equal(skipped.meaning_echoes_target, 1);
  assert.equal(excludedJaMeaning, 1);
  const ids = new Set(items.map((item) => item.id));
  for (const id of ["tt_kafka", "fa_number", "ip_ja", "ip_transcript", "ac_generic"]) assert.ok(!ids.has(id));
  assert.ok(items.filter((item) => item.group === "error_patch").every((item) => item.meaning === ""));
  const noisy = items.find((item) => item.id === "ip_noisy");
  assert.equal(noisy.meaning, "深入");
  assert.match(noisy.note, /再確認＝重新确认/u);
  const partial = items.find((item) => item.id === "ip_partial");
  assert.equal(partial.reading, "");
  assert.match(partial.note, /よみ：てんかい/u);
  assert.equal(items.find((item) => item.id === "ip_hours").reading, "こうすう");
  assert.deepEqual(items.find((item) => item.id === "ip_hours").evidence[0].label, "2026-07-01 · 一次面接 · s001");
});

// ── 题型规则 ────────────────────────────────────────────────────

test("各组可用题型：B/F 不出识义，C 只出读音，A 只识词，句型与回答结构只翻卡", () => {
  const types = (item, typing = true) => availableCardTypes(item, index, { typing });
  assert.deepEqual(types(nb("求人票")), ["reading_choice", "word_choice", "short_input"]);
  assert.deepEqual(types(nb("求人票"), false), ["reading_choice", "word_choice"]);
  assert.deepEqual(types(nb("担う")), ["reading_choice", "word_choice", "short_input"]);
  assert.deepEqual(types(nb("Kafka")), ["reading_choice", "short_input"]);
  assert.deepEqual(types(nb("マッチング")), ["word_choice", "short_input"]);
  assert.deepEqual(types(nb("〜と理解しております。")), ["flip"]);
  assert.deepEqual(types(byId.get("as_conclusion")), ["flip"]);
  assert.deepEqual(types(byId.get("ac_focus")), ["flip"]);
  assert.deepEqual(types(byId.get("ip_hours")), ["word_choice", "short_input"], "纯汉字短语不出识义");
  assert.ok(types(byId.get("ip_plan")).includes("meaning_choice"));
  assert.deepEqual(types(byId.get("ep_particle")), ["cloze_choice", "short_input"]);
  assert.deepEqual(types(byId.get("ep_verb")), ["natural_choice"]);
  assert.deepEqual(types(byId.get("ep_kana"), false), ["natural_choice"]);
  assert.deepEqual(types(byId.get("ep_long")), ["flip"], "差异核超过 12 字不出二选一，只能翻卡");
  assert.ok(!types(byId.get("ip_plan"), false).includes("short_input"), "关掉打字题");
  for (const item of pool.items.filter((value) => value.source === "notebook")) {
    assert.ok(!types(item).includes("meaning_choice"), `${item.ja} 不出识义`);
  }
});

test("助词选项：含正解与原错助词、4 个互不相同；互换对不同时补；名词前不补「の」；删除型带 ∅", () => {
  for (const day of DAYS) {
    const options = particleOptions(byId.get("ep_particle").patch, `x|${day}`, "目");
    assert.equal(options.length, 4);
    assert.equal(new Set(options).size, 4);
    assert.ok(options.includes("に") && options.includes("を"));
    assert.ok(!options.includes("へ"), "正解に时不补へ");
    assert.ok(!options.includes("の"), "后面是汉字且正解不是の");
  }
  const ga = particleOptions({ ...byId.get("ep_particle").patch, rightCores: ["が"], wrongCore: "を" }, "s", "あ");
  assert.ok(!ga.includes("は"));
  const deletion = card(byId.get("ep_delete"), "cloze_choice");
  assert.ok(deletion.options.includes(QUICK_EMPTY));
  assert.ok(deletion.options.includes("の"));
  assert.equal(deletion.answer, QUICK_EMPTY);
  assert.equal(deletion.stem, "来週は大きい＿＿会議室を予約しました。");
  assert.equal(gradeQuickCard(deletion, { response: QUICK_EMPTY }).passed, true);
});

test("哪个更自然：只显示差异核 ± 最多 4 字，并给出高亮区间", () => {
  const verb = card(byId.get("ep_verb"), "natural_choice");
  assert.deepEqual([...verb.options].sort(), ["感じします", "感じます"]);
  assert.equal(verb.stem, "その仕事にやりがいを＿＿＿＿。");
  const wrongAt = verb.options.indexOf("感じします");
  assert.deepEqual(verb.optionMarks[wrongAt], [2, 3]);
  assert.deepEqual(verb.optionMarks[1 - wrongAt], [2, 2], "删除型为空区间");
  assert.equal(verb.answer, "感じます");
  assert.equal(verb.reveal.wrong, "感じします");
  assert.match(verb.reveal.explain, /一段動詞/u, "没有 noteJa 时用型说明兜底");
});

test("干扰项排除：释义同段或互相包含、日语互相包含的不同时出现", () => {
  const ok = byId.get("ip_ok");
  const visit = byId.get("ip_visit");
  const check = byId.get("ip_check");
  for (const day of DAYS) {
    const meaning = card(ok, "meaning_choice", day);
    assert.ok(!meaning.options.includes("收到（更礼貌）"), "「收到」与「收到（更礼貌）」互斥");
    const word = card(visit, "word_choice", day);
    assert.ok(!word.options.includes("ご教示ください"), "「请教/拜访」切段后与「请教」相等");
    const checkWord = card(check, "word_choice", day);
    assert.ok(!checkWord.options.includes("確認する"), "「確認」与「確認する」互相包含");
    const slot = card(byId.get("ip_slot1"), "word_choice", day);
    assert.ok(slot.options.every((option) => option.includes("〜")), "句型只和句型一起出");
  }
});

test("A 表识词：四选一，固定带上本人的 ✗ 形", () => {
  const calque = nb("マッチング");
  for (const day of DAYS) {
    const value = card(calque, "word_choice", day);
    assert.equal(value.options.length, 4);
    assert.ok(value.options.includes("撮合する"));
    assert.equal(value.stem, "匹配");
    assert.equal(value.reveal.wrong, "撮合する");
  }
});

test("读音变异：只变汉字读音部分、不等于正解；读音题四选一", () => {
  const variants = mutateReading("たずさわる", "携わる");
  const all = Object.values(variants).flat();
  assert.ok(all.length >= 3);
  assert.ok(all.every((value) => value !== "たずさわる" && value.endsWith("わる")), "送假名不动");
  assert.ok(variants["sokuon+"].includes("たずっさわる"));
  const katakana = mutateReading("カフカ", "Kafka");
  assert.ok(katakana["long+"].includes("カーフカ"));
  assert.ok(!Object.values(mutateReading("ジャバ", "Java")).flat().includes("ジーャバ"), "小写假名前不插长音");
  const reading = card(nb("携わる"), "reading_choice");
  assert.equal(reading.options.length, 4);
  assert.ok(reading.options.includes("たずさわる"));
  assert.equal(reading.prompt, "reading");
});

test("短输入：资格与归一化（片假名、全角输入都能判对）", () => {
  const word = card(nb("担う"), "short_input");
  assert.equal(word.prompt, "input_word");
  assert.equal(word.stem, "承担");
  assert.equal(gradeQuickCard(word, { response: "ニナウ" }).passed, true);
  assert.equal(gradeQuickCard(word, { response: "担う" }).passed, true);
  assert.equal(gradeQuickCard(word, { response: "" }).passed, false, "空串不算答对");
  const particle = card(byId.get("ep_particle"), "short_input");
  assert.equal(particle.prompt, "input_particle");
  assert.equal(gradeQuickAnswer(byId.get("ep_particle"), "short_input", { response: "ニ" }).passed, true);
  assert.equal(gradeQuickAnswer(byId.get("ep_particle"), "short_input", { response: "資料に目を通す" }).passed, true);
  const kana = card(byId.get("ep_kana"), "short_input");
  assert.equal(kana.prompt, "input_fix");
  assert.equal(kana.stem.slice(kana.mark[0], kana.mark[1]), "だから");
  assert.equal(gradeQuickCard(kana, { response: "ですので" }).passed, true);
  assert.equal(card(byId.get("ep_delete"), "short_input"), null, "删除型助词不能打字");
  assert.equal(card(byId.get("ip_slot1"), "short_input"), null, "带〜不打字");
  const reading = card(nb("Kafka"), "short_input");
  assert.equal(reading.prompt, "input_reading");
  assert.equal(gradeQuickCard(reading, { response: "かふか" }).passed, true);
});

test("三层阶梯：R 点选、D 更难的点选、P 才短输入且受额度约束", () => {
  assert.equal(layerOf("unseen"), "R");
  assert.equal(layerOf("recognized"), "R");
  assert.equal(layerOf("correctable"), "D");
  assert.equal(layerOf("stable"), "P");
  const choose = (item, stage, extra = {}) =>
    chooseCardType(item, stage, { index, typing: true, day: DAYS[0], typedLeft: 2, ...extra });
  const term = nb("担う");
  assert.equal(choose(term, "unseen"), "reading_choice");
  assert.equal(choose(term, "correctable"), "word_choice");
  assert.equal(choose(term, "retrievable"), "short_input");
  assert.equal(choose(term, "retrievable", { typedLeft: 0 }), "word_choice", "额度用完退回点选");
  assert.equal(choose(term, "stable", { typing: false }), "word_choice");
  const plan = byId.get("ip_plan");
  assert.equal(choose(plan, "unseen"), "meaning_choice");
  assert.equal(choose(plan, "correctable"), "word_choice");
  assert.equal(choose(byId.get("ip_hours"), "unseen"), "word_choice", "R 层没有识义时向上找");
  assert.equal(choose(byId.get("ep_particle"), "unseen"), "cloze_choice");
  assert.equal(choose(byId.get("ep_particle"), "retrievable"), "short_input");
  assert.equal(choose(byId.get("ep_verb"), "stable"), "natural_choice", "P 层没有短输入就维持点选");
  assert.equal(choose(byId.get("ep_long"), "unseen"), "flip");
  assert.equal(choose(nb("Kafka"), "unseen"), "reading_choice");
  assert.equal(choose(nb("Kafka"), "correctable"), "reading_choice");
  assert.equal(choose(byId.get("as_conclusion"), "stable"), "flip");
});

test("isBinaryOnly：只有二选一可判分的条目", () => {
  assert.equal(isBinaryOnly(byId.get("ep_verb"), index), true);
  assert.equal(isBinaryOnly(byId.get("ep_particle"), index), false);
  assert.equal(isBinaryOnly(byId.get("ip_plan"), index), false);
  assert.equal(isBinaryOnly(byId.get("as_conclusion"), index), false, "翻卡不算二选一");
});

test("翻卡：不给 passed；gaveUp 记 false；卡片照常带答案", () => {
  const flip = card(byId.get("as_conclusion"), "flip");
  assert.equal(flip.grading, "self");
  assert.equal(flip.stem, "先给结论，再补理由和例子");
  assert.equal(flip.answer, "結論から申し上げます。");
  assert.deepEqual(gradeQuickCard(flip, { rating: "remembered" }), {});
  assert.deepEqual(gradeQuickAnswer(byId.get("as_conclusion"), "flip", { rating: "forgot" }), {});
  const cloze = card(byId.get("ep_particle"), "cloze_choice");
  assert.deepEqual(gradeQuickCard(cloze, { response: "に", gaveUp: true }), { passed: false });
  const pattern = card(nb("〜と理解しております。"), "flip");
  assert.equal(pattern.prompt, "flip_pattern");
  assert.equal(pattern.stem, "〜と理解……");
});

test("同一天同一题选项固定；换一天干扰项可以变，但规则不变", () => {
  const item = byId.get("ip_plan");
  assert.deepEqual(card(item, "meaning_choice", DAYS[0]), card(item, "meaning_choice", DAYS[0]));
  const cardId = card(item, "meaning_choice", DAYS[1]).cardId;
  assert.equal(cardId, `ip_plan:meaning_choice:${DAYS[1]}`);
});

test("全量不变式：所有条目 × 所有可用题型 × 多天", () => {
  const meaningZh = new Map(CURRICULUM.items.map((item) => [item.id, item.meaningZh]));
  let built = 0;
  for (const item of pool.items) {
    for (const type of availableCardTypes(item, index, { typing: true })) {
      for (const day of DAYS) {
        const value = card(item, type, day, "retrievable");
        assert.ok(value, `${item.id} ${type} ${day} 可用却出不了卡`);
        built += 1;
        assert.deepEqual(checkQuickCard(value, item), [], `${item.id} ${type}`);
        if (type !== "flip") {
          assert.ok(value.options.length === 0 || (value.options.length >= 2 && value.options.length <= 4));
          assert.equal(new Set(value.options.map(normalizeQuickAnswer)).size, value.options.length);
          if (value.options.length) {
            assert.ok(value.options.some((option) => gradeQuickCard(value, { response: option }).passed), "答案在选项里");
          }
          assert.equal(gradeQuickCard(value, { response: value.answer }).passed, true, `${item.id} ${type} 展示答案判对`);
        }
        // 服务端与客户端判分对每个选项、答案与一个错误输入都一致。
        for (const response of [...value.options, value.answer, "まちがい"]) {
          assert.deepEqual(
            gradeQuickAnswer(item, type, { response }),
            gradeQuickCard(value, { response }),
            `${item.id} ${type} ${response}`,
          );
        }
        assert.deepEqual(value.accepted, acceptedAnswers(item, type));
        if (item.group === "error_patch") {
          assert.ok(!JSON.stringify(value).includes(meaningZh.get(item.id)), `${item.id} 卡片不含课程 meaningZh`);
        }
        if (value.optionMarks) assert.equal(value.optionMarks.length, value.options.length);
      }
    }
  }
  assert.ok(built > 100);
  assert.ok(!pool.items.some((item) => item.id === "tt_kafka" || item.id === "fa_number"));
});

// ── 复核补充：真实数据抽查里发现的歧义题（fixture 仍全部自编） ──────

test("释义：纯汉字的日文释义判日文；日文括注与整理标记移出主释义，答后解释里保留", () => {
  assert.equal(meaningLanguage("人材紹介会社"), "ja", "新字体「紹」只出现在日文里");
  assert.equal(meaningLanguage("推迟处理"), "zh");
  assert.deepEqual(splitMeaningNotes("看起来能行（いける＝行ける）"), { meaning: "看起来能行", notes: ["いける＝行ける"] });
  assert.deepEqual(splitMeaningNotes("关于……（丁寧）"), { meaning: "关于……", notes: ["丁寧"] });
  assert.deepEqual(splitMeaningNotes("拿来举例（必收惯用句）").meaning, "拿来举例");
  assert.deepEqual(splitMeaningNotes("（谦让）与您共享"), { meaning: "（谦让）与您共享", notes: [] }, "纯中文语境括注是意思的一部分");
  assert.deepEqual(
    splitMeaningNotes("不太好开口——后面多半是婉拒"),
    { meaning: "不太好开口", notes: ["后面多半是婉拒"] },
    "破折号后的用法说明移到答后解释，选项只留意思本身",
  );

  const extra = buildQuickPool({ ...CURRICULUM, items: [
    ...CURRICULUM.items,
    phrase("ip_style", "働きっぷり", "工作的样子（〜っぷり＝……的样子）"),
    phrase("ip_leak", "おりません", "「いません」的郑重说法"),
  ] }, NOTEBOOK);
  const extraIndex = createQuickIndex(extra.items);
  const style = extra.items.find((item) => item.id === "ip_style");
  assert.equal(style.meaning, "工作的样子", "与题面同形的「っぷり」不进选项");
  assert.match(style.note, /〜っぷり/u);
  const leak = extra.items.find((item) => item.id === "ip_leak");
  const leakTypes = availableCardTypes(leak, extraIndex, { typing: true });
  assert.ok(!leakTypes.includes("meaning_choice") && !leakTypes.includes("word_choice"), "释义引了与题面相同的假名");
});

test("助词补位：从句主语不同时出现が/の；空格后是は/の时不补能叠用的助词；する前不让に/と同时出现", () => {
  const base = { wrong: "", fixes: [], pre: "", post: "", particle: true, context: "", anchor: "none" };
  for (const day of DAYS) {
    const relative = particleOptions({ ...base, wrongCore: "と", rightCores: ["が"] }, `r|${day}`, "や");
    assert.ok(!relative.includes("の"), "先輩が／の作った資料：两个都对");
    const topic = particleOptions({ ...base, wrongCore: "を", rightCores: ["に"] }, `t|${day}`, "は");
    // 凑不够 4 个就不出（null），也不拿能叠用的助词凑数。
    assert.ok(topic === null || topic.every((option) => !["で", "と", "へ", "の", "は"].includes(option)), "勝つには／勝つのは／勝つとは");
    const suru = particleOptions({ ...base, wrongCore: "を", rightCores: ["に"] }, `s|${day}`, "し");
    assert.ok(!suru.includes("と"), "中心にする／中心とする");
  }
});

test("哪个更自然：时态、接缝重复、与别条矛盾的不出；首选修正重说动词时换用能拼通的写法", () => {
  const items = [
    patchItem("nx_seam", "同じの", "同じ部署", "ほぼ同じの部署はありません。", "連体詞"),
    patchItem("nx_verb", "けど", "ありますが／のですが", "問題はいろいろあるけど、進めます。", "文体"),
    patchItem("nx_tense", "行きます", "行きました", "先週、大阪に行きます。", "時制"),
    patchItem("nx_c1", "了解です", "承知しました", "はい、了解です。", "敬語"),
    patchItem("nx_c2", "承知しました", "承知いたしました", "はい、承知しました。", "敬語"),
    patchItem("nx_ok", "感じします", "感じます", "その作業に手応えを感じします。", "感じします"),
  ];
  const local = buildQuickPool({ ...CURRICULUM, items }, undefined);
  const localIndex = createQuickIndex(local.items);
  const get = (id) => local.items.find((item) => item.id === id);
  const natural = (id) => availableCardTypes(get(id), localIndex, { typing: true }).includes("natural_choice");
  assert.equal(natural("nx_seam"), false, "拼回原句成了「同じ部署部署」");
  assert.equal(natural("nx_tense"), false, "±4 字窗口看不出说的是什么时候");
  assert.equal(natural("nx_c1"), false, "正解「承知しました」在另一条里是错形");
  assert.equal(natural("nx_c2"), false, "错形「承知しました」在另一条里是正解");
  assert.equal(natural("nx_ok"), true);
  const verb = buildQuickCard(get("nx_verb"), "natural_choice", { index: localIndex, day: DAYS[0], reason: "new", stage: "unseen" });
  assert.ok(verb && verb.answer.endsWith("あるのですが"), verb?.answer);
  assert.ok(!verb.options.some((option) => option.includes("あるあります")));
  // 时态条目没有点选可出时退回翻卡，不会从题库里消失。
  assert.ok(availableCardTypes(get("nx_tense"), localIndex, { typing: true }).length > 0);
});

test("出处：没有假名的摘录（回答复盘里的中文点评）不显示，只留日期 · 场次", () => {
  const pool = buildQuickPool({ ...CURRICULUM, items: [
    ...CURRICULUM.items,
    {
      ...phrase("ac_review", "段階的に任せる", "分阶段交给对方"),
      kind: "active_chunk",
      evidence: [{ path: PATH, interviewKey: KEY, excerpt: "回答方向正确，但缺少一个具体例子" }],
    },
  ] }, NOTEBOOK);
  const item = pool.items.find((entry) => entry.id === "ac_review");
  assert.ok(item);
  assert.equal(item.evidence[0].excerpt, "");
  assert.ok(item.evidence[0].label.length > 0);
});
