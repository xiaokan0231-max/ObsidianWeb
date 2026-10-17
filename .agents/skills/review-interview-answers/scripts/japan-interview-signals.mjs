// 日本面试官在意的整场信号：志望度、收尾表态、懸念化解、主动负面、即兴敬体、年收在留口径、逆質問类型。
//
// 为什么和五维分开：五维评「被问到的问题答得怎样」，而 rubric 的「没被问的不评」「如实负面不扣表达分」
// 「文体二层不重复扣」让这些整场行为在五维里一分不扣。2026-10 复核时发现复盘高分和选考结果对不上，
// 原因之一就在这里。所以它们单独成层：不折算成分数，不进五维均分，
// 每项只给判断、原句证据和下一步。
//
// 本文件是 skill 内的正本：校验器、Bridge 的 schema 与提示、Web 的规范化和展示都从这里取。
// lib/japan-interview-signals.mjs 是指向本文件的符号链接——skill 被单独拷走时，校验器不能依赖仓库里的文件。

/** 新复盘才带信号；旧报告没有这一层，读到缺失不能当作「全部做到」。 */
export const JAPAN_SIGNALS_VERSION = "2026-10-js1";

/** 数组顺序＝报告、界面和对照表的列顺序。 */
export const JAPAN_SIGNAL_KEYS = /** @type {const} */ ([
  "motivation",
  "closing",
  "concernRecovery",
  "unpromptedNegative",
  "registerConsistency",
  "salaryVisaLine",
  "reverseQuestions",
]);

export const JAPAN_SIGNAL_VERDICTS = /** @type {const} */ (["good", "mixed", "poor", "not_applicable", "insufficient_material"]);

/** 这三档是对本人的判断，必须引用原句；未触发、资料不足不评价本人。 */
export const JAPAN_SIGNAL_ASSESSED_VERDICTS = /** @type {const} */ (["good", "mixed", "poor"]);

/**
 * 「没被问到的不评」不适用于志望度和收尾：没人会单独问「你想不想来」，不说本身就是信号。
 * 完整资料下这两项必须给出判断；只有对应段落确实缺录时才能写资料不足。
 */
export const JAPAN_SIGNALS_ALWAYS_ASSESSED = /** @type {const} */ (["motivation", "closing"]);

/** 对照表单元格用的通用短标签；具体含义看各信号自己的 verdicts。 */
export const JAPAN_SIGNAL_VERDICT_SHORT = /** @type {const} */ ({
  good: "做到",
  mixed: "部分",
  poor: "没做到",
  not_applicable: "未触发",
  insufficient_material: "资料不足",
});

/**
 * speaker：判断类结论至少要引用谁的原句。self＝本人；both＝面试官的懸念和本人的回应都要有。
 * verdicts 只列该信号允许的结论：只有现场可能根本没出现的情境（懸念、年收在留、逆質問）才有「未触发」，
 * 负面和敬体每场都有说话机会，不能用未触发回避。short 是对照表的列名。
 */
export const JAPAN_SIGNAL_META = /** @type {const} */ ({
  motivation: {
    label: "志望度・入社意欲",
    short: "志望度",
    question: "有没有把想进这家公司、想做这份工作说出口",
    speaker: "self",
    verdicts: {
      good: "明确说出想进这家公司",
      mixed: "只说兴趣，或把动机讲成避险",
      poor: "没有说出口",
      insufficient_material: "相关段落缺录",
    },
  },
  closing: {
    label: "收尾表态",
    short: "收尾",
    question: "最后一段有没有表明意愿、感谢并请求推进",
    speaker: "self",
    verdicts: {
      good: "收尾明确表态",
      mixed: "只有礼貌收尾",
      poor: "收尾没有表态",
      insufficient_material: "收尾段缺录",
    },
  },
  concernRecovery: {
    label: "懸念当场化解",
    short: "懸念",
    question: "面试官流露的担心有没有当场回应并化解",
    speaker: "both",
    verdicts: {
      good: "当场化解",
      mixed: "回应了但没化解",
      poor: "懸念悬着或被加深",
      not_applicable: "面试官没有流露懸念",
      insufficient_material: "相关段落不可靠",
    },
  },
  unpromptedNegative: {
    label: "主动说负面",
    short: "主动负面",
    question: "有没有主动说出没被问的负面（落选经历、为事实道歉、自贬、给自己的事实加「多分」）",
    speaker: "self",
    verdicts: {
      good: "没有主动说负面",
      mixed: "偶有自贬或「多分」",
      poor: "主动说出没被问的负面",
      insufficient_material: "资料不足以判断",
    },
  },
  registerConsistency: {
    label: "即兴段です・ます",
    short: "敬体",
    question: "背好的段落以外，即兴回答有没有滑到普通形",
    speaker: "self",
    verdicts: {
      good: "即兴段保持敬体",
      mixed: "偶尔滑到普通形",
      poor: "即兴时常用普通形",
      insufficient_material: "没有可靠逐字",
    },
  },
  salaryVisaLine: {
    label: "年收・在留口径",
    short: "年收在留",
    question: "谈到年收或在留资格时，是否照本人当时的既定口径说",
    speaker: "self",
    verdicts: {
      good: "照既定口径说",
      mixed: "部分偏离口径",
      poor: "自压价、报到范围外或口径没说出",
      not_applicable: "本场没谈到",
      insufficient_material: "当时口径或原话不明",
    },
  },
  reverseQuestions: {
    label: "逆質問类型",
    short: "逆質問",
    question: "逆質問是在表达入社意欲，还是只确认条件",
    speaker: "self",
    verdicts: {
      good: "意欲型为主",
      mixed: "意欲型与条件型混合",
      poor: "条件型为主或没有提问",
      not_applicable: "没有逆質問环节",
      insufficient_material: "逆質問段缺录",
    },
  },
});

