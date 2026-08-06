"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  computeStats,
  latestListeningMarks,
  parseAnnotations,
  parseSeirikou,
  patternSlug,
  plainSei,
  reviewDecisionTasks,
  segmentSei,
  uniqueAnnotations,
  type ParsedSeirikou,
  type ReviewAnnotation,
  type ReviewDecisionTask,
  type ReviewSentence,
  type ReviewStats,
} from "@/lib/review";
import { getString, getType, type Note } from "@/lib/notes";
import {
  allDeductions,
  DEDUCTION_SEVERITY_META,
  hasDeductionLedger,
  parseInterviewAnswerReview,
  REVIEW_DIMENSION_META,
  type AnswerStrategyTag,
  type InterviewAnswerReview,
  type ReviewDeduction,
  type ReviewDimensionKey,
} from "@/lib/review-deep";
import { parseInterviewPractice } from "@/lib/review-practice";
import {
  parseReviewFeedback,
  uniqueReviewFeedback,
  type ReviewFeedbackEntry,
  type ReviewFeedbackKind,
} from "@/lib/review-feedback";
// タグのラベルは vault の 面接傾向_横断 を生成する側と同じものを使う。
// 二重に持つと Web の表示と generated ノートの表記がずれる
import { STRATEGY_TREND_META } from "@/lib/interview-trends.mjs";

// 面接復盤：整理稿（派生層）を読む・批注（事実層）へ追記する、の2操作だけを持つ。
// 整理稿の中身をここで書き換える経路は意図的に存在しない（唯一writer表を参照）。

type ReviewDoc = {
  key: string;
  note: Note;
  company: string;
  date: string;
  round: string;
  result?: string;
  parsed: ParsedSeirikou;
  stats: ReviewStats;
  annotationPath: string;
  annotationExists: boolean;
  annotations: ReviewAnnotation[];
  bySentence: Map<string, ReviewAnnotation[]>;
  listeningMarks: Map<string, "×" | "△">;
  decisionTasks: ReviewDecisionTask[];
  deepReview?: InterviewAnswerReview;
  practiceBlockIds: Set<string>;
  feedbackByBlock: Map<string, ReviewFeedbackEntry[]>;
};

/**
 * 写入失败的一条提示。`subject` 必须自带主语（哪场面接、哪句/哪个 block），
 * 因为这条提示不出现在触发它的按钮旁边，靠位置认不出说的是谁。
 */
type WriteAlert = { subject: string; detail: string };

type Mode = "study" | "compare";
type Filter =
  | "all"
  | "pending"
  | "transcript"
  | "learner-decision"
  | "speaker-decision"
  | "noted"
  | "open"
  | "err"
  | "go";

// 阅读模式跟侧栏折叠态一个做法：存 localStorage、useSyncExternalStore 读，
// 避免「effect 里 setState」的水合抖动。
const MODE_KEY = "review:mode";
const MODE_EVENT = "review:modechange";

