"use client";

// 「日本面试信号」的两处展示：单场复盘里的七项信号，和跨场的「信号 × 选考结果」对照。
// 判断口径、标签和计数都来自 lib（japan-interview-signals.mjs / interview-outcome.ts），这里只负责排版——
// 在组件里另写一套标签或计数，界面和 vault 的生成笔记就会各说各的。

import { uiCopy } from "@/lib/ui-copy";

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
  "整场 · 与五维分开，不进总分": "面接全体 · 五項目の評価と分け、総合点には含めない",
  "对方没有单独问、却会据此判断的整场行为：志望度、收尾表态、懸念有没有当场化解、有没有主动说负面、即兴时的です・ます、年收和在留口径、逆質問的类型。": "個別に質問されなくても見られる面接全体の行動です。志望度、締めくくり、懸念への対応、自発的な否定的発言、即興での丁寧語、年収・在留資格の説明、逆質問の種類を確認します。",
  "这份复盘生成于新口径之前，还没有评日本面试信号，不代表这些方面都做到了。历史复盘不改写；重新生成或要求重评这一场后，七项信号会显示在这里。": "旧基準の振り返りのため、この7項目は未評価です。すべてできたという意味ではありません。再作成・再評価後に表示します。",
  "每项判断都引用本场原句；未触发或资料不足不评价本人。无原音不评发音和语速。选考结果是面试之后的记录，只在跨场对照里并排，不用来倒推这一场的表现。": "各判断にはこの面接の原発言を引用します。該当する場面がない・資料が不足する項目は評価しません。音声がないため発音・話す速さも評価しません。後日の選考結果は比較用に並べ、結果から面接の出来を推定しません。",
  "还没有场次按新口径评了日本面试信号：历史复盘不改写，新生成或要求重评的场次才会填进信号列。下面先按场列出已有的选考结果。": "新基準で評価した面接はまだありません。再作成・再評価した回から項目を表示します。以下には既存の選考結果を表示しています。",
  "没有可用的选考记录": "参照できる選考記録はありません",
  "通过": "通過",
  "无音": "連絡待ち",
  "不适用": "対象外",
  "做到": "できた",
  "部分": "一部できた",
  "没做到": "できなかった",
  "未触发": "該当場面なし",
  "资料不足": "資料不足",
  "未判断": "未判定",
  "收尾表态": "締めくくりの意思表示",
  "收尾": "締めくくり",
  "懸念当场化解": "その場での懸念の解消",
  "主动说负面": "自発的な否定的発言",
  "主动负面": "否定的発言",
  "即兴段です・ます": "即興でのです・ます",
  "年收・在留口径": "年収・在留資格の説明",
  "年收在留": "年収・在留資格",
  "逆質問类型": "逆質問の種類",
  "明确说出想进这家公司": "入社したい意思を明言",
  "只说兴趣，或把动机讲成避险": "興味だけ、または不安回避が動機",
  "没有说出口": "意思を言葉にしていない",
  "相关段落缺录": "該当する箇所の記録なし",
  "收尾明确表态": "締めくくりで意思を明言",
  "只有礼貌收尾": "礼儀正しい挨拶のみ",
  "收尾没有表态": "締めくくりで意思表示なし",
  "收尾段缺录": "締めくくりの記録なし",
  "当场化解": "その場で解消",
  "回应了但没化解": "応答したが解消せず",
  "懸念悬着或被加深": "懸念が残った・深まった",
  "面试官没有流露懸念": "面接官から懸念の表明なし",
  "相关段落不可靠": "該当箇所の記録が不確か",
  "没有主动说负面": "自発的な否定的発言なし",
  "偶有自贬或「多分」": "時折の自己卑下・「多分」",
  "主动说出没被问的负面": "聞かれていない否定的な内容を発言",
  "资料不足以判断": "資料不足で判断不可",
  "即兴段保持敬体": "即興でも丁寧語を維持",
  "偶尔滑到普通形": "時折普通形に変わった",
  "即兴时常用普通形": "即興で普通形が多い",
  "没有可靠逐字": "信頼できる逐語記録なし",
  "照既定口径说": "事前に決めた説明に沿った",
  "部分偏离口径": "事前の説明から一部ずれた",
  "自压价、报到范围外或口径没说出": "自ら条件を下げた・範囲外の条件・説明なし",
  "本场没谈到": "この面接では話題にならず",
  "当时口径或原话不明": "当時の方針・原発言が不明",
  "意欲型为主": "意欲を伝える質問が中心",
  "意欲型与条件型混合": "意欲と条件確認の質問が混在",
  "条件型为主或没有提问": "条件確認が中心・質問なし",
  "没有逆質問环节": "逆質問の場面なし",
  "逆質問段缺录": "逆質問の記録なし",
  "{signal}的原句": "{signal}の原発言",
  "这场复盘没有评日本面试信号": "この面接のシグナルは未評価",
  "只计数：{count} 场既评了信号、又有通过／不採用／无音的结果": "件数のみ：シグナル評価と通過・不採用・連絡待ちの結果がある{count}件",
  "有没有把想进这家公司、想做这份工作说出口": "この企業・仕事を希望する意思を言葉にしたか",
  "最后一段有没有表明意愿、感谢并请求推进": "最後に意思・感謝・次の選考への希望を伝えたか",
  "面试官流露的担心有没有当场回应并化解": "面接官の懸念にその場で応答し、解消したか",
  "有没有主动说出没被问的负面（落选经历、为事实道歉、自贬、给自己的事实加「多分」）": "聞かれていない否定的な情報を自分から話したか（不採用経験・事実への謝罪・自己卑下・自分の経験に「多分」）",
  "背好的段落以外，即兴回答有没有滑到普通形": "準備した回答以外の即興で、普通形になったか",
  "谈到年收或在留资格时，是否照本人当时的既定口径说": "年収・在留資格を、その時点で決めた方針どおり説明したか",
  "逆質問是在表达入社意欲，还是只确认条件": "逆質問で入社意欲を伝えたか、条件確認のみだったか",
  "样本很小：{total} 场复盘里 {assessed} 场按新口径评了日本面试信号，其中 {comparable} 场有明确结果（全部场次：{counts}）。这里只把信号和结果并排、只计数，不算比率、不推因果——选考结果还受岗位匹配、时机、竞争者和企业状况影响。": "標本は少数です。振り返り{total}件のうち{assessed}件を新基準で評価し、{comparable}件に比較可能な結果があります（全件：{counts}）。項目と結果を並べて件数のみを確認します。比率や因果関係は算出しません。結果は職種との適合、時期、競合候補、企業の状況にも左右されます。",
  "结果来源：同一案件之后还有下一轮的场次记为通过；最后一轮取关联 job-case 的 status，没有 job-case 的独立面谈取面谈 TODO 的 selection_status（closed 记为不採用、waiting 记为无音）。中介面谈不是企业选考，记为不适用。": "結果の出典：同じ案件の次回面接があれば通過とします。最終回は応募案件のstatus、独立した面談は面談TODOのselection_statusを参照します（closedは不採用、waitingは連絡待ち）。紹介会社との面談は企業の選考ではないため対象外です。",
};

