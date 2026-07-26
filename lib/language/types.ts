import type { MasteryStatus, TrainingStatus } from "@/lib/dojo/types";

export type LanguageCategory =
  | "numbers_reading"
  | "vocabulary"
  | "technical_vocabulary"
  | "grammar"
  | "particles_collocations"
  | "interview_expression"
  | "business_expression"
  | "delivery_buffer";

export type LanguageEvidence = {
  path: string;
  excerpt: string;
};

export type LanguageDrillType = "choice" | "text" | "ordering";

export type LanguageDrill = {
  id: string;
  unitId: string;
  type: LanguageDrillType;
  promptZh: string;
  promptJa?: string;
  choices: string[];
  correctAnswer?: string;
  acceptedAnswers: string[];
  correctOrder: string[];
  explanationZh: string;
};

export type LanguageUnit = {
  id: string;
  canonicalKey: string;
  category: LanguageCategory;
  titleZh: string;
  targetJa: string;
  reading: string;
  meaningZh: string;
  usageZh: string;
  register: "interview" | "business" | "both";
  exampleKind: "general" | "personal";
  exampleJa: string;
  alternativesJa: string[];
  commonErrorJa: string;
  correctedJa: string;
  errorReasonZh: string;
  cautionZh: string;
  evidence: LanguageEvidence[];
  factSensitive: boolean;
  factSourcePaths: string[];
  relatedDojoItemIds: string[];
  priority: number;
  drills: LanguageDrill[];
};

export type LanguageQuestionType = LanguageDrillType | "free_response";

export type LanguageExamQuestion = {
  id: string;
  unitId: string;
  category: LanguageCategory;
  type: LanguageQuestionType;
  promptZh: string;
  promptJa?: string;
  choices: string[];
  correctAnswer?: string;
  acceptedAnswers: string[];
  correctOrder: string[];
  rubricZh?: string;
};

export type LanguageBank = {
  version: 1;
  generatedAt: string;
  model: string;
  sourceFingerprint: string;
  sourceCount: number;
  summaryZh: string;
  immediateAdviceZh: string;
  units: LanguageUnit[];
  questionBank: LanguageExamQuestion[];
};

export type LanguageTrainingEvent = {
  id: string;
  unitId: string;
  action: "trained" | "reverted";
  at: string;
  sessionId?: string;
  score?: number;
};

export type LanguageSessionKind = "quick" | "standard" | "intensive" | "special";

export type LanguageSession = {
  id: string;
  kind: LanguageSessionKind;
  createdAt: string;
  bankFingerprint: string;
  unitIds: string[];
  drillIds?: string[];
  category?: LanguageCategory;
  signature?: string;
};

export type LanguageAnswer = {
  questionId: string;
  answer: string;
};

export type LanguageDrillGrade = {
  questionId: string;
  unitId: string;
  score: number;
  passed: boolean;
  userAnswer: string;
  correctAnswer: string;
  feedbackZh: string;
};

export type LanguageSessionAttempt = {
  id: string;
  submissionId: string;
  sessionId: string;
  submittedAt: string;
  bankFingerprint: string;
  unitIds: string[];
  score: number;
  grades: LanguageDrillGrade[];
};

export type LanguageCoachSentence = {
  unitId: string;
  text: string;
};

export type LanguageCoachUnitFeedback = {
  unitId: string;
  meaning: number;
  grammar: number;
  naturalness: number;
  register: number;
  speakability: number;
  factSafety: number;
  criticalError: boolean;
  feedbackZh: string;
  correctedJa: string;
};

export type LanguageCoachFeedback = {
  id: string;
  submissionId: string;
  sessionId: string;
  submittedAt: string;
  bankFingerprint: string;
  model: string;
  summaryZh: string;
  factualRisk: boolean;
  unitFeedbacks: LanguageCoachUnitFeedback[];
};

export type LanguageExamKind = "quick" | "formal" | "special";

export type LanguageExamDefinition = {
  id: string;
  name: string;
  kind: LanguageExamKind;
  createdAt: string;
  bankFingerprint: string;
  questions: LanguageExamQuestion[];
  signature?: string;
};

export type LanguageOpenDimensions = {
  meaning: number;
  grammar: number;
  naturalness: number;
  register: number;
  speakability: number;
  factSafety: number;
};

export type LanguageExamGrade = LanguageDrillGrade & {
  criticalError: boolean;
  dimensions?: LanguageOpenDimensions;
  improvedAnswerJa?: string;
};

export type LanguageUnitExamResult = {
  unitId: string;
  score: number;
  passed: boolean;
  assessed: boolean;
  criticalError: boolean;
};

