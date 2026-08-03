"use client";

import {
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
import type { Note } from "@/lib/notes";
import { Inlines } from "./prep-doc-render";

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

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );
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
  if (!references.length) return null;
  return (
    <p className="expression-evidence">
      <b>来自面试稿</b>
      {references.map(evidenceLabel).join(" ／ ")}
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
  const response = await fetch("/api/language/topics/progress", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ eventId: makeEventId(), ...input }),
  });
  const body = await response.json() as ProgressResponse & { error?: string };
  if (!response.ok) {
    throw new Error(body.error || `保存失败 (${response.status})`);
  }
  return body;
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

export default function LanguageExpressionCourses({
  notes,
  onVaultChanged,
}: {
  notes: Note[];
  onVaultChanged: () => Promise<void>;
}) {
  const courses = useMemo(() => findLanguageExpressionCourses(notes), [notes]);
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const storedStudyState = useSyncExternalStore(
    subscribeStudyState,
    getStudyStateSnapshot,
    getServerStudyStateSnapshot,
  );

  const rememberPosition = useCallback((
    courseId: string,
    position: StudyPosition,
  ) => {
    updateStudyState((current) => ({
      ...current,
      activeCourseId: courseId,
      positions: {
        ...current.positions,
        [courseId]: position,
      },
    }));
  }, []);

  const chooseCourse = (courseId: string) => {
    setSelectedCourseId(courseId);
    updateStudyState((current) => ({
      ...current,
      activeCourseId: courseId,
    }));
  };

  const selected =
    courses.find(
      (course) =>
        course.courseId === (
          selectedCourseId ||
          storedStudyState?.activeCourseId
        ),
    ) ?? courses[0];

  if (!selected) {
    return (
      <div className="expression-courses-view">
        <section className="expression-empty">
          <b>語</b>
          <div>
            <small>COURSE CATALOG</small>
            <h2>还没有可用的专项课程</h2>
            <p>在 Vault 中加入带有 language-expression-course 标记的素材后，这里会自动出现。</p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="expression-courses-view">
      <div className="expression-course-shell">
        <aside className="expression-catalog" aria-label="专项课程目录">
          <div className="expression-catalog-heading">
            <small>COURSE CATALOG</small>
            <strong>{courses.length} 门课程</strong>
          </div>
          {courses.map((course) => (
            <button
              type="button"
              key={course.courseId}
              className={course.courseId === selected.courseId ? "active" : ""}
              onClick={() => chooseCourse(course.courseId)}
            >
              <span>{course.topic}</span>
              <strong>{course.title}</strong>
              <small>
                {course.chunks.length} 词块 · {course.patterns.length} 句型
              </small>
            </button>
          ))}
        </aside>

        <CourseWorkbench
          // 保存位置が読めた時点で別インスタンスとして作り直す。effect で setState して
          // 復元すると「既定表示 → 復元表示」のカスケードレンダーになる。
          key={`${selected.courseId}:${storedStudyState ? "restored" : "initial"}`}
          course={selected}
          notes={notes}
          onVaultChanged={onVaultChanged}
          positionReady={storedStudyState !== null}
          initialPosition={storedStudyState?.positions[selected.courseId]}
          onPositionChange={rememberPosition}
        />
      </div>
    </div>
  );
}

function CourseWorkbench({
  course,
  notes,
  onVaultChanged,
  positionReady,
  initialPosition,
  onPositionChange,
}: {
  course: LanguageExpressionCourse;
  notes: Note[];
  onVaultChanged: () => Promise<void>;
  positionReady: boolean;
  initialPosition?: StudyPosition;
  onPositionChange: (courseId: string, position: StudyPosition) => void;
}) {
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
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

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

  const save = async (
    itemId: string,
    exercise: LanguageExpressionExercise,
    action: "completed" | "reopened",
  ) => {
    const key = completionKey(exercise, itemId);
    setBusyKey(key);
    setError("");
    setMessage("");
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
          ? `已记录第 ${result.state.improvCount} 次随机表达`
          : action === "completed"
            ? "已标记为练过"
            : "已重新打开练习",
      );
      await onVaultChanged();
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "无法保存进度");
      return false;
    } finally {
      setBusyKey("");
    }
  };

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
    setMessage("");
    setError("");
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
    setMessage("");
  }, []);

  const changeChunkLevel = (level: ChunkLevel) => {
    setChunkLevel(level);
    setCursor((current) => ({ ...current, recall: 0, collocation: 0 }));
    setRevealed(false);
    setMessage("");
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
    setMessage("");
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
    <main className="expression-workbench">
      <header className="expression-course-header">
        <div>
          <small>{course.topic} · FLEXIBLE OUTPUT</small>
          <h2>{course.title}</h2>
          <p>不背整段台本；系统会记住上次位置。← 返回上一题，→ 自动标记当前题并前进，Space 查看答案。</p>
        </div>
        <dl>
          <div><dt>核心词块</dt><dd>{recallDone}<span>/{coreChunks.length}</span></dd></div>
          <div><dt>核心句型</dt><dd>{patternDone}<span>/{corePatterns.length}</span></dd></div>
          <div><dt>纠错改写</dt><dd>{rewriteDone}<span>/{rewriteCount}</span></dd></div>
          <div><dt>随机表达</dt><dd>{progress.improvCount}<span> 次</span></dd></div>
        </dl>
      </header>

      <nav className="expression-mode-tabs" aria-label="专项训练方式">
        {MODES.map((item) => (
          <button
            type="button"
            key={item.id}
            className={mode === item.id ? "active" : ""}
            onClick={() => switchMode(item.id)}
          >
            <i aria-hidden="true">{item.short}</i>
            <span><strong>{item.label}</strong><small>{item.description}</small></span>
          </button>
        ))}
      </nav>

      {(message || error) && (
        <div className={`expression-message ${error ? "error" : ""}`}>
          {error || message}
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
  return (
    <div className="expression-level-switch" aria-label="词块范围">
      <button
        type="button"
        className={value === "core" ? "active" : ""}
        onClick={() => onChange("core")}
      >
        核心词块
      </button>
      <button
        type="button"
        className={value === "extended" ? "active" : ""}
        onClick={() => onChange("extended")}
      >
        扩展词块
      </button>
    </div>
  );
}

function PracticeHeader({
  eyebrow,
  title,
  instruction,
  current,
  total,
}: {
  eyebrow: string;
  title: string;
  instruction: string;
  current: number;
  total: number;
}) {
  return (
    <header className="expression-practice-header">
      <div>
        <small>{eyebrow}</small>
        <h3>{title}</h3>
        <p>{instruction}</p>
      </div>
      <span>{Math.min(current + 1, total || 1)} / {total}</span>
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
  return (
    <div className="expression-question-navigation" aria-label="题目导航">
      <button
        type="button"
        disabled={disabled}
        aria-keyshortcuts="ArrowLeft"
        title="快捷键：←"
        onClick={onPrevious}
      >
        <kbd aria-hidden="true">←</kbd>
        上一题
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
  return (
    <button
      type="button"
      className="expression-reveal-button"
      aria-keyshortcuts="Space"
      title="快捷键：Space"
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
        title="进入下一题，并自动把当前题标记为已练"
        onClick={() => void completeAndNext()}
      >
        <span aria-hidden="true">✓</span>
        {busy ? "正在保存…" : "下一题"}
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
          title="取消「已练」，放回练习队列"
          onClick={() => void onSave(itemId, exercise, "reopened")}
        >
          {busy ? "…" : "↩ 取消已练"}
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
          {[levelLabel(chunk.level), learningBasisLabel(chunk.learningBasis), chunk.id]
            .filter(Boolean)
            .join(" · ")}
        </span>
        <small>中文功能</small>
        <h4>{chunk.meaningZh}</h4>
        <p className="expression-topic-line">{chunk.topics.join(" · ")}</p>

        {revealed ? (
          <div className="expression-reveal">
            <small>日语词块</small>
            <strong lang="ja">{chunk.japanese}</strong>
            {chunk.reading && <p lang="ja">{chunk.reading}</p>}
            {chunk.explanationZh && (
              <p className="expression-learning-note">
                <b>基础解释</b>{chunk.explanationZh}
              </p>
            )}
            <p className="expression-example" lang="ja">
              <b>例句</b>{chunk.exampleJa}
            </p>
            <div className="expression-mini-columns">
              <div>
                <b>常见搭配</b>
                <ul>{chunk.collocations.slice(0, 3).map((item) => <li key={item} lang="ja">{item}</li>)}</ul>
              </div>
              <div>
                <b>可替换表达</b>
                <ul>
                  {chunk.alternativesJa.slice(0, 3).map((item) => (
                    <li key={item} lang="ja"><Inlines nodes={parseInline(item)} /></li>
                  ))}
                </ul>
              </div>
            </div>
            {chunk.factBoundary && (
              <p className="expression-boundary"><b>事实边界</b>{chunk.factBoundary}</p>
            )}
            <EvidenceRefs references={chunk.evidenceRefs} />
          </div>
        ) : (
          <RevealButton onClick={onReveal}>我已经说过了，查看词块</RevealButton>
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
  if (predicate?.[2]?.length >= 2) {
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
          {[levelLabel(chunk.level), learningBasisLabel(chunk.learningBasis), chunk.id]
            .filter(Boolean)
            .join(" · ")}
        </span>
        <small>{chunk.meaningZh}</small>
        <h4 lang="ja">{clozeCollocation(chunk, collocation)}</h4>
        {revealed ? (
          <div className="expression-reveal">
            <small>搭配确认</small>
            <strong lang="ja">{collocation}</strong>
            <p className="expression-fragment" lang="ja">{chunk.exampleJa}</p>
            <p className="expression-hint">再把主题替换成：{chunk.topics.slice(0, 3).join("／")}</p>
          </div>
        ) : (
          <RevealButton onClick={onReveal}>查看搭配</RevealButton>
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
          {[levelLabel(pattern.level), learningBasisLabel(pattern.learningBasis), pattern.id]
            .filter(Boolean)
            .join(" · ")}
        </span>
        <small>{pattern.functionZh}</small>
        <h4 lang="ja">{pattern.patternJa}</h4>
        <p className="expression-slots">{pattern.slotsZh}</p>
        <div className="expression-keyword-pair">
          {[ideaA, ideaB].filter(Boolean).map((idea) => (
            <div key={idea.id}>
              <small>{idea.title}</small>
              <strong>{idea.keywords.slice(0, 4).join(" ／ ")}</strong>
            </div>
          ))}
        </div>
        {revealed ? (
          <div className="expression-reveal expression-short-examples">
            <small>规则与短例</small>
            {pattern.explanationZh && (
              <p className="expression-learning-note">
                <b>基础解释</b>{pattern.explanationZh}
              </p>
            )}
            {pattern.contrastJa && (
              <p className="expression-contrast" lang="ja">
                <b>易错对比</b>{pattern.contrastJa}
              </p>
            )}
            {pattern.examplesJa.slice(0, 2).map((example) => (
              <p className="expression-pattern-example" key={example} lang="ja">{example}</p>
            ))}
            {pattern.alternativesJa.length > 0 && (
              <p className="expression-natural-options" lang="ja">
                <b>更自然</b>{pattern.alternativesJa.slice(0, 2).join(" ／ ")}
              </p>
            )}
            <EvidenceRefs references={pattern.evidenceRefs} />
            <p className="expression-hint">不要复述示例；换成上面的关键词再说一遍。</p>
          </div>
        ) : (
          <RevealButton onClick={onReveal}>查看两个短例</RevealButton>
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
        current={recipeIndex % recipes.length}
        total={recipes.length}
      />
      <article className="expression-prompt-card expression-improv-card">
        <span className="expression-item-badge">随机组合 · {recipe.id}</span>
        <div className="expression-improv-draw">
          <div>
            <small>原因</small>
            <strong>{cause.title}</strong>
            <p>{cause.keywords.slice(0, 5).join(" ／ ")}</p>
          </div>
          <span aria-hidden="true">＋</span>
          <div>
            <small>对策</small>
            <strong>{solution.title}</strong>
            <p>{solution.keywords.slice(0, 5).join(" ／ ")}</p>
          </div>
          <span aria-hidden="true">＋</span>
          <div>
            <small>指定句型</small>
            <strong lang="ja">{pattern.patternJa}</strong>
            <p>{pattern.functionZh}</p>
          </div>
        </div>

        <div className="expression-self-check">
          <small>说完后自己检查</small>
          <ul>
            <li>是否先给出观点，再说明原因和对策？</li>
            <li>是否避免把个人倾向说成所有人的特征？</li>
            <li>是否把建议和本人已有经历区分开？</li>
          </ul>
        </div>

        <button type="button" className="expression-resource-button" onClick={onResources}>
          {resourcesOpen ? "收起可用素材" : "卡住时查看可用素材"}
          <span aria-hidden="true">{resourcesOpen ? "−" : "+"}</span>
        </button>

        {resourcesOpen && (
          <div className="expression-resource-drawer">
            <div>
              <small>可调用词块</small>
              <ul>
                {relatedChunks.map((chunk) => (
                  <li key={chunk.id}>
                    <strong lang="ja">{chunk.japanese}</strong>
                    <span>{chunk.meaningZh}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <small>还可换用的句型</small>
              <ul className="expression-alternate-patterns">
                {alternatePatterns.map((candidate) => (
                  <li key={candidate.id}>
                    <strong lang="ja">{candidate.patternJa}</strong>
                    <span>{candidate.functionZh}</span>
                  </li>
                ))}
              </ul>
              <small>边界提醒</small>
              {boundaryCards.slice(0, 3).map((card) => (
                <p key={card.id}><b>{card.title}</b>{card.descriptionZh}</p>
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
          {busy ? "正在记录…" : "完成一次表达"}
        </button>
        <button type="button" onClick={onRedraw}>重新抽取 <span>↻</span></button>
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
          {current.kind === "correction" ? "口误修正" : "危险表达"} · {current.item.id}
        </span>
        <small>{current.item.title}</small>
        <blockquote lang="ja">{original}</blockquote>
        {revealed ? (
          <div className="expression-reveal">
            <small>推荐改写</small>
            <strong lang="ja">{corrected}</strong>
            {current.kind === "safe" && <p>{current.item.reasonZh}</p>}
            <div className="expression-replacement">
              <b>替换练习</b>
              <span>{practice}</span>
            </div>
            {current.kind === "correction" && (
              <EvidenceRefs references={current.item.evidenceRefs} />
            )}
          </div>
        ) : (
          <RevealButton onClick={onReveal}>我已经改写，查看短句</RevealButton>
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
  return (
    <section className="expression-practice expression-unavailable">
      <b>待</b>
      <div><h3>当前练法还没有素材</h3><p>{text}</p></div>
    </section>
  );
}
