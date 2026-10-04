import type {
  LanguageBatch,
  LanguageBatchAction,
  LanguageBatchHistory,
  LanguageItemProgress,
  LanguageLearningItemKind,
  LanguageScanJudgment,
  LanguageTrainingStage,
} from "./language/types.ts";
import {
  LANGUAGE_COMPILE_LIMIT,
  LANGUAGE_OPEN_STRESS_LIMIT,
  LANGUAGE_STRESS_LIMIT,
} from "./language/types.ts";

/*
 * 集中训练的结算统计。只读服务端已经判过分的批次，不在前端重新判分：
 * passed 由服务端 mergeLanguageBatchCheckpoint 与 Codex 批改写入，客户端算的结果无效。
 */

export const STAGE_ORDER: readonly LanguageTrainingStage[] = [
  "unseen",
  "recognized",
  "correctable",
  "retrievable",
  "transferable",
  "stable",
];

export function stageRank(stage: LanguageTrainingStage) {
  return STAGE_ORDER.indexOf(stage);
}

/**
 * pass / fail：服务端判定。
 * blank：没作答（没有动作，或输入后又清空）。服务端会把清空的动作记成未通过，但那不是「答错」。
 * ungraded：回答结构题超出每批 Codex 批改上限，确定没有送去批改。
 * unconfirmed：回答结构题送去批改但结果是未通过——Codex 离线时接口同样返回未通过，
 *   两者在响应里分不出来，所以不画成 ×。
 */
export type SettleMark = "pass" | "fail" | "blank" | "ungraded" | "unconfirmed";

export type SettleItem = {
  itemId: string;
  phase: "compile" | "stress";
  mark: SettleMark;
  open: boolean;
};

export type PhaseTally = Record<SettleMark, number> & { total: number };

export type ScanTally = Record<LanguageScanJudgment, number> & { total: number; unjudged: number };

export type StageChange = {
  itemId: string;
  from: LanguageTrainingStage;
  to: LanguageTrainingStage;
};

export type FullSettlement = {
  kind: "full";
  batchId: string;
  date: string;
  targetSize: number;
  scan: ScanTally;
  compile: PhaseTally;
  stress: PhaseTally;
  compileItems: SettleItem[];
  stressItems: SettleItem[];
  /** 命中数 / 已作答数；没有任何作答时为 null，界面显示「—」而不是 0%。 */
  hits: number;
  answered: number;
  rate: number | null;
  /** 作答了但没画成 × 的题数（ungraded + unconfirmed）。 */
  pendingReview: number;
  promoted: StageChange[];
  demoted: StageChange[];
  /** 比较基准：本批开始时的快照，还是本次打开训练页时的快照（之前已保存的作答不计入）。 */
  baseline: "batch" | "session" | "none";
};

export type HistorySettlement = {
  kind: "history";
  batchId: string;
  date: string;
  targetSize: number;
  completedCount: number;
  successCount: number;
};

export type Settlement = FullSettlement | HistorySettlement;

export type StageSnapshot = {
  scope: "batch" | "session";
  stages: Record<string, LanguageTrainingStage>;
};

const emptyTally = (): PhaseTally => ({ total: 0, pass: 0, fail: 0, blank: 0, ungraded: 0, unconfirmed: 0 });

function latestByItem(actions: LanguageBatchAction[], phase: LanguageBatchAction["phase"]) {
  const sorted = actions.filter((action) => action.phase === phase).sort((left, right) => left.at.localeCompare(right.at));
  const latest = new Map<string, LanguageBatchAction>();
  for (const action of sorted) latest.set(action.itemId, action);
  return latest;
}

function phaseItemIds(listed: string[], limit: number, latest: Map<string, LanguageBatchAction>) {
  // 界面只展示前 limit 项，但旧批次里超出上限且已作答的项目服务端也会保留，结算要算上。
  const ids = listed.slice(0, limit);
  for (const id of latest.keys()) if (!ids.includes(id)) ids.push(id);
  return ids;
}

/** 与 complete 路由的送评规则一致：按时间顺序取前 N 道非空的回答结构题。 */
function openActionsSentForGrading(
  actions: LanguageBatchAction[],
  kindOf: (itemId: string) => LanguageLearningItemKind | undefined,
) {
  return new Set(
    [...actions]
      .sort((left, right) => left.at.localeCompare(right.at))
      .filter((action) => action.phase === "stress" && kindOf(action.itemId) === "answer_strategy" && action.answer?.trim())
      .slice(0, LANGUAGE_OPEN_STRESS_LIMIT)
      .map((action) => action.actionId),
  );
}

