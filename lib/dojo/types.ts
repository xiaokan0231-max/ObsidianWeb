export type TrainingStatus = "untrained" | "trained";
export type MasteryStatus = "unassessed" | "failed" | "mastered";

export type TrainingCategory =
  | "vocabulary"
  | "technical_vocabulary"
  | "grammar"
  | "expression"
  | "delivery"
  | "structure"
  | "intent"
  | "bridge"
  | "company";

export type Evidence = {
  path: string;
  excerpt: string;
};

export type TrainingItem = {
  id: string;
  canonicalKey?: string;
  category: TrainingCategory;
  titleZh: string;
  targetJa: string;
  explanationZh: string;
  evidence: Evidence[];
  priority: number;
  upcomingCompany?: string;
  drillZh: string;
  passCriteriaZh: string;
  risk: "low" | "medium" | "high";
};

export type ExamQuestionType = "choice" | "text" | "ordering" | "free_response";

export type ExamQuestion = {
  id: string;
  itemId: string;
  category: TrainingCategory;
  type: ExamQuestionType;
  promptZh: string;
  promptJa?: string;
  choices?: string[];
  correctAnswer?: string;
  acceptedAnswers?: string[];
  correctOrder?: string[];
  rubricZh?: string;
};

export type UpcomingFocus = {
  company: string;
  date?: string;
  focusZh: string[];
  questionIds: string[];
};

export type TrainingProfile = {
  version: 1 | 2;
  generatedAt: string;
  model: string;
  sourceFingerprint: string;
  sourceCount: number;
  summaryZh: string;
  immediateAdviceZh: string;
  learningItems: TrainingItem[];
  questionBank: ExamQuestion[];
  upcomingFocus: UpcomingFocus[];
};

export type TrainingEvent = {
  id: string;
  itemId: string;
  action: "trained" | "reverted";
  at: string;
  method?: string;
  note?: string;
  practiceAttemptId?: string;
};

export type GradeDimensions = {
  intent: number;
  conclusion: number;
  evidence: number;
  companyConnection: number;
  factualSafety: number;
  japanese: number;
  speakability: number;
};

export type ExamItemGrade = {
  questionId: string;
  itemId: string;
  score: number;
  passed: boolean;
  criticalError: boolean;
  dimensions?: GradeDimensions;
  feedbackZh: string;
  improvedAnswerJa?: string;
  userAnswer: string;
  correctAnswer?: string;
};

export type ItemExamResult = {
  itemId: string;
  score: number;
  passed: boolean;
  criticalError: boolean;
};

export type ExamReport = {
  id: string;
  examId: string;
  examName: string;
  submittedAt: string;
  model: string;
  profileFingerprint: string;
  score: number;
  categoryScores: Partial<Record<TrainingCategory, number>>;
  questions: ExamQuestion[];
  grades: ExamItemGrade[];
  itemResults: ItemExamResult[];
  newlyMastered: string[];
  stillUnmastered: string[];
};

export type TrainingItemState = TrainingItem & {
  trainingStatus: TrainingStatus;
  masteryStatus: MasteryStatus;
  latestScore?: number;
  bestScore?: number;
  examCount: number;
  failedCount: number;
  lastExamAt?: string;
};

export type DojoState = {
  ready: boolean;
  profile?: TrainingProfile;
  items: TrainingItemState[];
  trainingEvents: TrainingEvent[];
  examReports: ExamReport[];
};

export type CodexRuntimeStatus = {
  bridge: "ready" | "busy" | "offline" | "misconfigured";
  codexVersion?: string;
  authentication?: "chatgpt" | "api-key" | "unknown";
  safeBilling: boolean;
  queueDepth?: number;
  lastError?: string;
};
