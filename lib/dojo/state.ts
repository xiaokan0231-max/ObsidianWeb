import type {
  DojoState,
  ExamReport,
  TrainingEvent,
  TrainingProfile,
} from "./types.ts";

export function deriveDojoState(
  profile: TrainingProfile | undefined,
  events: TrainingEvent[],
  reports: ExamReport[],
): DojoState {
  if (!profile) {
    return {
      ready: false,
      items: [],
      trainingEvents: events,
      examReports: reports,
    };
  }
  const orderedEvents = [...events].sort((a, b) => a.at.localeCompare(b.at));
  const orderedReports = [...reports].sort((a, b) =>
    a.submittedAt.localeCompare(b.submittedAt),
  );
  const items = profile.learningItems.map((item) => {
    const itemEvents = orderedEvents.filter((event) => event.itemId === item.id);
    const trainingStatus =
      itemEvents.at(-1)?.action === "trained" ? "trained" : "untrained";
    const attempts = orderedReports.filter((report) =>
      report.itemResults.some((result) => result.itemId === item.id),
    );
    const results = attempts.flatMap((report) =>
      report.itemResults
        .filter((result) => result.itemId === item.id)
        .map((result) => ({ ...result, at: report.submittedAt })),
    );
    const latest = results.at(-1);
    const masteryStatus = latest
      ? latest.passed
        ? "mastered"
        : "failed"
      : "unassessed";
    return {
      ...item,
      trainingStatus,
      masteryStatus,
      latestScore: latest?.score,
      bestScore: results.length
        ? Math.max(...results.map((result) => result.score))
        : undefined,
      examCount: results.length,
      failedCount: results.filter((result) => !result.passed).length,
      lastExamAt: latest?.at,
    } as const;
  });
  items.sort((left, right) => {
    const score = (item: (typeof items)[number]) =>
      item.priority +
      (item.upcomingCompany ? 20 : 0) +
      item.failedCount * 12 +
      (item.latestScore !== undefined ? Math.max(0, 80 - item.latestScore) / 2 : 0) -
      (item.masteryStatus === "mastered" ? 18 : 0) +
      (item.masteryStatus === "mastered" &&
      item.lastExamAt &&
      Date.now() - new Date(item.lastExamAt).getTime() > 45 * 86_400_000
        ? 24
        : 0);
    return score(right) - score(left);
  });
  return {
    ready: true,
    profile,
    items,
    trainingEvents: orderedEvents,
    examReports: orderedReports.reverse(),
  };
}