function subscribeMode(onChange: () => void) {
  window.addEventListener(MODE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(MODE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readMode(): Mode {
  return window.localStorage.getItem(MODE_KEY) === "compare" ? "compare" : "study";
}

const FILTER_LABELS: { id: Filter; label: string; shortcut: string }[] = [
  { id: "all", label: "全部", shortcut: "1" },
  { id: "pending", label: "待裁定", shortcut: "2" },
  { id: "transcript", label: "转录错误", shortcut: "3" },
  { id: "learner-decision", label: "我说错了", shortcut: "4" },
  { id: "speaker-decision", label: "话者确认", shortcut: "5" },
  { id: "noted", label: "已批注", shortcut: "6" },
  { id: "open", label: "未结束", shortcut: "7" },
  { id: "err", label: "我的错误", shortcut: "8" },
  { id: "go", label: "聴解・語彙", shortcut: "9" },
];

function toggleSet(current: Set<string>, key: string) {
  const next = new Set(current);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

function buildDocs(notes: Note[]): ReviewDoc[] {
  const studies = notes.filter((note) => getType(note) === "transcript-study");
  const annotationNotes = notes.filter((note) => getType(note) === "study-annotation");
  const reviewNotes = notes.filter((note) => getType(note) === "review");
  const deepReviewNotes = notes.filter((note) => getType(note) === "interview-answer-review");
  const practiceNotes = notes.filter((note) => getType(note) === "interview-answer-practice");
  const feedbackNotes = notes.filter((note) => getType(note) === "interview-answer-feedback");

  return studies
    .map((note) => {
      const company = getString(note.frontmatter.company);
      const date = getString(note.frontmatter.date);
      const round = getString(note.frontmatter.round);
      const annotationNote = annotationNotes.find(
        (candidate) =>
          getString(candidate.frontmatter.company) === company &&
          getString(candidate.frontmatter.date) === date,
      );
      const resultNote = reviewNotes.find(
        (candidate) =>
          getString(candidate.frontmatter.company) === company &&
          getString(candidate.frontmatter.date) === date,
      );
      const deepReviewNote = deepReviewNotes.find(
        (candidate) =>
          getString(candidate.frontmatter.company) === company &&
          getString(candidate.frontmatter.date) === date &&
          getString(candidate.frontmatter.round) === round,
      );
      const practiceNote = practiceNotes.find(
        (candidate) =>
          getString(candidate.frontmatter.company) === company &&
          getString(candidate.frontmatter.date) === date &&
          getString(candidate.frontmatter.round) === round,
      );
      const feedbackNote = feedbackNotes.find(
        (candidate) =>
          getString(candidate.frontmatter.company) === company &&
          getString(candidate.frontmatter.date) === date &&
          getString(candidate.frontmatter.round) === round,
      );
      const parsed = parseSeirikou(note.content);
      const annotations = annotationNote
        ? uniqueAnnotations(parseAnnotations(annotationNote.content))
        : [];
      const bySentence = new Map<string, ReviewAnnotation[]>();
      for (const annotation of annotations) {
        const list = bySentence.get(annotation.sentenceId) ?? [];
        list.push(annotation);
        bySentence.set(annotation.sentenceId, list);
      }
      const feedbackByBlock = new Map<string, ReviewFeedbackEntry[]>();
      for (const feedback of feedbackNote
        ? uniqueReviewFeedback(parseReviewFeedback(feedbackNote.content))
        : []) {
        const list = feedbackByBlock.get(feedback.blockId) ?? [];
        list.push(feedback);
        feedbackByBlock.set(feedback.blockId, list);
      }
      return {
        key: note.path,
        note,
        company,
        date,
        round,
        result: getString(resultNote?.frontmatter.result) || undefined,
        parsed,
        stats: computeStats(parsed.sentences),
        annotationPath: annotationNote?.path ?? note.path.replace(/_整理稿\.md$/, "_批注.md"),
        annotationExists: Boolean(annotationNote),
        annotations,
        bySentence,
        listeningMarks: latestListeningMarks(annotations),
        decisionTasks: reviewDecisionTasks(parsed.sentences, annotations),
        deepReview: deepReviewNote
          ? parseInterviewAnswerReview(deepReviewNote.content) ?? undefined
          : undefined,
        practiceBlockIds: new Set(
          practiceNote
            ? parseInterviewPractice(practiceNote.content).map((entry) => entry.blockId)
            : [],
        ),
        feedbackByBlock,
      };
    })
    .sort((left, right) => right.date.localeCompare(left.date));
}

export default function InterviewReview({
  notes,
  onVaultChanged,
  initialSelectedKey = null,
}: {
  notes: Note[];
  onVaultChanged: () => void | Promise<void>;
  initialSelectedKey?: string | null;
}) {
  const docs = useMemo(() => buildDocs(notes), [notes]);

  const [selectedKey, setSelectedKey] = useState<string | null>(initialSelectedKey);
  const mode = useSyncExternalStore(subscribeMode, readMode, () => "study" as Mode);
  const [filter, setFilter] = useState<Filter>("all");
  const [patternFilter, setPatternFilter] = useState<string | null>(null);
  const [openBlocks, setOpenBlocks] = useState<Set<string>>(new Set());
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [errOpen, setErrOpen] = useState<Set<string>>(new Set());
  const [rawOpen, setRawOpen] = useState<Set<string>>(new Set());
  /**
   * 「正在批注哪一句」和草稿正文合成一个对象，是为了让清空只能是原子的。
   * 句子 ID 形如 s1/s2/s5，每场整理稿都从 s1 重新编号，**跨场必然重号**；
   * 拆成两个 state 时漏清任何一个，B 场的同号句就会顶着 A 场的草稿把编辑器打开。
   */
  const [annotationDraft, setAnnotationDraft] = useState<
    { sentenceId: string; draft: string } | null
  >(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [deepBusy, setDeepBusy] = useState(false);
  const [practiceBusy, setPracticeBusy] = useState<string | null>(null);
  const [feedbackBusy, setFeedbackBusy] = useState<string | null>(null);
  const [deepOpen, setDeepOpen] = useState(false);
  const [deepFocusBlockId, setDeepFocusBlockId] = useState<string | null>(null);
  const [deepFocusDimension, setDeepFocusDimension] = useState<ReviewDimensionKey | null>(null);
  const [evidenceFocus, setEvidenceFocus] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  /**
   * 🔴 写入失败**不走** `message`。`message` 只在正文流的一个位置（第二阶段面板之后）渲染，
   * 而这四条写入路径的触发点全都看不到那个位置：句卡在它下面几千 px，
   * 「加入重练」「同意」在展开的 `<details>` 里往下几百 px，
   * 「重新生成」隔着整份报告面板（约 2,400px）。
   * 按下的人看不到失败理由，就跟按了没反应的死按钮没有区别 —— 这正是这次要修的病。
   *
   * 所以失败一律积到 `writeAlerts`，只由固定层 `.rv-write-alerts` 一处渲染：
   * 不依赖任何子树保持挂载、不依赖滚动位置、不依赖当前是详情页还是一覧页。
   * 同样的理由和同样的形状见 jobs-view 的 `statusErrors`
   *（那边把提示放在控件旁边试过两次，两次都在实际使用中看不见）。
   */
  const [writeAlerts, setWriteAlerts] = useState<Record<string, WriteAlert>>({});
  const inFlightAnnotations = useRef(new Set<string>());

  const switchMode = (next: Mode) => {
    window.localStorage.setItem(MODE_KEY, next);
    window.dispatchEvent(new Event(MODE_EVENT));
  };

  /**
   * 深度报告的三个 focus 是一组：blockId / dimension / evidence 说的都是「现在看的是哪一场的哪一处」。
   * 换场时只清其中一部分，残留的那个会在报告下次挂载时把滚动位置抢走——
   * 而且 dimension 的定位比 blockId 多等一帧（双 rAF vs 单 rAF），残留的维度反而盖过刚点开的那一问。
   * 所以只留这一个通道：新增入口照着调用即可，不会再出现「补了两个、忘了第三个」。
   */
  const focusDeepReview = (blockId: string | null) => {
    setDeepOpen(Boolean(blockId));
    setDeepFocusBlockId(blockId);
    setDeepFocusDimension(null);
    setEvidenceFocus(null);
  };

  /**
   * 批注草稿是**另一组**状态，故意不并进 `focusDeepReview`：那边说的是「报告看到哪儿」，
   * 纯展示；这边攥着一段还没落盘的用户输入，清不掉是会写坏数据的。
   * 写入走 `submitAnnotation(target, ...)` 里的 `target.annotationPath`，
   * 而 target 永远是**当前显示的那场**——换场时草稿不清，A 场没保存的文字就会被
   * 送进 B 场的 _批注.md，挂到一个同号但毫不相干的句子上。
   * 两组语义不同，但要求一样：换场的入口两个都得调。
   */
  const resetAnnotationDraft = () => setAnnotationDraft(null);

  const doc = docs.find((item) => item.key === selectedKey) ?? null;

  useEffect(() => {
    if (!doc) return;
    const byKey: Record<string, Filter> = {
      "1": "all",
      "2": "pending",
      "3": "transcript",
      "4": "learner-decision",
      "5": "speaker-decision",
      "6": "noted",
      "7": "open",
      "8": "err",
      "9": "go",
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      const next = byKey[event.key];
      if (!next) return;
      event.preventDefault();
      setFilter(next);
      setPatternFilter(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [doc]);

  /** 同一个 key 也用于「重试前先清掉上一次的失败」：成功了就不会再被写回去。 */
  const dismissWriteAlert = useCallback((key: string) => {
    setWriteAlerts((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);

  const noteWriteFailure = useCallback(
    (key: string, subject: string, error: unknown, fallback: string) => {
      const reason = error instanceof Error && error.message ? error.message : fallback;
      setWriteAlerts((current) => ({ ...current, [key]: { subject, detail: reason } }));
    },
    [],
  );

  const submitAnnotation = useCallback(
    async (
      target: ReviewDoc,
      sentenceId: string,
      kind: "批注" | "裁定" | "聴解",
      text: string,
      decisionTarget?: string,
    ) => {
      const submissionKey = [target.key, sentenceId, kind, decisionTarget ?? "", text].join("\u0000");
      if (inFlightAnnotations.current.has(submissionKey)) return;
      inFlightAnnotations.current.add(submissionKey);
      // 裁定按 target 分 key：同一句上「話者裁定」和「誤2 裁定」各自失败时要能同时看到两条。
      const alertKey = `annotate:${target.key}:${sentenceId}:${kind}:${decisionTarget ?? ""}`;
      setBusy(sentenceId);
      setMessage(null);
      dismissWriteAlert(alertKey);
      try {
        const response = await fetch("/api/review/annotate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            notePath: target.annotationPath,
            sentenceId,
            kind,
            text,
            target: decisionTarget,
          }),
        });
        const payload = (await response.json()) as { ok?: boolean; error?: string };
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error ?? `写入失败（${response.status}）`);
        }
        setAnnotationDraft(null);
        await onVaultChanged();
      } catch (error) {
        noteWriteFailure(
          alertKey,
          `${target.company} · ${sentenceId} 的${kind}`,
          error,
          "批注写入失败",
        );
      } finally {
        inFlightAnnotations.current.delete(submissionKey);
        setBusy(null);
      }
    },
    [dismissWriteAlert, noteWriteFailure, onVaultChanged],
  );

  const generateDeepReview = useCallback(
    async (target: ReviewDoc) => {
      const alertKey = `deep:${target.key}`;
      setDeepBusy(true);
      setMessage(null);
      dismissWriteAlert(alertKey);
      try {
        const response = await fetch("/api/review/deep", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notePath: target.note.path }),
        });
        const payload = (await response.json()) as { ok?: boolean; error?: string };
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error ?? `生成失败（${response.status}）`);
        }
        await onVaultChanged();
        setDeepOpen(true);
      } catch (error) {
        noteWriteFailure(
          alertKey,
          `${target.company} · 回答质量复盘`,
          error,
          "回答质量复盘生成失败",
        );
      } finally {
        setDeepBusy(false);
      }
    },
    [dismissWriteAlert, noteWriteFailure, onVaultChanged],
  );

  const queuePractice = useCallback(
    async (target: ReviewDoc, blockId: string) => {
      const alertKey = `practice:${target.key}:${blockId}`;
      setPracticeBusy(blockId);
      setMessage(null);
      dismissWriteAlert(alertKey);
      try {
        const response = await fetch("/api/review/practice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notePath: target.note.path, blockId }),
        });
        const payload = (await response.json()) as {
          ok?: boolean;
          error?: string;
          deduplicated?: boolean;
        };
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error ?? `加入失败（${response.status}）`);
        }
        await onVaultChanged();
        setMessage(payload.deduplicated ? `${blockId} 已在重练队列中。` : `${blockId} 已加入重练队列。`);
      } catch (error) {
        noteWriteFailure(
          alertKey,
          `${target.company} · ${blockId} 加入重练`,
          error,
          "加入重练失败",
        );
      } finally {
        setPracticeBusy(null);
      }
    },
    [dismissWriteAlert, noteWriteFailure, onVaultChanged],
  );

  const submitReviewFeedback = useCallback(
    async (
      target: ReviewDoc,
      blockId: string,
      kind: ReviewFeedbackKind,
      feedbackText: string,
    ) => {
      const alertKey = `feedback:${target.key}:${blockId}:${kind}`;
      setFeedbackBusy(blockId);
      setMessage(null);
      dismissWriteAlert(alertKey);
      try {
        const response = await fetch("/api/review/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notePath: target.note.path, blockId, kind, text: feedbackText }),
        });
        const payload = (await response.json()) as {
          ok?: boolean;
          error?: string;
          deduplicated?: boolean;
        };
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error ?? `反馈写入失败（${response.status}）`);
        }
        await onVaultChanged();
        setMessage(payload.deduplicated ? `${blockId} 已记录过相同反馈。` : `${blockId} 的人工反馈已保存。`);
        return true;
      } catch (error) {
        noteWriteFailure(
          alertKey,
          `${target.company} · ${blockId} 的${FEEDBACK_LABELS[kind]}`,
          error,
          "AI 评价反馈写入失败",
        );
        return false;
      } finally {
        setFeedbackBusy(null);
      }
    },
    [dismissWriteAlert, noteWriteFailure, onVaultChanged],
  );

  if (!doc) {
    // 退回一覧页也不丢失败提示：写入还没回来时按了「← 面接一覧」就看不到理由的话，
    // 那又多出一个「看不见的条件」，正是这次要消掉的东西。
    return (
      <>
        <ReviewIndex
          docs={docs}
          onSelect={(key, reviewBlockId) => {
            setSelectedKey(key);
            setFilter("all");
            setPatternFilter(null);
            // 先把整场面接还原成摘要目录，让读者自己选择进入哪一问。
            setOpenBlocks(new Set());
            setRevealed(new Set());
            setErrOpen(new Set());
            setRawOpen(new Set());
            focusDeepReview(reviewBlockId ?? null);
            resetAnnotationDraft();
            window.scrollTo({ top: 0 });
          }}
        />
        <ReviewWriteAlerts alerts={writeAlerts} onDismiss={dismissWriteAlert} />
      </>
    );
  }

  const unresolvedDecisionTasks = doc.decisionTasks.filter((task) => !task.resolvedBy);
  const resolvedDecisionCount = doc.decisionTasks.length - unresolvedDecisionTasks.length;
  const pendingSentenceIds = new Set(unresolvedDecisionTasks.map((task) => task.sentenceId));
  const transcriptDecisionTasks = doc.decisionTasks.filter(
    (task) => task.resolution === "transcript",
  );
  const learnerDecisionTasks = doc.decisionTasks.filter((task) => task.resolution === "learner");
  const speakerDecisionTasks = doc.decisionTasks.filter((task) =>
    task.resolution?.startsWith("speaker-"),
  );
  const transcriptSentenceIds = new Set(transcriptDecisionTasks.map((task) => task.sentenceId));
  const learnerDecisionSentenceIds = new Set(learnerDecisionTasks.map((task) => task.sentenceId));
  const speakerDecisionSentenceIds = new Set(speakerDecisionTasks.map((task) => task.sentenceId));
  const openAnnotations = doc.annotations.filter((item) => item.status === "open");
  const openSentenceIds = new Set(openAnnotations.map((item) => item.sentenceId));
  const notedSentenceCount = doc.bySentence.size;
  const filterCounts: Record<Filter, string | number> = {
    all: doc.stats.sentenceTotal,
    pending: `${pendingSentenceIds.size}句·${unresolvedDecisionTasks.length}点`,
    transcript: `${transcriptDecisionTasks.length}点`,
    "learner-decision": `${learnerDecisionTasks.length}点`,
    "speaker-decision": `${speakerDecisionTasks.length}点`,
    noted: notedSentenceCount,
    open: openAnnotations.length,
    err: doc.parsed.sentences.filter((sentence) =>
      sentence.errors.some((error) => error.kind === "学習者"),
    ).length,
    go: doc.stats.goCount,
  };

  const sentenceMatches = (sentence: ReviewSentence) => {
    if (patternFilter) {
      return sentence.errors.some(
        (error) => error.pattern && patternSlug(error.pattern) === patternFilter,
      );
    }
    if (filter === "err") return sentence.errors.some((error) => error.kind === "学習者");
    if (filter === "pending") return pendingSentenceIds.has(sentence.id);
    if (filter === "transcript") return transcriptSentenceIds.has(sentence.id);
    if (filter === "learner-decision") return learnerDecisionSentenceIds.has(sentence.id);
    if (filter === "speaker-decision") return speakerDecisionSentenceIds.has(sentence.id);
    if (filter === "go") return sentence.go.length > 0;
    if (filter === "noted") return doc.bySentence.has(sentence.id);
    if (filter === "open") return openSentenceIds.has(sentence.id);
    return true;
  };

  const visibleBlocks = doc.parsed.blocks
    .map((block) => ({ block, sentences: block.sentences.filter(sentenceMatches) }))
    .filter((item) => item.sentences.length > 0);
  const focused = filter !== "all" || Boolean(patternFilter);
  const visibleSentenceCount = visibleBlocks.reduce((total, item) => total + item.sentences.length, 0);
  const visibleBlockIds = visibleBlocks.map((item) => item.block.id);

  const scrollToBlock = (blockId: string) => {
    setOpenBlocks((current) => {
      const next = new Set(current);
      next.add(blockId);
      return next;
    });
    // 如果目录打开了一个折叠章节，要等 DOM 补上句子后再定位。
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        document
          .getElementById(`rvb-${blockId}`)
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  };

  const jumpToEvidence = (sentenceId: string) => {
    const block = doc.parsed.blocks.find((item) =>
      item.sentences.some((sentence) => sentence.id === sentenceId),
    );
    if (!block) {
      setMessage(`整理稿中找不到证据句 ${sentenceId}。`);
      return;
    }
    setFilter("all");
    setPatternFilter(null);
    setOpenBlocks((current) => {
      const next = new Set(current);
      next.add(block.id);
      return next;
    });
    setRevealed((current) => {
      const next = new Set(current);
      next.add(sentenceId);
      return next;
    });
    setEvidenceFocus(sentenceId);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        document
          .getElementById(`rvs-${sentenceId}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });
  };

  const patternEntries = [...doc.stats.patterns.entries()].sort(
    (left, right) => right[1].learner + right[1].uncertain - (left[1].learner + left[1].uncertain),
  );

  return (
    <div className="review-view">
      <header className="rv-toolbar">
        <button
          className="rv-back"
          onClick={() => {
            setSelectedKey(null);
            focusDeepReview(null);
            resetAnnotationDraft();
            window.scrollTo({ top: 0 });
          }}
        >← 面接一覧</button>
        <div className="rv-title">
          <h1>{doc.company}</h1>
          <span>{doc.round} · {doc.date}{doc.result ? ` · ${doc.result}` : ""}</span>
        </div>
        <div className="rv-mode" role="tablist" aria-label="阅读模式">
          <button
            role="tab"
            aria-selected={mode === "study"}
            className={mode === "study" ? "active" : ""}
            onClick={() => switchMode("study")}
          >学習<small>先猜后看</small></button>
          <button
            role="tab"
            aria-selected={mode === "compare"}
            className={mode === "compare" ? "active" : ""}
            onClick={() => switchMode("compare")}
          >対照<small>日中并排</small></button>
        </div>
      </header>

      <section className="rv-stats">
        <div className="rv-counts">
          <div><strong>{doc.stats.sentenceTotal}</strong><span>文</span></div>
          <div><strong>{pendingSentenceIds.size}</strong><span>待确认句</span></div>
          <div><strong>{unresolvedDecisionTasks.length}</strong><span>待裁定点</span></div>
          <div><strong>{transcriptDecisionTasks.length}</strong><span>转录错误</span></div>
          <div><strong>{learnerDecisionTasks.length}</strong><span>我说错了</span></div>
          <div><strong>{openAnnotations.length}</strong><span>未结束</span></div>
        </div>
        {patternEntries.length > 0 && (
          <div className="rv-patterns" aria-label="错误型分布">
            {patternEntries.slice(0, 8).map(([slug, bucket]) => (
              <button
                key={slug}
                className={patternFilter === slug ? "active" : ""}
                onClick={() => setPatternFilter(patternFilter === slug ? null : slug)}
                title={`确定 ${bucket.learner} · 疑 ${bucket.uncertain}`}
              >
                {slug}
                <b>{bucket.learner + bucket.uncertain}</b>
              </button>
            ))}
            {patternFilter && (
              <button className="rv-clear" onClick={() => setPatternFilter(null)}>清除筛选 ×</button>
            )}
          </div>
        )}
        <div className="rv-filters" role="tablist" aria-label="内容筛选">
          {FILTER_LABELS.map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={filter === item.id && !patternFilter}
              className={filter === item.id && !patternFilter ? "active" : ""}
              onClick={() => {
                setFilter(item.id);
                setPatternFilter(null);
              }}
            >
              <kbd>{item.shortcut}</kbd>
              {item.label}
              <b>{filterCounts[item.id]}</b>
            </button>
          ))}
        </div>
      </section>

      <section className={`rv-stage ${unresolvedDecisionTasks.length === 0 ? "complete" : ""}`}>
        <div className="rv-stage-copy">
          <span>第一阶段 · 证据裁定</span>
          <h2>
            {unresolvedDecisionTasks.length === 0
              ? "批注完成，可以进入回答质量复盘"
              : `${pendingSentenceIds.size} 句话里还有 ${unresolvedDecisionTasks.length} 个裁定点`}
          </h2>
          <p>
            已裁定 {resolvedDecisionCount} / {doc.decisionTasks.length}：转录错误 {transcriptDecisionTasks.length}，本人错误 {learnerDecisionTasks.length}，话者确认 {speakerDecisionTasks.length}。
            深度复盘会在全部完成后再判断漏答、答非所问和回答策略。
          </p>
        </div>
        <div className="rv-stage-progress" aria-label={`批注进度 ${resolvedDecisionCount} / ${doc.decisionTasks.length}`}>
          <i style={{ width: `${doc.decisionTasks.length ? (resolvedDecisionCount / doc.decisionTasks.length) * 100 : 100}%` }} />
        </div>
        <button
          disabled={unresolvedDecisionTasks.length === 0}
          onClick={() => {
            setFilter("pending");
            setPatternFilter(null);
          }}
        >
          {unresolvedDecisionTasks.length === 0 ? "第一阶段已完成" : "继续裁定 →"}
        </button>
      </section>

      <section className={`rv-deep-stage ${unresolvedDecisionTasks.length > 0 ? "locked" : "ready"}`}>
        <div className="rv-deep-stage-copy">
          <span>第二阶段 · 回答质量</span>
          <h2>
            {unresolvedDecisionTasks.length > 0
              ? "完成证据裁定后解锁"
              : doc.deepReview
                ? `整体评价 ${Math.round(doc.deepReview.overallScore)} / 100`
                : "可以生成深度复盘了"}
          </h2>
          <p>
            检查是否听懂、是否覆盖全部子问、是否答非所问，以及回答方式在日本面试中的策略风险；不重复做语法评分。
          </p>
        </div>
        <div className="rv-deep-actions">
          {doc.deepReview && (
            <button className="quiet" onClick={() => setDeepOpen((current) => !current)}>
              {deepOpen ? "收起报告" : "查看报告"}
            </button>
          )}
          <button
            disabled={unresolvedDecisionTasks.length > 0 || deepBusy}
            onClick={() => void generateDeepReview(doc)}
          >
            {unresolvedDecisionTasks.length > 0
              ? `还差 ${unresolvedDecisionTasks.length} 个裁定点`
              : deepBusy
                ? "正在分析整场面试…"
                : doc.deepReview
                  ? "重新生成"
                  : "生成深度复盘 →"}
          </button>
        </div>
        {doc.deepReview?.dimensions && (
          <section className="rv-score-glance" aria-label="五维评分概览">
            <header>
              <strong>五维评分</strong>
              <span>
                {hasDeductionLedger(doc.deepReview.dimensions)
                  ? "每维都从 100 起扣 · 点开任意一维看扣在哪一题"
                  : "各占 20% · 旧格式报告没有扣分明细，重新生成后可见"}
              </span>
            </header>
            <div>
              {(Object.keys(REVIEW_DIMENSION_META) as ReviewDimensionKey[]).map((key) => {
                const dimension = doc.deepReview?.dimensions?.[key];
                const score = Math.round(dimension?.score ?? 0);
                const band = score >= 80 ? "high" : score >= 65 ? "mid" : "low";
                const deductions = dimension?.deductions;
                const top = (deductions ?? []).slice(0, 2);
                return (
                  <article key={key}>
                    <button
                      type="button"
                      disabled={!deductions}
                      aria-label={`${REVIEW_DIMENSION_META[key].label} ${score} 分，查看扣分明细`}
                      onClick={() => {
                        setDeepOpen(true);
                        setDeepFocusDimension(key);
                      }}
                    >
                      <div>
                        <span>{REVIEW_DIMENSION_META[key].label}</span>
                        <strong>{score}</strong>
                      </div>
                      <i className="rv-dimension-track" aria-hidden="true">
                        <em className={band} style={{ width: `${score}%` }} />
                      </i>
                      {deductions && (deductions.length === 0 ? (
                        <p className="rv-glance-clean">没有找到扣分点</p>
                      ) : (
                        <ul className="rv-glance-deductions">
                          {top.map((item, index) => (
                            <li key={`${item.blockId}-${index}`}>
                              <b>−{item.points}</b>
                              {item.blockId && <i>{item.blockId}</i>}
                              <span>{item.labelZh}</span>
                            </li>
                          ))}
                          {deductions.length > top.length && (
                            <li className="more">还有 {deductions.length - top.length} 项 →</li>
                          )}
                        </ul>
                      ))}
                    </button>
                  </article>
                );
              })}
            </div>
          </section>
        )}
      </section>

      {doc.deepReview && deepOpen && (
        <DeepReviewPanel
          review={doc.deepReview}
          queuedBlockIds={doc.practiceBlockIds}
          practiceBusy={practiceBusy}
          feedbackByBlock={doc.feedbackByBlock}
          feedbackBusy={feedbackBusy}
          focusBlockId={deepFocusBlockId}
          focusDimension={deepFocusDimension}
          onEvidenceClick={jumpToEvidence}
          onQueuePractice={(blockId) => void queuePractice(doc, blockId)}
          onFeedback={(blockId, kind, feedbackText) =>
            submitReviewFeedback(doc, blockId, kind, feedbackText)}
        />
      )}

      {!doc.annotationExists && (
        <p className="rv-message">这场面接还没有批注文件（{doc.annotationPath}）。先在 vault 里建好再批注。</p>
      )}
      {/* 写入失败不再走这里（由 .rv-write-alerts 接住），剩下的只有成功和找不到证据句的通知，
          所以不再挂 error 样式 —— 红底配「已加入重练队列」会把成功读成失败。 */}
      {message && <p className="rv-message">{message}</p>}

      <div className="rv-reading-bar">
        <p>
          <strong>{visibleSentenceCount}</strong>
          <span> / {doc.stats.sentenceTotal} 句</span>
          <i>·</i>
          <span>{visibleBlocks.length} 个话题</span>
          {focused && <em>筛选结果已自动展开</em>}
        </p>
        {!focused && visibleBlocks.length > 0 && (
          <div>
            <button onClick={() => setOpenBlocks(new Set(visibleBlockIds))}>展开全部</button>
            <button onClick={() => setOpenBlocks(new Set())}>收起全部</button>
          </div>
        )}
      </div>

      <nav className="rv-toc" aria-label="質問ブロック">
        {visibleBlocks.map(({ block }) => {
          const errCount = block.sentences.reduce(
            (total, sentence) => total + sentence.errors.filter((error) => error.kind !== "転写").length,
            0,
          );
          const isOpen = focused || openBlocks.has(block.id);
          return (
            <button
              key={block.id}
              className={isOpen ? "open" : ""}
              aria-expanded={isOpen}
              onClick={() => scrollToBlock(block.id)}
              title={block.summary ?? block.title}
            >
              <span>{block.id}</span>
              {block.title.replace(/（.*$/, "").slice(0, 9)}
              {errCount > 0 && <b>{errCount}</b>}
            </button>
          );
        })}
      </nav>

      <div className="rv-stream">
        {visibleBlocks.length === 0 && (
          <p className="rv-empty-filter">当前筛选没有命中任何句子。</p>
        )}
        {visibleBlocks.map(({ block, sentences }) => {
          const isOpen = focused || openBlocks.has(block.id);
          const issueCount = sentences.reduce(
            (total, sentence) =>
              total +
              sentence.errors.filter((error) => error.kind !== "転写").length +
              (sentence.uncertainSpeaker ? 1 : 0),
            0,
          );
          return (
          <section key={block.id} className={`rv-block ${isOpen ? "open" : "collapsed"}`} id={`rvb-${block.id}`}>
            <header>
              <button
                className="rv-block-toggle"
                aria-expanded={isOpen}
                aria-controls={`rvb-body-${block.id}`}
                disabled={focused}
                onClick={() => setOpenBlocks((current) => toggleSet(current, block.id))}
              >
                <span className="rv-block-id">{block.id}</span>
                <span className="rv-block-copy">
                  <span className="rv-block-title">
                    <h2>{block.title}</h2>
                    <small>{sentences.length} 句{issueCount > 0 ? ` · ${issueCount} 处重点` : ""}</small>
                  </span>
                  {block.summary && <span className="rv-block-summary">{block.summary}</span>}
                </span>
                <span className="rv-block-chevron" aria-hidden="true">⌄</span>
              </button>
            </header>
            {isOpen && (
              <div className="rv-block-body" id={`rvb-body-${block.id}`}>
                {sentences.map((sentence) => (
                  <SentenceCard
                    key={sentence.id}
                    doc={doc}
                    sentence={sentence}
                    mode={mode}
                    revealed={revealed.has(sentence.id)}
                    errored={errOpen.has(sentence.id)}
                    rawShown={rawOpen.has(sentence.id)}
                    noting={annotationDraft?.sentenceId === sentence.id}
                    noteDraft={annotationDraft?.draft ?? ""}
                    busy={busy === sentence.id}
                    evidenceFocused={evidenceFocus === sentence.id}
                    onReveal={() => setRevealed((current) => toggleSet(current, sentence.id))}
                    onToggleErrors={() => setErrOpen((current) => toggleSet(current, sentence.id))}
                    onToggleRaw={() => setRawOpen((current) => toggleSet(current, sentence.id))}
                    onStartNote={() => setAnnotationDraft({ sentenceId: sentence.id, draft: "" })}
                    onCancelNote={() => setAnnotationDraft(null)}
                    onDraft={(draft) => setAnnotationDraft({ sentenceId: sentence.id, draft })}
                    onSubmit={(kind, text, decisionTarget) =>
                      void submitAnnotation(doc, sentence.id, kind, text, decisionTarget)
                    }
                  />
                ))}
              </div>
            )}
          </section>
          );
        })}
      </div>

      <ReviewWriteAlerts alerts={writeAlerts} onDismiss={dismissWriteAlert} />
    </div>
  );
}

const QUALITY_LABELS = {
  strong: "回答较好",
  mixed: "有得有失",
  weak: "需要重练",
  neutral: "无需评价",
} as const;

const COMPREHENSION_LABELS = {
  clear: "听懂了",
  partial: "部分理解",
  likely_missed: "可能没听懂",
} as const;

const DECISION_LABELS = {
  transcript: "转录错误",
  learner: "本人确实说错",
  "speaker-interviewer": "话者：面试官",
  "speaker-self": "话者：本人",
  unknown: "已裁定",
} as const;

const FEEDBACK_LABELS: Record<ReviewFeedbackKind, string> = {
  agree: "同意",
  disagree: "不同意",
  context: "补充事实",
};

/**
 * 🔴 写入失败的显示**只有这一处**。放在按钮旁边的做法不要再试：
 * 句卡、`<details>` 里的「加入重练」「同意」、报告面板上方的「重新生成」，
 * 它们和正文流里的提示位之间隔着几百到几千 px，出错时人根本滚不到；
 * 折叠 `<details>` 或退回一覧页还会把提示连同子树一起卸载掉。
 * 所以这里不依赖挂载状态、不依赖滚动位置、不依赖当前是详情页还是一覧页 ——
 * 固定层画一次，`subject` 自带主语，离得远也知道说的是哪一条。
 */
function ReviewWriteAlerts({
  alerts,
  onDismiss,
}: {
  alerts: Record<string, WriteAlert>;
  onDismiss: (key: string) => void;
}) {
  const entries = Object.entries(alerts);
  if (entries.length === 0) return null;
  return (
    <div className="rv-write-alerts" role="alert">
      {entries.map(([key, alert]) => (
        <p key={key}>
          <b>{alert.subject}</b>
          <span>没有写入。{alert.detail}</span>
          <button type="button" onClick={() => onDismiss(key)} aria-label="关闭提示">×</button>
        </p>
      ))}
    </div>
  );
}


/** 一条扣分：多少分・什么档・哪一题・为什么・下次怎么办・证据句。 */
function DeductionRow({
  item,
  dimensionLabel,
  onBlockClick,
  onEvidenceClick,
}: {
  item: ReviewDeduction;
  dimensionLabel?: string;
  onBlockClick: (blockId: string) => void;
  onEvidenceClick: (sentenceId: string) => void;
}) {
  return (
    <li className={`sev-${item.severity}`}>
      <div className="rv-deduction-head">
        <b>−{item.points}</b>
        <em title={DEDUCTION_SEVERITY_META[item.severity].hintZh}>
          {DEDUCTION_SEVERITY_META[item.severity].label}
        </em>
        {dimensionLabel && <u>{dimensionLabel}</u>}
        {item.blockId && (
          <button type="button" onClick={() => onBlockClick(item.blockId)}>
            {item.blockId}
          </button>
        )}
        <strong>{item.labelZh}</strong>
      </div>
      {item.detailZh && <p>{item.detailZh}</p>}
      {item.fixZh && (
        <p className="rv-deduction-fix"><span>下次</span>{item.fixZh}</p>
      )}
      {item.evidenceSentenceIds.length > 0 && (
        <p className="rv-deduction-evidence">
          <span>证据句</span>
          {item.evidenceSentenceIds.map((sentenceId) => (
            <button key={sentenceId} type="button" onClick={() => onEvidenceClick(sentenceId)}>
              {sentenceId}
            </button>
          ))}
        </p>
      )}
    </li>
  );
}

function DeepReviewPanel({
  review,
  queuedBlockIds,
  practiceBusy,
  feedbackByBlock,
  feedbackBusy,
  focusBlockId,
  focusDimension,
  onEvidenceClick,
  onQueuePractice,
  onFeedback,
}: {
  review: InterviewAnswerReview;
  queuedBlockIds: Set<string>;
  practiceBusy: string | null;
  feedbackByBlock: Map<string, ReviewFeedbackEntry[]>;
  feedbackBusy: string | null;
  focusBlockId: string | null;
  focusDimension: ReviewDimensionKey | null;
  onEvidenceClick: (sentenceId: string) => void;
  onQueuePractice: (blockId: string) => void;
  onFeedback: (
    blockId: string,
    kind: ReviewFeedbackKind,
    text: string,
  ) => Promise<boolean>;
}) {
  const [showAllBlocks, setShowAllBlocks] = useState(Boolean(focusBlockId));
  const [feedbackEditor, setFeedbackEditor] = useState<{
    blockId: string;
    kind: "disagree" | "context";
  } | null>(null);
  const [feedbackDraft, setFeedbackDraft] = useState("");
  const [deductionView, setDeductionView] = useState<"dimension" | "rank">("dimension");
  // 概览里点某一维时要跳到该维的锚点，而排行视图里没有按维度分组的锚点。
  // 用「props 变化时调整 state」的渲染期写法而不是 effect：effect 里 setState 会多跑一轮渲染，
  // 滚动就可能发生在视图还没切回来的时候。
  const [lastFocusDimension, setLastFocusDimension] = useState(focusDimension);
  if (focusDimension !== lastFocusDimension) {
    setLastFocusDimension(focusDimension);
    if (focusDimension) setDeductionView("dimension");
  }
  const ledger = hasDeductionLedger(review.dimensions);
  const flatDeductions = allDeductions(review.dimensions);
  const lostPoints = flatDeductions.reduce((total, item) => total + item.points, 0);
  const priorities = new Set(review.priorityBlockIds);
  const sortedBlocks = [...review.blocks].sort(
    (left, right) => Number(priorities.has(right.blockId)) - Number(priorities.has(left.blockId)),
  );
  const blocks = priorities.size > 0 && !showAllBlocks
    ? sortedBlocks.filter((block) => priorities.has(block.blockId))
    : sortedBlocks;
  const hiddenBlockCount = sortedBlocks.length - blocks.length;
  useEffect(() => {
    if (!focusBlockId) return;
    window.requestAnimationFrame(() => {
      const target = document.getElementById(`rv-review-${focusBlockId}`);
      if (target instanceof HTMLDetailsElement) target.open = true;
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [focusBlockId, showAllBlocks]);
  // 概览里点了某一维 → 报告展开后滚到那一维的扣分明细。
  useEffect(() => {
    if (!focusDimension) return;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        document
          .getElementById(`rv-dimension-${focusDimension}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });
  }, [focusDimension]);
  const jumpToReviewBlock = (blockId: string) => {
    if (!blocks.some((block) => block.blockId === blockId)) setShowAllBlocks(true);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const target = document.getElementById(`rv-review-${blockId}`);
        if (target instanceof HTMLDetailsElement) target.open = true;
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });
  };
  return (
    <section className="rv-deep-report">
      <header>
        <div className="rv-deep-score">
          <strong>{Math.round(review.overallScore)}</strong>
          <span>/ 100</span>
        </div>
        <div>
          <span>ANSWER QUALITY REVIEW</span>
          <h2>整场回答评价</h2>
          <p>{review.summaryZh}</p>
        </div>
        <small>{review.model} · {review.generatedAt.slice(0, 10)}</small>
      </header>
      {review.dimensions && !ledger && (
        <section className="rv-score-source" aria-label="总分来源">
          <header>
            <h3>总分来源</h3>
            <p>
              五个维度各占 20%。这份是旧格式报告，只有整体理由、没有逐条扣分；
              重新生成后每一维都会列出扣在哪一题、扣了几分。
            </p>
          </header>
          <div>
            {(Object.keys(REVIEW_DIMENSION_META) as ReviewDimensionKey[]).map((key) => {
              const dimension = review.dimensions?.[key];
              return (
                <article key={key}>
                  <span>{REVIEW_DIMENSION_META[key].label}</span>
                  <strong>{Math.round(dimension?.score ?? 0)}</strong>
                  <i className="rv-dimension-track" aria-hidden="true">
                    <em
                      className={(dimension?.score ?? 0) >= 80 ? "high" : (dimension?.score ?? 0) >= 65 ? "mid" : "low"}
                      style={{ width: `${Math.round(dimension?.score ?? 0)}%` }}
                    />
                  </i>
                  <p>{dimension?.rationaleZh}</p>
                  {dimension && dimension.evidenceBlockIds.length > 0 && (
                    <small>
                      <span>依据：</span>
                      {dimension.evidenceBlockIds.map((blockId) => (
                        <button
                          key={blockId}
                          type="button"
                          onClick={() => jumpToReviewBlock(blockId)}
                        >{blockId}</button>
                      ))}
                    </small>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}

      {review.dimensions && ledger && (
        <section className="rv-ledger" aria-label="扣分明细">
          <header>
            <div>
              <h3>扣分明细</h3>
              <p>
                每一维都从 100 分开始。只有能指到具体问题、具体句子的失分才扣得动分——
                看不到扣分项，就说明这一维没有被扣。
              </p>
            </div>
            <div className="rv-ledger-total">
              <b>−{lostPoints}</b>
              <span>{flatDeductions.length} 项 · 五维合计</span>
            </div>
            <div className="rv-ledger-switch" role="group" aria-label="扣分排列方式">
              <button
                type="button"
                className={deductionView === "dimension" ? "on" : ""}
                onClick={() => setDeductionView("dimension")}
              >按维度</button>
              <button
                type="button"
                className={deductionView === "rank" ? "on" : ""}
                onClick={() => setDeductionView("rank")}
              >按扣分排序</button>
            </div>
          </header>

          {deductionView === "dimension" ? (
            <div className="rv-ledger-dimensions">
              {(Object.keys(REVIEW_DIMENSION_META) as ReviewDimensionKey[]).map((key) => {
                const dimension = review.dimensions?.[key];
                const score = Math.round(dimension?.score ?? 0);
                const deductions = dimension?.deductions ?? [];
                return (
                  <article key={key} id={`rv-dimension-${key}`}>
                    <header>
                      <h4>{REVIEW_DIMENSION_META[key].label}</h4>
                      <p className="rv-ledger-formula">
                        {/* 减分为零时不写「100 = 100」这种废式子，满分自己会说话 */}
                        {deductions.length > 0 && (
                          <>
                            <span>100</span>
                            {deductions.map((item, index) => (
                              <em key={`${item.blockId}-${index}`}>−{item.points}</em>
                            ))}
                            <i>=</i>
                          </>
                        )}
                        <strong>{score}</strong>
                      </p>
                    </header>
                    {deductions.length > 0 ? (
                      <ol className="rv-deduction-list">
                        {deductions.map((item, index) => (
                          <DeductionRow
                            key={`${item.blockId}-${index}`}
                            item={item}
                            onBlockClick={jumpToReviewBlock}
                            onEvidenceClick={onEvidenceClick}
                          />
                        ))}
                      </ol>
                    ) : (
                      <p className="rv-ledger-clean">这一维没有找到可举证的扣分点，保持满分。</p>
                    )}
                    {dimension?.rationaleZh && (
                      <p className="rv-ledger-rationale">{dimension.rationaleZh}</p>
                    )}
                  </article>
                );
              })}
            </div>
          ) : flatDeductions.length > 0 ? (
            <ol className="rv-deduction-list rv-deduction-rank">
              {flatDeductions.map((item, index) => (
                <DeductionRow
                  key={`${item.dimension}-${item.blockId}-${index}`}
                  item={item}
                  dimensionLabel={REVIEW_DIMENSION_META[item.dimension].label}
                  onBlockClick={jumpToReviewBlock}
                  onEvidenceClick={onEvidenceClick}
                />
              ))}
            </ol>
          ) : (
            <p className="rv-ledger-clean">整场没有找到可举证的扣分点。</p>
          )}
        </section>
      )}
      <div className="rv-deep-overview">
        <div>
          <h3>回答强项</h3>
          <ul>{review.strengths.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
        <div className="risk">
          <h3>优先改进</h3>
          <ul>{review.weaknesses.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      </div>
      <div className="rv-deep-list-head">
        <div>
          <strong>{showAllBlocks || priorities.size === 0 ? "全部问题" : "优先重练"}</strong>
          <span>{blocks.length} / {sortedBlocks.length}</span>
        </div>
        {priorities.size > 0 && (
          <button type="button" onClick={() => setShowAllBlocks((current) => !current)}>
            {showAllBlocks ? `只看重点 ${priorities.size}` : `显示其他 ${hiddenBlockCount} 项`}
          </button>
        )}
      </div>
      <div className="rv-deep-blocks">
        {blocks.map((block) => {
          const feedback = feedbackByBlock.get(block.blockId) ?? [];
          const agreed = feedback.some((entry) => entry.kind === "agree");
          const editor = feedbackEditor?.blockId === block.blockId ? feedbackEditor : null;
          return (
            <details
              id={`rv-review-${block.blockId}`}
              key={block.blockId}
              className={`rv-deep-block q-${block.quality} ${priorities.has(block.blockId) ? "priority" : ""}`}
            >
              <summary>
                <span>{block.blockId}</span>
                <strong>{block.questionTitle}</strong>
                <em className={`c-${block.comprehension}`}>{COMPREHENSION_LABELS[block.comprehension]}</em>
                <em>{QUALITY_LABELS[block.quality]}</em>
                {block.missedPoints.length > 0 && <b>漏答 {block.missedPoints.length}</b>}
                <i aria-hidden="true">⌄</i>
              </summary>
              <div className="rv-deep-block-body">
                <p className="rv-deep-intent"><span>面试官意图</span>{block.interviewerIntentZh}</p>
                <div className="rv-coverage">
                  <div><h4>问了什么</h4><ul>{block.askedPoints.map((item) => <li key={item}>{item}</li>)}</ul></div>
                  <div><h4>答到了</h4><ul>{block.answeredPoints.map((item) => <li key={item}>{item}</li>)}</ul></div>
                  <div className={block.missedPoints.length > 0 ? "missed" : ""}>
                    <h4>没答全</h4>
                    {block.missedPoints.length > 0
                      ? <ul>{block.missedPoints.map((item) => <li key={item}>{item}</li>)}</ul>
                      : <p>没有明显漏答</p>}
                  </div>
                </div>
                <div className="rv-deep-advice">
                  <div><h4>评价</h4><p>{block.evaluationZh}</p></div>
                  <div><h4>改进方向</h4><p>{block.improvementZh}</p></div>
                </div>
                {(block.strategyTags ?? []).length > 0 && (
                  <p className="rv-strategy-tags">
                    <span>策略标签</span>
                    {(block.strategyTags ?? []).map((tag) => (
                      <em key={tag}>{STRATEGY_TREND_META[tag].label}</em>
                    ))}
                  </p>
                )}
                {block.improvedAnswerJa && (
                  <div className="rv-improved-answer">
                    <header>
                      <span>改善回答 · AI 草稿</span>
                      <button
                        type="button"
                        disabled={queuedBlockIds.has(block.blockId) || practiceBusy === block.blockId}
                        onClick={() => onQueuePractice(block.blockId)}
                      >
                        {queuedBlockIds.has(block.blockId)
                          ? "已加入重练"
                          : practiceBusy === block.blockId
                            ? "加入中…"
                            : "加入重练"}
                      </button>
                    </header>
                    <p lang="ja">{block.improvedAnswerJa}</p>
                  </div>
                )}
                {block.evidenceSentenceIds.length > 0 && (
                  <p className="rv-evidence-ids">
                    <span>证据句：</span>
                    {block.evidenceSentenceIds.map((sentenceId) => (
                      <button
                        key={sentenceId}
                        type="button"
                        onClick={() => onEvidenceClick(sentenceId)}
                      >{sentenceId}</button>
                    ))}
                  </p>
                )}
                <section className="rv-ai-feedback" aria-label={`${block.blockId} AI 评价反馈`}>
                  <header>
                    <div>
                      <strong>你对这项 AI 评价</strong>
                      <span>反馈会在重新生成时作为约束读取</span>
                    </div>
                    <div>
                      <button
                        type="button"
                        className={agreed ? "selected" : ""}
                        disabled={agreed || feedbackBusy === block.blockId}
                        onClick={() => void onFeedback(block.blockId, "agree", "")}
                      >{agreed ? "已同意" : "同意"}</button>
                      <button
                        type="button"
                        disabled={feedbackBusy === block.blockId}
                        onClick={() => {
                          setFeedbackEditor({ blockId: block.blockId, kind: "disagree" });
                          setFeedbackDraft("");
                        }}
                      >不同意</button>
                      <button
                        type="button"
                        disabled={feedbackBusy === block.blockId}
                        onClick={() => {
                          setFeedbackEditor({ blockId: block.blockId, kind: "context" });
                          setFeedbackDraft("");
                        }}
                      >补充事实</button>
                    </div>
                  </header>
                  {feedback.length > 0 && (
                    <div className="rv-feedback-history">
                      {feedback.map((entry) => (
                        <p key={entry.id} className={`kind-${entry.kind}`}>
                          <em>{FEEDBACK_LABELS[entry.kind]}</em>
                          <span>{entry.text}</span>
                          <time>{entry.date}</time>
                        </p>
                      ))}
                    </div>
                  )}
                  {editor && (
                    <div className="rv-feedback-editor">
                      <textarea
                        autoFocus
                        rows={3}
                        value={feedbackDraft}
                        onChange={(event) => setFeedbackDraft(event.target.value)}
                        placeholder={editor.kind === "disagree"
                          ? "哪一处判断不准确？请写出理由或反例。"
                          : "补充 AI 不知道的背景、事实或当时的真实意图。"}
                      />
                      <div>
                        <button
                          type="button"
                          disabled={!feedbackDraft.trim() || feedbackBusy === block.blockId}
                          onClick={async () => {
                            const saved = await onFeedback(block.blockId, editor.kind, feedbackDraft.trim());
                            if (!saved) return;
                            setFeedbackEditor(null);
                            setFeedbackDraft("");
                          }}
                        >{feedbackBusy === block.blockId ? "保存中…" : `保存${FEEDBACK_LABELS[editor.kind]}`}</button>
                        <button
                          type="button"
                          className="quiet"
                          disabled={feedbackBusy === block.blockId}
                          onClick={() => {
                            setFeedbackEditor(null);
                            setFeedbackDraft("");
                          }}
                        >取消</button>
                      </div>
                    </div>
                  )}
                </section>
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}

function ReviewIndex({
  docs,
  onSelect,
}: {
  docs: ReviewDoc[];
  onSelect: (key: string, reviewBlockId?: string) => void;
}) {
  const [selectedTrend, setSelectedTrend] = useState<AnswerStrategyTag | null>(null);
  const aggregate = useMemo(() => {
    const patterns = new Map<string, number>();
    for (const doc of docs) {
      for (const [slug, bucket] of doc.stats.patterns) {
        patterns.set(slug, (patterns.get(slug) ?? 0) + bucket.learner + bucket.uncertain);
      }
    }
    return [...patterns.entries()].sort((left, right) => right[1] - left[1]).slice(0, 8);
  }, [docs]);
  const answerTrends = useMemo(() => {
    const reviewedDocs = docs.filter((doc) => doc.deepReview);
    const byTag = new Map<AnswerStrategyTag, {
      interviewKeys: Set<string>;
      occurrences: number;
      questions: {
        docKey: string;
        company: string;
        date: string;
        round: string;
        blockId: string;
        title: string;
        evaluation: string;
        missedCount: number;
      }[];
    }>();
    for (const doc of reviewedDocs) {
      for (const block of doc.deepReview?.blocks ?? []) {
        for (const tag of new Set(block.strategyTags ?? [])) {
          const item = byTag.get(tag) ?? {
            interviewKeys: new Set<string>(),
            occurrences: 0,
            questions: [],
          };
          item.interviewKeys.add(doc.key);
          item.occurrences += 1;
          item.questions.push({
            docKey: doc.key,
            company: doc.company,
            date: doc.date,
            round: doc.round,
            blockId: block.blockId,
            title: block.questionTitle,
            evaluation: block.evaluationZh,
            missedCount: block.missedPoints.length,
          });
          byTag.set(tag, item);
        }
      }
    }
    const repeated = [...byTag.entries()]
      .filter(([, item]) => item.interviewKeys.size >= 2)
      .sort((left, right) =>
        right[1].interviewKeys.size - left[1].interviewKeys.size ||
        right[1].occurrences - left[1].occurrences,
      );
    for (const [, item] of repeated) {
      item.questions.sort((left, right) =>
        right.date.localeCompare(left.date) || left.company.localeCompare(right.company),
      );
    }
    return { reviewedCount: reviewedDocs.length, repeated };
  }, [docs]);

  const selectedTrendItem = selectedTrend
    ? answerTrends.repeated.find(([tag]) => tag === selectedTrend)?.[1]
    : undefined;

  if (selectedTrend && selectedTrendItem) {
    return (
      <div className="review-view rv-trend-detail-page">
        <header className="rv-trend-detail-hero">
          <button type="button" onClick={() => setSelectedTrend(null)}>← 回答趋势</button>
          <div>
            <span>CROSS-INTERVIEW DETAIL</span>
            <h1>{STRATEGY_TREND_META[selectedTrend].label}</h1>
            <p>{STRATEGY_TREND_META[selectedTrend].description}</p>
          </div>
          <dl>
            <div><dt>反复出现</dt><dd>{selectedTrendItem.interviewKeys.size} / {answerTrends.reviewedCount} 场</dd></div>
            <div><dt>命中问题</dt><dd>{selectedTrendItem.occurrences} 个</dd></div>
          </dl>
        </header>
        <section className="rv-trend-question-list">
          <header>
            <div>
              <span>全部证据问题</span>
              <h2>从具体回答开始复习</h2>
            </div>
            <p>点击任一问题，会直接打开对应面试的深度复盘，并展开该问题。</p>
          </header>
          <div>
            {selectedTrendItem.questions.map((question) => (
              <button
                key={`${question.docKey}-${question.blockId}`}
                type="button"
                onClick={() => onSelect(question.docKey, question.blockId)}
              >
                <span className="rv-trend-question-id">{question.blockId}</span>
                <span className="rv-trend-question-copy">
                  <small>{question.company} · {question.round} · {question.date}</small>
                  <strong>{question.title}</strong>
                  <p>{question.evaluation}</p>
                </span>
                <span className="rv-trend-question-meta">
                  {question.missedCount > 0 && <em>漏答 {question.missedCount}</em>}
                  <i aria-hidden="true">→</i>
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="review-view">
      {aggregate.length > 0 && (
        <section className="rv-agg" aria-label="跨面试错误型摘要">
          <span>跨面试错误型 TOP</span>
          {aggregate.map(([slug, count]) => (
            <div key={slug}><em>{slug}</em><b>{count}</b></div>
          ))}
        </section>
      )}

      {docs.length > 0 && (
        <section className="rv-answer-trends">
          <header>
            <div>
              <span>CROSS-INTERVIEW PATTERNS</span>
              <h2>跨面试回答趋势</h2>
            </div>
            <p>只把出现在至少两场面试中的策略问题列为趋势，避免把一场里的偶发失误当成习惯。</p>
          </header>
          {answerTrends.reviewedCount < 2 ? (
            <p className="rv-trend-empty">
              已有 {answerTrends.reviewedCount} 场深度复盘；至少完成 2 场后开始判断重复模式。
            </p>
          ) : answerTrends.repeated.length === 0 ? (
            <p className="rv-trend-empty">目前没有跨两场重复出现的回答策略问题。</p>
          ) : (
            <div className="rv-trend-grid">
              {answerTrends.repeated.map(([tag, item]) => (
                <button key={tag} type="button" onClick={() => setSelectedTrend(tag)}>
                  <span className="rv-trend-mark" aria-hidden="true" />
                  <span className="rv-trend-copy">
                    <span>
                      <strong>{STRATEGY_TREND_META[tag].label}</strong>
                      <small>{item.interviewKeys.size} / {answerTrends.reviewedCount} 场</small>
                    </span>
                    <em>{STRATEGY_TREND_META[tag].description}</em>
                  </span>
                  <span className="rv-trend-count">{item.occurrences}题 <i aria-hidden="true">→</i></span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {docs.length === 0 ? (
        <div className="rv-empty">
          <h2>还没有整理稿</h2>
          <p>
            把面接逐字稿交给 Claude 按 <code>_整理稿スペック</code> 生成
            <code>YYYY-MM-DD_〈回〉_整理稿.md</code> 后，这里会自动出现。
          </p>
        </div>
      ) : (
        <div className="rv-cards">
          {docs.map((doc) => {
            const open = doc.annotations.filter((item) => item.status === "open").length;
            const unresolvedTasks = doc.decisionTasks.filter((item) => !item.resolvedBy);
            const unresolvedSentences = new Set(unresolvedTasks.map((item) => item.sentenceId)).size;
            const completedTasks = doc.decisionTasks.length - unresolvedTasks.length;
            const completion = doc.decisionTasks.length
              ? Math.round((completedTasks / doc.decisionTasks.length) * 100)
              : 100;
            const score = doc.deepReview ? Math.round(doc.deepReview.overallScore) : null;
            const scoreBand = score === null ? "none" : score >= 80 ? "high" : score >= 65 ? "mid" : "low";
            return (
              <button key={doc.key} className="rv-card" onClick={() => onSelect(doc.key)}>
                <header>
                  <div>
                    <span className="rv-card-date">{doc.date}</span>
                    <h3>{doc.company}</h3>
                  </div>
                  <span className={`rv-card-score ${scoreBand}`}>
                    {score === null ? <b>—</b> : <b>{score}</b>}
                    <small>{score === null ? "未复盘" : "回答分"}</small>
                  </span>
                </header>
                <div className="rv-card-meta">
                  <span>{doc.round}</span>
                  {doc.result && <span className={`rv-result ${doc.result === "不採用" ? "bad" : ""}`}>{doc.result}</span>}
                </div>
                <p className="rv-card-insight">
                  {doc.deepReview?.weaknesses[0] ?? (unresolvedTasks.length > 0
                    ? `还有 ${unresolvedTasks.length} 个证据裁定点，完成后才能生成深度复盘。`
                    : "证据裁定已完成，可以生成回答质量复盘。")}
                </p>
                <div className="rv-card-progress">
                  <span><i style={{ width: `${completion}%` }} /></span>
                  <small>裁定 {completedTasks} / {doc.decisionTasks.length}</small>
                </div>
                <dl>
                  <div><dt>文</dt><dd>{doc.stats.sentenceTotal}</dd></div>
                  <div><dt>我的错误</dt><dd className="warn">{doc.stats.learnerErrors}</dd></div>
                  <div><dt>待裁定</dt><dd className="pending">{unresolvedSentences}句 · {unresolvedTasks.length}点</dd></div>
                  <div><dt>批注</dt><dd>{open > 0 ? `${open} open` : doc.annotations.length}</dd></div>
                </dl>
                <span className="rv-card-open">打开复盘 <i aria-hidden="true">→</i></span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SentenceCard({
  doc,
  sentence,
  mode,
  revealed,
  errored,
  rawShown,
  noting,
  noteDraft,
  busy,
  evidenceFocused,
  onReveal,
  onToggleErrors,
  onToggleRaw,
  onStartNote,
  onCancelNote,
  onDraft,
  onSubmit,
}: {
  doc: ReviewDoc;
  sentence: ReviewSentence;
  mode: Mode;
  revealed: boolean;
  errored: boolean;
  rawShown: boolean;
  noting: boolean;
  noteDraft: string;
  busy: boolean;
  evidenceFocused: boolean;
  onReveal: () => void;
  onToggleErrors: () => void;
  onToggleRaw: () => void;
  onStartNote: () => void;
  onCancelNote: () => void;
  onDraft: (value: string) => void;
  onSubmit: (
    kind: "批注" | "裁定" | "聴解",
    text: string,
    decisionTarget?: string,
  ) => void;
}) {
  const segments = segmentSei(sentence);
  const detailShown = mode === "compare" || revealed;
  const mark = doc.listeningMarks.get(sentence.id);
  const annotations = doc.bySentence.get(sentence.id) ?? [];
  const learnerCount = sentence.errors.filter((error) => error.kind === "学習者").length;
  const sentenceDecisionTasks = doc.decisionTasks.filter((task) => task.sentenceId === sentence.id);
  const pendingCount = sentenceDecisionTasks.filter((task) => !task.resolvedBy).length;
  const resolvedCount = sentenceDecisionTasks.length - pendingCount;
  const genText = sentence.gen ?? plainSei(sentence);

  return (
    <article
      id={`rvs-${sentence.id}`}
      className={[
        "rv-b",
        sentence.speaker === "私" ? "mine" : "theirs",
        sentence.uncertainSpeaker ? "uncertain" : "",
        busy ? "busy" : "",
        evidenceFocused ? "evidence-focus" : "",
      ].join(" ")}
    >
      <header>
        <span className="rv-speaker">{sentence.speaker}{sentence.uncertainSpeaker ? "?" : ""}</span>
        <span className="rv-sid">{sentence.id}</span>
        {mark && <span className={`rv-mark ${mark === "×" ? "hard" : "soft"}`}>{mark}</span>}
        {learnerCount > 0 && <span className="rv-cnt err">誤 {learnerCount}</span>}
        {pendingCount > 0 && <span className="rv-cnt pending">疑 {pendingCount}</span>}
        {resolvedCount > 0 && <span className="rv-cnt resolved">済 {resolvedCount}</span>}
        <span className="rv-tools">
          <button className={rawShown ? "active" : ""} onClick={onToggleRaw}>原文</button>
          {(sentence.errors.length > 0 || sentence.uncertainSpeaker) && (
            <button className={errored ? "active" : ""} onClick={onToggleErrors}>
              指摘 {sentence.errors.length + (sentence.uncertainSpeaker ? 1 : 0)}
            </button>
          )}
          {sentence.speaker === "面" && (
            <span className="rv-listen">
              <button
                className={mark === "△" ? "active soft" : ""}
                disabled={busy}
                title="当时半懂半猜"
                onClick={() => onSubmit("聴解", "△推測で理解")}
              >△</button>
              <button
                className={mark === "×" ? "active hard" : ""}
                disabled={busy}
                title="当时没听懂"
                onClick={() => onSubmit("聴解", "×聞き取れず")}
              >×</button>
            </span>
          )}
          <button onClick={noting ? onCancelNote : onStartNote}>批注{annotations.length > 0 ? ` ${annotations.length}` : ""}</button>
        </span>
      </header>

      <p
        className={`rv-text ${mode === "study" && !revealed ? "tappable" : ""}`}
        lang="ja"
        onClick={mode === "study" ? onReveal : undefined}
        title={mode === "study" && !revealed ? "点击显示译文和注释" : undefined}
      >
        {segments.map((segment, index) =>
          segment.error ? (
            <button
              key={index}
              className={`rv-err ${segment.error.kind === "学習者" ? "learner" : segment.error.kind === "疑" ? "doubt" : "trans"}`}
              onClick={(event) => {
                event.stopPropagation();
                onToggleErrors();
              }}
            >{segment.text}</button>
          ) : (
            <span key={index}>{segment.text}</span>
          ),
        )}
      </p>

      {detailShown && (
        <div className="rv-detail">
          {sentence.yaku && <p className="rv-yaku" lang="zh-CN">{sentence.yaku}</p>}
          {sentence.go.map((item, index) => (
            <p key={index} className="rv-go" lang="ja">語 <span>{item}</span></p>
          ))}
          {sentence.notes.map((item, index) => (
            <p key={index} className="rv-note-line">注 <span>{item}</span></p>
          ))}
        </div>
      )}

      {errored && (sentence.errors.length > 0 || sentence.uncertainSpeaker) && (
        <div className="rv-errors">
          {sentence.errors.map((error) => (
            <div key={error.index} className="rv-error-item">
              <span className={`rv-kind ${error.kind === "学習者" ? "learner" : error.kind === "疑" ? "doubt" : "trans"}`}>
                {error.kind}
              </span>
              <div>
                <p>
                  {error.span && <b lang="ja">«{error.span}»</b>}
                  {error.correction && <> → <em lang="ja">{error.correction}</em></>}
                  {error.pattern && <i className="rv-pattern">{error.pattern}</i>}
                </p>
                <small>{error.raw}</small>
                {error.kind === "疑" && (() => {
                  const task = sentenceDecisionTasks.find(
                    (candidate) => candidate.target === `error:${error.index}`,
                  );
                  return (
                  <div className="rv-judge">
                    <span>裁定：</span>
                    {task?.resolvedBy ? (
                      <em className={`rv-resolved r-${task.resolution ?? "unknown"}`}>
                        {DECISION_LABELS[task.resolution ?? "unknown"]} · {task.resolvedBy}
                      </em>
                    ) : (
                      <>
                        <button
                          disabled={busy}
                          onClick={() =>
                            onSubmit(
                              "裁定",
                              `${error.span ? `«${error.span}»` : `誤${error.index}`}は転写誤りで確定（実際は${error.correction ? `「${error.correction}」` : "正しい形"}と発話した）`,
                              `error:${error.index}`,
                            )
                          }
                        >是转录错</button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            onSubmit(
                              "裁定",
                              `${error.span ? `«${error.span}»` : `誤${error.index}`}は学習者誤りで確定（実際にそう発話した）`,
                              `error:${error.index}`,
                            )
                          }
                        >我真说错了</button>
                      </>
                    )}
                  </div>
                  );
                })()}
              </div>
            </div>
          ))}
          {sentence.uncertainSpeaker && (
            <div className="rv-error-item">
              <span className="rv-kind doubt">話者疑</span>
              <div>
                <p>这句话是谁说的？</p>
                <div className="rv-judge">
                  <span>裁定：</span>
                  {sentenceDecisionTasks.find((task) => task.target === "speaker")?.resolvedBy ? (
                    <em className="rv-resolved">
                      {DECISION_LABELS[
                        sentenceDecisionTasks.find((task) => task.target === "speaker")?.resolution ?? "unknown"
                      ]} · {sentenceDecisionTasks.find((task) => task.target === "speaker")?.resolvedBy}
                    </em>
                  ) : (
                    <>
                      <button disabled={busy} onClick={() => onSubmit("裁定", "話者裁定：この文は面接官の発言", "speaker")}>面接官</button>
                      <button disabled={busy} onClick={() => onSubmit("裁定", "話者裁定：この文は自分の発言", "speaker")}>我自己</button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {rawShown && (
        <p className="rv-raw" lang="ja">
          <span>原</span>
          {genText}
        </p>
      )}

      {annotations.length > 0 && (
        <div className="rv-annotations">
          {annotations.map((annotation) => (
            <div key={annotation.id} className="rv-annotation">
              <header>
                <span className="rv-aid">{annotation.id}</span>
                <span className={`rv-akind k-${annotation.kind}`}>{annotation.kind}</span>
                <span className={`rv-astatus s-${annotation.status}`}>{annotation.status}</span>
                <time>{annotation.date}</time>
              </header>
              <p>{annotation.mine}</p>
              {annotation.ai && <p className="rv-ai">AI：{annotation.ai}</p>}
            </div>
          ))}
        </div>
      )}

      {noting && (
        <div className="rv-note-editor">
          <textarea
            value={noteDraft}
            autoFocus
            rows={3}
            placeholder="写给 AI 的批注：这句怎么说更好？为什么？（会追记到批注笔记，AI 统一回答）"
            onChange={(event) => onDraft(event.target.value)}
          />
          <div>
            <button
              disabled={busy || !noteDraft.trim()}
              onClick={() => onSubmit("批注", noteDraft.trim())}
            >{busy ? "写入中…" : "送信"}</button>
            <button className="quiet" onClick={onCancelNote}>取消</button>
          </div>
        </div>
      )}
    </article>
  );
}
