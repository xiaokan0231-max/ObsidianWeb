// 面接準備に「その会社でしか成立しない志望動機」が実際に書かれているかを検査する。
// §1 の一行や共通カード p11 だけでは、面接でそのまま話せる回答にならないため別に確認する。

import { HEADING_RE, stripComments, stripFrontmatter } from "./interview-prep-embed.mjs";

// 新稿按语义章节分派；未声明版本的历史稿保留原来的编号契约。
/** @type {readonly { id: "overview" | "motivation" | "questions" | "resources" | "backup", title: string, navLabel: string }[]} */
export const PREP_V2_SECTIONS = [
  { id: "overview", title: "纵览与建议", navLabel: "纵览" },
  { id: "motivation", title: "志望動機", navLabel: "志望動機" },
  { id: "questions", title: "逆質問", navLabel: "逆質問" },
  { id: "resources", title: "研究资料", navLabel: "资料" },
  { id: "backup", title: "临场备用", navLabel: "临场备用" },
];

/**
 * v2 临场备用开头的三个固定块。不新增 H2：五章契约、导航与历史稿都不用动，临场卡按这些标题取出重排。
 * 标题原样匹配——改了一个字，Web 就认不出来，校验器也会按缺块报。
 * @type {readonly { id: "opening" | "concerns" | "closing", title: string }[]}
 */
export const PREP_V2_STAGE_BLOCKS = [
  { id: "opening", title: "冒頭30秒" },
  { id: "concerns", title: "本場の懸念 TOP3 と先回り一言" },
  { id: "closing", title: "締めの一言" },
];
export const PREP_V2_THANKS_TITLE = "当日お礼メッセージ";
/**
 * 新模板 frontmatter 的 `prep_contract`：有它，校验器才按新契约（临场三块、新版逆質問）强制检查。
 * 不按面试日期强制——旧模板写的草稿补上日期那一刻，不能让整个 vault 的检查被拦住。
 */