/** 某个信号允许的结论，供 Bridge schema 与校验共用。 */
export function japanSignalVerdicts(key) {
  return JAPAN_SIGNAL_VERDICTS.filter((verdict) => Object.hasOwn(JAPAN_SIGNAL_META[key]?.verdicts ?? {}, verdict));
}

const nonEmpty = (value) => typeof value === "string" && value.trim().length > 0;

// 无原音时不能评发音和语速；说明「不评」的句子不算违规。只作警告：措辞判断交给人工复核。
const AUDIO_CLAIM = /发音|發音|発音|语速|語速|话速|話速|口音|アクセント|イントネーション|滑舌/;
const AUDIO_BOUNDARY = /不评|不判|不能判|不能评|无法判|無法判|不作|不做|不予|无原音|無原音|没有原音|未聴取|未聽取|未听/;

/**
 * 模型输出与持久化报告共用的机械校验。语义（判断是否成立）仍须回查完整问答。
 *
 * @param {unknown} signals 七个键的 japanSignals 对象
 * @param {{
 *   sentencesByBlock?: Map<string, Set<string>>,
 *   speakers?: Map<string, string>,
 *   materialScope?: string,
 *   reconstructed?: boolean,
 * }} [context]
 *   speakers：sNN → 「私」/「面」（已应用话者裁定）；没有时跳过话者检查。
 *   reconstructed：整理稿是本人记忆重构或非逐字（reconstruction=memory / verbatim=false）。
 * @returns {string[]}
 */
export function japanSignalErrors(signals, { sentencesByBlock, speakers, materialScope, reconstructed = false } = {}) {
  const errors = [];
  if (!signals || typeof signals !== "object" || Array.isArray(signals)) return ["japanSignals must be an object with the seven signal keys"];
  for (const key of Object.keys(signals)) {
    if (!JAPAN_SIGNAL_KEYS.includes(key)) errors.push(`japanSignals.${key} is not a known signal`);
  }
  for (const key of JAPAN_SIGNAL_KEYS) {
    const at = `japanSignals.${key}`;
    const item = signals[key];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`${at} is missing`);
      continue;
    }
    const verdict = item.verdict;
    if (!japanSignalVerdicts(key).includes(verdict)) {
      errors.push(`${at}.verdict ${JSON.stringify(verdict)} is not allowed; use ${japanSignalVerdicts(key).join(" / ")}`);
    }
    if (JAPAN_SIGNALS_ALWAYS_ASSESSED.includes(key) && verdict === "insufficient_material" && materialScope === "full_available_text") {
      errors.push(`${at}: 完整资料下志望度和收尾每场都要判断，不能写资料不足`);
    }
    if (key === "registerConsistency" && reconstructed && verdict !== "insufficient_material") {
      errors.push(`${at}: 记忆重构或非逐字稿不能评价敬体措辞，只能写 insufficient_material`);
    }
    if (!nonEmpty(item.observationZh)) errors.push(`${at}.observationZh is empty`);
    if (typeof item.fixZh !== "string") errors.push(`${at}.fixZh must be a string`);
    else if ((verdict === "mixed" || verdict === "poor") && !item.fixZh.trim()) errors.push(`${at}.fixZh must give a concrete next step for ${verdict}`);
    if (!Array.isArray(item.evidence)) {
      errors.push(`${at}.evidence must be an array`);
      continue;
    }
    const assessed = JAPAN_SIGNAL_ASSESSED_VERDICTS.includes(verdict);
    if (assessed && item.evidence.length === 0) errors.push(`${at}: ${verdict} 必须引用 q/s 原句`);
    const seen = new Set();
    const cited = [];
    item.evidence.forEach((ref, index) => {
      const refAt = `${at}.evidence[${index}]`;
      if (!ref || typeof ref !== "object" || typeof ref.blockId !== "string" || !/^q\d+$/.test(ref.blockId)) {
        errors.push(`${refAt}.blockId must be qNN`);
        return;
      }
      if (sentencesByBlock && !sentencesByBlock.has(ref.blockId)) errors.push(`${refAt} cites unknown block ${ref.blockId}`);
      if (!Array.isArray(ref.sentenceIds) || ref.sentenceIds.length === 0 || ref.sentenceIds.some((id) => typeof id !== "string")) {
        errors.push(`${refAt}.sentenceIds must cite at least one sNN`);
        return;
      }
      for (const id of ref.sentenceIds) {
        if (sentencesByBlock?.has(ref.blockId) && !sentencesByBlock.get(ref.blockId).has(id)) {
          errors.push(`${refAt} cites ${id}, which does not belong to ${ref.blockId}`);
        }
        const unique = `${ref.blockId}/${id}`;
        if (seen.has(unique)) errors.push(`${refAt} repeats ${unique}`);
        seen.add(unique);
        cited.push(id);
      }
    });
    if (speakers && assessed && cited.length) {
      const spoken = new Set(cited.map((id) => speakers.get(id)).filter(Boolean));
      const speaker = JAPAN_SIGNAL_META[key].speaker;
      if (speaker === "self" && !spoken.has("私")) errors.push(`${at}: 判断本人的行为至少要引用一句本人（私）的原话`);
      if (speaker === "both" && !spoken.has("面")) errors.push(`${at}: 懸念判断必须引用面试官流露懸念的原句`);
      if (speaker === "both" && verdict !== "poor" && !spoken.has("私")) errors.push(`${at}: ${verdict} 需要同时引用本人当场回应的原句`);
    }
  }
  return errors;
}

