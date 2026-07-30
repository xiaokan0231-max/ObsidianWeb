/** 工作区计时只计算本次打开后的活跃时间，不把批次在库里放置的天数算成训练时长。 */
export function activeSessionMinutes(startedAt: number, now = Date.now()) {
  return Math.max(0, Math.floor((now - startedAt) / 60_000));
}