export const PREP_V2_CONTRACT = "2026-10";
/** 没有标记的旧模板稿，面试日期在这天及以后只给提醒（不拦）；更早的是历史稿，不回头补。 */
export const PREP_V2_STAGE_BLOCKS_FROM = "2026-10-16";
const SELF_INTRO_LINK_RE = /\[\[自己紹介_音読台本#[^\]|]+(?:\|[^\]]*)?\]\]/;
// 只抓「〜経験はまだありません」式的单纯否定和道歉：被问到时可以说边界，但先回り和締め不能用它开口。
const BARE_NEGATIVE_RE = /(?:経験|実績|こと)(?:は|が|も)?(?:まだ|あまり|ほとんど|全く|一度も|多く)?(?:ありません|ございません|ない)|申し訳|すみません/;

/**
 * 对照样稿文末的第六个 H2：写面试后才知道的事实，所以不能放进只含面试前信息的五章。
 * 只有样稿允许且必须有它，并引用整理稿 `#qNN`。
 */
export const PREP_V2_REPLAY_COMPARISON_TITLE = "对照：当时实际发生了什么／新稿会改变什么";

/** 逆質問的五种题型。标题写 `### 1. 〔题型〕主题`，备用写 `### 4. 备用｜〔题型〕主题`。 */
export const PREP_V2_QUESTION_TYPES = ["面接官本人型", "经验连接型", "事业课题型", "活跃期待型", "确认型"];
export const PREP_V2_INTERVIEWER_TITLE = "面接官研究";
const QUESTION_TITLE_RE = /^([1-5])\.\s*(备用｜)?〔([^〕]*)〕/;
// 开放式问题至少要有一个疑问词；没有的多半是一句「はい／いいえ」就答完的是非题。
const OPEN_QUESTION_RE = /どんな|どのよう|どういう|どう|何|なに|なん|どこ|いつ|誰|どなた|どれ|なぜ|から見て/;
const SELF_DEPRECATING_RE = /(?:つまらない|くだらない|初歩的な|素朴な)(?:質問|こと)/;
// 只禁「单独一句」：没有前置き、开口就问最期待什么。
const BARE_EXPECTATION_RE = /^(?:もし)?(?:入社(?:した|でき)ら[、,]?)?(?:最も|一番|特に)?期待され(?:ること|ている(?:こと|役割))/;
// カジュアル与一次面接里确认型不当主问题。
const EARLY_ROUND_RE = /カジュアル|一次|1次|１次|初回/;

/** @param {unknown} value @returns {1 | 2 | null} */
export function interviewPrepVersion(value) {
  if (value === undefined || value === 1 || value === "1") return 1;
  if (value === 2 || value === "2") return 2;
  return null;
}

function headingBlock(lines, startIndex, level) {
  let end = lines.length;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const match = lines[index].match(HEADING_RE);
    if (match && match[1].length <= level) {
      end = index;
      break;
    }
  }
  return lines.slice(startIndex + 1, end);
}

function semanticSectionLines(content, title) {
  const lines = stripComments(stripFrontmatter(content)).split("\n");
  const index = lines.findIndex((line) => {
    const match = line.match(HEADING_RE);
    return match?.[1].length === 2 && match[2].trim() === title;
  });
  return index < 0 ? null : headingBlock(lines, index, 2);
}

/**
 * @param {string} content @param {1 | 2} [prepVersion]
 * @param {{ date?: string, round?: string, contract?: string, strict?: boolean, replay?: boolean }} [options]
 *   contract：frontmatter 的 prep_contract；replay：对照样稿，按新契约整篇检查并要求文末对照节。
 */
export function interviewPrepStructureIssues(content, prepVersion = 1, options = {}) {
  if (prepVersion !== 2) return [];
  const body = stripComments(stripFrontmatter(content));
  const headings = [...body.matchAll(/^##\s+(.+)$/gm)].map((match) => match[1].trim());
  const issues = [];
  for (const spec of PREP_V2_SECTIONS) {
    const count = headings.filter((heading) => heading === spec.title).length;
    if (count !== 1) issues.push(`v2 需要且仅能有一个 \`## ${spec.title}\`（当前 ${count} 个）`);
    else if (!semanticSectionLines(content, spec.title)?.join("\n").trim()) {
      issues.push(`v2 的 \`## ${spec.title}\` 不能为空`);
    }
  }
  for (const heading of headings) {
    if (!PREP_V2_SECTIONS.some((spec) => spec.title === heading) && !(options.replay && heading === PREP_V2_REPLAY_COMPARISON_TITLE)) {
      issues.push(`v2 不支持额外的 H2「${heading}」，请放入五个语义章节内`);
    }
  }
  if (options.contract && options.contract !== PREP_V2_CONTRACT) {
    issues.push(`prep_contract 只支持 ${PREP_V2_CONTRACT}（当前 ${options.contract}）`);
  }
  if (options.replay) {
    const count = headings.filter((heading) => heading === PREP_V2_REPLAY_COMPARISON_TITLE).length;
    const lines = semanticSectionLines(content, PREP_V2_REPLAY_COMPARISON_TITLE)?.join("\n") ?? "";
    if (count !== 1) issues.push(`对照样稿需要且仅能有一个文末 \`## ${PREP_V2_REPLAY_COMPARISON_TITLE}\`（当前 ${count} 个）`);
    else if (!/\[\[[^\]]+#q\d+/.test(lines)) issues.push("对照节要引用整理稿的具体问答 `[[…#qNN…]]`");
  }
  return [...issues, ...prepStageBlockIssues(content, options), ...prepReverseQuestionIssues(content, options)];
}

const headingLevel = (line) => line.match(HEADING_RE)?.[1].length ?? 0;
const headingTitle = (line) => line.match(HEADING_RE)?.[2].trim() ?? "";
const filled = (text) => Boolean(text) && !text.includes("{{");

/** 带新模板标记的稿、或显式要求（对照样稿）时必须按新契约写；稿里已经用了某一部分时，那部分也要写全。 */
function contractDue({ contract = "", strict = false, replay = false }) {
  return strict || replay || contract === PREP_V2_CONTRACT;
}

/**
 * 旧模板写成、还没升级的 v2 稿：面试日期到了生效日，只提醒（vault:check 的 ⚠️），不拦。
 * 是否按新模板补齐由本人决定。
 * @param {string} content @param {1 | 2 | null} prepVersion
 * @param {{ date?: string, contract?: string }} [options]
 * @returns {string | null}
 */
export function prepContractReminder(content, prepVersion, { date = "", contract = "" } = {}) {
  if (prepVersion !== 2 || contract) return null;
  const day = String(date).trim().replace(/^["']|["']$/g, "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < PREP_V2_STAGE_BLOCKS_FROM) return null;
  const backup = semanticSectionLines(content, "临场备用") ?? [];
  const questions = semanticSectionLines(content, "逆質問") ?? [];
  const hasStage = PREP_V2_STAGE_BLOCKS.every((spec) => backup.some((line) => headingLevel(line) === 3 && headingTitle(line) === spec.title));
  const hasQuestions = questions.some((line) => headingLevel(line) === 3 && headingTitle(line) === PREP_V2_INTERVIEWER_TITLE);
  if (hasStage && hasQuestions) return null;
  return `按旧模板写成（无 prep_contract）：面试在 ${PREP_V2_STAGE_BLOCKS_FROM} 及以后，可按新模板补齐临场备用三块与新版逆質問，补齐后加上 prep_contract: ${PREP_V2_CONTRACT}`;
}

/** 台词行（含【面接官】预想回答）。去掉注音与加粗再查，免得「経験（けいけん）は」这类写法躲过检查。 */
function sayLine(line) {
  const body = line.trim().replace(/^>\s?/, "");
  const speaker = body.startsWith("【あなた】") ? "you" : body.startsWith("【面接官】") ? "interviewer" : null;
  if (!speaker) return null;
  return { speaker, text: body.slice(5).replace(/（[\p{Script=Hiragana}\p{Script=Katakana}ー・\s]+）/gu, "").replace(/\*/g, "").trim() };
}

function sayText(line) {
  const say = sayLine(line);
  return say?.speaker === "you" ? say.text : null;
}

/**
 * 临场备用的三个固定块。稿里出现任一块、或面试日期不早于生效日时才查：
 * 生效前的 v2 稿没有这三块也照常通过，一旦开始用就必须写全。
 * @param {string} content
 * @param {{ date?: string, strict?: boolean }} [options]
 */
export function prepStageBlockIssues(content, options = {}) {
  const lines = semanticSectionLines(content, "临场备用");
  if (!lines) return [];
  const found = (title) => lines.flatMap((line, index) => headingLevel(line) === 3 && headingTitle(line) === title ? [index] : []);
  if (!contractDue(options) && PREP_V2_STAGE_BLOCKS.every((spec) => found(spec.title).length === 0)) return [];

  const issues = [];
  for (const spec of PREP_V2_STAGE_BLOCKS) {
    const indexes = found(spec.title);
    if (indexes.length !== 1) {
      issues.push(`v2 的临场备用需要且仅能有一个 \`### ${spec.title}\`（当前 ${indexes.length} 个）`);
      continue;
    }
    const block = headingBlock(lines, indexes[0], 3);
    const says = block.map(sayText).filter((text) => text !== null);
    for (const text of says) {
      if (BARE_NEGATIVE_RE.test(text)) {
        issues.push(`「${spec.title}」的台词不能用单纯否定或道歉开口，改成现状＋计划：${text.slice(0, 40)}`);
      }
    }
    if (spec.id === "opening") {
      if (!says.some(filled)) issues.push("「冒頭30秒」缺少置换后的 `【あなた】` 挨拶");
      if (!SELF_INTRO_LINK_RE.test(block.join("\n"))) {
        issues.push("「冒頭30秒」缺少自己紹介的指定朗读节链接 `[[自己紹介_音読台本#…]]`");
      }
    } else if (spec.id === "concerns") {
      const items = block.flatMap((line, index) => headingLevel(line) === 4 ? [index] : []);
      if (items.length < 1 || items.length > 3) {
        issues.push(`「${spec.title}」需要 1〜3 个 \`####\` 懸念（当前 ${items.length} 个）`);
      }
      for (const index of items) {
        if (!headingBlock(block, index, 4).map(sayText).some(filled)) {
          issues.push(`懸念「${headingTitle(block[index])}」缺少置换后的 \`【あなた】\` 先回り一言`);
        }
      }
    } else {
      const firstSub = block.findIndex((line) => headingLevel(line) >= 4);
      if (!(firstSub < 0 ? block : block.slice(0, firstSub)).map(sayText).some(filled)) {
        issues.push("「締めの一言」缺少置换后的 `【あなた】` 志望度表达");
      }
      const thanks = block.flatMap((line, index) => headingLevel(line) === 4 && headingTitle(line) === PREP_V2_THANKS_TITLE ? [index] : []);
      if (thanks.length !== 1) {
        issues.push(`「締めの一言」需要且仅能有一个 \`#### ${PREP_V2_THANKS_TITLE}\`（当前 ${thanks.length} 个）`);
      } else if (!headingBlock(block, thanks[0], 4).some((line) => {
        const text = line.trim();
        return filled(text) && !text.startsWith("▷") && headingLevel(text) === 0;
      })) {
        issues.push(`「${PREP_V2_THANKS_TITLE}」缺少置换后的短文`);
      }
    }
  }
  return issues;
}

/**
 * 新版逆質問：面接官研究＋五题，每题前置き＋开放式问题、2〜3 组「预想回答→接话」、收住一句。
 * 触发条件同临场三块；旧格式（目的／听清什么／如何判断）的历史稿不查。
 * @param {string} content
 * @param {{ date?: string, round?: string, strict?: boolean }} [options]
 */
export function prepReverseQuestionIssues(content, options = {}) {
  const lines = semanticSectionLines(content, "逆質問");
  if (!lines) return [];
  const h3 = lines.flatMap((line, index) => headingLevel(line) === 3 ? [{ index, title: headingTitle(line) }] : []);
  const research = h3.filter((item) => item.title === PREP_V2_INTERVIEWER_TITLE);
  const questions = h3.filter((item) => /^[1-5]\./.test(item.title));
  const started = research.length > 0 || questions.some((item) => QUESTION_TITLE_RE.test(item.title));
  if (!contractDue(options) && !started) return [];

  const issues = [];
  if (research.length !== 1) {
    issues.push(`v2 的逆質問需要且仅能有一个 \`### ${PREP_V2_INTERVIEWER_TITLE}\`（当前 ${research.length} 个）`);
  } else {
    const block = headingBlock(lines, research[0].index, 3);
    if (!block.map(sayText).some(filled)) issues.push(`「${PREP_V2_INTERVIEWER_TITLE}」缺少现场钩子句型 \`【あなた】\``);
    if (!/https?:\/\/|未确认|未確認|当场自我介绍/.test(block.join("\n"))) issues.push(`「${PREP_V2_INTERVIEWER_TITLE}」要附出席者公开事实的直接 URL，或写明「未确认」`);
  }
  if (questions.length !== 5) issues.push(`逆質問需要 3 个主问题＋2 个备用，即 \`### 1.\`〜\`### 5.\`（当前 ${questions.length} 个）`);

  const types = [];
  for (const { index, title } of questions) {
    const match = title.match(QUESTION_TITLE_RE);
    const label = `逆質問「${title}」`;
    if (!match || !PREP_V2_QUESTION_TYPES.includes(match[3])) {
      issues.push(`${label}的标题要写成 \`N. 〔题型〕主题\`，题型为 ${PREP_V2_QUESTION_TYPES.join("／")} 之一`);
      continue;
    }
    const [, number, backup, type] = match;
    if (Number(number) >= 4 && !backup) issues.push(`${label}是备用题，标题写 \`${number}. 备用｜〔题型〕…\``);
    if (Number(number) <= 3) types.push(type);
    const block = headingBlock(lines, index, 3);
    const says = block.map(sayLine).filter(Boolean);
    const question = says[0];
    if (!question || question.speaker !== "you" || !filled(question.text)) {
      issues.push(`${label}缺少置换后的 \`【あなた】\` 问法`);
      continue;
    }
    const sentences = question.text.split(/[。？?]/).filter((part) => part.trim());
    const length = question.text.replace(/\s/g, "").length;
    if (sentences.length > 2) issues.push(`${label}的问法最多 2 句（当前 ${sentences.length} 句）`);
    if (length < 45 || length > 130) issues.push(`${label}的问法去注音后约 60〜110 字（当前 ${length} 字）`);
    if (!OPEN_QUESTION_RE.test(sentences.at(-1) ?? "")) issues.push(`${label}要问开放式问题（どんな／どのように／〇〇様から見て），不问是非`);
    if (BARE_EXPECTATION_RE.test(question.text)) issues.push(`${label}不能单独问「最も期待されること」，先给前置き或改成活跃期待型`);
    if (says.some((say) => say.speaker === "you" && SELF_DEPRECATING_RE.test(say.text))) issues.push(`${label}不用自贬式开头`);
    if (!block.some((line) => /^\*\*用到的信息\*\*/.test(line.trim()))) issues.push(`${label}缺少 \`**用到的信息**\``);
    // 问法之后应是 2〜3 组「【面接官】预想回答→【あなた】接话」，再以一句【あなた】收住。
    const flow = says.slice(1).map((say) => say.speaker === "you" ? "Y" : "I").join("");
    if (!/^(?:IY){2,3}Y$/.test(flow)) {
      issues.push(`${label}问法之后要有 2〜3 组「【面接官】预想回答→【あなた】接话」，最后一句【あなた】收住`);
    } else if (!says.slice(1).every((say) => filled(say.text))) {
      issues.push(`${label}的预想回答与接话还有未置换的占位`);
    }
    if (!block.some((line) => /^▷\s*这一问还能帮你判断/.test(line.trim()))) issues.push(`${label}缺少「▷ 这一问还能帮你判断」备注`);
  }
  if (types.length && !types.includes("面接官本人型")) issues.push("逆質問的主问题里至少要有 1 个〔面接官本人型〕");
  if (types.length && !types.includes("经验连接型")) issues.push("逆質問的主问题里至少要有 1 个〔经验连接型〕");
  if (EARLY_ROUND_RE.test(options.round ?? "") && types.includes("确认型")) {
    issues.push("カジュアル和一次面接里〔确认型〕不当主问题：放到备用，或改到人事面、内定后、站内消息");
  }
  return issues;
}

export function prepCarryForwardIssues(content, prepVersion = 1) {
  const scope = prepVersion === 2
    ? (semanticSectionLines(content, "纵览与建议") ?? []).join("\n")
    : content;
  return /^###\s+前回から今回への回流\s*$/m.test(scope)
    ? []
    : [prepVersion === 2
      ? "v2 的纵览与建议中缺少「### 前回から今回への回流」"
      : "§2 に「### 前回から今回への回流」が無い"];
}

function quickMotivationValue(lines) {
  for (const line of lines) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((cell) => cell.trim());
    if (cells[0] === "志望動機") return cells.slice(1).join("|").trim();
  }
  return "";
}

/**
 * Web の「本場専属・志望動機」入口もこの判定を使う。
 * §6 の外にある速査キーワードや共通カード p11 を拾うと、別会社でも同じ回答を
 * 開いてしまうため、想定問答内の H4 だけを返す。
 */
export function findCompanyMotivationHeading(content, prepVersion = 1) {
  if (prepVersion === 2) {
    return semanticSectionLines(content, "志望動機") ? "志望動機" : null;
  }
  const body = stripComments(stripFrontmatter(content));
  const lines = body.split("\n");
  const qaSectionIndex = lines.findIndex((line) => {
    const match = line.match(HEADING_RE);
    return match?.[1].length === 2 && match[2].includes("想定問答");
  });
  if (qaSectionIndex < 0) return null;

  const qaLines = headingBlock(lines, qaSectionIndex, 2);
  for (const line of qaLines) {
    const match = line.match(HEADING_RE);
    if (match?.[1].length === 4 && match[2].includes("志望動機")) {
      return match[2].trim();
    }
  }
  return null;
}

export function companyMotivationIssues(content, prepVersion = 1) {
  if (prepVersion === 2) {
    const lines = semanticSectionLines(content, "志望動機");
    return lines
      ? shortMotivationIssues(lines, 3)
      : ["v2 缺少 `## 志望動機` 的本公司专属回答"];
  }
  const body = stripComments(stripFrontmatter(content));
  const lines = body.split("\n");
  const issues = [];

  const quickSectionIndex = lines.findIndex((line) => {
    const match = line.match(HEADING_RE);
    return match?.[1].length === 2 && match[2].includes("速査");
  });
  const quickLines = quickSectionIndex < 0 ? [] : headingBlock(lines, quickSectionIndex, 2);
  const quickValue = quickMotivationValue(quickLines);
  if (!quickValue || quickValue.includes("{{")) {
    issues.push("§1「面談直前の一枚」に会社固有の志望動機が無い");
  }

  const qaSectionIndex = lines.findIndex((line) => {
    const match = line.match(HEADING_RE);
    return match?.[1].length === 2 && match[2].includes("想定問答");
  });
  const qaLines = qaSectionIndex < 0 ? [] : headingBlock(lines, qaSectionIndex, 2);
  const motivationHeading = findCompanyMotivationHeading(content);
  const questionIndex = motivationHeading
    ? qaLines.findIndex((line) => {
        const match = line.match(HEADING_RE);
        return match?.[1].length === 4 && match[2].trim() === motivationHeading;
      })
    : -1;
  if (questionIndex < 0) {
    issues.push("§6 に `#### Q. 志望動機` の会社特化回答が無い（§1 の一行や p11 の参照だけでは不可）");
    return issues;
  }

  const questionLines = headingBlock(qaLines, questionIndex, 4);
  return [...issues, ...shortMotivationIssues(questionLines, 5)];
}

function shortMotivationIssues(questionLines, shortLevel) {
  const issues = [];
  const shortIndex = questionLines.findIndex((line) => {
    const match = line.match(HEADING_RE);
    return match?.[1].length === shortLevel && match[2].trim() === "20秒版（既定）";
  });
  if (shortIndex < 0) {
    issues.push(`志望動機に \`${"#".repeat(shortLevel)} 20秒版（既定）\` が無い`);
  } else {
    const shortLines = headingBlock(questionLines, shortIndex, shortLevel);
    const answer = shortLines
      .filter((line) => line.includes("【あなた】"))
      .join("\n")
      .trim();
    if (!answer || answer.includes("{{")) {
      issues.push("志望動機の20秒版に、置換済みの `【あなた】` 回答が無い");
    } else {
      const sentenceCount = (answer.match(/。/g) ?? []).length;
      if (sentenceCount < 2 || sentenceCount > 3) {
        issues.push(`志望動機の20秒版は2〜3句にする（現在 ${sentenceCount} 句）`);
      }
    }
  }

  const questionText = questionLines.join("\n");
  if (!/^▷\s*根拠\s*[:：].*\[[^\]]+\]\(https:\/\/[^)]+\)/m.test(questionText)) {
    issues.push(`${shortLevel === 3 ? "志望動機の H2" : "志望動機と同じQブロック"}に \`▷ 根拠: [公式の直接ページ](https://…)\` が無い`);
  }

  return issues;
}
