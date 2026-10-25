"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import {
  deriveLanguageExpressionProgress,
  findLanguageExpressionCourses,
  languageExpressionProgressPath,
  parseLanguageExpressionProgress,
  type CorrectionCard,
  type ExpressionChunk,
  type LearningBasis,
  type LanguageExpressionCourse,
  type LanguageExpressionExercise,
  type SafeRewriteCard,
} from "@/lib/language-expression-course";
import { parseInline } from "@/lib/interview-prep-doc";
import { postJson } from "@/lib/client-api";
import ScopeLoading from "./scope-loading";
import { isTypingTarget as isEditableTarget } from "@/lib/keyboard";
import { getTitle, type Note } from "@/lib/notes";
import { isLanguageScenarioResource } from "@/lib/vault-scope";
import { Inlines } from "./prep-doc-render";
import { notifyUrlChange } from "./use-url-state";
import { useUiLocale } from "./ui-locale";
import { createTrainingCopy, trainingTopicCopy } from "@/lib/special-training-i18n";
import { EXPRESSION_WORKBENCH_COPY } from "./language-expression-copy";
import LanguageScenarioCourse from "./language-scenario-course";
import LanguageTextbook from "./language-textbook";
import { useTextbookSearch } from "./use-textbook-position";
import { findLanguageTextbookChapters, languageChapterHref } from "@/lib/language-textbook";
import { readTextbookPosition, resolveTextbookPosition, type TextbookPosition } from "@/lib/language-textbook-position";
import { findInterviewQuestionCollections, questionCollectionHref } from "@/lib/interview-question-collection";
import InterviewQuestionCollectionView, { type QuestionCollectionFilterChange } from "./interview-question-collection";
import InterviewLanguageLearning from "./interview-language-learning";
import { languageIndexOf, languageIndexHref, questionLocation } from "@/lib/interview-language";
import { QUESTION_TOPICS } from "@/lib/interview-question-collection";
import { specialCourseHref, specialQuestionModuleHref, specialTrainingHref, specialTrainingRoute } from "@/lib/special-training-navigation";
import { SpecialTrainingBreadcrumbs, SpecialTrainingDashboard, SpecialTrainingModule } from "./special-training-dashboard";
import { useSpecialTrainingCopy } from "./special-training-copy";

const QUESTION_URL_KEYS = ["questionSet", "questionTopic", "questionReview", "questionKind", "questionSearch", "questionPage", "questionView", "languageCategory", "languagePoint", "questionId", "languageReturnCategory"];

// 练习方式的名称从界面字典派生，课程与练习素材仍按原文显示。
const EXPRESSION_MENU_COPY = {
  ...EXPRESSION_WORKBENCH_COPY,
  "专项课程目录": ["专项课程目录", "専門コース一覧"],
  "学习顺序与覆盖说明": ["学习顺序与覆盖说明", "学習順序と出典の説明"],
  "学习顺序": ["学习顺序", "学習順序"],
  "来源覆盖": ["来源覆盖", "出典の範囲"],
  "{count} 门课程": ["{count} 门课程", "{count} コース"],
  "{chunks} 词块 · {patterns} 句型": ["{chunks} 词块 · {patterns} 句型", "表現 {chunks} 件 · 文型 {patterns} 件"],
  "专项训练方式": ["专项训练方式", "専門トレーニングの練習方式"],
  "中译日词块": ["中译日词块", "中国語から日本語の表現へ"],
  "固定搭配补全": ["固定搭配补全", "定型表現の穴埋め"],
  "句型替换": ["句型替换", "文型の置き換え"],
  "随机表达": ["随机表达", "ランダム発話"],
  "安全改写": ["安全改写", "適切な言い換え"],
  "词": ["词", "語"],
  "搭": ["搭", "連"],
  "句": ["句", "型"],
  "说": ["说", "話"],
  "改": ["改", "改"],
  "先看中文功能，主动提取日语表达。": ["先看中文功能，主动提取日语表达。", "中国語で意図を確認し、日本語表現を思い出す。"],
  "把词块放回自然、常用的搭配中。": ["把词块放回自然、常用的搭配中。", "表現を自然でよく使う組み合わせに当てはめる。"],
  "用同一个骨架替换不同观点和内容。": ["用同一个骨架替换不同观点和内容。", "同じ文型で意見や内容を置き換える。"],
  "抽取原因、对策和句型，自由说二至四句。": ["抽取原因、对策和句型，自由说二至四句。", "原因・対策・文型を選び、自由に 2〜4 文話す。"],
  "修正真实口误，换掉绝对化或越界表达。": ["修正真实口误，换掉绝对化或越界表达。", "実際の言い間違いや、断定しすぎた表現を修正する。"],
  "词块范围": ["词块范围", "表現の範囲"],
  "核心词块": ["核心词块", "基本表現"],
  "扩展词块": ["扩展词块", "発展表現"],
} as const satisfies Record<string, readonly [string, string]>;

function useExpressionMenu() {
  const { locale } = useUiLocale();
  return createTrainingCopy(EXPRESSION_MENU_COPY, locale);
}

type PracticeMode =
  | "recall"
  | "collocation"
  | "substitution"
  | "improv"
  | "rewrite";

type ProgressState = {
  completedKeys: string[];
  improvCount: number;
  lastEventAt?: string;
};

type ProgressResponse = {
  ok: true;
  deduplicated: boolean;
  state: ProgressState;
  path: string;
  /** 更新後の進捗ノート。これで notes 配列を1件差し替え、全量再取得を省く。 */
  note?: Note;
};

type RewriteItem =
  | { kind: "correction"; item: CorrectionCard }
  | { kind: "safe"; item: SafeRewriteCard };

type SaveProgress = (
  itemId: string,
  exercise: LanguageExpressionExercise,
  action: "completed" | "reopened",
) => Promise<boolean>;
type MoveQuestion = (length: number, direction: -1 | 1) => void;

type ChunkLevel = "core" | "extended";
type PracticeCursor = Record<PracticeMode, number>;
type StudyPosition = {
  mode: PracticeMode;
  chunkLevel: ChunkLevel;
  cursor: PracticeCursor;
  updatedAt: string;
};
type StoredStudyState = {
  version: 1;
  activeCourseId: string;
  positions: Record<string, StudyPosition>;
};

const STUDY_POSITION_STORAGE_KEY = "echo:language-expression-position:v1";
const DEFAULT_CURSOR: PracticeCursor = {
  recall: 0,
  collocation: 0,
  substitution: 0,
  improv: 0,
  rewrite: 0,
};

const MODES: Array<{
  id: PracticeMode;
  label: string;
  short: string;
  description: string;
}> = [
  {
    id: "recall",
    label: "中译日词块",
    short: "词",
    description: "先看中文功能，主动提取日语表达。",
  },
  {
    id: "collocation",
    label: "固定搭配补全",
    short: "搭",
    description: "把词块放回自然、常用的搭配中。",
  },
  {
    id: "substitution",
    label: "句型替换",
    short: "句",
    description: "用同一个骨架替换不同观点和内容。",
  },
  {
    id: "improv",
    label: "随机表达",
    short: "说",
    description: "抽取原因、对策和句型，自由说二至四句。",
  },
  {
    id: "rewrite",
    label: "安全改写",
    short: "改",
    description: "修正真实口误，换掉绝对化或越界表达。",
  },
];

const EMPTY_PROGRESS: ProgressState = {
  completedKeys: [],
  improvCount: 0,
};

function isPracticeMode(value: unknown): value is PracticeMode {
  return MODES.some((mode) => mode.id === value);
}

function storedCursor(value: unknown): PracticeCursor {
  const source = value && typeof value === "object"
    ? value as Partial<Record<PracticeMode, unknown>>
    : {};
  return Object.fromEntries(
    MODES.map(({ id }) => {
      const cursor = source[id];
      return [id, typeof cursor === "number" && Number.isFinite(cursor) && cursor >= 0
        ? Math.floor(cursor)
        : 0];
    }),
  ) as PracticeCursor;
}

