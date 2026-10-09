"use client";

import { Fragment } from "react";
import {
  ACCESS_STATE_LABEL,
  HARD_GATE_LABEL,
  JOB_FIT_AXES,
  JOB_FIT_GATE_LABEL,
  JOB_FIT_SCORE_LABEL,
  JOB_ORIGIN_LABEL,
  UNRATED_V2_LABEL,
  type JobFit,
  type JobIntake,
} from "@/lib/jobs";
import { RadarChart } from "./radar-chart";
import { useJobMenu } from "./jobs-copy";
import type { Matcher } from "./jobs-types";

/* 卡片、列表、看板、决策台、抽屉与对比都要用的小部件和格式化函数。 */

export const COMPARE_LIMIT = 3;

export const ORIGIN_LABEL = JOB_ORIGIN_LABEL;

/**
 * 「已经动过手，但还没形成応募」的机会。
 *
 * Findy 的「いいかも」、媒体上的スカウト回信这类动作，本人做完了但企业没回应，
 * 求人票也没提交出去——按 7 枚举只能是 `未応募`。可是它和「还没看过的推荐」
 * 完全不是一回事：前者球在对方手里，本人现在做不了任何事。
 *
 * 混在一起会同时坏两头：未応募 的数字虚高，首页还催你去「判断是否応募」
 * 一个你三天前就点过的岗位。用 waiting_for 把两者分开。
 */

/**
 * 入库时期的强调档。今天进的必须一眼跳出来 —— 卡片按匹配度排时，
 * 新着は列の途中に埋もれる。ここが霞むと「今日は何が増えたか」を目で拾えない。
 */
export function intakeTone(intake: JobIntake) {
  if (intake === "today") return "new";
  if (intake === "d3" || intake === "d7") return "recent";
  return "old";
}

export function clip(text: string, limit: number) {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/**
 * 搜索词的高亮规则。由父级按关键词 useMemo 一次，卡片几百张时不必每张各编译一遍正则，
 * 也让 memo 过的卡片在关键词不变时拿到同一个引用。
 */
export function buildMatcher(query: string): Matcher {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  // 正则交替是最左优先而不是最长优先，先排长词，`java javascript` 才不会把 JavaScript 切成两半。
  const alternatives = [...tokens]
    .sort((left, right) => right.length - left.length)
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return { tokens, pattern: new RegExp(`(${alternatives.join("|")})`, "gi") };
}

/** 命中的搜索词在卡片文本里高亮，便于确认为什么这条被搜出来。 */
export function Highlight({ text, matcher }: { text: string; matcher: Matcher }) {
  if (!matcher) return <>{text}</>;
  const { tokens, pattern } = matcher;
  return (
    <>
      {text.split(pattern).map((piece, index) =>
        tokens.includes(piece.toLowerCase())
          ? <mark key={index}>{piece}</mark>
          : <Fragment key={index}>{piece}</Fragment>,
      )}
    </>
  );
}

/** カード右上の v2 採点札。Band と合計だけ——Gate は hold が既定で情報量が薄く、reject の時だけ色で知らせる。 */
export function FitChip({ fit }: { fit: JobFit }) {
  const { t, label: menuLabel } = useJobMenu();
  return (
    <span
      className={`job-fit-chip band-${fit.band} gate-${fit.hardGate}`}
      title={`${t("v2 採点")} ${fit.score}/100 · Band ${fit.band} · Gate ${menuLabel(HARD_GATE_LABEL[fit.hardGate])}`}
    >
      <b>{fit.band}</b><small>{fit.score}</small>
    </span>
  );
}

/** 六軸は満点がそれぞれ違う（25 / 10 / 15…）。雷达は満点比に揃えて形だけを比べる。 */
export const FIT_RADAR_AXES = JOB_FIT_AXES.map((key) => ({ key, label: JOB_FIT_SCORE_LABEL[key].label }));
export const fitRadarValues = (fit: JobFit) => JOB_FIT_AXES.map((key) => fit.scores[key] / JOB_FIT_SCORE_LABEL[key].max);

/** 抽屉の v2 六軸。未採点は文言のまま出す——0 のバーを 6 本並べると「全部最低」に見える。 */
export function FitPanel({ fit }: { fit: JobFit | null }) {
  const { t, label: menuLabel } = useJobMenu();
  if (!fit) return <p className="job-fit-panel job-fit-unrated">{t("v2 採点")}：{menuLabel(UNRATED_V2_LABEL)}</p>;
  const gateKeys = Object.keys(JOB_FIT_GATE_LABEL) as (keyof JobFit["gates"])[];
  return (
    <section className="job-fit-panel" aria-label={t("v2 採点")}>
      <header>
        <strong>Fit {fit.score}<small>/100</small></strong>
        <em className={`job-fit-band band-${fit.band}`}>Band {fit.band}</em>
        <em className={`job-fit-gate gate-${fit.hardGate}`}>Gate {HARD_GATE_LABEL[fit.hardGate]}</em>
        {fit.accessState && <span className="job-fit-access">{ACCESS_STATE_LABEL[fit.accessState]}</span>}
      </header>
      <div className="job-fit-body">
        {/* 雷达只看形状（哪一轴拖后腿），原始分数留在右侧条形里——各轴满分不同，雷达上标原值会误读。 */}
        <RadarChart
          className="job-fit-radar"
          axes={FIT_RADAR_AXES}
          series={[{ id: "fit", label: `Fit ${fit.score}`, values: fitRadarValues(fit) }]}
          max={1}
          size={240}
          showValues={false}
          title={t("v2 六轴雷达")}
        />
        <ul className="job-fit-axes">
          {JOB_FIT_AXES.map((key) => {
            const { label, max } = JOB_FIT_SCORE_LABEL[key];
            return (
              <li key={key}>
                <span>{label}</span>
                <i><b style={{ width: `${(fit.scores[key] / max) * 100}%` }} /></i>
                <small>{fit.scores[key]}/{max}</small>
              </li>
            );
          })}
        </ul>
      </div>
      <p className="job-fit-gates">
        {gateKeys.map((key) => fit.gates[key] && (
          <span key={key} className={`gate-${fit.gates[key]}`}>{JOB_FIT_GATE_LABEL[key]} {HARD_GATE_LABEL[fit.gates[key]]}</span>
        ))}
      </p>
    </section>
  );
}