/** 措辞层面的提醒，不拦截：无原音时提到发音语速，多半是越界评价。 */
export function japanSignalWarnings(signals) {
  if (!signals || typeof signals !== "object") return [];
  return JAPAN_SIGNAL_KEYS.flatMap((key) => {
    const item = signals[key];
    const text = [item?.observationZh, item?.fixZh].filter((value) => typeof value === "string").join("\n");
    return AUDIO_CLAIM.test(text) && !AUDIO_BOUNDARY.test(text)
      ? [`japanSignals.${key} mentions pronunciation or speech speed; without original audio these must not be evaluated`]
      : [];
  });
}

/**
 * 写入前已经整体校验过；这里只做防御性的整理：去空白、丢掉不属于该问题块的句子。
 * 不合法的输入返回 undefined，而不是补成「做到」——缺失必须保持缺失。
 *
 * @param {unknown} value
 * @param {Map<string, Set<string>>} sentencesByBlock
 */
export function normalizeJapanSignals(value, sentencesByBlock) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = /** @type {Record<string, any>} */ (value);
  if (!JAPAN_SIGNAL_KEYS.every((key) => source[key] && typeof source[key] === "object")) return undefined;
  return Object.fromEntries(JAPAN_SIGNAL_KEYS.map((key) => {
    const item = source[key];
    const verdict = japanSignalVerdicts(key).includes(item.verdict) ? item.verdict : "insufficient_material";
    const evidence = (Array.isArray(item.evidence) ? item.evidence : [])
      .filter((ref) => ref && typeof ref === "object" && sentencesByBlock.has(String(ref.blockId)))
      .map((ref) => ({
        blockId: String(ref.blockId),
        sentenceIds: (Array.isArray(ref.sentenceIds) ? ref.sentenceIds : [])
          .map(String).filter((id) => sentencesByBlock.get(String(ref.blockId)).has(id)),
      }))
      .filter((ref) => ref.sentenceIds.length > 0);
    return [key, {
      verdict,
      observationZh: typeof item.observationZh === "string" ? item.observationZh.trim() : "",
      fixZh: typeof item.fixZh === "string" ? item.fixZh.trim() : "",
      evidence,
    }];
  }));
}

/**
 * 读取已持久化报告里的信号层。旧报告、版本不明或结构不全时返回 null：
 * 界面和对照表据此显示「未评估」，而不是把缺失当成没问题。
 *
 * @param {unknown} review
 */
export function readJapanSignals(review) {
  const value = review && typeof review === "object" ? /** @type {Record<string, any>} */ (review) : null;
  if (!value || typeof value.japanSignalsVersion !== "string" || !value.japanSignals || typeof value.japanSignals !== "object") return null;
  const signals = value.japanSignals;
  if (!JAPAN_SIGNAL_KEYS.every((key) => signals[key] && JAPAN_SIGNAL_VERDICTS.includes(signals[key].verdict))) return null;
  return { version: value.japanSignalsVersion, signals };
}