function readStoredStudyState(): StoredStudyState {
  const fallback: StoredStudyState = {
    version: 1,
    activeCourseId: "",
    positions: {},
  };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(STUDY_POSITION_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<StoredStudyState>;
    const positions: Record<string, StudyPosition> = {};
    if (parsed.positions && typeof parsed.positions === "object") {
      for (const [courseId, position] of Object.entries(parsed.positions)) {
        if (!position || typeof position !== "object") continue;
        const candidate = position as Partial<StudyPosition>;
        positions[courseId] = {
          mode: isPracticeMode(candidate.mode) ? candidate.mode : "recall",
          chunkLevel: candidate.chunkLevel === "extended" ? "extended" : "core",
          cursor: storedCursor(candidate.cursor),
          updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : "",
        };
      }
    }
    return {
      version: 1,
      activeCourseId: typeof parsed.activeCourseId === "string"
        ? parsed.activeCourseId
        : "",
      positions,
    };
  } catch {
    return fallback;
  }
}

// 学習位置は localStorage が出所なので、React ステートに写し取らず外部ストアとして購読する。
// useEffect + setState で読み込むと「初回レンダー → setState → 再レンダー」のカスケードになり、
// SSR とハイドレーションの食い違いも自前で面倒を見ることになる。
// useSyncExternalStore なら「まだ読んでいない = null」をサーバーと初回ハイドレーションに返し、
// マウント後の切り替えを React 側が担保してくれる。
const EMPTY_STUDY_STATE: StoredStudyState = {
  version: 1,
  activeCourseId: "",
  positions: {},
};

const studyStateListeners = new Set<() => void>();
// null = まだ localStorage を読んでいない。
let studyStateSnapshot: StoredStudyState | null = null;

function subscribeStudyState(listener: () => void) {
  studyStateListeners.add(listener);
  // subscribe はマウント後にしか走らないので、ここで読めばハイドレーションは崩れない。
  // 値が null から変わったことは、React が subscribe 直後のスナップショット比較で拾う。
  if (studyStateSnapshot === null) {
    studyStateSnapshot = readStoredStudyState();
  }
  return () => {
    studyStateListeners.delete(listener);
  };
}

function getStudyStateSnapshot() {
  return studyStateSnapshot;
}

function getServerStudyStateSnapshot(): StoredStudyState | null {
  return null;
}

function updateStudyState(
  update: (current: StoredStudyState) => StoredStudyState,
) {
  studyStateSnapshot = update(studyStateSnapshot ?? EMPTY_STUDY_STATE);
  try {
    window.localStorage.setItem(
      STUDY_POSITION_STORAGE_KEY,
      JSON.stringify(studyStateSnapshot),
    );
  } catch {
    // 保存領域が使えない環境でも、当日の練習操作そのものは止めない。
  }
  for (const listener of studyStateListeners) listener();
}

function allowsRevealShortcut(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return true;
  const interactive = target.closest("button, a, [role='button']");
  return !interactive || interactive.classList.contains("expression-reveal-button");
}

function completionKey(exercise: LanguageExpressionExercise, itemId: string) {
  return `${exercise}:${itemId}`;
}

function levelLabel(level: "core" | "extended") {
  return level === "core" ? "核心" : "扩展";
}

function learningBasisLabel(basis?: LearningBasis) {
  if (basis === "observed-error") return "真实错误";
  if (basis === "natural-upgrade") return "自然度升级";
  if (basis === "foundation") return "基础巩固";
  return "";
}

function evidenceLabel(reference: string) {
  const inner = reference.match(/^\[\[(.+)\]\]$/u)?.[1] ?? reference;
  const alias = inner.split("|").at(-1)?.trim();
  return alias || inner;
}

function EvidenceRefs({ references }: { references: string[] }) {
  const { t } = useExpressionMenu();
  if (!references.length) return null;
  return (
    <p className="expression-evidence">
      <b>{t("来自面试稿")}</b>
      <span lang="">{references.map(evidenceLabel).join(" ／ ")}</span>
    </p>
  );
}

function movedIndex(current: number, length: number, direction: -1 | 1) {
  if (length <= 1) return 0;
  return (current + direction + length) % length;
}

function randomIndex(length: number, previous = -1) {
  if (length <= 1) return 0;
  const candidate = Math.floor(Math.random() * length);
  return candidate === previous ? (candidate + 1) % length : candidate;
}