type Translate = (label: string, values?: Record<string, string | number>) => string;
const identity: Translate = uiCopy("zh-CN", {});

/** 日语界面只换标题和按钮；判断正文保持中文正本，避免译文与 vault 报告不一致。 */
export function signalsCopy(locale: string): Translate {
  return uiCopy(locale === "ja" ? "ja" : "zh-CN", COPY_JA);
}

function verdictText(key: JapanSignalKey, item: JapanSignalItem) {
  const verdicts = JAPAN_SIGNAL_META[key].verdicts as Record<string, string>;
  return verdicts[item.verdict] ?? JAPAN_SIGNAL_VERDICT_SHORT[item.verdict];
}

function OutcomeChip({ outcome, t = identity }: { outcome: InterviewOutcome | null; t?: Translate }) {
  const kind = outcome?.kind ?? "unknown";
  return <span className={`js-outcome-chip o-${kind}`} title={outcome?.detail ?? t("没有可用的选考记录")}>
    {t(outcome?.label ?? INTERVIEW_OUTCOME_LABELS.unknown)}
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
        <span className="js-eyebrow">{t("整场 · 与五维分开，不进总分")}</span>
        <h2>{t("日本面试信号")}</h2>
        <p>{t("对方没有单独问、却会据此判断的整场行为：志望度、收尾表态、懸念有没有当场化解、有没有主动说负面、即兴时的です・ます、年收和在留口径、逆質問的类型。")}</p>
      </div>
      <div className="js-outcome">
        <span>{t("选考结果")}</span>
        <OutcomeChip outcome={outcome} t={t} />
        <small>{outcome?.detail ?? t("没有可用的选考记录")}</small>
      </div>
    </header>
    {signals ? <ol className="js-signal-grid">
      {JAPAN_SIGNAL_KEYS.map((key) => {
        const item = signals[key];
        return <li key={key} className={`js-signal v-${item.verdict}`}>
          <div className="js-signal-head">
            <h3>{t(JAPAN_SIGNAL_META[key].label)}</h3>
            <span className={`js-verdict v-${item.verdict}`}>{t(JAPAN_SIGNAL_VERDICT_SHORT[item.verdict])}</span>
          </div>
          <p className="js-verdict-text">{t(verdictText(key, item))}</p>
          <p>{item.observationZh}</p>
          {item.fixZh && <p className="js-fix"><b>{t("下一步")}</b>{item.fixZh}</p>}
          {item.evidence.length > 0 && <div className="js-evidence" aria-label={t("{signal}的原句", { signal: t(JAPAN_SIGNAL_META[key].label) })}>
            {item.evidence.map((ref) => <button type="button" key={`${ref.blockId}:${ref.sentenceIds.join(",")}`}
              title={t("查看原文")} onClick={() => onEvidence(ref.blockId, ref.sentenceIds)}>
              {ref.blockId} · {ref.sentenceIds.join("・")}
            </button>)}
          </div>}
        </li>;
      })}
    </ol> : <p className="js-empty">{t("这份复盘生成于新口径之前，还没有评日本面试信号，不代表这些方面都做到了。历史复盘不改写；重新生成或要求重评这一场后，七项信号会显示在这里。")}</p>}
    <p className="js-footnote">{t("每项判断都引用本场原句；未触发或资料不足不评价本人。无原音不评发音和语速。选考结果是面试之后的记录，只在跨场对照里并排，不用来倒推这一场的表现。")}</p>
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
      <p>{signalOutcomeCaveat(comparison, t)}</p>
    </header>
    {comparison.assessed === 0 && <p className="js-empty">{t("还没有场次按新口径评了日本面试信号：历史复盘不改写，新生成或要求重评的场次才会填进信号列。下面先按场列出已有的选考结果。")}</p>}
    <div className="js-table-wrap">
      <table className="js-table">
        <thead><tr>
          <th scope="col">{t("日期")}</th>
          <th scope="col">{t("公司 · 轮次")}</th>
          <th scope="col">{t("结果")}</th>
          {JAPAN_SIGNAL_KEYS.map((key) => <th scope="col" key={key} title={t(JAPAN_SIGNAL_META[key].question)}>{t(JAPAN_SIGNAL_META[key].short)}</th>)}
        </tr></thead>
        <tbody>{rows.map((row) => <tr key={row.key}>
          <td>{row.date}</td>
          <td>{onSelect
            ? <button type="button" onClick={() => onSelect(row.key)}>{row.company}<small>{row.round}</small></button>
            : <span>{row.company}<small>{row.round}</small></span>}</td>
          <td><OutcomeChip outcome={row.outcome} t={t} /></td>
          {JAPAN_SIGNAL_KEYS.map((key) => {
            const item = row.signals?.[key];
            return <td key={key}>{item
              ? <span className={`js-cell v-${item.verdict}`} title={`${t(verdictText(key, item))}：${item.observationZh}`}>{t(JAPAN_SIGNAL_VERDICT_SHORT[item.verdict])}</span>
              : <span className="js-cell v-none" title={t("这场复盘没有评日本面试信号")}>—</span>}</td>;
          })}
        </tr>)}</tbody>
      </table>
    </div>
    {comparison.comparable > 0 && <div className="js-table-wrap">
      <table className="js-table js-tally">
        <caption>{t("只计数：{count} 场既评了信号、又有通过／不採用／无音的结果", { count: comparison.comparable })}</caption>
        <thead><tr>
          <th scope="col">{t("信号")}</th>
          {COMPARABLE_OUTCOMES.map((kind) => <th scope="col" key={kind}>{t(INTERVIEW_OUTCOME_LABELS[kind])}</th>)}
        </tr></thead>
        <tbody>{JAPAN_SIGNAL_KEYS.map((key) => <tr key={key}>
          <th scope="row">{t(JAPAN_SIGNAL_META[key].label)}</th>
          {COMPARABLE_OUTCOMES.map((kind) => <td key={kind}>{verdictTallyText(comparison.bySignal[key][kind], t)}</td>)}
        </tr>)}</tbody>
      </table>
    </div>}
    <p className="js-footnote">{t(SIGNAL_OUTCOME_SOURCE_NOTE)}</p>
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
