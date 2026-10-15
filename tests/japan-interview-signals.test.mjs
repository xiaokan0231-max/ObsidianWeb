import assert from "node:assert/strict";
import test from "node:test";
import {
  JAPAN_SIGNALS_ALWAYS_ASSESSED,
  JAPAN_SIGNALS_OUTPUT_SCHEMA,
  JAPAN_SIGNALS_VERSION,
  JAPAN_SIGNAL_KEYS,
  JAPAN_SIGNAL_META,
  japanSignalErrors,
  japanSignalVerdicts,
  japanSignalWarnings,
  japanSignalsInstruction,
  normalizeJapanSignals,
  readJapanSignals,
} from "../lib/japan-interview-signals.mjs";

// q01 面试官问志望动机、本人回答；q02 面试官流露懸念、本人回应；q03 收尾。全部是虚构问答。
const sentencesByBlock = new Map([["q01", new Set(["s001", "s002"])], ["q02", new Set(["s003", "s004"])], ["q03", new Set(["s005", "s006"])]]);
const speakers = new Map([["s001", "面"], ["s002", "私"], ["s003", "面"], ["s004", "私"], ["s005", "面"], ["s006", "私"]]);
const ref = (blockId, ...sentenceIds) => ({ blockId, sentenceIds });
const valid = () => ({
  motivation: { verdict: "mixed", observationZh: "只说对技术感兴趣，没有说想进这家公司。", fixZh: "先说想在贵公司负责的具体工作，再说理由。", evidence: [ref("q01", "s002")] },
  closing: { verdict: "poor", observationZh: "最后只说「以上です」。", fixZh: "道谢后补一句：本日のお話で志望度が高まりました。", evidence: [ref("q03", "s006")] },
  concernRecovery: { verdict: "good", observationZh: "面试官担心对客沟通，本人用具体做法回应并被复述。", fixZh: "", evidence: [ref("q02", "s003", "s004")] },
  unpromptedNegative: { verdict: "good", observationZh: "职责说明里没有主动说落选或道歉。", fixZh: "", evidence: [ref("q01", "s002")] },
  registerConsistency: { verdict: "mixed", observationZh: "原::里即兴补充一次滑到普通形。", fixZh: "即兴时先用「〜です」收句。", evidence: [ref("q02", "s004")] },
  salaryVisaLine: { verdict: "not_applicable", observationZh: "查过全部问答，本场没有谈年收或在留。", fixZh: "", evidence: [] },
  reverseQuestions: { verdict: "not_applicable", observationZh: "面试官没有给提问机会。", fixZh: "", evidence: [] },
});
const check = (signals, extra = {}) => japanSignalErrors(signals, { sentencesByBlock, speakers, materialScope: "full_available_text", ...extra });

test("七项信号各有允许的结论：志望度和收尾每场都评，只有可能没出现的情境才有「未触发」", () => {
  assert.deepEqual(JAPAN_SIGNAL_KEYS, ["motivation", "closing", "concernRecovery", "unpromptedNegative", "registerConsistency", "salaryVisaLine", "reverseQuestions"]);
  const conditional = JAPAN_SIGNAL_KEYS.filter((key) => japanSignalVerdicts(key).includes("not_applicable"));
  assert.deepEqual(conditional, ["concernRecovery", "salaryVisaLine", "reverseQuestions"]);
  for (const key of JAPAN_SIGNALS_ALWAYS_ASSESSED) assert.ok(!japanSignalVerdicts(key).includes("not_applicable"), key);
  for (const key of JAPAN_SIGNAL_KEYS) {
    assert.deepEqual(JAPAN_SIGNALS_OUTPUT_SCHEMA.properties[key].properties.verdict.enum, japanSignalVerdicts(key), key);
    assert.ok(JAPAN_SIGNAL_META[key].label && JAPAN_SIGNAL_META[key].short, key);
  }
  assert.deepEqual(JAPAN_SIGNALS_OUTPUT_SCHEMA.required, [...JAPAN_SIGNAL_KEYS]);
  assert.equal(JAPAN_SIGNALS_OUTPUT_SCHEMA.additionalProperties, false);
});

