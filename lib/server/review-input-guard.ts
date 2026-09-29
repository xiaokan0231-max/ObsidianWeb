export type ReviewInputSnapshot = ReadonlyArray<{
  path: string;
  content: string | null;
}>;

/** 长任务结束后再读依据；原文或本人补充变化时，不能用旧输入覆盖现有复盘。 */
export async function commitReviewWithFreshInputs<T>(
  snapshot: ReviewInputSnapshot,
  read: (path: string) => Promise<{ content: string } | null>,
  commit: () => Promise<T>,
): Promise<T> {
  const current = await Promise.all(snapshot.map(({ path }) => read(path)));
  if (snapshot.some(({ content }, index) => content !== (current[index]?.content ?? null))) {
    throw new Error("生成期间原文或本人补充已更新，请按最新材料重新生成；原报告已保留。");
  }
  return commit();
}