function makeEventId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `expression-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function postProgress(input: {
  courseId: string;
  itemId: string;
  exercise: LanguageExpressionExercise;
  action: "completed" | "reopened";
}) {
  return postJson<ProgressResponse & { ok?: boolean; error?: string }>("/api/language/topics/progress", { eventId: makeEventId(), ...input });
}

function courseProgress(course: LanguageExpressionCourse, notes: Note[]): ProgressState {
  const path = languageExpressionProgressPath(course);
  const note = notes.find((candidate) => candidate.path === path);
  if (!note) return EMPTY_PROGRESS;
  return deriveLanguageExpressionProgress(
    parseLanguageExpressionProgress(note.content).filter(
      (event) => event.courseId === course.courseId,
    ),
  );
}

function sequentialQuestionCount(
  course: LanguageExpressionCourse,
  mode: PracticeMode,
  chunkLevel: ChunkLevel,
) {
  if (mode === "recall") {
    return course.chunks.filter((chunk) => chunk.level === chunkLevel).length;
  }
  if (mode === "collocation") {
    return course.chunks.filter(
      (chunk) => chunk.level === chunkLevel && chunk.collocations.length > 0,
    ).length;
  }
  if (mode === "substitution") return course.patterns.length;
  if (mode === "rewrite") {
    return course.corrections.length + course.safeRewrites.length;
  }
  return 0;
}

function currentSequentialQuestion(
  course: LanguageExpressionCourse,
  mode: PracticeMode,
  chunkLevel: ChunkLevel,
  cursor: PracticeCursor,
): {
  itemId: string;
  exercise: LanguageExpressionExercise;
  length: number;
} | null {
  if (mode === "recall" || mode === "collocation") {
    const chunks = course.chunks.filter(
      (chunk) =>
        chunk.level === chunkLevel &&
        (mode !== "collocation" || chunk.collocations.length > 0),
    );
    const item = chunks[cursor[mode] % Math.max(chunks.length, 1)];
    return item
      ? { itemId: item.id, exercise: mode, length: chunks.length }
      : null;
  }
  if (mode === "substitution") {
    const item = course.patterns[
      cursor.substitution % Math.max(course.patterns.length, 1)
    ];
    return item
      ? {
          itemId: item.id,
          exercise: "substitution",
          length: course.patterns.length,
        }
      : null;
  }
  if (mode === "rewrite") {
    const items = [...course.corrections, ...course.safeRewrites];
    const item = items[cursor.rewrite % Math.max(items.length, 1)];
    return item
      ? { itemId: item.id, exercise: "rewrite", length: items.length }
      : null;
  }
  return null;
}

function LanguageExpressionCourses({
  notes,
  onOpen,
  onOpenWiki,
  onVaultChanged,
  onNoteWritten,
  loading = false,
}: {
  notes: Note[];
  onOpen: (note: Note) => void;
  onOpenWiki: (target: string, section?: string) => void;
  /** この視図の scope がまだ届いていない：空状態ではなく読取中を出す。 */
  loading?: boolean;
  onVaultChanged: () => Promise<void>;
  /** 進捗保存の応答に載る更新後ノートを1件差し替える。全量再取得（onVaultChanged）の代替。 */
  onNoteWritten?: (note: Note) => void;
}) {
  const { t } = useExpressionMenu();
  const ui = useSpecialTrainingCopy();
  const courses = useMemo(() => findLanguageExpressionCourses(notes), [notes]);
  const chapters = useMemo(() => findLanguageTextbookChapters(notes), [notes]);
  const questionCollections = useMemo(() => findInterviewQuestionCollections(notes), [notes]);
  const languageIndexes = useMemo(() => new Map(questionCollections.map(({collection}) => [collection.collectionId, languageIndexOf(collection)])), [questionCollections]);
  const resources = useMemo(() => notes.filter(isLanguageScenarioResource).sort((a, b) => {
    const rank = (note: Note) => note.frontmatter.material_kind === "language-scenario-guide" ? 0 : 1;
    return rank(a) - rank(b) || getTitle(a).localeCompare(getTitle(b)) || a.path.localeCompare(b.path);
  }), [notes]);
  const resourceLinks = resources.length > 0 && <section className="expression-course-resources" aria-label={t("学习顺序与覆盖说明")}>
    <h2>{t("学习顺序与覆盖说明")}</h2>
    <div>{resources.map((note) => <button type="button" key={note.path} onClick={() => onOpen(note)}>
      <small>{t(note.frontmatter.material_kind === "language-scenario-guide" ? "学习顺序" : "来源覆盖")}</small>
      <span lang="und">{getTitle(note)} <i aria-hidden="true">↗</i></span>
    </button>)}</div>
  </section>;
  const search = useTextbookSearch();
  const locationParams = new URLSearchParams(search);
  const route = specialTrainingRoute(search);
  const storedStudyState = useSyncExternalStore(
    subscribeStudyState,
    getStudyStateSnapshot,
    getServerStudyStateSnapshot,
  );
  const navigate = (href: string, replace = false) => {
    // 层级导航保留目录历史；只在搜索等原位更新时 replace。
    window.history[replace ? "replaceState" : "pushState"]({ ...(window.history.state ?? {}), __echoNote: null }, "", href);
    notifyUrlChange();
  };
  const rememberPosition = useCallback((courseId: string, position: StudyPosition) => {
    updateStudyState(current => ({ ...current, activeCourseId: courseId,
      positions: { ...current.positions, [courseId]: position } }));
  }, []);
  const chooseCourse = (courseId: string) => {
    navigate(specialCourseHref(window.location.search, courseId));
    updateStudyState(current => ({ ...current, activeCourseId: courseId }));
  };
  const chooseChapter = (chapterId: string, requestedPosition?: TextbookPosition) => {
    if (route.kind === "chapter" && chapterId === route.chapterId && !requestedPosition) return;
    const target = chapters.find(item => item.chapterId === chapterId);
    const position = target?.module ? requestedPosition ?? resolveTextbookPosition(target.module, "", readTextbookPosition(chapterId)) : undefined;
    navigate(languageChapterHref(new URL(specialTrainingHref(window.location.search), window.location.href).search, chapterId, position));
  };
  const chooseQuestionTopic = (collectionId: string, topicId?: string) => {
    const params = new URLSearchParams(window.location.search);
    for (const key of ["specialModule", "questionCatalog", "questionPage", "questionView", "languageCategory", "languagePoint", "questionId", "languageReturnCategory"]) params.delete(key);
    if (locationParams.get("questionSet") !== collectionId) for (const key of ["questionReview", "questionKind", "questionSearch"]) params.delete(key);
    if (params.get("questionReview") === "excluded") params.delete("questionReview");
    navigate(questionCollectionHref(params.toString(), collectionId, topicId));
  };
  const changeQuestionFilters = (collectionId: string, change: QuestionCollectionFilterChange, replace = false) => {
    const params = new URLSearchParams(window.location.search);
    params.delete("questionId");
    const defaults = { review: "accepted", sourceKind: "all", query: "", page: 1 };
    for (const [field, key] of [["review", "questionReview"], ["sourceKind", "questionKind"], ["query", "questionSearch"], ["page", "questionPage"]] as const) {
      if (change[field] !== undefined) {
        if (change[field] === defaults[field]) params.delete(key);
        else params.set(key, String(change[field]));
      }
    }
    if (change.page === undefined) params.delete("questionPage");
    if (change.review === "excluded") params.set("questionTopic", "all");
    navigate(questionCollectionHref(params.toString(), collectionId, params.get("questionTopic") ?? "all"), replace);
  };
  const chooseLanguagePoint = (collectionId: string, dimensionId?: string, pointId?: string, questionId?: string) => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("specialModule") === "questions" && params.get("questionCatalog") === "language") {
      // 当前用法的分类与进入前的目录筛选分开，返回“全部”时不丢失原位置。
      params.set("languageReturnCategory", params.get("languageCategory") ?? "all");
    }
    params.delete("specialModule"); params.delete("questionCatalog");
    const target = new URL(languageIndexHref(params.toString(), collectionId, dimensionId, pointId), window.location.href);
    if (questionId) target.searchParams.set("questionId", questionId);
    navigate(`${target.pathname}${target.search}`);
  };
  const openOriginalQuestion = (collectionId: string, questionId: string) => {
    const collection = questionCollections.find(item => item.collection.collectionId === collectionId)?.collection;
    const location = collection && questionLocation(collection, questionId);
    if (!location) return;
    const params = new URLSearchParams(window.location.search);
    for (const key of [...QUESTION_URL_KEYS, "specialModule", "questionCatalog"]) params.delete(key);
    params.set("questionId", location.representativeQuestionId);
    if (location.page > 1) params.set("questionPage", String(location.page));
    navigate(questionCollectionHref(params.toString(), collectionId, location.topicId));
  };
  const catalogProps = { chapters, courses, questionCollections, languageIndexes, search, onNavigate: navigate,
    onSelectChapter: chooseChapter, onSelectCourse: chooseCourse, onSelectQuestionTopic: chooseQuestionTopic, onSelectLanguagePoint: chooseLanguagePoint };
  const breadcrumb = (title?: string, titleLang?: string) => <SpecialTrainingBreadcrumbs search={search} module={route.kind === "home" ? undefined : route.module}
    moduleHref={route.kind === "language" ? specialQuestionModuleHref(search, "language", locationParams.get("languageReturnCategory") ?? locationParams.get("languageCategory") ?? undefined) : undefined}
    title={title} titleLang={titleLang} onNavigate={navigate} />;

  // 首页与目录不挂载详情；教材的阅读 effect 因此无法把裸入口改写成首章。
  if (route.kind === "home" || route.kind === "module" || (route.kind === "course" && route.courseId === "catalog")) {
    const activeModule = route.kind === "module" ? route.module : route.kind === "course" ? "practice" : undefined;
    return <div className="expression-courses-view" lang={ui.locale}>{breadcrumb()}{loading ? <ScopeLoading label={ui.t("专项训练")} message={ui.t("正在读取专项训练材料…")} /> : <>
      {activeModule ? <SpecialTrainingModule {...catalogProps} module={activeModule} /> : <SpecialTrainingDashboard {...catalogProps} />}
      {resources.length > 0 && <details className="special-material-resources"><summary>{ui.t("学习顺序与来源说明")}</summary>{resourceLinks}</details>}
    </>}</div>;
  }

  if (route.kind === "questions" || route.kind === "language") {
    const resource = questionCollections.find(item => item.collection.collectionId === route.collectionId);
    const languageIndex = resource && languageIndexes.get(resource.collection.collectionId);
    const back = () => navigate(specialQuestionModuleHref(window.location.search, route.kind === "language" ? "language" : "intent", locationParams.get("languageReturnCategory") ?? locationParams.get("languageCategory") ?? undefined));
    const sourcePoint = languageIndex?.points.find(point => point.id === locationParams.get("languagePoint"));
    const topic = QUESTION_TOPICS.find(topic => topic.id === locationParams.get("questionTopic"));
    const title = route.kind === "language" ? sourcePoint?.titleZh ?? ui.t("语言用法")
      : topic ? trainingTopicCopy(topic, ui.locale).title : ui.t("提问与上下文");
    if (resource && route.kind === "language") {
      return <div className="expression-courses-view" lang={ui.locale}>{breadcrumb(title, route.kind === "language" && sourcePoint ? "zh-CN" : undefined)}{languageIndex ? <InterviewLanguageLearning collection={resource.collection} index={languageIndex}
        dimensionId={locationParams.get("languageCategory") ?? "all"} pointId={locationParams.get("languagePoint") ?? undefined} questionId={locationParams.get("questionId") ?? undefined}
        onSelectPoint={(dimensionId, pointId) => chooseLanguagePoint(resource.collection.collectionId, dimensionId, pointId)}
        onSelectQuestion={(questionId, dimensionId, pointId) => chooseLanguagePoint(resource.collection.collectionId, dimensionId, pointId, questionId)}
        onOpenQuestion={questionId => openOriginalQuestion(resource.collection.collectionId, questionId)}
        onBrowseQuestions={() => chooseQuestionTopic(resource.collection.collectionId, "all")} onBack={back} onOpenWiki={onOpenWiki} />
        : <section className="question-empty"><h1>{ui.t("提问语言学习")}</h1><p>{ui.t("语言材料尚未载入或需要核对，原问题集仍可正常阅读。")}</p><button type="button" onClick={() => chooseQuestionTopic(resource.collection.collectionId, "all")}>{ui.t("按提问主题浏览")}</button></section>}</div>;
    }
    return <div className="expression-courses-view" lang={ui.locale}>{breadcrumb(title, route.kind === "language" && sourcePoint ? "zh-CN" : undefined)}{resource ? <InterviewQuestionCollectionView collection={resource.collection}
      topicId={locationParams.get("questionTopic") ?? "all"} onSelectTopic={topicId => chooseQuestionTopic(resource.collection.collectionId, topicId)}
      review={locationParams.get("questionReview") ?? "accepted"} sourceKind={locationParams.get("questionKind") ?? "all"} query={locationParams.get("questionSearch") ?? ""}
      page={Number(locationParams.get("questionPage") ?? 1)} onFilterChange={(change, replace) => changeQuestionFilters(resource.collection.collectionId, change, replace)}
      languageIndex={languageIndex ?? undefined} focusedQuestionId={locationParams.get("questionId") ?? undefined}
      onOpenLanguage={languageIndex ? (dimensionId, pointId, questionId) => chooseLanguagePoint(resource.collection.collectionId, dimensionId, pointId, questionId) : undefined}
      onBack={back} onOpenWiki={onOpenWiki} /> : <section className="question-empty"><h1>{ui.t("面试官问题集")}</h1><p role={loading ? "status" : undefined}>{loading ? ui.t("正在读取问题集材料…") : ui.t("这个问题集尚未载入，或材料格式需要核对。")}</p><button type="button" onClick={back}>{ui.t("返回研读目录")}</button></section>}</div>;
  }

  if (route.kind === "chapter") {
    const chapter = chapters.find(item => item.chapterId === route.chapterId) ?? (!route.chapterId ? chapters[0] : undefined);
    return <div className="expression-courses-view" lang={ui.locale}>{breadcrumb(chapter?.title ?? ui.t("学习章节"), chapter ? "zh-CN" : undefined)}{chapter ? <LanguageTextbook chapters={chapters} chapter={chapter}
      onSelectChapter={chooseChapter} onOpenWiki={onOpenWiki} hasPractice={courses.length > 0}
      hasChapterPractice={courses.some(course => course.courseId === chapter.exerciseCourseId)}
      onPractice={courseId => courseId ? chooseCourse(courseId) : navigate(specialTrainingHref(window.location.search, "practice"))} />
      : <section className="expression-empty"><p role={loading ? "status" : undefined}>{loading ? ui.t("正在读取学习章节…") : ui.t("这个章节尚未载入或已调整，请从目录选择。")}</p><button type="button" onClick={() => navigate(specialTrainingHref(window.location.search, "textbook"))}>{ui.t("返回章节目录")}</button></section>}</div>;
  }

  const selected = courses.find(course => course.courseId === route.courseId);
  if (!selected) return <div className="expression-courses-view" lang={ui.locale}>{breadcrumb(ui.t("练习课程"))}<section className="expression-empty"><p role={loading ? "status" : undefined}>{loading ? ui.t("正在读取练习课程…") : ui.t("这个课程尚未载入或已调整，请从目录选择。")}</p><button type="button" onClick={() => navigate(specialTrainingHref(window.location.search, "practice"))}>{ui.t("返回练习目录")}</button></section></div>;
  return <div className="expression-courses-view" lang={ui.locale}>{breadcrumb(selected.title, "und")}
    <div className="expression-course-shell">
      <aside className="expression-catalog" aria-label={t("专项课程目录")}>
        <div className="expression-catalog-heading"><small>{ui.t("练习课程")}</small><strong>{t("{count} 门课程", { count: courses.length })}</strong></div>
        {courses.map(course => <button type="button" key={course.courseId} className={course.courseId === selected.courseId ? "active" : ""} onClick={() => chooseCourse(course.courseId)}>
          <span lang="und">{course.topic}</span><strong lang="und">{course.title}</strong><small>{course.scenario ? ui.t("情境练习 · 约 {minutes} 分钟", { minutes: course.scenario.durationMinutes }) : t("{chunks} 词块 · {patterns} 句型", { chunks: course.chunks.length, patterns: course.patterns.length })}</small>
        </button>)}
      </aside>
      {selected.scenario ? <LanguageScenarioCourse key={selected.courseId} course={selected} notes={notes} onVaultChanged={onVaultChanged} onNoteWritten={onNoteWritten} /> : <CourseWorkbench
        key={`${selected.courseId}:${storedStudyState ? "restored" : "initial"}`} course={selected} notes={notes} onVaultChanged={onVaultChanged} onNoteWritten={onNoteWritten}
        positionReady={storedStudyState !== null} initialPosition={storedStudyState?.positions[selected.courseId]} onPositionChange={rememberPosition} />}
    </div>
  </div>;
}

function CourseWorkbench({
  course,
  notes,
  onVaultChanged,
  onNoteWritten,
  positionReady,
  initialPosition,
  onPositionChange,
}: {
  course: LanguageExpressionCourse;
  notes: Note[];
  onVaultChanged: () => Promise<void>;
  onNoteWritten?: (note: Note) => void;
  positionReady: boolean;
  initialPosition?: StudyPosition;
  onPositionChange: (courseId: string, position: StudyPosition) => void;
}) {
  const { t, label: menuLabel, locale, number } = useExpressionMenu();
  const derivedProgress = useMemo(
    () => courseProgress(course, notes),
    [course, notes],
  );
  const [localProgress, setLocalProgress] = useState<ProgressState | null>(null);
  const progress = localProgress ?? derivedProgress;
  // initialPosition はマウント時の初期値としてだけ使う。以降に変わっても追わない
  // （保存位置が届いた時は、呼び出し側が key を変えてこのコンポーネントを作り直す）。
  const [mode, setMode] = useState<PracticeMode>(
    initialPosition?.mode ?? "recall",
  );
  const [chunkLevel, setChunkLevel] = useState<ChunkLevel>(
    initialPosition?.chunkLevel ?? "core",
  );
  const [cursor, setCursor] = useState<PracticeCursor>(
    () => initialPosition?.cursor ?? { ...DEFAULT_CURSOR },
  );
  const [revealed, setRevealed] = useState(false);
  const [resourceOpen, setResourceOpen] = useState(false);
  const [improvSelection, setImprovSelection] = useState({
    cause: 0,
    solution: 0,
    pattern: 0,
  });
  const [busyKey, setBusyKey] = useState("");
  // 只存消息键和参数，切换语言时重新显示文案，不重放保存操作。
  const [message, setMessage] = useState<{
    key: "已记录第 {count} 次随机表达" | "已标记为练过" | "已重新打开练习";
    count?: number;
  } | null>(null);
  const [error, setError] = useState<{ key: "无法保存进度"; detail?: string } | null>(null);

  // positionReady が false の間は書かない。localStorage を読み終える前に既定値を
  // 書き戻すと、保存済みの位置を読む前に潰してしまう。
  useEffect(() => {
    if (!positionReady) return;
    onPositionChange(course.courseId, {
      mode,
      chunkLevel,
      cursor,
      updatedAt: new Date().toISOString(),
    });
  }, [
    chunkLevel,
    course.courseId,
    cursor,
    mode,
    onPositionChange,
    positionReady,
  ]);

  const completed = useMemo(
    () => new Set(progress.completedKeys),
    [progress.completedKeys],
  );
  const coreChunks = course.chunks.filter((chunk) => chunk.level === "core");
  const corePatterns = course.patterns.filter((pattern) => pattern.level === "core");
  const rewriteCount = course.corrections.length + course.safeRewrites.length;
  const recallDone = coreChunks.filter((chunk) =>
    completed.has(completionKey("recall", chunk.id)) ||
    completed.has(completionKey("collocation", chunk.id))
  ).length;
  const patternDone = corePatterns.filter((pattern) =>
    completed.has(completionKey("substitution", pattern.id))
  ).length;
  const rewriteDone = [
    ...course.corrections,
    ...course.safeRewrites,
  ].filter((item) => completed.has(completionKey("rewrite", item.id))).length;

  // useCallback なのは、下の keydown を張る useEffect が依存に save を持つため。
  // 素の関数だと毎レンダーで作り直され、リスナーの張り替えが起き続ける。
  const save = useCallback(async (
    itemId: string,
    exercise: LanguageExpressionExercise,
    action: "completed" | "reopened",
  ) => {
    const key = completionKey(exercise, itemId);
    setBusyKey(key);
    setError(null);
    setMessage(null);
    try {
      const result = await postProgress({
        courseId: course.courseId,
        itemId,
        exercise,
        action,
      });
      setLocalProgress(result.state);
      setMessage(
        exercise === "improv"
          ? { key: "已记录第 {count} 次随机表达", count: result.state.improvCount }
          : { key: action === "completed" ? "已标记为练过" : "已重新打开练习" },
      );
      // state はもう画面に反映済み。vault 側の進捗ノートは応答の note で1件差し替え、
      // 以前ここで走っていた全量再取得（サーバ 300 GET + 6MB）を省く。
      if (result.note && onNoteWritten) onNoteWritten(result.note);
      else await onVaultChanged();
      return true;
    } catch (saveError) {
      setError({ key: "无法保存进度", detail: saveError instanceof Error ? saveError.message : undefined });
      return false;
    } finally {
      setBusyKey("");
    }
  }, [course.courseId, onNoteWritten, onVaultChanged]);

  const switchMode = (nextMode: PracticeMode) => {
    if (nextMode === "improv") {
      const causes = course.ideaCards.filter((card) => card.category === "cause");
      const solutions = course.ideaCards.filter((card) => card.category === "solution");
      const patterns = improvPatterns(course);
      setImprovSelection({
        cause: randomIndex(causes.length),
        solution: randomIndex(solutions.length),
        pattern: randomIndex(patterns.length),
      });
    }
    setMode(nextMode);
    setRevealed(false);
    setResourceOpen(false);
    setMessage(null);
    setError(null);
  };

  const move = useCallback((
    modeKey: PracticeMode,
    length: number,
    direction: -1 | 1 = 1,
  ) => {
    setCursor((current) => ({
      ...current,
      [modeKey]: movedIndex(current[modeKey], length, direction),
    }));
    setRevealed(false);
    setResourceOpen(false);
    setMessage(null);
  }, []);

  const changeChunkLevel = (level: ChunkLevel) => {
    setChunkLevel(level);
    setCursor((current) => ({ ...current, recall: 0, collocation: 0 }));
    setRevealed(false);
    setMessage(null);
  };

  const redrawImprov = () => {
    const causes = course.ideaCards.filter((card) => card.category === "cause");
    const solutions = course.ideaCards.filter((card) => card.category === "solution");
    const patterns = improvPatterns(course);
    setImprovSelection((current) => ({
      cause: randomIndex(causes.length, current.cause),
      solution: randomIndex(solutions.length, current.solution),
      pattern: randomIndex(patterns.length, current.pattern),
    }));
    setCursor((current) => ({
      ...current,
      improv: movedIndex(
        current.improv,
        Math.max(improvRecipes(course).length, 1),
        1,
      ),
    }));
    setResourceOpen(false);
    setMessage(null);
  };

  const questionCount = useMemo(
    () => sequentialQuestionCount(course, mode, chunkLevel),
    [chunkLevel, course, mode],
  );
  const currentQuestion = useMemo(
    () => currentSequentialQuestion(course, mode, chunkLevel, cursor),
    [chunkLevel, course, cursor, mode],
  );

  useEffect(() => {
    if (
      !positionReady ||
      busyKey ||
      mode === "improv" ||
      questionCount <= 0
    ) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        isEditableTarget(event.target)
      ) {
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        move(mode, questionCount, -1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        if (!currentQuestion) return;
        const advance = async () => {
          const key = completionKey(
            currentQuestion.exercise,
            currentQuestion.itemId,
          );
          if (!completed.has(key)) {
            const saved = await save(
              currentQuestion.itemId,
              currentQuestion.exercise,
              "completed",
            );
            if (!saved) return;
          }
          move(mode, currentQuestion.length, 1);
        };
        void advance();
      } else if (
        (event.key === " " || event.code === "Space") &&
        !revealed &&
        allowsRevealShortcut(event.target)
      ) {
        event.preventDefault();
        setRevealed(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    busyKey,
    completed,
    currentQuestion,
    mode,
    move,
    positionReady,
    questionCount,
    revealed,
    save,
  ]);

  return (
    <main className="expression-workbench" lang={locale}>
      <header className="expression-course-header">
        <div>
          <small><span lang="">{course.topic}</span> · {t("FLEXIBLE OUTPUT")}</small>
          <h2 lang="">{course.title}</h2>
          <p>{t("不背整段台本；系统会记住上次位置。← 返回上一题，→ 自动标记当前题并前进，Space 查看答案。")}</p>
        </div>
        <dl>
          <div><dt>{t("核心词块")}</dt><dd>{number(recallDone)}<span>/{number(coreChunks.length)}</span></dd></div>
          <div><dt>{t("核心句型")}</dt><dd>{number(patternDone)}<span>/{number(corePatterns.length)}</span></dd></div>
          <div><dt>{t("纠错改写")}</dt><dd>{number(rewriteDone)}<span>/{number(rewriteCount)}</span></dd></div>
          <div><dt>{t("随机表达")}</dt><dd>{number(progress.improvCount)}<span>{t(" 次")}</span></dd></div>
        </dl>
      </header>

      <nav className="expression-mode-tabs" aria-label={t("专项训练方式")}>
        {MODES.map((item) => (
          <button
            type="button"
            key={item.id}
            className={mode === item.id ? "active" : ""}
            onClick={() => switchMode(item.id)}
          >
            <i aria-hidden="true">{menuLabel(item.short)}</i>
            <span><strong>{menuLabel(item.label)}</strong><small>{menuLabel(item.description)}</small></span>
          </button>
        ))}
      </nav>

      {(message || error) && (
        <div className={`expression-message ${error ? "error" : ""}`} role={error ? "alert" : "status"}>
          {error ? <>{t(error.key)}{error.detail && <>：<span lang={Object.hasOwn(EXPRESSION_MENU_COPY, error.detail) ? locale : ""}>{menuLabel(error.detail)}</span></>}</>
            : message && t(message.key, { count: message.count })}
        </div>
      )}

      {mode === "recall" && (
        <RecallPractice
          chunks={course.chunks}
          level={chunkLevel}
          onLevel={changeChunkLevel}
          cursor={cursor.recall}
          revealed={revealed}
          completed={completed}
          busyKey={busyKey}
          onReveal={() => setRevealed(true)}
          onMove={(length, direction) => move("recall", length, direction)}
          onSave={save}
        />
      )}

      {mode === "collocation" && (
        <CollocationPractice
          chunks={course.chunks}
          level={chunkLevel}
          onLevel={changeChunkLevel}
          cursor={cursor.collocation}
          revealed={revealed}
          completed={completed}
          busyKey={busyKey}
          onReveal={() => setRevealed(true)}
          onMove={(length, direction) => move("collocation", length, direction)}
          onSave={save}
        />
      )}

      {mode === "substitution" && (
        <SubstitutionPractice
          course={course}
          cursor={cursor.substitution}
          revealed={revealed}
          completed={completed}
          busyKey={busyKey}
          onReveal={() => setRevealed(true)}
          onMove={(length, direction) => move("substitution", length, direction)}
          onSave={save}
        />
      )}

      {mode === "improv" && (
        <ImprovisationPractice
          course={course}
          recipeIndex={cursor.improv}
          selection={improvSelection}
          resourcesOpen={resourceOpen}
          busyKey={busyKey}
          onResources={() => setResourceOpen((open) => !open)}
          onRedraw={redrawImprov}
          onComplete={(itemId) => void save(itemId, "improv", "completed")}
        />
      )}

      {mode === "rewrite" && (
        <RewritePractice
          course={course}
          cursor={cursor.rewrite}
          revealed={revealed}
          completed={completed}
          busyKey={busyKey}
          onReveal={() => setRevealed(true)}
          onMove={(length, direction) => move("rewrite", length, direction)}
          onSave={save}
        />
      )}
    </main>
  );
}

function LevelSwitch({
  value,
  onChange,
}: {
  value: "core" | "extended";
  onChange: (value: "core" | "extended") => void;
}) {
  const { t } = useExpressionMenu();
  return (
    <div className="expression-level-switch" aria-label={t("词块范围")}>
      <button
        type="button"
        className={value === "core" ? "active" : ""}
        onClick={() => onChange("core")}
      >
        {t("核心词块")}
      </button>
      <button
        type="button"
        className={value === "extended" ? "active" : ""}
        onClick={() => onChange("extended")}
      >
        {t("扩展词块")}
      </button>
    </div>
  );
}

function PracticeHeader({
  eyebrow,
  title,
  instruction,
  instructionIsMaterial = false,
  current,
  total,
}: {
  eyebrow: string;
  title: string;
  instruction: string;
  instructionIsMaterial?: boolean;
  current: number;
  total: number;
}) {
  const { label, locale, number } = useExpressionMenu();
  return (
    <header className="expression-practice-header">
      <div>
        <small>{label(eyebrow)}</small>
        <h3>{label(title)}</h3>
        <p lang={instructionIsMaterial ? "zh-CN" : locale}>{instructionIsMaterial ? instruction : label(instruction)}</p>
      </div>
      <span>{number(Math.min(current + 1, total || 1))} / {number(total)}</span>
    </header>
  );
}

function QuestionNavigation({
  onPrevious,
  disabled = false,
}: {
  onPrevious: () => void;
  disabled?: boolean;
}) {
  const { t } = useExpressionMenu();
  return (
    <div className="expression-question-navigation" aria-label={t("题目导航")}>
      <button
        type="button"
        disabled={disabled}
        aria-keyshortcuts="ArrowLeft"
        title={t("快捷键：←")}
        onClick={onPrevious}
      >
        <kbd aria-hidden="true">←</kbd>
        {t("上一题")}
      </button>
    </div>
  );
}

function RevealButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  const { t } = useExpressionMenu();
  return (
    <button
      type="button"
      className="expression-reveal-button"
      aria-keyshortcuts="Space"
      title={t("快捷键：Space")}
      onClick={onClick}
    >
      {children}
      <kbd aria-hidden="true">Space</kbd>
    </button>
  );
}

function NextQuestionButton({
  itemId,
  exercise,
  completed,
  busyKey,
  onSave,
  onNext,
}: {
  itemId: string;
  exercise: LanguageExpressionExercise;
  completed: Set<string>;
  busyKey: string;
  onSave: SaveProgress;
  onNext: () => void;
}) {
  const { t } = useExpressionMenu();
  const key = completionKey(exercise, itemId);
  const done = completed.has(key);
  const busy = busyKey === key;

  const completeAndNext = async () => {
    if (!done) {
      const saved = await onSave(itemId, exercise, "completed");
      if (!saved) return;
    }
    onNext();
  };

  return (
    <span className="expression-complete-group">
      <button
        type="button"
        className={`expression-complete expression-complete-next ${done ? "done" : ""}`}
        disabled={Boolean(busyKey)}
        aria-keyshortcuts="ArrowRight"
        title={t("进入下一题，并自动把当前题标记为已练")}
        onClick={() => void completeAndNext()}
      >
        <span aria-hidden="true">✓</span>
        {t(busy ? "正在保存…" : "下一题")}
        {!busy && <span aria-hidden="true">→</span>}
      </button>
      {/* 「已练」を取り消す唯一の導線。押し間違いや練習し直しで戻せないと、
          完了状態が事実上不可逆になる（reopened はイベント型・API・reducer とも
          対応済みなのに UI から発火する経路が無かった）。 */}
      {done && (
        <button
          type="button"
          className="expression-reopen"
          disabled={Boolean(busyKey)}
          title={t("取消「已练」，放回练习队列")}
          onClick={() => void onSave(itemId, exercise, "reopened")}
        >
          {busy ? "…" : t("↩ 取消已练")}
        </button>
      )}
    </span>
  );
}

function RecallPractice({
  chunks,
  level,
  onLevel,
  cursor,
  revealed,
  completed,
  busyKey,
  onReveal,
  onMove,
  onSave,
}: {
  chunks: ExpressionChunk[];
  level: "core" | "extended";
  onLevel: (level: "core" | "extended") => void;
  cursor: number;
  revealed: boolean;
  completed: Set<string>;
  busyKey: string;
  onReveal: () => void;
  onMove: MoveQuestion;
  onSave: SaveProgress;
}) {
  const { t, label, locale } = useExpressionMenu();
  const pool = chunks.filter((chunk) => chunk.level === level);
  const index = cursor % Math.max(pool.length, 1);
  const chunk = pool[index];
  if (!chunk) return <PracticeUnavailable text="这个范围还没有词块。" />;

  return (
    <section className="expression-practice">
      <LevelSwitch value={level} onChange={onLevel} />
      <PracticeHeader
        eyebrow="CHINESE → JAPANESE"
        title="看到功能，先把日语说出来"
        instruction="不用造长句。先主动提取词块，再用它说一个最短句子。"
        current={index}
        total={pool.length}
      />
      <article className="expression-prompt-card">
        <span className="expression-item-badge">
          {[label(levelLabel(chunk.level)), label(learningBasisLabel(chunk.learningBasis)), chunk.id]
            .filter(Boolean)
            .join(" · ")}
        </span>
        <small>{t("中文功能")}</small>
        <h4 lang="zh-CN">{chunk.meaningZh}</h4>
        <p className="expression-topic-line" lang="">{chunk.topics.join(" · ")}</p>

        {revealed ? (
          <div className="expression-reveal">
            <small>{t("日语词块")}</small>
            <strong lang="ja">{chunk.japanese}</strong>
            {chunk.reading && <p lang="ja">{chunk.reading}</p>}
            {chunk.explanationZh && (
              <p className="expression-learning-note" lang="zh-CN">
                <b lang={locale}>{t("基础解释")}</b>{chunk.explanationZh}
              </p>
            )}
            <p className="expression-example" lang="ja">
              <b lang={locale}>{t("例句")}</b>{chunk.exampleJa}
            </p>
            <div className="expression-mini-columns">
              <div>
                <b>{t("常见搭配")}</b>
                <ul>{chunk.collocations.slice(0, 3).map((item) => <li key={item} lang="ja">{item}</li>)}</ul>
              </div>
              <div>
                <b>{t("可替换表达")}</b>
                <ul>
                  {chunk.alternativesJa.slice(0, 3).map((item) => (
                    <li key={item} lang="ja"><Inlines nodes={parseInline(item)} /></li>
                  ))}
                </ul>
              </div>
            </div>
            {chunk.factBoundary && (
              <p className="expression-boundary" lang="zh-CN"><b lang={locale}>{t("事实边界")}</b>{chunk.factBoundary}</p>
            )}
            <EvidenceRefs references={chunk.evidenceRefs} />
          </div>
        ) : (
          <RevealButton onClick={onReveal}>{t("我已经说过了，查看词块")}</RevealButton>
        )}
      </article>
      <footer className="expression-practice-actions">
        <QuestionNavigation
          disabled={Boolean(busyKey)}
          onPrevious={() => onMove(pool.length, -1)}
        />
        <NextQuestionButton
          itemId={chunk.id}
          exercise="recall"
          completed={completed}
          busyKey={busyKey}
          onSave={onSave}
          onNext={() => onMove(pool.length, 1)}
        />
      </footer>
    </section>
  );
}

function clozeCollocation(chunk: ExpressionChunk, collocation: string) {
  const predicate = collocation.match(/^(.*[をにへでとがは])([^をにへでとがは]+)$/u);
  if (predicate && predicate[2].length >= 2) {
    return `${predicate[1]}＿＿＿＿`;
  }
  if (collocation.includes(chunk.japanese)) {
    return collocation.replace(chunk.japanese, "＿＿＿＿");
  }
  return `${collocation}　→　＿＿＿＿`;
}

function CollocationPractice({
  chunks,
  level,
  onLevel,
  cursor,
  revealed,
  completed,
  busyKey,
  onReveal,
  onMove,
  onSave,
}: {
  chunks: ExpressionChunk[];
  level: "core" | "extended";
  onLevel: (level: "core" | "extended") => void;
  cursor: number;
  revealed: boolean;
  completed: Set<string>;
  busyKey: string;
  onReveal: () => void;
  onMove: MoveQuestion;
  onSave: SaveProgress;
}) {
  const { t, label } = useExpressionMenu();
  const pool = chunks.filter(
    (chunk) => chunk.level === level && chunk.collocations.length > 0,
  );
  const index = cursor % Math.max(pool.length, 1);
  const chunk = pool[index];
  if (!chunk) return <PracticeUnavailable text="这个范围还没有固定搭配。" />;
  const collocation = chunk.collocations[0];

  return (
    <section className="expression-practice">
      <LevelSwitch value={level} onChange={onLevel} />
      <PracticeHeader
        eyebrow="COLLOCATION CLOZE"
        title="补全固定搭配"
        instruction="先把空格补出来，再换一个主语或业务场景说一遍。"
        current={index}
        total={pool.length}
      />
      <article className="expression-prompt-card expression-cloze-card">
        <span className="expression-item-badge">
          {[label(levelLabel(chunk.level)), label(learningBasisLabel(chunk.learningBasis)), chunk.id]
            .filter(Boolean)
            .join(" · ")}
        </span>
        <small lang="zh-CN">{chunk.meaningZh}</small>
        <h4 lang="ja">{clozeCollocation(chunk, collocation)}</h4>
        {revealed ? (
          <div className="expression-reveal">
            <small>{t("搭配确认")}</small>
            <strong lang="ja">{collocation}</strong>
            <p className="expression-fragment" lang="ja">{chunk.exampleJa}</p>
            <p className="expression-hint">{t("再把主题替换成：")}<span lang="">{chunk.topics.slice(0, 3).join("／")}</span></p>
          </div>
        ) : (
          <RevealButton onClick={onReveal}>{t("查看搭配")}</RevealButton>
        )}
      </article>
      <footer className="expression-practice-actions">
        <QuestionNavigation
          disabled={Boolean(busyKey)}
          onPrevious={() => onMove(pool.length, -1)}
        />
        <NextQuestionButton
          itemId={chunk.id}
          exercise="collocation"
          completed={completed}
          busyKey={busyKey}
          onSave={onSave}
          onNext={() => onMove(pool.length, 1)}
        />
      </footer>
    </section>
  );
}

function SubstitutionPractice({
  course,
  cursor,
  revealed,
  completed,
  busyKey,
  onReveal,
  onMove,
  onSave,
}: {
  course: LanguageExpressionCourse;
  cursor: number;
  revealed: boolean;
  completed: Set<string>;
  busyKey: string;
  onReveal: () => void;
  onMove: MoveQuestion;
  onSave: SaveProgress;
}) {
  const { t, label, locale } = useExpressionMenu();
  const patterns = course.patterns;
  const index = cursor % Math.max(patterns.length, 1);
  const pattern = patterns[index];
  if (!pattern) return <PracticeUnavailable text="这门课程还没有句型。" />;
  const ideas = course.ideaCards.filter((card) => card.category !== "boundary");
  const ideaA = ideas[index % Math.max(ideas.length, 1)];
  const ideaB = ideas[(index + 3) % Math.max(ideas.length, 1)];

  return (
    <section className="expression-practice">
      <PracticeHeader
        eyebrow="PATTERN SUBSTITUTION"
        title="保留骨架，替换内容"
        instruction="从下面两组关键词各选一个，用指定句型自己造句。"
        current={index}
        total={patterns.length}
      />
      <article className="expression-prompt-card expression-pattern-card">
        <span className="expression-item-badge">
          {[label(levelLabel(pattern.level)), label(learningBasisLabel(pattern.learningBasis)), pattern.id]
            .filter(Boolean)
            .join(" · ")}
        </span>
        <small lang="zh-CN">{pattern.functionZh}</small>
        <h4 lang="ja">{pattern.patternJa}</h4>
        <p className="expression-slots" lang="zh-CN">{pattern.slotsZh}</p>
        <div className="expression-keyword-pair">
          {[ideaA, ideaB].filter(Boolean).map((idea) => (
            <div key={idea.id} lang="">
              <small>{idea.title}</small>
              <strong>{idea.keywords.slice(0, 4).join(" ／ ")}</strong>
            </div>
          ))}
        </div>
        {revealed ? (
          <div className="expression-reveal expression-short-examples">
            <small>{t("规则与短例")}</small>
            {pattern.explanationZh && (
              <p className="expression-learning-note" lang="zh-CN">
                <b lang={locale}>{t("基础解释")}</b>{pattern.explanationZh}
              </p>
            )}
            {pattern.contrastJa && (
              <p className="expression-contrast" lang="ja">
                <b lang={locale}>{t("易错对比")}</b>{pattern.contrastJa}
              </p>
            )}
            {pattern.examplesJa.slice(0, 2).map((example) => (
              <p className="expression-pattern-example" key={example} lang="ja">{example}</p>
            ))}
            {pattern.alternativesJa.length > 0 && (
              <p className="expression-natural-options" lang="ja">
                <b lang={locale}>{t("更自然")}</b>{pattern.alternativesJa.slice(0, 2).join(" ／ ")}
              </p>
            )}
            <EvidenceRefs references={pattern.evidenceRefs} />
            <p className="expression-hint">{t("不要复述示例；换成上面的关键词再说一遍。")}</p>
          </div>
        ) : (
          <RevealButton onClick={onReveal}>{t("查看两个短例")}</RevealButton>
        )}
      </article>
      <footer className="expression-practice-actions">
        <QuestionNavigation
          disabled={Boolean(busyKey)}
          onPrevious={() => onMove(patterns.length, -1)}
        />
        <NextQuestionButton
          itemId={pattern.id}
          exercise="substitution"
          completed={completed}
          busyKey={busyKey}
          onSave={onSave}
          onNext={() => onMove(patterns.length, 1)}
        />
      </footer>
    </section>
  );
}

function ImprovisationPractice({
  course,
  recipeIndex,
  selection,
  resourcesOpen,
  busyKey,
  onResources,
  onRedraw,
  onComplete,
}: {
  course: LanguageExpressionCourse;
  recipeIndex: number;
  selection: { cause: number; solution: number; pattern: number };
  resourcesOpen: boolean;
  busyKey: string;
  onResources: () => void;
  onRedraw: () => void;
  onComplete: (itemId: string) => void;
}) {
  const { t } = useExpressionMenu();
  const recipes = improvRecipes(course);
  const causes = course.ideaCards.filter((card) => card.category === "cause");
  const solutions = course.ideaCards.filter((card) => card.category === "solution");
  const patterns = improvPatterns(course);
  const recipe = recipes[recipeIndex % Math.max(recipes.length, 1)];
  const cause = causes[selection.cause % Math.max(causes.length, 1)];
  const solution = solutions[selection.solution % Math.max(solutions.length, 1)];
  const pattern = patterns[selection.pattern % Math.max(patterns.length, 1)];

  if (!recipe || !cause || !solution || !pattern) {
    return <PracticeUnavailable text="随机表达需要原因卡、对策卡、核心句型和抽题规则。" />;
  }

  const relatedIds = new Set([
    ...cause.relatedChunkIds,
    ...solution.relatedChunkIds,
  ]);
  const relatedChunks = course.chunks
    .filter((chunk) => relatedIds.has(chunk.id))
    .slice(0, 8);
  const alternatePatterns = patterns
    .filter((candidate) => candidate.id !== pattern.id)
    .slice(0, 4);
  const boundaryCards = course.ideaCards.filter((card) => card.category === "boundary");
  const busy = busyKey === completionKey("improv", recipe.id);

  return (
    <section className="expression-practice">
      <PracticeHeader
        eyebrow="IMPROVISED OUTPUT"
        title="用三张卡，自由说二至四句"
        instruction={recipe.promptZh || "先说观点，再连接一个原因和一个对策。"}
        instructionIsMaterial={Boolean(recipe.promptZh)}
        current={recipeIndex % recipes.length}
        total={recipes.length}
      />
      <article className="expression-prompt-card expression-improv-card">
        <span className="expression-item-badge">{t("随机组合")} · {recipe.id}</span>
        <div className="expression-improv-draw">
          <div>
            <small>{t("原因")}</small>
            <strong lang="">{cause.title}</strong>
            <p lang="">{cause.keywords.slice(0, 5).join(" ／ ")}</p>
          </div>
          <span aria-hidden="true">＋</span>
          <div>
            <small>{t("对策")}</small>
            <strong lang="">{solution.title}</strong>
            <p lang="">{solution.keywords.slice(0, 5).join(" ／ ")}</p>
          </div>
          <span aria-hidden="true">＋</span>
          <div>
            <small>{t("指定句型")}</small>
            <strong lang="ja">{pattern.patternJa}</strong>
            <p lang="zh-CN">{pattern.functionZh}</p>
          </div>
        </div>

        <div className="expression-self-check">
          <small>{t("说完后自己检查")}</small>
          <ul>
            <li>{t("是否先给出观点，再说明原因和对策？")}</li>
            <li>{t("是否避免把个人倾向说成所有人的特征？")}</li>
            <li>{t("是否把建议和本人已有经历区分开？")}</li>
          </ul>
        </div>

        <button type="button" className="expression-resource-button" onClick={onResources}>
          {t(resourcesOpen ? "收起可用素材" : "卡住时查看可用素材")}
          <span aria-hidden="true">{resourcesOpen ? "−" : "+"}</span>
        </button>

        {resourcesOpen && (
          <div className="expression-resource-drawer">
            <div>
              <small>{t("可调用词块")}</small>
              <ul>
                {relatedChunks.map((chunk) => (
                  <li key={chunk.id}>
                    <strong lang="ja">{chunk.japanese}</strong>
                    <span lang="zh-CN">{chunk.meaningZh}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <small>{t("还可换用的句型")}</small>
              <ul className="expression-alternate-patterns">
                {alternatePatterns.map((candidate) => (
                  <li key={candidate.id}>
                    <strong lang="ja">{candidate.patternJa}</strong>
                    <span lang="zh-CN">{candidate.functionZh}</span>
                  </li>
                ))}
              </ul>
              <small>{t("边界提醒")}</small>
              {boundaryCards.slice(0, 3).map((card) => (
                <p key={card.id} lang="zh-CN"><b lang="">{card.title}</b>{card.descriptionZh}</p>
              ))}
            </div>
          </div>
        )}
      </article>
      <footer className="expression-practice-actions">
        <button
          type="button"
          className="expression-complete"
          disabled={Boolean(busyKey)}
          onClick={() => onComplete(recipe.id)}
        >
          <span aria-hidden="true">✓</span>
          {t(busy ? "正在记录…" : "完成一次表达")}
        </button>
        <button type="button" onClick={onRedraw}>{t("重新抽取")} <span>↻</span></button>
      </footer>
    </section>
  );
}

function improvRecipes(course: LanguageExpressionCourse) {
  const dedicated = course.recipes.filter(
    (recipe) =>
      recipe.id === "r04" ||
      /(?:即興|随机|ランダム|2[〜～-]4)/u.test(`${recipe.title} ${recipe.promptZh}`),
  );
  return dedicated.length ? dedicated : course.recipes;
}

function improvPatterns(course: LanguageExpressionCourse) {
  const levels = new Set(improvRecipes(course).flatMap((recipe) => recipe.patternLevels));
  return course.patterns.filter((pattern) => levels.size === 0 || levels.has(pattern.level));
}

function RewritePractice({
  course,
  cursor,
  revealed,
  completed,
  busyKey,
  onReveal,
  onMove,
  onSave,
}: {
  course: LanguageExpressionCourse;
  cursor: number;
  revealed: boolean;
  completed: Set<string>;
  busyKey: string;
  onReveal: () => void;
  onMove: MoveQuestion;
  onSave: SaveProgress;
}) {
  const { t } = useExpressionMenu();
  const items: RewriteItem[] = [
    ...course.corrections.map((item): RewriteItem => ({ kind: "correction", item })),
    ...course.safeRewrites.map((item): RewriteItem => ({ kind: "safe", item })),
  ];
  const index = cursor % Math.max(items.length, 1);
  const current = items[index];
  if (!current) return <PracticeUnavailable text="这门课程还没有纠错或安全改写。" />;

  const original =
    current.kind === "correction" ? current.item.originalJa : current.item.riskyJa;
  const corrected =
    current.kind === "correction" ? current.item.correctedJa : current.item.safeJa;
  const practice = current.item.replacementPractice;

  return (
    <section className="expression-practice">
      <PracticeHeader
        eyebrow="CORRECTION & SAFE REWRITE"
        title={current.kind === "correction" ? "修正真实口误" : "换成准确、克制的表达"}
        instruction="先自己改写，再查看短句。重点是保留意思，同时去掉不自然或过度断定。"
        current={index}
        total={items.length}
      />
      <article className="expression-prompt-card expression-rewrite-card">
        <span className="expression-item-badge">
          {t(current.kind === "correction" ? "口误修正" : "危险表达")} · {current.item.id}
        </span>
        <small lang="">{current.item.title}</small>
        <blockquote lang="ja">{original}</blockquote>
        {revealed ? (
          <div className="expression-reveal">
            <small>{t("推荐改写")}</small>
            <strong lang="ja">{corrected}</strong>
            {current.kind === "safe" && <p lang="zh-CN">{current.item.reasonZh}</p>}
            <div className="expression-replacement">
              <b>{t("替换练习")}</b>
              <span lang="zh-CN">{practice}</span>
            </div>
            {current.kind === "correction" && (
              <EvidenceRefs references={current.item.evidenceRefs} />
            )}
          </div>
        ) : (
          <RevealButton onClick={onReveal}>{t("我已经改写，查看短句")}</RevealButton>
        )}
      </article>
      <footer className="expression-practice-actions">
        <QuestionNavigation
          disabled={Boolean(busyKey)}
          onPrevious={() => onMove(items.length, -1)}
        />
        <NextQuestionButton
          itemId={current.item.id}
          exercise="rewrite"
          completed={completed}
          busyKey={busyKey}
          onSave={onSave}
          onNext={() => onMove(items.length, 1)}
        />
      </footer>
    </section>
  );
}

function PracticeUnavailable({ text }: { text: string }) {
  const { t, label } = useExpressionMenu();
  return (
    <section className="expression-practice expression-unavailable">
      <b>{t("待")}</b>
      <div><h3>{t("当前练法还没有素材")}</h3><p>{label(text)}</p></div>
    </section>
  );
}

// 外壳的 UI state（⌘K・overlay）变化时不重渲染整个视圖。props 都是稳定引用。
export default memo(LanguageExpressionCourses);
