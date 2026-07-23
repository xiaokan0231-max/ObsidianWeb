import type {
  LanguageBank,
  LanguageCoachFeedback,
  LanguageExamReport,
  LanguageSessionAttempt,
  LanguageState,
  LanguageTrainingEvent,
} from "./types";

export function deriveLanguageState(
  bank: LanguageBank | undefined,
  events: LanguageTrainingEvent[],
  attempts: LanguageSessionAttempt[],
  feedbacks: LanguageCoachFeedback[],
  reports: LanguageExamReport[],
  currentSourceFingerprint?: string,
): LanguageState {
  const orderedEvents = [...events].sort((left, right) => left.at.localeCompare(right.at));
  const orderedReports = [...reports].sort((left, right) =>
    left.submittedAt.localeCompare(right.submittedAt),
  );
  const stale = Boolean(
    bank && currentSourceFingerprint && bank.sourceFingerprint !== currentSourceFingerprint,
  );
  if (!bank) {
    return {
      ready: false,
      stale: false,
      currentSourceFingerprint,
      units: [],
      trainingEvents: orderedEvents,
      sessionAttempts: attempts,
      coachFeedbacks: feedbacks,
      examReports: [...orderedReports].reverse(),
    };
  }

  const units = bank.units.map((unit) => {
    const unitEvents = orderedEvents.filter((event) => event.unitId === unit.id);
    const latestTraining = unitEvents.at(-1);
    const assessed = orderedReports.flatMap((report) =>
      report.unitResults
        .filter((result) => result.unitId === unit.id && result.assessed)
        .map((result) => ({ ...result, at: report.submittedAt })),
    );
    const latest = assessed.at(-1);
    const available = !(stale && unit.factSensitive) &&
      !(unit.factSensitive && unit.factSourcePaths.length === 0);
    const latestScore = latest?.score;
    const failedCount = assessed.filter((result) => !result.passed).length;
    return {
      ...unit,
      trainingStatus: latestTraining?.action === "trained" ? "trained" : "untrained",
      masteryStatus: latest ? (latest.passed ? "mastered" : "failed") : "unassessed",
      available,
      blockedReasonZh: available
        ? undefined
        : stale
          ? "Vault 事实来源已变化，重建训练库后才能继续使用这个个性化单元。"
          : "这个个人事实缺少权威来源，确认后才能进入训练。",
      latestScore,
      bestScore: assessed.length
        ? Math.max(...assessed.map((result) => result.score))
        : undefined,
      examCount: assessed.length,
      failedCount,
      latestTrainedAt: latestTraining?.action === "trained" ? latestTraining.at : undefined,
      lastExamAt: latest?.at,
    } as const;
  });

  units.sort((left, right) => {
    const score = (unit: (typeof units)[number]) =>
      unit.priority +
      unit.failedCount * 14 +
      (unit.latestScore === undefined ? 8 : Math.max(0, 80 - unit.latestScore) / 2) -
      (unit.masteryStatus === "mastered" ? 20 : 0) -
      (unit.available ? 0 : 1000);
    return score(right) - score(left);
  });

  return {
    ready: true,
    stale,
    currentSourceFingerprint,
    bank,
    units,
    trainingEvents: orderedEvents,
    sessionAttempts: [...attempts].sort((left, right) =>
      right.submittedAt.localeCompare(left.submittedAt),
    ),
    coachFeedbacks: [...feedbacks].sort((left, right) =>
      right.submittedAt.localeCompare(left.submittedAt),
    ),
    examReports: [...orderedReports].reverse(),
  };
}
