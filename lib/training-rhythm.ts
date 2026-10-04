import type {
  LanguageBatchHistory,
  LanguageItemProgress,
  LanguageTrainingStage,
} from "./language/types.ts";
import { tokyoParts } from "./dojo/utils.ts";
import { STAGE_ORDER } from "./training-settlement.ts";

/*
 * 训练总览的节奏数字。全部来自批次历史与进度，不造积分、不造等级。
 * 日期一律按 JST 归日：批次的 date 字段是开批那天，跨零点做完的批次要算在完成那天。
 */

export function jstDay(iso: string) {
  const time = new Date(iso);
  return Number.isFinite(time.getTime()) ? tokyoParts(time).date : "";
}

export function shiftDay(day: string, offset: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function completionDays(history: LanguageBatchHistory[]) {
  return new Set(history.map((entry) => entry.completedAt ? jstDay(entry.completedAt) : "").filter(Boolean));
}

export type TrainingStreak = {
  days: number;
  /** done：今天已完成；holding：今天还没练，但昨天练过，连续没有断；none：没有在延续的连续。 */
  status: "done" | "holding" | "none";
  lastDay?: string;
};

/** 今天还没练不算断：从昨天往回数，界面显示「保持中」。 */
export function trainingStreak(history: LanguageBatchHistory[], today = tokyoParts().date): TrainingStreak {
  const days = completionDays(history);
  const lastDay = [...days].filter((day) => day <= today).sort().at(-1);
  const anchor = days.has(today) ? today : days.has(shiftDay(today, -1)) ? shiftDay(today, -1) : "";
  if (!anchor) return { days: 0, status: "none", lastDay };
  let count = 0;
  for (let day = anchor; days.has(day); day = shiftDay(day, -1)) count += 1;
  return { days: count, status: anchor === today ? "done" : "holding", lastDay };
}

export type TrainingDay = {
  day: string;
  batches: number;
  items: number;
  hits: number;
};

/** 最近 span 天（含今天，旧→新）每天完成的批次数、项目数与命中数。 */
export function dailyTraining(history: LanguageBatchHistory[], span = 14, today = tokyoParts().date): TrainingDay[] {
  const days = Array.from({ length: span }, (_, index) => shiftDay(today, index - span + 1));
  const byDay = new Map(days.map((day) => [day, { day, batches: 0, items: 0, hits: 0 }]));
  for (const entry of history) {
    if (!entry.completedAt) continue;
    const bucket = byDay.get(jstDay(entry.completedAt));
    if (!bucket) continue;
    bucket.batches += 1;
    bucket.items += entry.completedCount;
    bucket.hits += entry.successCount;
  }
  return days.map((day) => byDay.get(day)!);
}

/** 热度分级只看当天完成了几批：0 / 1 / 2 / 3+。不按项目数分级，避免大批次显得「更努力」。 */
export function heatLevel(day: TrainingDay) {
  return Math.min(3, day.batches);
}

export type StageShare = {
  stage: LanguageTrainingStage;
  count: number;
  share: number;
};

export function stageDistribution(progress: LanguageItemProgress[]): StageShare[] {
  const counts = new Map(STAGE_ORDER.map((stage) => [stage, 0]));
  for (const entry of progress) counts.set(entry.stage, (counts.get(entry.stage) ?? 0) + 1);
  const total = progress.length;
  return STAGE_ORDER.map((stage) => {
    const count = counts.get(stage) ?? 0;
    return { stage, count, share: total ? count / total : 0 };
  });
}

/** 工作区计时：mm:ss，满一小时后 h:mm:ss。 */
export function formatClock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/** 一小时训练目标的完成比例，0–1。 */
export const TRAINING_GOAL_MS = 60 * 60 * 1000;
export function goalRatio(ms: number, goal = TRAINING_GOAL_MS) {
  return Math.max(0, Math.min(1, ms / goal));
}
