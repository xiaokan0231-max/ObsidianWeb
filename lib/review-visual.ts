// 復盤画面の図（五維レーダー・回答分の推移・会社別の轮次線）が使う派生値。
// 画面側で場当たりに数えると、一覧の分数帯と詳細の分数帯が別々の閾値で割れても誰も気づかない。
// だから閾値も並び順もここ一箇所に置き、node:test で固定する。

import { buildInterviewTrends } from "./interview-trends.mjs";
import { REVIEW_DIMENSION_META, type InterviewAnswerReview, type ReviewDimensionKey } from "./review-deep.ts";

export type ReviewScoreBand = "high" | "mid" | "low" | "none";

/** 一覧カード・分数環・維度バーが共有する三段階。80 / 65 は既存の維度バーの色分けと同じ境目。 */
export function reviewScoreBand(score: number | null | undefined): ReviewScoreBand {
  if (score === null || score === undefined || !Number.isFinite(score)) return "none";
  return score >= 80 ? "high" : score >= 65 ? "mid" : "low";
}

/** 横断集計の入力。interview-trends の reviewTrendEntry と同じ形にそろえる。 */
export type ReviewVisualEntry = {
  key: string;
  company: string;
  date: string;
  round: string;
  review?: InterviewAnswerReview | null;
  result?: string;
};

export type DimensionAverages = Record<ReviewDimensionKey, number | null>;

/**
 * 「この場」を除いた過去の平均。自分自身を平均に混ぜると、場数が少ない今は
 * 比較線が本場の多角形に引き寄せられて差が見えなくなる。
 * 平均の計算そのものは vault の generated ノートと同じ buildInterviewTrends に任せる。
 */
export function historicalDimensionAverages(
  entries: ReviewVisualEntry[],
  excludeKey: string,
): DimensionAverages | null {
  const others = entries.filter((entry) => entry.key !== excludeKey && entry.review?.dimensions);
  if (others.length === 0) return null;
  const trends = buildInterviewTrends(others.map((entry) => ({ ...entry, review: entry.review ?? null }))) as {
    dimensionAverages: Record<string, number | null>;
  };
  const keys = Object.keys(REVIEW_DIMENSION_META) as ReviewDimensionKey[];
  const averages = Object.fromEntries(
    keys.map((key) => [key, trends.dimensionAverages[key] ?? null]),
  ) as DimensionAverages;
  return keys.some((key) => averages[key] !== null) ? averages : null;
}

export type ReviewScorePoint = {
  key: string;
  company: string;
  date: string;
  round: string;
  score: number;
};

/** 回答分の推移：深度復盤のある場だけ、古い順。同日は key で安定させる（再描画で点が入れ替わらない）。 */
export function reviewScoreTimeline(entries: ReviewVisualEntry[]): ReviewScorePoint[] {
  return entries
    .filter((entry): entry is ReviewVisualEntry & { review: InterviewAnswerReview } => Boolean(entry.review))
    .map((entry) => ({
      key: entry.key,
      company: entry.company,
      date: entry.date,
      round: entry.round,
      score: Math.round(entry.review.overallScore),
    }))
    .sort((left, right) => (left.date || "").localeCompare(right.date || "") || left.key.localeCompare(right.key));
}

export type ReviewCompanyGroup<T> = {
  company: string;
  /** 轮次線の並び：古い順。左から右へ「一次→二次→最終」と読めるようにする。 */
  rounds: T[];
  latestDate: string;
  /** 末端の結果徽章。最後の場の結果だけを使う——途中の場の結果は次の場があること自体が語っている。 */
  outcome?: string;
};

/** 会社ごとに束ねる。会社の並びは最後に面接した日の新しい順（一覧の既定と同じ向き）。 */
export function groupReviewsByCompany<T extends { key: string; company: string; date: string; result?: string }>(
  items: T[],
): ReviewCompanyGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const company = item.company || "公司未命名";
    const list = groups.get(company) ?? [];
    list.push(item);
    groups.set(company, list);
  }
  return [...groups.entries()]
    .map(([company, list]) => {
      const rounds = [...list].sort((left, right) =>
        (left.date || "").localeCompare(right.date || "") || left.key.localeCompare(right.key));
      const last = rounds.at(-1);
      return { company, rounds, latestDate: last?.date ?? "", outcome: last?.result || undefined };
    })
    .sort((left, right) => right.latestDate.localeCompare(left.latestDate) || left.company.localeCompare(right.company));
}