export type LanguageExamReport = {
  id: string;
  examId: string;
  examName: string;
  submittedAt: string;
  model: string;
  bankFingerprint: string;
  score: number;
  categoryScores: Partial<Record<LanguageCategory, number>>;
  questions: LanguageExamQuestion[];
  grades: LanguageExamGrade[];
  unitResults: LanguageUnitExamResult[];
  newlyMastered: string[];
  stillUnmastered: string[];
};

export type LanguageUnitState = LanguageUnit & {
  trainingStatus: TrainingStatus;
  masteryStatus: MasteryStatus;
  available: boolean;
  blockedReasonZh?: string;
  latestScore?: number;
  bestScore?: number;
  examCount: number;
  failedCount: number;
  latestTrainedAt?: string;
  lastExamAt?: string;
};

export type LanguageState = {
  ready: boolean;
  stale: boolean;
  currentSourceFingerprint?: string;
  bank?: LanguageBank;
  units: LanguageUnitState[];
  trainingEvents: LanguageTrainingEvent[];
  sessionAttempts: LanguageSessionAttempt[];
  coachFeedbacks: LanguageCoachFeedback[];
  examReports: LanguageExamReport[];
};

// v2 は「教材の一覧」ではなく、面接証拠から作る集中訓練カリキュラム。
// v1 の型は既存ログを読み続けるために残し、相互変換はしない。
export type LanguageLearningItemKind =
  | "error_patch"
  | "active_chunk"
  | "interviewer_phrase"
  | "answer_strategy"
  | "technical_term"
  | "fact_anchor";

export type LanguageTrainingStage =
  | "unseen"
  | "recognized"
  | "correctable"
  | "retrievable"
  | "transferable"
  | "stable";

export type LanguageEvidenceRef = {
  path: string;
  interviewKey: string;
  sentenceId?: string;
  blockId?: string;
  excerpt: string;
};

export type LanguageLearningItem = {
  id: string;
  canonicalKey: string;
  kind: LanguageLearningItemKind;
  titleZh: string;
  targetJa: string;
  reading: string;
  meaningZh: string;
  promptZh: string;
  originalJa: string;
  correctedJa: string;
  pattern: string;
  sourceInterviewKeys: string[];
  evidence: LanguageEvidenceRef[];
  factSensitive: boolean;
  factSourcePaths: string[];
  basePriority: number;
  listeningMark?: "×" | "△";
  strategyTags: string[];
};

export type LanguageIssueSummary = {
  key: string;
  label: string;
  kind: LanguageLearningItemKind;
  occurrenceCount: number;
  interviewCount: number;
  itemIds: string[];
  evidence: LanguageEvidenceRef[];
};

export type LanguageAbilityProfile = {
  interviewCount: number;
  learnerErrorCount: number;
  reviewedBlockCount: number;
  listeningGapCount: number;
  staleReviewPaths: string[];
  topIssues: LanguageIssueSummary[];
};

export type LanguageCurriculum = {
  version: 2;
  generatedAt: string;
  sourceFingerprint: string;
  contentFingerprint?: string;
  sourceCount: number;
  summaryZh: string;
  items: LanguageLearningItem[];
  profile: LanguageAbilityProfile;
};

export type LanguageItemProgress = {
  itemId: string;
  stage: LanguageTrainingStage;
  seenCount: number;
  successCount: number;
  failureCount: number;
  successDates: string[];
  firstSuccessAt?: string;
  lastSeenAt?: string;
  nextDueAt?: string;
  rejected: boolean;
  postTrainingOccurrences: number;
};

export type LanguageBatchPhase = "scan" | "compile" | "stress" | "completed";
export type LanguageScanJudgment = "known" | "uncertain" | "unknown" | "reject";

export const LANGUAGE_COMPILE_LIMIT = 20;
export const LANGUAGE_STRESS_LIMIT = 15;
export const LANGUAGE_OPEN_STRESS_LIMIT = 3;

export type LanguageBatchAction = {
  actionId: string;
  itemId: string;
  phase: Exclude<LanguageBatchPhase, "completed">;
  at: string;
  judgment?: LanguageScanJudgment;
  answer?: string;
  passed?: boolean;
};

export type LanguageBatch = {
  id: string;
  date: string;
  createdAt: string;
  updatedAt: string;
  curriculumFingerprint: string;
  targetSize: 100 | 150 | 200;
  phase: LanguageBatchPhase;
  cursor: number;
  scanItemIds: string[];
  compileItemIds: string[];
  stressItemIds: string[];
  actions: LanguageBatchAction[];
  signature: string;
  completedAt?: string;
};

export type LanguageBatchHistory = {
  id: string;
  date: string;
  targetSize: number;
  completedCount: number;
  successCount: number;
  completedAt?: string;
};

export type LanguageV2State = {
  ready: boolean;
  stale: boolean;
  curriculum?: LanguageCurriculum;
  progress: LanguageItemProgress[];
  currentBatch?: LanguageBatch;
  history: LanguageBatchHistory[];
};