test("合格的信号通过校验；结构、结论与证据的每类错误都会被报出", () => {
  assert.deepEqual(check(valid()), []);
  const cases = [
    [(s) => { delete s.closing; }, /closing is missing/],
    [(s) => { s.extra = s.closing; }, /extra is not a known signal/],
    [(s) => { s.closing = { ...s.closing, verdict: "not_applicable", evidence: [] }; }, /closing.verdict "not_applicable" is not allowed/],
    [(s) => { s.motivation = { ...s.motivation, verdict: "insufficient_material", evidence: [] }; }, /完整资料下志望度和收尾每场都要判断/],
    [(s) => { s.motivation.evidence = []; }, /mixed 必须引用 q\/s 原句/],
    [(s) => { s.motivation.evidence = [ref("q01", "s003")]; }, /s003, which does not belong to q01/],
    [(s) => { s.motivation.evidence = [ref("q09", "s001")]; }, /unknown block q09/],
    [(s) => { s.motivation.evidence = [ref("q01", "s002"), ref("q01", "s002")]; }, /repeats q01\/s002/],
    [(s) => { s.closing.fixZh = ""; }, /fixZh must give a concrete next step for poor/],
    [(s) => { s.closing.observationZh = " "; }, /closing.observationZh is empty/],
    [(s) => { s.closing.evidence = [ref("q03", "s005")]; }, /至少要引用一句本人（私）的原话/],
    [(s) => { s.concernRecovery.evidence = [ref("q02", "s004")]; }, /必须引用面试官流露懸念的原句/],
    [(s) => { s.concernRecovery.evidence = [ref("q02", "s003")]; }, /good 需要同时引用本人当场回应的原句/],
  ];
  for (const [mutate, pattern] of cases) {
    const signals = structuredClone(valid());
    mutate(signals);
    assert.ok(check(signals).some((error) => pattern.test(error)), `${pattern}: ${JSON.stringify(check(signals))}`);
  }
  // 资料有限时，志望度确实缺录可以写资料不足；懸念没被加深时 poor 不强求本人回应句。
  const limited = structuredClone(valid());
  limited.motivation = { verdict: "insufficient_material", observationZh: "收尾与志望段缺录。", fixZh: "", evidence: [] };
  limited.concernRecovery = { verdict: "poor", observationZh: "面试官的担心被搁置。", fixZh: "当场用一个具体做法回应。", evidence: [ref("q02", "s003")] };
  assert.deepEqual(check(limited, { materialScope: "limited" }), []);
  assert.match(japanSignalErrors(null)[0], /must be an object/);
});

test("记忆重构只能对敬体写资料不足；提到发音语速只警告，说明「不评」的不警告", () => {
  assert.ok(check(valid(), { reconstructed: true }).some((error) => /记忆重构或非逐字稿不能评价敬体/.test(error)));
  const reconstructed = structuredClone(valid());
  reconstructed.registerConsistency = { verdict: "insufficient_material", observationZh: "记忆重构，无逐字。", fixZh: "", evidence: [] };
  assert.deepEqual(check(reconstructed, { reconstructed: true }), []);
  const speech = structuredClone(valid());
  speech.registerConsistency.observationZh = "语速偏快，敬体滑落一次。";
  assert.equal(japanSignalWarnings(speech).length, 1);
  speech.registerConsistency.observationZh = "无原音，不评语速；原::里敬体滑落一次。";
  assert.deepEqual(japanSignalWarnings(speech), []);
});

test("规范化去掉不属于该问题的句子；旧报告或结构不全读成 null 而不是全部做到", () => {
  const raw = structuredClone(valid());
  raw.motivation.evidence = [ref("q01", "s002", "s009"), ref("q07", "s001")];
  raw.motivation.observationZh = "  有空白  ";
  const normalized = normalizeJapanSignals(raw, sentencesByBlock);
  assert.deepEqual(normalized.motivation.evidence, [ref("q01", "s002")]);
  assert.equal(normalized.motivation.observationZh, "有空白");
  assert.equal(normalizeJapanSignals({ motivation: raw.motivation }, sentencesByBlock), undefined);
  assert.equal(readJapanSignals({ japanSignals: valid() }), null, "没有版本的信号不认");
  assert.equal(readJapanSignals({}), null);
  assert.equal(readJapanSignals({ japanSignalsVersion: JAPAN_SIGNALS_VERSION, japanSignals: valid() }).signals.closing.verdict, "poor");
});

test("Bridge 提示写明每场必评、原句、口径与音频边界", () => {
  for (const phrase of [/不进五维均分/, /每场都要判断/, /原::/, /statedPositions/, /按面试日期选当时有效的版本/, /无原音不评发音、语速/, /特にありません/]) {
    assert.match(japanSignalsInstruction(), phrase);
  }
});
