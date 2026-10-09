/*
 * 选考漏斗与选考管线的纯计算。分析页画图、表格「前段比」列与测试共用这一份，
 * 免得图上写「→ 62.5%」、表里又按另一种口径算出别的数。
 */

export type FunnelStage = { stage: string; value: number };

export type FunnelStep = FunnelStage & {
  /** 相对第一段（応募）的比例。第一段为 0 时一律 0，不画出 NaN。 */
  ofTop: number;
  /**
   * 相对前一段的转化率。第一段没有前段＝null；前段为 0 时也是 null（不可定义，而不是 0%）。
   * 观测口径下后段可能大于前段（台帳只记不採用），这里不截断，原样交给画面去说明。
   */
  ofPrevious: number | null;
};

export function funnelSteps(stages: readonly FunnelStage[]): FunnelStep[] {
  const top = stages[0]?.value ?? 0;
  return stages.map((stage, index) => {
    const previous = index > 0 ? stages[index - 1].value : null;
    return {
      ...stage,
      ofTop: top > 0 ? stage.value / top : 0,
      ofPrevious: previous === null || previous <= 0 ? null : stage.value / previous,
    };
  });
}

export type PipelineSegment = { status: string; count: number; share: number };

/**
 * 「选考管线」分段条：按给定状态顺序数件数。0 件的段保留在数据里（表格和读屏要知道它是 0），
 * 画面自己决定是否隐藏；share 以各段合计为分母，合计为 0 时全是 0。
 */
export function pipelineSegments(
  jobs: readonly { status: string }[],
  statuses: readonly string[],
): PipelineSegment[] {
  const counts = statuses.map((status) => jobs.filter((job) => job.status === status).length);
  const total = counts.reduce((sum, count) => sum + count, 0);
  return statuses.map((status, index) => ({
    status,
    count: counts[index],
    share: total > 0 ? counts[index] / total : 0,
  }));
}