function markOf(
  action: LanguageBatchAction | undefined,
  open: boolean,
  sent: Set<string>,
): SettleMark {
  if (!action || !action.answer?.trim()) return "blank";
  if (action.passed === true) return "pass";
  // 普通题服务端总会写 passed；万一缺了也只能说「没判」，不能当成答错。
  if (!open) return action.passed === false ? "fail" : "ungraded";
  return sent.has(action.actionId) ? "unconfirmed" : "ungraded";
}

/** 只记批次内项目的阶段，作为结算时「升阶」的比较基准。 */
export function snapshotStages(progress: LanguageItemProgress[], itemIds: Iterable<string>) {
  const wanted = new Set(itemIds);
  const stages: Record<string, LanguageTrainingStage> = {};
  for (const entry of progress) if (wanted.has(entry.itemId)) stages[entry.itemId] = entry.stage;
  return stages;
}

export function diffStages(
  before: Record<string, LanguageTrainingStage>,
  after: LanguageItemProgress[],
) {
  const promoted: StageChange[] = [];
  const demoted: StageChange[] = [];
  for (const entry of after) {
    const from = before[entry.itemId];
    // 基准里没有的项目（课程中途重建新增）不知道原来在哪一阶，不算升也不算降。
    if (!from || from === entry.stage) continue;
    const change = { itemId: entry.itemId, from, to: entry.stage };
    if (stageRank(entry.stage) > stageRank(from)) promoted.push(change);
    else demoted.push(change);
  }
  const byGain = (left: StageChange, right: StageChange) =>
    stageRank(right.to) - stageRank(left.to) || left.itemId.localeCompare(right.itemId);
  return { promoted: promoted.sort(byGain), demoted: demoted.sort(byGain) };
}

export function summarizeBatch({
  batch,
  kindOf,
  before,
  after,
}: {
  batch: LanguageBatch;
  kindOf: (itemId: string) => LanguageLearningItemKind | undefined;
  before?: StageSnapshot;
  after: LanguageItemProgress[];
}): FullSettlement {
  const scanLatest = latestByItem(batch.actions, "scan");
  const scan: ScanTally = { total: batch.scanItemIds.length, unjudged: 0, known: 0, uncertain: 0, unknown: 0, reject: 0 };
  for (const id of batch.scanItemIds) {
    const judgment = scanLatest.get(id)?.judgment;
    if (judgment) scan[judgment] += 1;
    else scan.unjudged += 1;
  }

  const sent = openActionsSentForGrading(batch.actions, kindOf);
  const tallyPhase = (phase: "compile" | "stress", listed: string[], limit: number) => {
    const latest = latestByItem(batch.actions, phase);
    const tally = emptyTally();
    const items = phaseItemIds(listed, limit, latest).map((itemId): SettleItem => {
      const open = phase === "stress" && kindOf(itemId) === "answer_strategy";
      const mark = markOf(latest.get(itemId), open, sent);
      tally[mark] += 1;
      tally.total += 1;
      return { itemId, phase, mark, open };
    });
    return { tally, items };
  };
  const compile = tallyPhase("compile", batch.compileItemIds, LANGUAGE_COMPILE_LIMIT);
  const stress = tallyPhase("stress", batch.stressItemIds, LANGUAGE_STRESS_LIMIT);

  const hits = compile.tally.pass + stress.tally.pass;
  const answered = compile.tally.total - compile.tally.blank + stress.tally.total - stress.tally.blank;
  const changes = before ? diffStages(before.stages, after) : { promoted: [], demoted: [] };

  return {
    kind: "full",
    batchId: batch.id,
    date: batch.date,
    targetSize: batch.targetSize,
    scan,
    compile: compile.tally,
    stress: stress.tally,
    compileItems: compile.items,
    stressItems: stress.items,
    hits,
    answered,
    rate: answered ? hits / answered : null,
    pendingReview: compile.tally.ungraded + stress.tally.ungraded + stress.tally.unconfirmed,
    promoted: changes.promoted,
    demoted: changes.demoted,
    baseline: before?.scope ?? "none",
  };
}

/** 重复提交已完成的批次时接口只给汇总行，没有逐题数据，只能出简版。 */
export function summarizeHistory(entry: LanguageBatchHistory): HistorySettlement {
  return {
    kind: "history",
    batchId: entry.id,
    date: entry.date,
    targetSize: entry.targetSize,
    completedCount: entry.completedCount,
    successCount: entry.successCount,
  };
}
