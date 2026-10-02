export type InterviewRound = "" | "agent" | "casual" | "final" | `round-${1 | 2 | 3 | 4 | 5 | 6}`;

export type CalendarRoundBadge = {
  mark: string;
  label: string;
  kind: "casual" | "numbered" | "final";
};

const ROUND_NUMERALS = ["一", "二", "三", "四", "五", "六"];
const ENGLISH_ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth"];

/** 只读明确的阶段名称；接触序号和面试官职级不能证明是第几轮或终面。 */
export function interviewRound(value: string): InterviewRound {
  const normalized = value.normalize("NFKC").toLocaleLowerCase();
  // 仅当括号明确是旧案内名时优先采用当前阶段；「三次（最終）」仍应显示终面。
  const primary = normalized.split(/[（(](?:案内|原案内|原称|旧称)/u)[0];
  if (primary !== normalized) {
    const round = interviewRound(primary);
    if (round) return round;
  }
  const compact = normalized.replace(/\s+/g, "");
  if (/说明会|説明会|說明會|セミナー|\bseminar\b/i.test(normalized)) return "";
  if (/(?:エージェント|猎头|獵頭)(?:面接|面试|面試|面談|面谈|$)/.test(compact) ||
    /\brecruiter(?:[\s-]+(?:interview|meeting)\b|$)/.test(normalized)) return "agent";
  // 「最終調整」等下一步行动，不能作为已确定最终面试的依据。
  if (/(?:最終|最终)(?=面接|面试|面試|面談|面谈|[）)]|$)|終面|终面/.test(compact) ||
    /\bfinal(?:[\s-]+(?:round|interview|meeting)\b|$)/.test(normalized)) return "final";
  if (/(?:カジュアル|轻松|輕鬆)(?=(?:(?:電話|オンライン|web)[・/-]?)?(?:面接|面试|面試|面談|面谈)|[）)]|$)/.test(compact) ||
    /\bcasual(?:[\s-]+(?:interview|meeting)\b|$)/.test(normalized)) return "casual";
  // 「1次選考」只有本身就是阶段名，或明确说明这场面谈所属阶段时才可补足；文书筛选不算面试。
  const selection = /面接|面试|面試|面談|面谈|\binterview\b|\bmeeting\b/.test(normalized) ||
    /^(?:第\s*)?[一二三四五六1-6]\s*次\s*(?:選考|选考)$/.test(normalized.trim());
  // 排除相邻数字，避免把「十三次」「11次」截取成支持范围内的一轮。
  const number = normalized.match(/(?:^|[^一二三四五六七八九十百\d])(?:第\s*)?([一二三四五六1-6])\s*(?:次|回|輪|轮)?\s*(?:面接|面试|面試|面談|面谈|面)/)?.[1] ??
    normalized.match(/(?:^|[^一二三四五六七八九十百\d])(?:第\s*)?([一二三四五六1-6])\s*(?:次|回|輪|轮)\s*$/)?.[1] ??
    (selection ? normalized.match(/(?:^|[^一二三四五六七八九十百\d])(?:第\s*)?([一二三四五六1-6])\s*次\s*(?:選考|选考)/)?.[1] : undefined);
  if (number) {
    const index = ROUND_NUMERALS.indexOf(number);
    return `round-${index >= 0 ? index + 1 : Number(number)}` as InterviewRound;
  }
  const ordinal = normalized.match(/\b(first|second|third|fourth|fifth|sixth)(?:[\s-]+(?:round|interview|meeting)\b|$)/)?.[1];
  return ordinal ? `round-${ENGLISH_ORDINALS.indexOf(ordinal) + 1}` as InterviewRound : "";
}

/** 徽标和场次匹配共用同一解析，避免卡片数字与打开的准备稿轮次不一致。 */
export function calendarRoundBadge(label: string): CalendarRoundBadge | null {
  const round = interviewRound(label);
  if (round === "casual") return { mark: "0", label: "轻松面谈", kind: "casual" };
  if (round === "final") return { mark: "终", label: "最终面试", kind: "final" };
  if (round.startsWith("round-")) {
    const mark = round.slice("round-".length);
    return { mark, label: `第${ROUND_NUMERALS[Number(mark) - 1]}次面试`, kind: "numbered" };
  }
  return null;
}
