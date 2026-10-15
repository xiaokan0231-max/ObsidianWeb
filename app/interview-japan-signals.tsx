"use client";

// 「日本面试信号」的两处展示：单场复盘里的七项信号，和跨场的「信号 × 选考结果」对照。
// 判断口径、标签和计数都来自 lib（japan-interview-signals.mjs / interview-outcome.ts），这里只负责排版——
// 在组件里另写一套标签或计数，界面和 vault 的生成笔记就会各说各的。

import {
  buildSignalOutcomeComparison,
  COMPARABLE_OUTCOMES,
  INTERVIEW_OUTCOME_LABELS,
  interviewJapanSignals,
  resolveInterviewOutcomes,
  SIGNAL_OUTCOME_SOURCE_NOTE,
  signalOutcomeCaveat,
  verdictTallyText,
  type InterviewOutcome,
  type JapanSignalItem,
  type JapanSignalKey,
  type SignalOutcomeComparison,
} from "@/lib/interview-outcome";
import { JAPAN_SIGNAL_KEYS, JAPAN_SIGNAL_META, JAPAN_SIGNAL_VERDICT_SHORT } from "@/lib/japan-interview-signals.mjs";
import type { Note } from "@/lib/notes";
import { joinReviewNotes } from "@/lib/review-join";
import { parseInterviewAnswerReview, type InterviewAnswerReview } from "@/lib/review-deep";
import "./styles/interview-japan-signals.css";

const COPY_JA: Record<string, string> = {
  "日本面试信号": "日本の面接で見られるシグナル",
  "选考结果": "選考結果",
  "下一步": "次にすること",
  "查看原文": "原文を見る",
  "日本面试信号 × 选考结果": "面接シグナル × 選考結果",
  "日期": "日付",
  "公司 · 轮次": "企業 · 回",
  "结果": "結果",
  "信号": "シグナル",
};

type Translate = (label: string) => string;
const identity: Translate = (label) => label;

/** 日语界面只换标题和按钮；判断正文保持中文正本，避免译文与 vault 报告不一致。 */
export function signalsCopy(locale: string): Translate {
  return locale === "ja" ? (label) => COPY_JA[label] ?? label : identity;
}

function verdictText(key: JapanSignalKey, item: JapanSignalItem) {
  const verdicts = JAPAN_SIGNAL_META[key].verdicts as Record<string, string>;
  return verdicts[item.verdict] ?? JAPAN_SIGNAL_VERDICT_SHORT[item.verdict];
}

function OutcomeChip({ outcome }: { outcome: InterviewOutcome | null }) {
  const kind = outcome?.kind ?? "unknown";
  return <span className={`js-outcome-chip o-${kind}`} title={outcome?.detail ?? "没有可用的选考记录"}>
    {outcome?.label ?? INTERVIEW_OUTCOME_LABELS.unknown}
  </span>;
}

/** 单场：七项信号逐项给结论、观察、下一步和原句入口；旧复盘明确显示「未评估」。 */
export function JapanSignalsPanel({ review, outcome, onEvidence, t = identity }: {
  review?: InterviewAnswerReview | null;
  outcome: InterviewOutcome | null;
  onEvidence: (blockId: string, sentenceIds: string[]) => void;
  t?: Translate;
}) {
  const signals = interviewJapanSignals(review);
  return <section className="js-panel" aria-label={t("日本面试信号")}>
    <header>
      <div>
        <span className="js-eyebrow">整场 · 与五维分开，不进总分</span>
        <h2>{t("日本面试信号")}</h2>
        <p>对方没有单独问、却会据此判断的整场行为：志望度、收尾表态、懸念有没有当场化解、有没有主动说负面、即兴时的です・ます、年收和在留口径、逆質問的类型。</p>
      </div>
      <div className="js-outcome">
        <span>{t("选考结果")}</span>
        <OutcomeChip outcome={outcome} />
        <small>{outcome?.detail ?? "没有可用的选考记录"}</small>
      </div>
    </header>
    {signals ? <ol className="js-signal-grid">
      {JAPAN_SIGNAL_KEYS.map((key) => {
        const item = signals[key];
        return <li key={key} className={`js-signal v-${item.verdict}`}>
          <div className="js-signal-head">
            <h3>{JAPAN_SIGNAL_META[key].label}</h3>
            <span className={`js-verdict v-${item.verdict}`}>{JAPAN_SIGNAL_VERDICT_SHORT[item.verdict]}</span>
          </div>
          <p className="js-verdict-text">{verdictText(key, item)}</p>
          <p>{item.observationZh}</p>
          {item.fixZh && <p className="js-fix"><b>{t("下一步")}</b>{item.fixZh}</p>}
          {item.evidence.length > 0 && <div className="js-evidence" aria-label={`${JAPAN_SIGNAL_META[key].label}的原句`}>
            {item.evidence.map((ref) => <button type="button" key={`${ref.blockId}:${ref.sentenceIds.join(",")}`}
              title={t("查看原文")} onClick={() => onEvidence(ref.blockId, ref.sentenceIds)}>
              {ref.blockId} · {ref.sentenceIds.join("・")}
            </button>)}
          </div>}
        </li>;
      })}
    </ol> : <p className="js-empty">这份复盘生成于新口径之前，还没有评日本面试信号，不代表这些方面都做到了。历史复盘不改写；重新生成或要求重评这一场后，七项信号会显示在这里。</p>}
    <p className="js-footnote">每项判断都引用本场原句；未触发或资料不足不评价本人。无原音不评发音和语速。选考结果是面试之后的记录，只在跨场对照里并排，不用来倒推这一场的表现。</p>
  </section>;
}