const OUTPUT_EVIDENCE = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["blockId", "sentenceIds"],
    properties: { blockId: { type: "string" }, sentenceIds: { type: "array", items: { type: "string" } } },
  },
};

/** Bridge 结构化输出里的 japanSignals。版本号由服务器写入，不让模型自报。 */
export const JAPAN_SIGNALS_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [...JAPAN_SIGNAL_KEYS],
  properties: Object.fromEntries(JAPAN_SIGNAL_KEYS.map((key) => [key, {
    type: "object",
    additionalProperties: false,
    required: ["verdict", "observationZh", "fixZh", "evidence"],
    properties: {
      verdict: { type: "string", enum: japanSignalVerdicts(key) },
      observationZh: { type: "string" },
      fixZh: { type: "string" },
      evidence: OUTPUT_EVIDENCE,
    },
  }])),
};

/** 与 references/scoring-rubric.md「日本面试信号」同口径的 Bridge 提示；改口径时两处一起改。 */
export function japanSignalsInstruction() {
  return `另返回japanSignals：整场级日本面试信号，与五维分开，不折算分数、不进五维均分、不改五维扣分。七项各给verdict、observationZh、fixZh、evidence。verdict：good做到、mixed部分、poor没做到，这三档必须在evidence引用本场真实{blockId,sentenceIds}（句子必须属于该q）；not_applicable未触发、insufficient_material资料不足不评价本人，可不引句，但observationZh要说明查过哪些段落、为何不能判断。motivation志望度・入社意欲：是否把想进这家公司/想做这份工作说出口；只说兴趣、只讲条件或把来日/择业动机讲成避险（只讲稳定、难被解雇、劳动法保护）为mixed，整场没说为poor。closing收尾表态：最后的感谢与意愿表态、是否请求推进；只有「かしこまりました」「以上です」「特にありません」为poor，只道谢不表态为mixed，以签证或条件问题结束也不算表态。志望度和收尾不适用「没被问到的不评」，每场都要判断：完整资料下不能写资料不足或未触发，只有该段确实缺录时才写insufficient_material。concernRecovery：面试官流露的懸念（日语对客沟通、经验缺口、在留、年龄、稳定性等）是否当场回应并化解，须同时引用面试官懸念句和本人回应句；懸念悬着或被本人的话加深为poor；面试官没有流露懸念时写not_applicable。unpromptedNegative：是否主动说出没被问的负面——落选经历、为事实道歉（为没做过的事先说すみません）、自贬、给自己的事实加「多分」；诚实回答被问到的边界不算，偶发一次轻度自谦为mixed。registerConsistency：只看即兴段（追问、闲聊、临场补充）的です・ます，以原::转写为准，正::是清洗稿可能已被改成敬体；记忆重构或非逐字稿只能insufficient_material；背过的段落工整不能代表即兴段。salaryVisaLine：谈到年收或在留时是否照本人当时的既定口径说，口径只认INPUT_JSON.statedPositions中self层资料，并按面试日期选当时有效的版本，不能拿事后改过的口径倒查；主动压低、报出求人范围以外的数字、在留只给一个笼统称呼而没说出准备好的完整口径都算偏离；没谈到为not_applicable，当时口径不明为insufficient_material。reverseQuestions：逆質問是意欲型（入社后的角色、期待、团队、成长、事业课题）还是条件型（薪资、加班、远程、福利、签证手续）；以条件型为主、最后一问落在签证或回答「特にありません」为poor；面试官没有给提问机会为not_applicable。无原音不评发音、语速、口音。mixed/poor的fixZh给下一场可直接照做的一句话或动作，只用已确认事实，不编经历；good可写保持方式。事后结果不倒推现场表现。`;
}

/** Markdown 报告里的「日本面试信号」节。Web 生成与 Vault 模式定向补充用同一个渲染，避免两种写法。 */
export function renderJapanSignalsMarkdown(signals) {
  if (!signals) return "";
  const rows = JAPAN_SIGNAL_KEYS.map((key) => {
    const item = signals[key];
    const meta = JAPAN_SIGNAL_META[key];
    const verdict = meta.verdicts[item.verdict] ?? item.verdict;
    const evidence = item.evidence.map((ref) => `${ref.blockId}/${ref.sentenceIds.join("・")}`).join("；");
    return `- **${meta.label}：${verdict}**（${JAPAN_SIGNAL_VERDICT_SHORT[item.verdict] ?? item.verdict}）${item.observationZh}\n`
      + `  - 证据：${evidence || "未引句（未触发或资料不足）"}\n`
      + `  - 下一步：${item.fixZh || "—"}`;
  }).join("\n");
  return `### 日本面试信号\n\n> 整场级信号，与五维分开：不折算分数，不进五维均分。志望度和收尾每场都评；其余未出现的情境记为未触发。无原音不评发音和语速。\n\n${rows}`;
}