/** 跨场：每场一行，结果与七项信号并排；有足够场次时再给按结果分组的计数。 */
export function SignalOutcomeTable({ comparison, onSelect, t = identity }: {
  comparison: SignalOutcomeComparison;
  onSelect?: (key: string) => void;
  t?: Translate;
}) {
  if (comparison.rows.length === 0) return null;
  const rows = [...comparison.rows].reverse();
  return <section className="js-compare" aria-label={t("日本面试信号 × 选考结果")}>
    <header>
      <h2>{t("日本面试信号 × 选考结果")}</h2>
      <p>{signalOutcomeCaveat(comparison)}</p>
    </header>
    {comparison.assessed === 0 && <p className="js-empty">还没有场次按新口径评了日本面试信号：历史复盘不改写，新生成或要求重评的场次才会填进信号列。下面先按场列出已有的选考结果。</p>}
    <div className="js-table-wrap">
      <table className="js-table">
        <thead><tr>
          <th scope="col">{t("日期")}</th>
          <th scope="col">{t("公司 · 轮次")}</th>
          <th scope="col">{t("结果")}</th>
          {JAPAN_SIGNAL_KEYS.map((key) => <th scope="col" key={key} title={JAPAN_SIGNAL_META[key].question}>{JAPAN_SIGNAL_META[key].short}</th>)}
        </tr></thead>
        <tbody>{rows.map((row) => <tr key={row.key}>
          <td>{row.date}</td>
          <td>{onSelect
            ? <button type="button" onClick={() => onSelect(row.key)}>{row.company}<small>{row.round}</small></button>
            : <span>{row.company}<small>{row.round}</small></span>}</td>
          <td><OutcomeChip outcome={row.outcome} /></td>
          {JAPAN_SIGNAL_KEYS.map((key) => {
            const item = row.signals?.[key];
            return <td key={key}>{item
              ? <span className={`js-cell v-${item.verdict}`} title={`${verdictText(key, item)}：${item.observationZh}`}>{JAPAN_SIGNAL_VERDICT_SHORT[item.verdict]}</span>
              : <span className="js-cell v-none" title="这场复盘没有评日本面试信号">—</span>}</td>;
          })}
        </tr>)}</tbody>
      </table>
    </div>
    {comparison.comparable > 0 && <div className="js-table-wrap">
      <table className="js-table js-tally">
        <caption>只计数：{comparison.comparable} 场既评了信号、又有通过／不採用／无音的结果</caption>
        <thead><tr>
          <th scope="col">{t("信号")}</th>
          {COMPARABLE_OUTCOMES.map((kind) => <th scope="col" key={kind}>{INTERVIEW_OUTCOME_LABELS[kind]}</th>)}
        </tr></thead>
        <tbody>{JAPAN_SIGNAL_KEYS.map((key) => <tr key={key}>
          <th scope="row">{JAPAN_SIGNAL_META[key].label}</th>
          {COMPARABLE_OUTCOMES.map((kind) => <td key={kind}>{verdictTallyText(comparison.bySignal[key][kind])}</td>)}
        </tr>)}</tbody>
      </table>
    </div>}
    <p className="js-footnote">{SIGNAL_OUTCOME_SOURCE_NOTE}</p>
  </section>;
}

type ReviewedInterview = { key: string; company: string; date: string; round: string; review?: InterviewAnswerReview | null };

/**
 * 复盘页与横向对照页共用的场次集合：有回答品质复盘的场次，与 vault:stats 的生成笔记同一口径。
 * key 是整理稿路径——选考结果也按整理稿路径解析。
 */
export function signalOutcomeComparison(interviews: ReviewedInterview[], outcomes: Map<string, InterviewOutcome>): SignalOutcomeComparison {
  return buildSignalOutcomeComparison(interviews.filter((item) => item.review).map((item) => ({
    key: item.key,
    company: item.company,
    date: item.date,
    round: item.round,
    outcome: outcomes.get(item.key) ?? null,
    signals: interviewJapanSignals(item.review),
  })));
}

/** 横向对照页没有现成的复盘列表，从笔记组装同一个集合。 */
export function signalOutcomeFromNotes(notes: Note[]): SignalOutcomeComparison {
  return signalOutcomeComparison(joinReviewNotes(notes).map((joined) => ({
    key: joined.key,
    company: joined.company,
    date: joined.date,
    round: joined.round,
    review: joined.deepReviewNote ? parseInterviewAnswerReview(joined.deepReviewNote.content) : null,
  })), resolveInterviewOutcomes(notes));
}
