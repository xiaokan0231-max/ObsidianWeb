"use client";

import { INTERVIEW_MENU_COPY, REVIEW_COPY_JA, useInterviewMenu } from "./interview-menu-copy";

import { menuLabel } from "@/lib/ui-menu-labels";
import { useUiLocale } from "./ui-locale";

import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { ClientApiError, postJson } from "@/lib/client-api";
import ScopeLoading from "./scope-loading";
import { isTypingTarget } from "@/lib/keyboard";
import { annotationCountLabel, INTERVIEW_LIST_BACK_LABEL } from "@/lib/ui-labels";
import { enumCodec, useUrlState, type UrlStateCodec } from "./use-url-state";
import {
  computeStats,
  latestListeningMarks,
  patternSlug,
  plainSei,
  segmentSei,
  type ParsedSeirikou,
  type ReviewAnnotation,
  type ReviewDecisionTask,
  type ReviewSentence,
  type ReviewStats,
} from "@/lib/review";
import { findDayNote, findRoundNote, joinReviewNotes } from "@/lib/review-join";
import { reviewSiblingPath } from "@/lib/review-paths";
import { getString, type Note } from "@/lib/notes";
import InterviewNovelReader from "./interview-novel-reader";
import InterviewAdvisory from "./interview-advisory";
import type { AdvisoryEvidenceRef } from "@/lib/interview-advisory";
import {
  allDeductions,
  DEDUCTION_SEVERITY_META,
  hasDeductionLedger,
  parseInterviewAnswerReview,
  REVIEW_DIMENSION_META,
  renderEvidenceEvaluation,
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
// タグのラベルも「何場で癖とみなすか」の判定も、vault の 面接傾向_横断 を生成する側と
// 同じものを使う。二重に持つと Web の表示と generated ノートが黙って割れる
import { STRATEGY_TREND_META, isRepeatedAcrossInterviews, interviewEvidenceScores } from "@/lib/interview-trends.mjs";
import {
  groupReviewsByCompany,
  historicalDimensionAverages,
  reviewScoreBand,
  reviewDisplayScore,
  reviewScoreTimeline,
  type DimensionAverages,
  type ReviewScorePoint,
  type ReviewVisualEntry,
} from "@/lib/review-visual";
import MarkdownDocument from "./markdown-document";
import { CountUp } from "./count-up";
import { InterviewReassessmentEntry, assessmentIssueCopy, findInterviewReassessment } from "./interview-reassessment-entry";
import { RadarChart, type RadarSeries } from "./radar-chart";
import ReviewCompanyAnalysis from "./review-company-analysis";
import { JapanSignalsPanel, SignalOutcomeTable, signalOutcomeComparison, signalsCopy } from "./interview-japan-signals";
import { resolveInterviewOutcomes, type SignalOutcomeComparison } from "@/lib/interview-outcome";
import { selectionNoticesForSession } from "@/lib/selection-notice";
import SelectionNoticePanel from "./selection-notice";

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
  /** 句卡ごとに decisionTasks を filter し直さない：一場 200 句なら 200 回の全走査が毎描画に乗る。 */
  decisionTasksBySentence: Map<string, ReviewDecisionTask[]>;
  deepReview?: InterviewAnswerReview;
  practiceBlockIds: Set<string>;
  feedbackByBlock: Map<string, ReviewFeedbackEntry[]>;
};

/**
 * 写入失败的一条提示。`subject` 必须自带主语（哪场面接、哪句/哪个 block），
 * 因为这条提示不出现在触发它的按钮旁边，靠位置认不出说的是谁。
 */
/** info 是成功・找不到证据这类通知：同一固定层显示，几秒后自己消失；error 要人手动关。 */
type WriteAlert = { subject: string; detail: string; tone?: "error" | "info" };

const NOTICE_MS = 4200;

type Mode = "study" | "compare" | "novel";
type NovelLanguage = "ja" | "zh";
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

// 详情页的筛选放进 URL（review= 由外壳管）：打开原笔记再回来、或刷新后，仍停在刚才筛的那一类句子上。
const FILTER_CODEC = enumCodec<Filter>([
  "all", "pending", "transcript", "learner-decision", "speaker-decision", "noted", "open", "err", "go",
]);
const PATTERN_CODEC: UrlStateCodec<string | null> = {
  parse: (raw) => raw || null,
  serialize: (value) => value ?? "",
};

// 回到一覧后，等一覧的卡片重新铺满再定位（太早滚，页面还不够高就被夹到底部附近）。
// 不用 rAF：面板在后台时 rAF 会停住，滚动就丢了。
function restoreWindowScroll(top: number) {
  const jump = () => window.scrollTo({ top, behavior: "instant" });
  jump();
  window.setTimeout(jump, 0);
  window.setTimeout(jump, 150);
}

// 阅读模式跟侧栏折叠态一个做法：存 localStorage、useSyncExternalStore 读，
// 避免「effect 里 setState」的水合抖动。
const MODE_KEY = "review:mode";
const MODE_EVENT = "review:modechange";
const NOVEL_LANG_KEY = "review:novel-language";

function subscribeMode(onChange: () => void) {
  window.addEventListener(MODE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(MODE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readMode(): Mode {
  const value = window.localStorage.getItem(MODE_KEY);
  return value === "compare" || value === "novel" ? value : "study";
}

function readNovelLanguage(): NovelLanguage {
  if (typeof window === "undefined") return "ja";
  return window.localStorage.getItem(NOVEL_LANG_KEY) === "zh" ? "zh" : "ja";
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

// 这一轮新加的界面文案。共用的菜单词表（lib/ui-menu-labels）照旧兜底，这里只放本页独有的。


function useReviewCopy() {
  const { locale } = useUiLocale();
  return useCallback(
    (label: string) => (locale === "ja" ? REVIEW_COPY_JA[label] ?? INTERVIEW_MENU_COPY[label] ?? menuLabel(label, locale) : label),
    [locale],
  );
}

function toggleSet(current: Set<string>, key: string) {
  const next = new Set(current);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

function buildDocs(notes: Note[]): ReviewDoc[] {
  // 整理稿を軸に同じ回のノートを束ねる規則は lib/review-join.ts が持つ。
  // ここは詳細画面だけが要る派生値（統計・練習キュー・フィードバック）を足すだけ。
  return joinReviewNotes(notes)
    .map((joined) => {
      const { note, company, date, round, annotationNote, parsed, annotations } = joined;
      const resultNote = findDayNote(notes, "review", joined);
      const practiceNote = findRoundNote(notes, "interview-answer-practice", joined);
      const feedbackNote = findRoundNote(notes, "interview-answer-feedback", joined);
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
      const decisionTasksBySentence = new Map<string, ReviewDecisionTask[]>();
      for (const task of joined.decisionTasks) {
        const list = decisionTasksBySentence.get(task.sentenceId) ?? [];
        list.push(task);
        decisionTasksBySentence.set(task.sentenceId, list);
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
        annotationPath: annotationNote?.path ?? reviewSiblingPath(note.path, "annotation"),
        annotationExists: Boolean(annotationNote),
        annotations,
        bySentence,
        listeningMarks: latestListeningMarks(annotations),
        decisionTasks: joined.decisionTasks,
        decisionTasksBySentence,
        deepReview: joined.deepReviewNote
          ? parseInterviewAnswerReview(joined.deepReviewNote.content) ?? undefined
          : undefined,
        practiceBlockIds: new Set(
          practiceNote
            ? parseInterviewPractice(practiceNote.content).map((entry) => entry.blockId)
            : [],
        ),
        feedbackByBlock,
      };
    });
  // 並び順（日付の新しい順）は joinReviewNotes が決める。ここで並べ直すと、
  // 一覧とプレビューで順序が割れても誰も気づかない。
}

type WriteResponse = { ok?: boolean; error?: string; note?: Note };

/**
 * 書き込み系 API への POST を一本化する。四つの呼び出し口が
 *「fetch → json → !ok なら投げる」をそれぞれ書いていて、`response.status` を
 * 混ぜ忘れた版が一つでも紛れると、その経路だけ失敗理由が画面から消える。
 *
 * ここが持つのは投げるところまで。busy の解除・警告の表示・再取得は
 * 呼び出し口ごとに順序も対象も違うので、あえて引き取らない。
 */
async function postReviewWrite<T extends WriteResponse = WriteResponse>(
  url: string,
  body: unknown,
  failureLabel: string,
): Promise<T> {
  try {
    // 復盤の生成は長い（Codex 経由）。共通の postJson に載せ、上限だけこちらで広げる。
    return await postJson<T>(url, body, { timeoutMs: 600_000 });
  } catch (error) {
    if (error instanceof ClientApiError) throw new Error(error.message || `${failureLabel}（${error.status}）`);
    throw error;
  }
}

/** 旧导读只供历史核对，默认收起，避免与上方新版诊断混成同一份评价。 */
export function ReviewIntroduction({ review, hidden = false }: { review: InterviewAnswerReview; hidden?: boolean }) {
  const menu = useInterviewMenu();
  const historical = review.evaluationMode !== "evidence" && String(review.evaluationMode) !== "scored_evidence";
  const paragraphs = review.overviewZh?.split(/\n\s*\n/).filter(Boolean)
    .map((paragraph, index) => <p key={index}>{paragraph}</p>);
  return <section className="rv-review-introduction" aria-label={historical ? menu("旧版综合导读（历史）") : menu("综合导读")} hidden={hidden}>
    <h2>{historical ? menu("旧版综合导读（历史）") : menu("综合导读")}</h2>
    {historical ? <>
      <p>{menu("这是原有报告的历史内容，保留原文供核对，不作为上方新版证据评价。")}</p>
      <details><summary>{menu("展开旧版导读")}</summary>{paragraphs}</details>
    </> : paragraphs}
  </section>;
}

function InterviewReview({
  notes,
  onVaultChanged,
  onNoteWritten,
  initialSelectedKey = null,
  initialPanel = "source",
  initialBlockId = null,
  initialSentenceId = null,
  onOpenEvidence,
  onOpenInsights,
  onSelectionChange,
  onOpenNote,
  onOpenSession,
  loading = false,
}: {
  notes: Note[];
  /** 标题行「原笔记 ↗」：外壳打开整理稿抽屉。不传就不出按钮（旧调用处行为不变）。 */
  onOpenNote?: (note: Note) => void;
  /** 标题行「准备稿 ↗」：外壳跳到这一场的本场面试页。不传就不出按钮。 */
  onOpenSession?: (target: { company: string; date: string; round: string; notePath: string }) => void;
  /** この視図の scope がまだ届いていない：「还没有整理稿」ではなく読取中を出す。 */
  loading?: boolean;
  onVaultChanged: () => void | Promise<void>;
  /** 追記系の書込は応答の note を1件差し替えるだけでよい。復盤の再生成だけ全量再取得に残す。 */
  onNoteWritten?: (note: Note) => void;
  initialSelectedKey?: string | null;
  initialPanel?: "advisory" | "quality" | "source";
  initialBlockId?: string | null;
  initialSentenceId?: string | null;
  onOpenEvidence: (ref: AdvisoryEvidenceRef) => void;
  onOpenInsights: () => void;
  onSelectionChange?: (key: string | null) => void;
}) {
  const menu = useInterviewMenu();
  const t = useReviewCopy();
  const docs = useMemo(() => buildDocs(notes), [notes]);
  // 雷达的「历史平均」描边：与 vault 的 面接傾向_横断 同一套平均算法，只是去掉了本场。
  const trendEntries = useMemo(
    () => docs.map((item) => ({ key: item.key, company: item.company, date: item.date, round: item.round, review: item.deepReview, reassessment: findInterviewReassessment(notes, item.note.path) })),
    [docs, notes],
  );
  // 选考结果按整理稿路径解析（job-case → 面谈 TODO），详情页的信号区块与一覧的对照表共用。
  const outcomes = useMemo(() => resolveInterviewOutcomes(notes), [notes]);
  const signalOutcome = useMemo(() => signalOutcomeComparison(docs.map((item) => ({
    key: item.key, company: item.company, date: item.date, round: item.round, review: item.deepReview,
  })), outcomes), [docs, outcomes]);
  const { locale } = useUiLocale();
  const signalsT = useMemo(() => signalsCopy(locale), [locale]);

  const [selectedKey, setSelectedKey] = useState<string | null>(initialSelectedKey);
  const [panel, setPanel] = useState<"advisory" | "quality" | "source">(initialPanel);
  const [assessmentOpen, setAssessmentOpen] = useState(initialPanel === "quality");
  const savedMode = useSyncExternalStore(subscribeMode, readMode, () => "study" as Mode);
  const [modeOverride, setModeOverride] = useState<"compare" | null>(initialPanel === "source" && initialBlockId ? "compare" : null);
  const mode = modeOverride ?? savedMode;
  const novelLang = useSyncExternalStore(subscribeMode, readNovelLanguage, () => "ja" as NovelLanguage);
  const previousMode = useRef<"study" | "compare">("study");
  const [filter, setFilter] = useUrlState<Filter>("filter", "all", FILTER_CODEC);
  const [patternParam, setPatternFilter] = useUrlState<string | null>("pattern", null, PATTERN_CODEC);
  // 打开详情时一覧滚到了哪里。返回时回到原处，不必从头再找下一场；未知时（刷新后直接进详情）回顶部。
  const listScrollTop = useRef<number | null>(null);
  // 证据链接带着 block／sentence 进来时，先把那一块展开、那一句揭开。
  const [openBlocks, setOpenBlocks] = useState<Set<string>>(new Set(initialBlockId ? [initialBlockId] : []));
  const [revealed, setRevealed] = useState<Set<string>>(new Set(initialSentenceId ? [initialSentenceId] : []));
  const [errOpen, setErrOpen] = useState<Set<string>>(new Set());
  const [rawOpen, setRawOpen] = useState<Set<string>>(new Set());
  /**
   * 「正在批注哪一句」只记一个 `场次 key + 句子 ID` 的组合键，草稿正文在 SentenceCard 自己的 state 里。
   * 草稿放在这一层时，每敲一个字整页几百张句卡都要重渲染，长场次里输入会明显跟不上。
   *
   * 句子 ID 形如 s1/s2/s5，每场整理稿都从 s1 重新编号，**跨场必然重号**——所以键里带场次，
   * 句卡的 React key 也带场次：换场时旧句卡整张卸载，草稿跟着消失，不会顶着 A 场的草稿打开 B 场的同号句。
   */
  const [notingKey, setNotingKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [deepBusy, setDeepBusy] = useState(false);
  const [practiceBusy, setPracticeBusy] = useState<string | null>(null);
  const [feedbackBusy, setFeedbackBusy] = useState<string | null>(null);
  const [deepOpen, setDeepOpen] = useState(initialPanel === "quality");
  const [deepFocusBlockId, setDeepFocusBlockId] = useState<string | null>(null);
  const [deepFocusDimension, setDeepFocusDimension] = useState<ReviewDimensionKey | null>(null);
  const [evidenceFocus, setEvidenceFocus] = useState<string | null>(initialSentenceId);
  /**
   * 🔴 写入结果**不走**正文流里的提示位。以前有一个 `message`，只渲染在「原文」面板里，
   * 而触发它的「加入重练」「同意」在「回答质量」面板 —— 按的时候那个面板是 hidden 的，
   * 成功提示永远看不到；找不到证据句时也只写了 message，点了等于没反应。
   * 失败更是如此：句卡在提示位下面几千 px，「重新生成」隔着整份报告面板（约 2,400px）。
   *
   * 所以失败和通知一律积到 `writeAlerts`，只由固定层 `.rv-write-alerts` 一处渲染：
   * 不依赖任何子树保持挂载、不依赖滚动位置、不依赖当前是详情页还是一覧页。
   * 同样的理由和同样的形状见 jobs-view 的 `statusErrors`
   *（那边把提示放在控件旁边试过两次，两次都在实际使用中看不见）。
   */
  const [writeAlerts, setWriteAlerts] = useState<Record<string, WriteAlert>>({});
  const inFlightAnnotations = useRef(new Set<string>());

  const sourceScrollTop = useRef(0);
  const panelScrollTops = useRef<Record<string, number>>({});

  const switchMode = (next: Mode) => {
    setModeOverride(null);
    if (next === "novel" && mode !== "novel") {
      previousMode.current = mode;
      sourceScrollTop.current = window.scrollY;
    }
    if (mode === "novel" && next !== "novel") {
      window.requestAnimationFrame(() => restoreWindowScroll(sourceScrollTop.current));
    }
    window.localStorage.setItem(MODE_KEY, next);
    window.dispatchEvent(new Event(MODE_EVENT));
  };

  const switchNovelLang = (next: NovelLanguage) => {
    window.localStorage.setItem(NOVEL_LANG_KEY, next);
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
   * 草稿本体随句卡卸载已经清掉了（key 带场次），这里收的是「哪张卡开着编辑器」：
   * 留着它，回到 A 场时那张卡会自己弹开一个空编辑器。
   * 两组语义不同，但要求一样：换场的入口两个都得调。
   */
  const resetAnnotationDraft = () => setNotingKey(null);

  // 回一覧的入口有好几个（顶栏按钮・连读模式的返回），滚动恢复与筛选清理集中在这里。
  // 筛选只对详情有意义；留在 URL 上会让一覧页的链接带着看不见的条件。
  const backToList = () => {
    setSelectedKey(null);
    onSelectionChange?.(null);
    setFilter("all");
    setPatternFilter(null);
    focusDeepReview(null);
    resetAnnotationDraft();
    restoreWindowScroll(listScrollTop.current ?? 0);
  };

  const doc = docs.find((item) => item.key === selectedKey) ?? null;
  const docKey = doc?.key;

  /*
   * 分数揭晓（维度条生长、分数滚动）只在每场第一次进入「回答质量」时播一次。
   * 面板靠 hidden 切换，display 从 none 恢复会让 CSS 动画重播，所以动画类只在这一秒里挂着；
   * round 让数字组件重挂一次——它在面板还隐藏时就挂载了，那次滚动没人看得见。
   */
  const [qualityReveal, setQualityReveal] = useState<{ docKey: string | null; round: number; active: boolean }>(
    { docKey: null, round: 0, active: false },
  );
  if (panel === "quality" && docKey && qualityReveal.docKey !== docKey) {
    setQualityReveal((current) => ({ docKey, round: current.round + 1, active: true }));
  }
  useEffect(() => {
    if (!qualityReveal.active) return;
    const timer = window.setTimeout(() => setQualityReveal((current) => ({ ...current, active: false })), 1000);
    return () => window.clearTimeout(timer);
  }, [qualityReveal.active, qualityReveal.round]);

  const historyAverages = useMemo(
    () => (selectedKey ? historicalDimensionAverages(trendEntries, selectedKey) : null),
    [trendEntries, selectedKey],
  );

  // 只带 block 的深链（趋势页、顾问证据）落地时闪一下那一问，1.5 秒后撤掉，免得一直像被选中。
  const [landingBlockId, setLandingBlockId] = useState<string | null>(initialSentenceId ? null : initialBlockId);
  useEffect(() => {
    if (!landingBlockId) return;
    const timer = window.setTimeout(() => setLandingBlockId(null), 1500);
    return () => window.clearTimeout(timer);
  }, [landingBlockId]);

  useEffect(() => {
    if (!doc || mode === "novel" || panel !== "source") return;
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
      if (isTypingTarget(event.target)) return;
      const next = byKey[event.key];
      if (!next) return;
      event.preventDefault();
      setFilter(next);
      setPatternFilter(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // 两个 setter 都是 useUrlState 交出的 useState setter，引用不变，列进来只为满足规则。
  }, [doc, mode, panel, setFilter, setPatternFilter]);

  useEffect(() => {
    if (!docKey || !initialBlockId || panel !== "source") return;
    const timer = window.setTimeout(() => {
      document.getElementById(initialSentenceId ? `rvs-${initialSentenceId}` : `rvb-${initialBlockId}`)
        ?.scrollIntoView({ block: "center" });
    }, 100);
    return () => window.clearTimeout(timer);
  }, [docKey, initialBlockId, initialSentenceId, panel]);

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
      setWriteAlerts((current) => ({ ...current, [key]: { subject, detail: reason, tone: "error" } }));
    },
    [],
  );

  // 通知只是确认「做到了 / 找不到」，读完就该消失；失败提示仍要人手动关，不共用这个计时。
  const noticeTimers = useRef(new Map<string, number>());
  useEffect(() => {
    const timers = noticeTimers.current;
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);
  const showNotice = useCallback(
    (key: string, subject: string, detail: string) => {
      setWriteAlerts((current) => ({ ...current, [key]: { subject, detail, tone: "info" } }));
      window.clearTimeout(noticeTimers.current.get(key));
      noticeTimers.current.set(key, window.setTimeout(() => {
        noticeTimers.current.delete(key);
        dismissWriteAlert(key);
      }, NOTICE_MS));
    },
    [dismissWriteAlert],
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
      dismissWriteAlert(alertKey);
      try {
        const payload = await postReviewWrite(
          "/api/review/annotate",
          {
            notePath: target.annotationPath,
            sentenceId,
            kind,
            text,
            target: decisionTarget,
          },
          "写入失败",
        );
        setNotingKey(null);
        if (payload.note && onNoteWritten) onNoteWritten(payload.note);
        else await onVaultChanged();
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
    [dismissWriteAlert, noteWriteFailure, onNoteWritten, onVaultChanged],
  );

  // 句卡是 memo 的：回调一律按句子 ID 取参、引用稳定，否则父级任何一次渲染都会让几百张卡全部重画。
  const toggleRevealed = useCallback((sentenceId: string) => setRevealed((current) => toggleSet(current, sentenceId)), []);
  const toggleErrors = useCallback((sentenceId: string) => setErrOpen((current) => toggleSet(current, sentenceId)), []);
  const toggleRaw = useCallback((sentenceId: string) => setRawOpen((current) => toggleSet(current, sentenceId)), []);
  const startNote = useCallback((key: string) => setNotingKey(key), []);
  const cancelNote = useCallback(() => setNotingKey(null), []);

  const generateDeepReview = useCallback(
    async (target: ReviewDoc) => {
      const alertKey = `deep:${target.key}`;
      setDeepBusy(true);
      dismissWriteAlert(alertKey);
      try {
        await postReviewWrite("/api/review/deep", { notePath: target.note.path }, "生成失败");
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
      dismissWriteAlert(alertKey);
      try {
        const payload = await postReviewWrite<WriteResponse & { deduplicated?: boolean }>(
          "/api/review/practice",
          { notePath: target.note.path, blockId },
          "加入失败",
        );
        // 成功不另发通知：按钮随回写变成「已加入重练」并锁住，就在按下的位置。
        if (payload.note && onNoteWritten) onNoteWritten(payload.note);
        else await onVaultChanged();
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
    [dismissWriteAlert, noteWriteFailure, onNoteWritten, onVaultChanged],
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
      dismissWriteAlert(alertKey);
      try {
        const payload = await postReviewWrite<WriteResponse & { deduplicated?: boolean }>(
          "/api/review/feedback",
          { notePath: target.note.path, blockId, kind, text: feedbackText },
          "反馈写入失败",
        );
        if (payload.note && onNoteWritten) onNoteWritten(payload.note);
        else await onVaultChanged();
        showNotice(
          `feedback-ok:${target.key}:${blockId}`,
          `${target.company} · ${blockId}`,
          payload.deduplicated ? "已记录过相同反馈。" : "人工反馈已保存。",
        );
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
    [dismissWriteAlert, noteWriteFailure, onNoteWritten, onVaultChanged, showNotice],
  );

  if (!doc) {
    // 退回一覧页也不丢失败提示：写入还没回来时按了「← 面试一览」就看不到理由的话，
    // 那又多出一个「看不见的条件」，正是这次要消掉的东西。
    return (
      <>
        <ReviewIndex
          notes={notes}
          onOpenNote={onOpenNote}
          loading={loading}
          docs={docs}
          trendEntries={trendEntries}
          signalOutcome={signalOutcome}
          onOpenInsights={onOpenInsights}
          onSelect={(key, reviewBlockId) => {
            setSelectedKey(key);
            onSelectionChange?.(key);
            setFilter("all");
            setPatternFilter(null);
            // 先把整场面接还原成摘要目录，让读者自己选择进入哪一问。
            setOpenBlocks(new Set());
            setRevealed(new Set());
            setErrOpen(new Set());
            setRawOpen(new Set());
            focusDeepReview(reviewBlockId ?? null);
            setPanel(reviewBlockId ? "quality" : "source");
            setAssessmentOpen(Boolean(reviewBlockId));
            if (reviewBlockId) switchMode("study");
            resetAnnotationDraft();
            listScrollTop.current = window.scrollY;
            // 进详情只回顶一次：带 reviewBlockId 进来时深度报告随后要自己滚到那一问，补跳会把它拽回顶部。
            window.scrollTo({ top: 0 });
          }}
        />
        <ReviewWriteAlerts alerts={writeAlerts} onDismiss={dismissWriteAlert} />
      </>
    );
  }

  // 连读直接使用整份整理稿，不能继承学习页的筛选或句卡展开状态。
  if (mode === "novel" && panel === "source") {
    return (
      <>
        <InterviewNovelReader
          key={doc.key}
          documentKey={`review-novel:${doc.key}`}
          company={doc.company}
          date={doc.date}
          round={doc.round}
          parsed={doc.parsed}
          decisionTasks={doc.decisionTasks}
          language={novelLang}
          onLanguageChange={switchNovelLang}
          onExit={() => switchMode(previousMode.current)}
          onBack={backToList}
          headerExtra={<SelectionNoticePanel notices={selectionNoticesForSession(doc.note, notes)} locale={locale}
            rejected={outcomes.get(doc.note.path)?.kind === "rejected"} />}
          // 阅读层 portal 到 body 并把外壳设为 inert，写入提示留在外壳里就关不掉，所以随阅读层一起挂。
          overlay={<ReviewWriteAlerts alerts={writeAlerts} onDismiss={dismissWriteAlert} />}
        />
      </>
    );
  }

  const unresolvedDecisionTasks = doc.decisionTasks.filter((task) => !task.resolvedBy);
  // URL 带来的错误型在这一场里不存在（换场・重新生成后）时视为未筛选，免得整页句卡被筛空。
  const patternFilter = patternParam && doc.stats.patterns.has(patternParam) ? patternParam : null;
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
      showNotice(`evidence-missing:${doc.key}`, "证据句定位", `整理稿中找不到证据句 ${sentenceId}。`);
      return;
    }
    setPanel("source");
    setAssessmentOpen(false);
    switchMode("compare");
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
    <div className="review-view rv-reader-page">
      <header className="rv-toolbar">
        <button
          className="rv-back"
          onClick={backToList}
        >{t(INTERVIEW_LIST_BACK_LABEL)}</button>
        <div className="rv-title">
          <h1>{doc.company}</h1>
          <span>{doc.round} · {doc.date}{doc.result ? ` · ${doc.result}` : ""}</span>
          {(
            <span className="rv-title-links">
              <ReviewCompanyAnalysis notes={notes} source={doc.note} company={doc.company} filter={filter} pattern={patternParam} />
              {onOpenSession && (
                <button
                  type="button"
                  onClick={() => onOpenSession({ company: doc.company, date: doc.date, round: doc.round, notePath: doc.note.path })}
                >{t("准备稿 ↗")}</button>
              )}
              {onOpenNote && <button type="button" onClick={() => onOpenNote(doc.note)}>{t("原笔记 ↗")}</button>}
            </span>
          )}
        </div>

      </header>

      <SelectionNoticePanel key={doc.key} notices={selectionNoticesForSession(doc.note, notes)} locale={locale}
        rejected={outcomes.get(doc.note.path)?.kind === "rejected"}
        onOpenNote={onOpenNote ? path => { const note = notes.find(item => item.path === path); if (note) onOpenNote(note); } : undefined} />

      <nav className="rv-section-tabs" aria-label={t("面试复盘内容")}>
        {([['source', menu("原文阅读")], ['advisory', menu("全文理解")], ['quality', menu("回答评价")]] as const).map(([value, label]) => <button type="button" key={value}
          aria-pressed={panel === value} onClick={() => {
            panelScrollTops.current[panel] = window.scrollY;
            setPanel(value);
            setAssessmentOpen(value === "quality");
            if (value === "quality") setDeepOpen(true);
            if (value === "source" && mode === "novel") switchMode("study");
            window.requestAnimationFrame(() => restoreWindowScroll(panelScrollTops.current[value] ?? 0));
          }}>{t(label)}</button>)}
        <button type="button" className="rv-cross-link" onClick={() => onOpenInsights()}>{t("公司对比 ↗")}</button>
      </nav>
      <div className="rv-reader-tools" hidden={panel !== "source"}>
        <span>{t("阅读模式")}</span>
        <div className="rv-mode-wrap" hidden={panel !== "source"}>
          <div className="rv-mode" role="tablist" aria-label={t("阅读模式")}>
            <button
              role="tab"
              aria-selected={mode === "study"}
              className={mode === "study" ? "active" : ""}
              onClick={() => switchMode("study")}
            >{t("学习")}<small>{t("先猜后看")}</small></button>
            <button
              role="tab"
              aria-selected={mode === "compare"}
              className={mode === "compare" ? "active" : ""}
              onClick={() => switchMode("compare")}
            >{t("对照")}<small>{t("日中并排")}</small></button>
          </div>
          {/* 全文阅读会换掉整页，不是同一组里的另一张标签；放进 tablist 会让读屏把它报成「未选中的标签」。 */}
          <button
            type="button"
            className="rv-mode-novel"
            data-novel-entry
            onClick={() => switchMode("novel")}
          >{t("全文阅读")}<small>{t("中文 / 日本語")}</small></button>
        </div>
      </div>
      <InterviewReassessmentEntry notes={notes} sourcePath={doc.note.path} onOpenNote={onOpenNote} t={t}
        expanded={assessmentOpen} onExpandedChange={setAssessmentOpen} onOpenEvidence={onOpenEvidence}
        onOpenUnderstanding={() => { setPanel("advisory"); setAssessmentOpen(false); window.scrollTo({ top: 0 }); }} onClose={() => {
          if (panel === "quality") {
            setPanel("source");
            window.requestAnimationFrame(() => restoreWindowScroll(panelScrollTops.current.source ?? 0));
          }
        }} />

      {doc.deepReview?.overviewZh && panel === "advisory" && <details className="rv-previous-introduction"><summary>{t("查看之前的面谈导读")}</summary><ReviewIntroduction review={doc.deepReview} /></details>}

      <div className="rv-panel" hidden={panel !== "advisory"}><InterviewAdvisory key={doc.key} report={doc.deepReview?.advisory} notes={notes} notePath={doc.note.path}
        onOpenEvidence={onOpenEvidence} onVaultChanged={onVaultChanged} onNoteWritten={onNoteWritten} onOpenInsights={onOpenInsights} /></div>

      <div className="rv-panel" hidden={panel !== "source"}>

      <details className="rv-source-tools">
      <summary>{t("批注与筛选")} · {doc.stats.sentenceTotal} {t("句")} · {unresolvedDecisionTasks.length} {t("待裁定点")}</summary>
      <section className="rv-stats">
        <div className="rv-counts">
          <div><strong>{doc.stats.sentenceTotal}</strong><span>{menu("文")}</span></div>
          <div><strong>{pendingSentenceIds.size}</strong><span>{menu("待确认句")}</span></div>
          <div><strong>{unresolvedDecisionTasks.length}</strong><span>{menu("待裁定点")}</span></div>
          <div><strong>{transcriptDecisionTasks.length}</strong><span>{menu("转录错误")}</span></div>
          <div><strong>{learnerDecisionTasks.length}</strong><span>{menu("我说错了")}</span></div>
          <div><strong>{openAnnotations.length}</strong><span>{menu("未结束")}</span></div>
        </div>
        {patternEntries.length > 0 && (
          <div className="rv-patterns" aria-label={menu("错误型分布")}>
            {patternEntries.slice(0, 8).map(([slug, bucket]) => (
              <button
                key={slug}
                className={patternFilter === slug ? "active" : ""}
                onClick={() => setPatternFilter(patternFilter === slug ? null : slug)}
                title={menu("确定 {count} · 疑 {uncertain}", { count: bucket.learner, uncertain: bucket.uncertain })}
              >
                {slug}
                <b>{bucket.learner + bucket.uncertain}</b>
              </button>
            ))}
            {patternFilter && (
              <button className="rv-clear" onClick={() => setPatternFilter(null)}>{t("清除筛选 ×")}</button>
            )}
          </div>
        )}
        <div className="rv-filters" role="tablist" aria-label={t("内容筛选")}>
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
              {t(item.label)}
              <b>{filterCounts[item.id]}</b>
            </button>
          ))}
        </div>
      </section>

      <section className={`rv-stage ${unresolvedDecisionTasks.length === 0 ? "complete" : ""}`}>
        <div className="rv-stage-copy">
          <span>{menu("第一阶段 · 证据裁定")}</span>
          <h2>
            {unresolvedDecisionTasks.length === 0
              ? menu("批注完成，可以进入回答质量复盘")
              : menu("{count} 句话里还有 {pending} 个裁定点", { count: pendingSentenceIds.size, pending: unresolvedDecisionTasks.length })}
          </h2>
          <p>
            {menu("已裁定 ")}{resolvedDecisionCount} / {doc.decisionTasks.length}{menu("：转录错误 ")}{transcriptDecisionTasks.length}{menu("，本人错误 ")}{learnerDecisionTasks.length}{menu("，话者确认 ")}{speakerDecisionTasks.length}{menu("。 深度复盘会在全部完成后再判断漏答、答非所问和回答策略。")}</p>
        </div>
        <div className="rv-stage-progress" aria-label={menu("批注进度 {count} / {total}", { count: resolvedDecisionCount, total: doc.decisionTasks.length })}>
          <i style={{ width: `${doc.decisionTasks.length ? (resolvedDecisionCount / doc.decisionTasks.length) * 100 : 100}%` }} />
        </div>
        <button
          disabled={unresolvedDecisionTasks.length === 0}
          onClick={() => {
            setFilter("pending");
            setPatternFilter(null);
          }}
        >
          {unresolvedDecisionTasks.length === 0 ? menu("第一阶段已完成") : menu("继续裁定 →")}
        </button>
      </section>

      </details>
      </div>
      <div className="rv-panel" hidden={panel !== "quality"}>
      <JapanSignalsPanel review={doc.deepReview} outcome={outcomes.get(doc.note.path) ?? null} t={signalsT}
        onEvidence={(_blockId, sentenceIds) => { if (sentenceIds[0]) jumpToEvidence(sentenceIds[0]); }} />
      {!findInterviewReassessment(notes, doc.note.path) && <section className={`rv-deep-stage ${unresolvedDecisionTasks.length > 0 ? "locked" : "ready"}`}>
        <div className="rv-deep-stage-copy">
          <span>{menu("第二阶段 · 回答质量")}</span>
          <h2>
            {unresolvedDecisionTasks.length > 0
              ? menu("完成证据裁定后解锁")
              : doc.deepReview
                ? reviewDisplayScore({ key: doc.key, company: doc.company, date: doc.date, round: doc.round, review: doc.deepReview }).score === null ? menu("回答评价 · 无整场总分") : `${String(doc.deepReview.evaluationMode) === "scored_evidence" ? menu("新版有据评分") : menu("旧版整体评价（不同口径）")} ${Math.round(doc.deepReview.overallScore as number)} / 100`
                : menu("可以生成深度复盘了")}
          </h2>
          <p>
            {menu("检查是否听懂、是否覆盖全部子问、是否答非所问，以及回答方式在日本面试中的策略风险；不重复做语法评分。")}</p>
        </div>
        <div className="rv-deep-actions">
          {doc.deepReview && (
            <button className="quiet" onClick={() => setDeepOpen((current) => !current)}>
              {deepOpen ? menu("收起报告") : menu("查看报告")}
            </button>
          )}
          <button
            disabled={unresolvedDecisionTasks.length > 0 || deepBusy}
            onClick={() => void generateDeepReview(doc)}
          >
            {unresolvedDecisionTasks.length > 0
              ? menu("还差 {count} 个裁定点", { count: unresolvedDecisionTasks.length })
              : deepBusy
                ? menu("正在分析整场面试…")
                : doc.deepReview
                  ? menu("重新生成")
                  : menu("生成深度复盘 →")}
          </button>
        </div>
        {doc.deepReview?.dimensions && doc.deepReview.evaluationMode !== "evidence" && (
          <section
            className={`rv-score-glance${qualityReveal.active ? " rv-reveal" : ""}`}
            aria-label={menu("五维评分概览")}
          >
            <header>
              <strong>{menu("五维评分")}</strong>
              <span>
                {String(doc.deepReview.evaluationMode) === "scored_evidence" ? menu("有据参考线 75 / 85 / 95，减去具体事件并应用上限；未评估不计分") : hasDeductionLedger(doc.deepReview.dimensions)
                  ? menu("历史旧口径：每维从 100 起扣 · 不与新版比较能力涨跌")
                  : menu("各占 20% · 旧格式报告没有扣分明细，重新生成后可见")}
              </span>
            </header>
            <FiveDimensionRadar
              key={qualityReveal.round}
              review={doc.deepReview}
              averages={historyAverages}
              t={t}
            />
            <div>
              {(Object.keys(REVIEW_DIMENSION_META) as ReviewDimensionKey[]).map((key, index) => {
                const dimension = doc.deepReview?.dimensions?.[key];
                const score = dimension?.level !== "not_assessed" && typeof dimension?.score === "number" && Number.isFinite(dimension.score) ? Math.round(dimension.score) : null;
                const band = reviewScoreBand(score);
                const deductions = dimension?.deductions;
                const top = (deductions ?? []).slice(0, 2);
                return (
                  <article key={key}>
                    <button
                      type="button"
                      disabled={!deductions}
                      aria-label={menu("{dimension} {score}，查看扣分明细", { dimension: menu(REVIEW_DIMENSION_META[key].label), score: score === null ? menu("未评估") : menu("{count} 分", { count: score }) })}
                      onClick={() => {
                        setDeepOpen(true);
                        setDeepFocusDimension(key);
                      }}
                    >
                      <div>
                        <span>{REVIEW_DIMENSION_META[key].label}</span>
                        {score === null ? <strong>{menu("未评估")}</strong> : <CountUp key={qualityReveal.round} as="strong" value={score} />}
                      </div>
                      <i className="rv-dimension-track" aria-hidden="true">
                        <em className={band} style={{ width: `${score ?? 0}%`, "--rv-index": index } as CSSProperties} />
                      </i>
                      {deductions && (deductions.length === 0 ? (
                        <p className="rv-glance-clean">{menu("没有独立扣分；分数仍由证据参考线与上限决定")}</p>
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
                            <li className="more">{menu("还有 ")}{deductions.length - top.length}{menu(" 项 →")}</li>
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
      </section>}

      {doc.deepReview && !findInterviewReassessment(notes, doc.note.path) && deepOpen && (
        <DeepReviewPanel
          review={doc.deepReview}
          queuedBlockIds={doc.practiceBlockIds}
          practiceBusy={practiceBusy}
          feedbackByBlock={doc.feedbackByBlock}
          feedbackBusy={feedbackBusy}
          focusBlockId={deepFocusBlockId}
          focusDimension={deepFocusDimension}
          revealRound={qualityReveal.round}
          onEvidenceClick={jumpToEvidence}
          onQueuePractice={(blockId) => void queuePractice(doc, blockId)}
          onFeedback={(blockId, kind, feedbackText) =>
            submitReviewFeedback(doc, blockId, kind, feedbackText)}
        />
      )}

      </div>
      <div className="rv-panel" hidden={panel !== "source"}>

      {!doc.annotationExists && (
        <p className="rv-message">{menu("这场面试还没有批注文件（")}{doc.annotationPath}{menu("）。先在 vault 里建好再批注。")}</p>
      )}

      <div className="rv-reading-bar">
        <p>
          <strong>{visibleSentenceCount}</strong>
          <span> / {doc.stats.sentenceTotal}{menu(" 句")}</span>
          <i>·</i>
          <span>{visibleBlocks.length}{menu(" 个话题")}</span>
          {focused && <em>{menu("筛选结果已自动展开")}</em>}
        </p>
        {!focused && visibleBlocks.length > 0 && (
          <div>
                <button onClick={() => setOpenBlocks(new Set(visibleBlockIds))}>{t("展开全部")}</button>
                <button onClick={() => setOpenBlocks(new Set())}>{t("收起全部")}</button>
          </div>
        )}
      </div>

      <nav className="rv-toc" aria-label={menu("質問ブロック")}>
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
          <p className="rv-empty-filter">{menu("当前筛选没有命中任何句子。")}</p>
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
          <section
            key={block.id}
            className={`rv-block ${isOpen ? "open" : "collapsed"}${landingBlockId === block.id ? " landing" : ""}`}
            id={`rvb-${block.id}`}
          >
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
                    <small>{sentences.length}{menu(" 句")}{issueCount > 0 ? menu(" · {count} 处重点", { count: issueCount }) : ""}</small>
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
                    key={`${doc.key}:${sentence.id}`}
                    doc={doc}
                    sentence={sentence}
                    mode={mode === "novel" ? "study" : mode}
                    revealed={revealed.has(sentence.id)}
                    errored={errOpen.has(sentence.id)}
                    rawShown={rawOpen.has(sentence.id)}
                    noting={notingKey === `${doc.key}:${sentence.id}`}
                    busy={busy === sentence.id}
                    evidenceFocused={evidenceFocus === sentence.id}
                    revealLabel={t("译文")}
                    onReveal={toggleRevealed}
                    onToggleErrors={toggleErrors}
                    onToggleRaw={toggleRaw}
                    onStartNote={startNote}
                    onCancelNote={cancelNote}
                    onSubmit={submitAnnotation}
                  />
                ))}
              </div>
            )}
          </section>
          );
        })}
      </div>

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

// 「听懂了」と「訊かれたことに答えた」は別の失敗。聞き取れていても論点がずれることはあるし、
// その取り違えは扣分明細でも別の維度（问题理解 vs 直接性）に効く。
// direct はラベルを出さない——正常な状態に印を付けても、本当に見てほしい2つが埋もれるだけ。
const RELEVANCE_LABELS = {
  direct: "",
  partial: "略有偏题",
  off_target: "答非所问",
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
  const menu = useInterviewMenu();
  const entries = Object.entries(alerts);
  if (entries.length === 0) return null;
  const hasError = entries.some(([, alert]) => alert.tone !== "info");
  return (
    <div className="rv-write-alerts" role={hasError ? "alert" : "status"}>
      {entries.map(([key, alert]) => (
        <p key={key} className={alert.tone === "info" ? "info" : undefined}>
          <b>{alert.subject}</b>
          <span>{alert.tone === "info" ? alert.detail : menu("没有写入。{detail}", { detail: alert.detail })}</span>
          <button type="button" onClick={() => onDismiss(key)} aria-label={menu("关闭提示")}>×</button>
        </p>
      ))}
    </div>
  );
}


/**
 * 五维雷达：填色是本场，虚线描边是其他已复盘场次的平均。
 * 只是给五个按钮配一张「形状」，数字与扣分入口仍在右侧按钮里——按钮的顺序和选择器被测试钉着，不挪。
 */
function FiveDimensionRadar({
  review,
  averages,
  t,
}: {
  review: InterviewAnswerReview;
  averages: DimensionAverages | null;
  t: (label: string) => string;
}) {
  const keys = Object.keys(REVIEW_DIMENSION_META) as ReviewDimensionKey[];
  const series: RadarSeries[] = [{
    id: "current",
    label: t("本场"),
    values: keys.map((key) => {
      const score = review.dimensions?.[key]?.level === "not_assessed" ? null : review.dimensions?.[key]?.score;
      return typeof score === "number" ? Math.round(score) : null;
    }),
    tone: "primary",
  }];
  if (averages) {
    series.push({ id: "history", label: t("历史平均"), values: keys.map((key) => averages[key]), tone: "secondary" });
  }
  return (
    <RadarChart
      className="rv-score-radar"
      axes={keys.map((key) => ({ key, label: REVIEW_DIMENSION_META[key].label }))}
      series={series}
      max={100}
      size={240}
      title={t("五维评分雷达")}
    />
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
  const menu = useInterviewMenu();
  return (
    <li className={`sev-${item.severity}`}>
      <div className="rv-deduction-head">
        <b>−{item.points}</b>
        <em title={DEDUCTION_SEVERITY_META[item.severity].hintZh}>
          {DEDUCTION_SEVERITY_META[item.severity].label}
        </em>
        {item.recovery && <em>{({ unresolved: menu("未恢复"), partial: menu("部分恢复"), repaired: menu("已恢复"), unknown: menu("恢复未知") })[item.recovery]}</em>}
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
        <p className="rv-deduction-fix"><span>{menu("下次")}</span>{item.fixZh}</p>
      )}
      {item.evidenceSentenceIds.length > 0 && (
        <p className="rv-deduction-evidence">
          <span>{menu("证据句")}</span>
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

export function DeepReviewPanel({
  review,
  queuedBlockIds,
  practiceBusy,
  feedbackByBlock,
  feedbackBusy,
  focusBlockId,
  focusDimension,
  revealRound = 0,
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
  /** 与概览同一个揭晓轮次：面板隐藏时挂载的那次滚动没人看见，进「回答质量」时靠它重挂再滚一次。 */
  revealRound?: number;
  onEvidenceClick: (sentenceId: string) => void;
  onQueuePractice: (blockId: string) => void;
  onFeedback: (
    blockId: string,
    kind: ReviewFeedbackKind,
    text: string,
  ) => Promise<boolean>;
}) {
  const menu = useInterviewMenu();
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
  const evidenceMode = review.evaluationMode === "evidence";
  const scoredMode = String(review.evaluationMode) === "scored_evidence";
  const displayScore = reviewDisplayScore({ key: "", company: "", date: "", round: "", review });
  const scoring = review.scoring;
  const evidenceScores = interviewEvidenceScores({ review });
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
        {!evidenceMode && <div className="rv-deep-score">
          {displayScore.score === null ? <strong>—</strong> : <CountUp key={revealRound} as="strong" value={Math.round(displayScore.score)} />}
          <span>{scoredMode ? displayScore.score === null ? menu("未评估整场总分") : menu("/ 100（新版有据评分）") : menu("/ 100（历史旧口径）")}</span>
        </div>}
        <div>
          <span>ANSWER QUALITY REVIEW</span>
          <h2>{menu("整场回答评价")}</h2>
          <p>{review.summaryZh}</p>
        </div>
        <small>{review.model} · {review.generatedAt.slice(0, 10)}</small>
      </header>
      {scoredMode && <section className="rv-score-source" aria-label={menu("新版评分来源")}><p>{scoring?.formulaZh || menu("已评估维度从有据参考线75 / 85 / 95减去事件25 / 5 / 2；缺证不计分。")}</p>{scoring?.cap != null && <p>{menu("未恢复的严重问题触发总分上限：")}{scoring.cap}。</p>}</section>}
      {!evidenceMode && !scoredMode && <p>{menu("历史旧分采用不同口径，不与新版解读为能力涨跌。")}</p>}
      {evidenceMode && <section aria-label={menu("有据评价")}><MarkdownDocument content={renderEvidenceEvaluation(review)} onWikiLink={() => {}} /></section>}
      {review.dimensions && !evidenceMode && !ledger && (
        <section className="rv-score-source" aria-label={menu("总分来源")}>
          <header>
            <h3>{menu("总分来源")}</h3>
            <p>
              {menu("五个维度各占 20%。这份是旧格式报告，只有整体理由、没有逐条扣分； 重新生成后每一维都会列出扣在哪一题、扣了几分。")}</p>
          </header>
          <div>
            {(Object.keys(REVIEW_DIMENSION_META) as ReviewDimensionKey[]).map((key) => {
              const dimension = review.dimensions?.[key];
              return (
                <article key={key}>
                  <span>{REVIEW_DIMENSION_META[key].label}</span>
                  <strong>{evidenceScores.dimensions[key] === null && scoredMode ? menu("未评估") : dimension?.level !== "not_assessed" && typeof dimension?.score === "number" ? Math.round(dimension.score) : menu("未评估")}</strong>
                  <i className="rv-dimension-track" aria-hidden="true">
                    <em
                      className={reviewScoreBand(dimension?.level === "not_assessed" ? null : dimension?.score)}
                      style={{ width: `${Math.round(dimension?.level === "not_assessed" ? 0 : dimension?.score ?? 0)}%` }}
                    />
                  </i>
                  <p>{dimension?.rationaleZh}</p>
                  {dimension && dimension.evidenceBlockIds.length > 0 && (
                    <small>
                      <span>{menu("依据：")}</span>
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

      {review.dimensions && !evidenceMode && ledger && (
        <section className="rv-ledger" aria-label={menu("扣分明细")}>
          <header>
            <div>
              <h3>{menu("扣分明细")}</h3>
              <p>
                {scoredMode ? menu("有据参考线75 / 85 / 95，减去具体事件25 / 5 / 2并应用上限；没有扣分不等于满分，缺证维度未评估。") : menu("历史旧口径从100起扣，保留原账本；不与新版比较能力涨跌。")}
              </p>
            </div>
            <div className="rv-ledger-total">
              <b>−{lostPoints}</b>
              <span>{flatDeductions.length}{menu(" 项 · 五维合计")}</span>
            </div>
            <div className="rv-ledger-switch" role="group" aria-label={menu("扣分排列方式")}>
              <button
                type="button"
                className={deductionView === "dimension" ? "on" : ""}
                onClick={() => setDeductionView("dimension")}
              >{menu("按维度")}</button>
              <button
                type="button"
                className={deductionView === "rank" ? "on" : ""}
                onClick={() => setDeductionView("rank")}
              >{menu("按扣分排序")}</button>
            </div>
          </header>

          {deductionView === "dimension" ? (
            <div className="rv-ledger-dimensions">
              {(Object.keys(REVIEW_DIMENSION_META) as ReviewDimensionKey[]).map((key) => {
                const dimension = review.dimensions?.[key];
                const score = dimension?.level !== "not_assessed" && typeof dimension?.score === "number" && Number.isFinite(dimension.score) ? Math.round(dimension.score) : null;
                const deductions = dimension?.deductions ?? [];
                const basis = dimension as typeof dimension & { baseScore?: number | null; basisZh?: string; positiveEvidenceBlockIds?: string[] };
                return (
                  <article key={key} id={`rv-dimension-${key}`}>
                    <header>
                      <h4>{REVIEW_DIMENSION_META[key].label}</h4>
                      <p className="rv-ledger-formula">
                        {/* 上限可能低于扣分后的结果，不能把它写成不成立的等式。 */}
                        {score !== null && deductions.length > 0 && (
                          <>
                            <span>{scoredMode ? basis?.baseScore ?? menu("参考线") : 100}</span>
                            {deductions.map((item, index) => (
                              <em key={`${item.blockId}-${index}`}>−{item.points}</em>
                            ))}
                            <i>{scoredMode && typeof basis?.baseScore === "number" && basis.baseScore - deductions.reduce((total, item) => total + item.points, 0) !== score ? menu("→ 上限后") : "="}</i>
                          </>
                        )}
                        <strong>{score === null ? menu("未评估") : score}</strong>
                      </p>
                    </header>
                    {scoredMode && basis?.basisZh && <p className="rv-ledger-rationale">{basis.basisZh}</p>}
                    {scoredMode && basis?.positiveEvidenceBlockIds?.length ? <p>{menu("正面依据：")}{basis.positiveEvidenceBlockIds.map((blockId) => <button key={blockId} type="button" onClick={() => jumpToReviewBlock(blockId)}>{blockId}</button>)}</p> : null}
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
                      <p className="rv-ledger-clean">{score === null ? menu("本维未评估；缺证不补成0或100。") : scoredMode ? menu("没有独立扣分；本维仍按正面证据参考线与上限评分。") : menu("历史账本未记扣分，不能据此证明未检验能力。")}</p>
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
            <p className="rv-ledger-clean">{menu("整场没有找到可举证的扣分点。")}</p>
          )}
        </section>
      )}
      <div className="rv-deep-overview">
        <div>
          <h3>{menu("回答强项")}</h3>
          <ul>{review.strengths.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
        <div className="risk">
          <h3>{menu("优先改进")}</h3>
          <ul>{review.weaknesses.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      </div>
      <div className="rv-deep-list-head">
        <div>
          <strong>{showAllBlocks || priorities.size === 0 ? menu("全部问题") : menu("优先重练")}</strong>
          <span>{blocks.length} / {sortedBlocks.length}</span>
        </div>
        {priorities.size > 0 && (
          <button type="button" onClick={() => setShowAllBlocks((current) => !current)}>
            {showAllBlocks ? menu("只看重点 {count}", { count: priorities.size }) : menu("显示其他 {count} 项", { count: hiddenBlockCount })}
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
                {block.relevance !== "direct" && (
                  <em className={`r-${block.relevance}`}>{RELEVANCE_LABELS[block.relevance]}</em>
                )}
                {block.missedPoints.length > 0 && <b>{menu("漏答 ")}{block.missedPoints.length}</b>}
                <i aria-hidden="true">⌄</i>
              </summary>
              <div className="rv-deep-block-body">
                <p className="rv-deep-intent"><span>{menu("面试官意图")}</span>{block.interviewerIntentZh}</p>
                <div className="rv-coverage">
                  <div><h4>{menu("问了什么")}</h4><ul>{block.askedPoints.map((item) => <li key={item}>{item}</li>)}</ul></div>
                  <div><h4>{menu("答到了")}</h4><ul>{block.answeredPoints.map((item) => <li key={item}>{item}</li>)}</ul></div>
                  <div className={block.missedPoints.length > 0 ? "missed" : ""}>
                    <h4>{menu("没答全")}</h4>
                    {block.missedPoints.length > 0
                      ? <ul>{block.missedPoints.map((item) => <li key={item}>{item}</li>)}</ul>
                      : <p>{menu("没有明显漏答")}</p>}
                  </div>
                </div>
                <div className="rv-deep-advice">
                  <div><h4>{menu("评价")}</h4><p>{block.evaluationZh}</p></div>
                  <div><h4>{menu("改进方向")}</h4><p>{block.improvementZh}</p></div>
                </div>
                {(block.strategyTags ?? []).length > 0 && (
                  <p className="rv-strategy-tags">
                    <span>{menu("策略标签")}</span>
                    {(block.strategyTags ?? []).map((tag) => (
                      <em key={tag}>{STRATEGY_TREND_META[tag].label}</em>
                    ))}
                  </p>
                )}
                {block.improvedAnswerJa && (
                  <div className="rv-improved-answer">
                    <header>
                      <span>{menu("改善回答 · AI 草稿")}</span>
                      <button
                        type="button"
                        disabled={queuedBlockIds.has(block.blockId) || practiceBusy === block.blockId}
                        onClick={() => onQueuePractice(block.blockId)}
                      >
                        {queuedBlockIds.has(block.blockId)
                          ? menu("已加入重练")
                          : practiceBusy === block.blockId
                            ? menu("加入中…")
                            : menu("加入重练")}
                      </button>
                    </header>
                    <p lang="ja">{block.improvedAnswerJa}</p>
                  </div>
                )}
                {block.evidenceSentenceIds.length > 0 && (
                  <p className="rv-evidence-ids">
                    <span>{menu("证据句：")}</span>
                    {block.evidenceSentenceIds.map((sentenceId) => (
                      <button
                        key={sentenceId}
                        type="button"
                        onClick={() => onEvidenceClick(sentenceId)}
                      >{sentenceId}</button>
                    ))}
                  </p>
                )}
                <section className="rv-ai-feedback" aria-label={menu("{id} AI 评价反馈", { id: block.blockId })}>
                  <header>
                    <div>
                      <strong>{menu("你对这项 AI 评价")}</strong>
                      <span>{menu("反馈会在重新生成时作为约束读取")}</span>
                    </div>
                    <div>
                      <button
                        type="button"
                        className={agreed ? "selected" : ""}
                        disabled={agreed || feedbackBusy === block.blockId}
                        onClick={() => void onFeedback(block.blockId, "agree", "")}
                      >{agreed ? menu("已同意") : menu("同意")}</button>
                      <button
                        type="button"
                        disabled={feedbackBusy === block.blockId}
                        onClick={() => {
                          setFeedbackEditor({ blockId: block.blockId, kind: "disagree" });
                          setFeedbackDraft("");
                        }}
                      >{menu("不同意")}</button>
                      <button
                        type="button"
                        disabled={feedbackBusy === block.blockId}
                        onClick={() => {
                          setFeedbackEditor({ blockId: block.blockId, kind: "context" });
                          setFeedbackDraft("");
                        }}
                      >{menu("补充事实")}</button>
                    </div>
                  </header>
                  {feedback.length > 0 && (
                    <div className="rv-feedback-history">
                      {feedback.map((entry) => (
                        <p key={entry.id} className={`kind-${entry.kind}`}>
                          <em>{menu(FEEDBACK_LABELS[entry.kind])}</em>
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
                          ? menu("哪一处判断不准确？请写出理由或反例。")
                          : menu("补充 AI 不知道的背景、事实或当时的真实意图。")}
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
                        >{feedbackBusy === block.blockId ? menu("保存中…") : menu("保存{kind}", { kind: menu(FEEDBACK_LABELS[editor.kind]) })}</button>
                        <button
                          type="button"
                          className="quiet"
                          disabled={feedbackBusy === block.blockId}
                          onClick={() => {
                            setFeedbackEditor(null);
                            setFeedbackDraft("");
                          }}
                        >{menu("取消")}</button>
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

/** 一览的排列方式跟阅读模式一个做法：localStorage + useSyncExternalStore，回到一览时还是上次那种。 */
const INDEX_GROUP_KEY = "review:index-group";
type IndexGroup = "company" | "all";

function readIndexGroup(): IndexGroup {
  try {
    return window.localStorage.getItem(INDEX_GROUP_KEY) === "all" ? "all" : "company";
  } catch {
    return "company";
  }
}

function saveIndexGroup(next: IndexGroup) {
  try {
    window.localStorage.setItem(INDEX_GROUP_KEY, next);
  } catch { /* 存储被禁用时只是记不住，切换本身照常。 */ }
  window.dispatchEvent(new Event(MODE_EVENT));
}

/** 分数环：conic-gradient 按分数画一圈。没有分数时退回原来的空心圆。 */
function ScoreRing({ score, label }: { score: number | null; label: string }) {
  return (
    <span
      className={`rv-card-score ${reviewScoreBand(score)}`}
      style={score === null ? undefined : ({ "--score": score } as CSSProperties)}
    >
      {score === null ? <b>—</b> : <b>{score}</b>}
      {label && <small>{label}</small>}
    </span>
  );
}

/**
 * 回答分走势：沿用分析页 chart-line 的画法（同一套类名与刻度）。
 * 每个点是一个可聚焦的按钮——走势图只是入口，点哪一场就进哪一场的复盘。
 */
function ReviewScoreTrend({
  points,
  onSelect,
  t,
}: {
  points: ReviewScorePoint[];
  onSelect: (key: string) => void;
  t: (label: string) => string;
}) {
  const W = 720;
  const H = 168;
  const PAD = { top: 16, right: 18, bottom: 30, left: 34 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (index: number) => PAD.left + (points.length <= 1 ? plotW / 2 : (index / (points.length - 1)) * plotW);
  const y = (score: number) => PAD.top + plotH - (Math.max(0, Math.min(100, score)) / 100) * plotH;
  // 日期标注太密会叠在一起：点多时只标首尾。
  const labelEvery = points.length <= 10;
  return (
    <section className="rv-score-trend" aria-label={t("回答分走势")}>
      <header>
        <h2>{t("回答分走势")}</h2>
        <span>{t("点任一场进入复盘")}</span>
      </header>
      <svg className="chart-line" viewBox={`0 0 ${W} ${H}`} role="group" aria-label={t("回答分走势")}>
        {[0, 50, 100].map((tick) => (
          <g key={tick}>
            <line className="chart-grid" x1={PAD.left} x2={W - PAD.right} y1={y(tick)} y2={y(tick)} />
            <text className="chart-tick" x={PAD.left - 8} y={y(tick) + 4} textAnchor="end">{tick}</text>
          </g>
        ))}
        {/* 65 / 80 是分数环与维度条换色的两条线，画淡虚线让「掉进哪一档」一眼可见。 */}
        {[65, 80].map((band) => (
          <line key={band} className="rv-trend-band" x1={PAD.left} x2={W - PAD.right} y1={y(band)} y2={y(band)} />
        ))}
        <polyline
          className="chart-line-path"
          pathLength={1}
          points={points.map((point, index) => `${x(index)},${y(point.score)}`).join(" ")}
        />
        {points.map((point, index) => (
          <g
            key={point.key}
            className={`rv-trend-point ${reviewScoreBand(point.score)}`}
            role="button"
            tabIndex={0}
            aria-label={`${point.company} ${point.round} ${point.date} ${point.score}`}
            onClick={() => onSelect(point.key)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              onSelect(point.key);
            }}
          >
            <title>{`${point.company} · ${point.round} · ${point.date} · ${point.score}`}</title>
            <circle className="chart-hit" cx={x(index)} cy={y(point.score)} r={14} />
            <circle className="chart-dot" cx={x(index)} cy={y(point.score)} r={4.5} />
            <text className="rv-trend-value" x={x(index)} y={y(point.score) - 10} textAnchor="middle">{point.score}</text>
            {(labelEvery || index === 0 || index === points.length - 1) && (
              <text className="chart-tick" x={x(index)} y={H - 8} textAnchor="middle">{point.date.slice(5)}</text>
            )}
          </g>
        ))}
      </svg>
    </section>
  );
}

/**
 * 按公司分组：每家一条横向轮次线，节点是那一场的分数环，末端是最后一场的结果。
 * 一眼看出「这家走到第几轮、每轮答得怎样」，比按日期平铺的卡片少翻很多。
 */
function ReviewCompanyTimeline({
  docs,
  onSelect,
  t,
  notes,
}: {
  notes: Note[];
  docs: ReviewDoc[];
  onSelect: (key: string) => void;
  t: (label: string) => string;
}) {
  const menu = useInterviewMenu();
  const groups = groupReviewsByCompany(docs);
  return (
    <div className="rv-company-lines">
      {groups.map((group) => (
        <section key={group.company} className="rv-company-line">
          <header>
            <h3>{group.company}</h3>
            <span>{group.rounds.length} {t("轮")} · {group.latestDate}</span>
          </header>
          <ol>
            {group.rounds.map((item) => {
              const reassessment = findInterviewReassessment(notes, item.note.path);
              const display = reviewDisplayScore({ ...item, review: item.deepReview, reassessment });
              const score = display.score;
              return (
                <li key={item.key}>
                  <button type="button" onClick={() => onSelect(item.key)}>
                    <ScoreRing score={score} label={t(display.label)} />
                    <span className="rv-company-round">
                      <strong>{item.round || "—"}</strong>
                      <small>{item.date}</small>
                      {reassessment && Array.isArray(reassessment.frontmatter.priority_issues) && (() => {
                        const copy = assessmentIssueCopy(getString(reassessment.frontmatter.priority_issues[0]));
                        return <span className="rv-company-summary">{getString(reassessment.frontmatter.priority_issues[0]).startsWith(menu("严重")) && <em>{t("优先改进")}</em>}<span>{copy.observation.split(/[。；]/)[0]}</span>{copy.action && <small>{t("下一步")}：{copy.action.split(/[。；]/)[0]}</small>}</span>;
                      })()}
                      <span className="rv-company-open">{t("查看原文与评价")} →</span>
                    </span>
                  </button>
                </li>
              );
            })}
            {group.outcome && (
              <li className="rv-company-outcome">
                <span className={`rv-result ${group.outcome.startsWith("不採用") ? "bad" : ""}`}>{group.outcome}</span>
              </li>
            )}
          </ol>
        </section>
      ))}
    </div>
  );
}

function ReviewIndex({
  notes,
  onOpenNote,
  docs,
  trendEntries,
  signalOutcome,
  onSelect,
  onOpenInsights,
  loading = false,
}: {
  notes: Note[];
  onOpenNote?: (note: Note) => void;
  docs: ReviewDoc[];
  trendEntries: ReviewVisualEntry[];
  /** 日本面试信号与每场选考结果的并排对照（只计数，不推因果）。 */
  signalOutcome: SignalOutcomeComparison;
  onSelect: (key: string, reviewBlockId?: string) => void;
  onOpenInsights: () => void;
  /** 面接 scope がまだ届いていない：「还没有整理稿」ではなく読取中を出す。 */
  loading?: boolean;
}) {
  const menu = useInterviewMenu();
  const t = useReviewCopy();
  const { locale } = useUiLocale();
  const group = useSyncExternalStore(subscribeMode, readIndexGroup, () => "company" as IndexGroup);
  const hasNewScoring = trendEntries.some((entry) => entry.reassessment ? (entry.reassessment as Note).frontmatter?.evaluation_mode === "scored_evidence" : String(entry.review?.evaluationMode) === "scored_evidence");
  const scorePoints = useMemo(() => hasNewScoring ? reviewScoreTimeline(trendEntries) : [], [trendEntries, hasNewScoring]);
  const historicalScorePoints = useMemo(() => reviewScoreTimeline(trendEntries.filter((entry) => String(entry.review?.evaluationMode) !== "scored_evidence").map((entry) => ({ ...entry, reassessment: null }))), [trendEntries]);
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
      .filter(([, item]) => isRepeatedAcrossInterviews(item.interviewKeys.size))
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
          <button type="button" onClick={() => setSelectedTrend(null)}>{menu("← 回答趋势")}</button>
          <div>
            <span>CROSS-INTERVIEW DETAIL</span>
            <h1>{STRATEGY_TREND_META[selectedTrend].label}</h1>
            <p>{STRATEGY_TREND_META[selectedTrend].description}</p>
          </div>
          <dl>
            <div><dt>{menu("反复出现")}</dt><dd>{selectedTrendItem.interviewKeys.size} / {answerTrends.reviewedCount}{menu(" 场")}</dd></div>
            <div><dt>{menu("命中问题")}</dt><dd>{selectedTrendItem.occurrences}{menu(" 个")}</dd></div>
          </dl>
        </header>
        <section className="rv-trend-question-list">
          <header>
            <div>
              <span>{menu("全部证据问题")}</span>
              <h2>{menu("从具体回答开始复习")}</h2>
            </div>
            <p>{menu("点击任一问题，会直接打开对应面试的深度复盘，并展开该问题。")}</p>
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
                  {question.missedCount > 0 && <em>{menu("漏答 ")}{question.missedCount}</em>}
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
    <div className="review-view rv-index-page">
      <header className="rv-index-heading"><h1>{t("面试复盘")}</h1><p>{t("选择一场面试，阅读原文或查看评价。")}</p></header>
      {docs.length === 0 && loading ? (
        <ScopeLoading label={menu("整理稿与复盘")} />
      ) : docs.length === 0 ? (
        <div className="rv-empty">
          <h2>{menu("还没有整理稿")}</h2>
          <p>
            {menu("把面试逐字稿交给 Claude 按 ")}<code>{menu("_整理稿スペック")}</code>{menu(" 生成")}<code>{menu("YYYY-MM-DD_〈回〉_整理稿.md")}</code>{menu(" 后，这里会自动出现。")}</p>
        </div>
      ) : (
        <>
        <div className="rv-index-switch" role="group" aria-label={t("复盘一览排列方式")}>
          <button type="button" aria-pressed={group === "company"} onClick={() => saveIndexGroup("company")}>{t("按公司")}</button>
          <button type="button" aria-pressed={group === "all"} onClick={() => saveIndexGroup("all")}>{t("全部场次")}</button>
        </div>
        {group === "company" ? (
          <ReviewCompanyTimeline notes={notes} docs={docs} onSelect={(key) => onSelect(key)} t={t} />
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
            const reassessment = findInterviewReassessment(notes, doc.note.path);
            const display = reviewDisplayScore({ ...doc, review: doc.deepReview, reassessment });
            const priorityIssue = Array.isArray(reassessment?.frontmatter.priority_issues)
              ? getString(reassessment.frontmatter.priority_issues[0]) : "";
            const issueCopy = priorityIssue ? assessmentIssueCopy(priorityIssue) : null;
            const score = display.score;
            const scoreBand = reviewScoreBand(score);
            return (
              <button key={doc.key} className={`rv-card band-${scoreBand}`} onClick={() => onSelect(doc.key)}>
                <header>
                  <div>
                    <span className="rv-card-date">{doc.date}</span>
                    <h3>{doc.company}</h3>
                  </div>
                  <ScoreRing score={score} label={t(display.label)} />
                </header>
                <div className="rv-card-meta">
                  <span>{doc.round}</span>
                  {doc.result && <span className={`rv-result ${doc.result === "不採用" ? "bad" : ""}`}>{doc.result}</span>}
                </div>
                <p className="rv-card-insight">
                  {issueCopy ? issueCopy.observation.split(/[。；]/)[0] : getString(reassessment?.frontmatter.diagnostic_conclusion).split(/[。；]/)[0] || doc.deepReview?.evaluation?.conclusionZh || doc.deepReview?.weaknesses[0] || (unresolvedTasks.length > 0
                    ? menu("还有 {count} 个证据裁定点，完成后才能生成深度复盘。", { count: unresolvedTasks.length })
                    : menu("证据裁定已完成，可以生成回答质量复盘。"))}
                </p>
                {issueCopy?.action && <p className="rv-card-next">{t("下一步")}：{issueCopy.action.split(/[。；]/)[0]}</p>}
                <div className="rv-card-progress">
                  <span><i style={{ width: `${completion}%` }} /></span>
                  <small>{menu("裁定 ")}{completedTasks} / {doc.decisionTasks.length}</small>
                </div>
                <dl>
                  <div><dt>{menu("文")}</dt><dd>{doc.stats.sentenceTotal}</dd></div>
                  <div><dt>{menu("我的错误")}</dt><dd className="warn">{doc.stats.learnerErrors}</dd></div>
                  <div><dt>{menu("待裁定")}</dt><dd className="pending">{unresolvedSentences}{menu("句 · ")}{unresolvedTasks.length}{menu("点")}</dd></div>
                  <div><dt>{menu("批注")}</dt><dd>{annotationCountLabel(open, doc.annotations.length)}</dd></div>
                </dl>
                <span className="rv-card-open">{menu("打开复盘 ")}<i aria-hidden="true">→</i></span>
              </button>
            );
          })}
        </div>
        )}
        </>
      )}
      {docs.length > 0 && <details className="rv-index-patterns"><summary>{t("跨面试回答趋势")} · {t("查看反复出现的问题")}</summary>
      {aggregate.length > 0 && (
        <section className="rv-agg" aria-label={menu("跨面试错误型摘要")}>
          <span>{menu("跨面试错误型 TOP")}</span>
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
              <h2>{menu("跨面试回答趋势")}</h2>
            </div>
            <p>{menu("只把出现在至少两场面试中的策略问题列为趋势，避免把一场里的偶发失误当成习惯。")}</p>
          </header>
          {answerTrends.reviewedCount < 2 ? (
            <p className="rv-trend-empty">
              {menu("已有 ")}{answerTrends.reviewedCount}{menu(" 场深度复盘；至少完成 2 场后开始判断重复模式。")}</p>
          ) : answerTrends.repeated.length === 0 ? (
            <p className="rv-trend-empty">{menu("目前没有跨两场重复出现的回答策略问题。")}</p>
          ) : (
            <div className="rv-trend-grid">
              {answerTrends.repeated.map(([tag, item]) => (
                <button key={tag} type="button" onClick={() => setSelectedTrend(tag)}>
                  <span className="rv-trend-mark" aria-hidden="true" />
                  <span className="rv-trend-copy">
                    <span>
                      <strong>{STRATEGY_TREND_META[tag].label}</strong>
                      <small>{item.interviewKeys.size} / {answerTrends.reviewedCount}{menu(" 场")}</small>
                    </span>
                    <em>{STRATEGY_TREND_META[tag].description}</em>
                  </span>
                  <span className="rv-trend-count">{item.occurrences}{menu("题 ")}<i aria-hidden="true">→</i></span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      </details>}
      {signalOutcome.rows.length > 0 && <details className="rv-index-patterns rv-index-signals"><summary>{t("日本面试信号 × 选考结果")} · {t("已评信号")} {signalOutcome.assessed} / {signalOutcome.rows.length} {t("场")} · {t("通过")} {signalOutcome.outcomeCounts.passed} · {t("不採用")} {signalOutcome.outcomeCounts.rejected} · {t("无音")} {signalOutcome.outcomeCounts.no_response}</summary>
        <SignalOutcomeTable comparison={signalOutcome} onSelect={(key) => onSelect(key)} t={signalsCopy(locale)} />
      </details>}
      <InterviewReassessmentEntry notes={notes} onOpenNote={onOpenNote} t={t} />
      <section className="rv-insights-entry"><div><h2>{t("把公司的口碑、岗位与条件放在一起看")}</h2><p>{t("对照各平台评分、岗位契合与工作条件，判断值得继续了解的机会。")}</p></div><button type="button" onClick={() => onOpenInsights()}>{t("进入公司对比 →")}</button></section>
      {scorePoints.length >= 2 && <section aria-label={menu("新版有据评分趋势")}><p>{menu("仅比较新版同口径有据评分；分数变化不直接表示能力涨跌。")}</p><ReviewScoreTrend points={scorePoints} onSelect={(key) => onSelect(key)} t={t} /></section>}
      {historicalScorePoints.length >= 2 && <details><summary>{menu("旧评分历史（不同口径，不能比较能力涨跌）")}</summary><ReviewScoreTrend points={historicalScorePoints} onSelect={(key) => onSelect(key)} t={t} /></details>}
    </div>
  );
}

const SentenceCard = memo(function SentenceCard({
  doc,
  sentence,
  mode,
  revealed,
  errored,
  rawShown,
  noting,
  busy,
  evidenceFocused,
  revealLabel,
  onReveal: revealSentence,
  onToggleErrors: toggleSentenceErrors,
  onToggleRaw: toggleSentenceRaw,
  onStartNote: startSentenceNote,
  onCancelNote,
  onSubmit: submitSentence,
}: {
  doc: ReviewDoc;
  sentence: ReviewSentence;
  mode: "study" | "compare";
  revealed: boolean;
  errored: boolean;
  rawShown: boolean;
  noting: boolean;
  busy: boolean;
  evidenceFocused: boolean;
  revealLabel: string;
  onReveal: (sentenceId: string) => void;
  onToggleErrors: (sentenceId: string) => void;
  onToggleRaw: (sentenceId: string) => void;
  onStartNote: (notingKey: string) => void;
  onCancelNote: () => void;
  onSubmit: (
    target: ReviewDoc,
    sentenceId: string,
    kind: "批注" | "裁定" | "聴解",
    text: string,
    decisionTarget?: string,
  ) => Promise<void>;
}) {
  const menu = useInterviewMenu();
  // 草稿只活在这张卡里：父级不知道正文，敲字时只有这一张卡重渲染。
  // 编辑器被关掉（取消、写入成功、换到别的句子）时一并清空，下次打开不会带着上一回的半句话。
  const [noteDraft, setNoteDraft] = useState("");
  const [wasNoting, setWasNoting] = useState(noting);
  if (noting !== wasNoting) {
    setWasNoting(noting);
    if (!noting) setNoteDraft("");
  }
  const onReveal = () => revealSentence(sentence.id);
  const onToggleErrors = () => toggleSentenceErrors(sentence.id);
  const onToggleRaw = () => toggleSentenceRaw(sentence.id);
  const onStartNote = () => startSentenceNote(`${doc.key}:${sentence.id}`);
  const onSubmit = (kind: "批注" | "裁定" | "聴解", text: string, decisionTarget?: string) =>
    void submitSentence(doc, sentence.id, kind, text, decisionTarget);
  const segments = segmentSei(sentence);
  const detailShown = mode === "compare" || revealed;
  const mark = doc.listeningMarks.get(sentence.id);
  const annotations = doc.bySentence.get(sentence.id) ?? [];
  const learnerCount = sentence.errors.filter((error) => error.kind === "学習者").length;
  const sentenceDecisionTasks = doc.decisionTasksBySentence.get(sentence.id) ?? [];
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
        {learnerCount > 0 && <span className="rv-cnt err">{menu("誤 ")}{learnerCount}</span>}
        {pendingCount > 0 && <span className="rv-cnt pending">{menu("疑 ")}{pendingCount}</span>}
        {resolvedCount > 0 && <span className="rv-cnt resolved">{menu("済 ")}{resolvedCount}</span>}
        <span className="rv-tools">
          {/* 点句子本身也能揭开，但那只是鼠标的捷径；键盘和读屏要有一个真按钮，并知道它控制的是哪一块。 */}
          {mode === "study" && (
            <button
              type="button"
              className={revealed ? "active" : ""}
              aria-expanded={revealed}
              aria-controls={`rvs-detail-${sentence.id}`}
              onClick={onReveal}
            >{revealLabel}</button>
          )}
          <button className={rawShown ? "active" : ""} onClick={onToggleRaw}>{menu("原文")}</button>
          {(sentence.errors.length > 0 || sentence.uncertainSpeaker) && (
            <button className={errored ? "active" : ""} onClick={onToggleErrors}>
              {menu("指摘 ")}{sentence.errors.length + (sentence.uncertainSpeaker ? 1 : 0)}
            </button>
          )}
          {sentence.speaker === "面" && (
            <span className="rv-listen">
              <button
                className={mark === "△" ? "active soft" : ""}
                disabled={busy}
                title={menu("当时半懂半猜")}
                onClick={() => onSubmit("聴解", "△推測で理解")}
              >△</button>
              <button
                className={mark === "×" ? "active hard" : ""}
                disabled={busy}
                title={menu("当时没听懂")}
                onClick={() => onSubmit("聴解", "×聞き取れず")}
              >×</button>
            </span>
          )}
          <button onClick={noting ? onCancelNote : onStartNote}>{menu("批注")}{annotations.length > 0 ? ` ${annotations.length}` : ""}</button>
        </span>
      </header>

      <p
        className={`rv-text ${mode === "study" && !revealed ? "tappable" : ""}`}
        lang="ja"
        onClick={mode === "study" ? onReveal : undefined}
        title={mode === "study" && !revealed ? menu("点击显示译文和注释") : undefined}
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
        <div className="rv-detail" id={`rvs-detail-${sentence.id}`}>
          {sentence.yaku && <p className="rv-yaku" lang="zh-CN">{sentence.yaku}</p>}
          {sentence.go.map((item, index) => (
            <p key={index} className="rv-go" lang="ja">{menu("語 ")}<span>{item}</span></p>
          ))}
          {sentence.notes.map((item, index) => (
            <p key={index} className="rv-note-line">{menu("注 ")}<span>{item}</span></p>
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
                    <span>{menu("裁定：")}</span>
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
                        >{menu("是转录错")}</button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            onSubmit(
                              "裁定",
                              `${error.span ? `«${error.span}»` : `誤${error.index}`}は学習者誤りで確定（実際にそう発話した）`,
                              `error:${error.index}`,
                            )
                          }
                        >{menu("我真说错了")}</button>
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
              <span className="rv-kind doubt">{menu("話者疑")}</span>
              <div>
                <p>{menu("这句话是谁说的？")}</p>
                <div className="rv-judge">
                  <span>{menu("裁定：")}</span>
                  {sentenceDecisionTasks.find((task) => task.target === "speaker")?.resolvedBy ? (
                    <em className="rv-resolved">
                      {DECISION_LABELS[
                        sentenceDecisionTasks.find((task) => task.target === "speaker")?.resolution ?? "unknown"
                      ]} · {sentenceDecisionTasks.find((task) => task.target === "speaker")?.resolvedBy}
                    </em>
                  ) : (
                    <>
                      <button disabled={busy} onClick={() => onSubmit("裁定", "話者裁定：この文は面接官の発言", "speaker")}>{menu("面试官")}</button>
                      <button disabled={busy} onClick={() => onSubmit("裁定", "話者裁定：この文は自分の発言", "speaker")}>{menu("我自己")}</button>
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
          <span>{menu("原")}</span>
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
            placeholder={menu("写给 AI 的批注：这句怎么说更好？为什么？（会追记到批注笔记，AI 统一回答）")}
            onChange={(event) => setNoteDraft(event.target.value)}
          />
          <div>
            <button
              disabled={busy || !noteDraft.trim()}
              onClick={() => onSubmit("批注", noteDraft.trim())}
            >{busy ? menu("写入中…") : menu("送信")}</button>
            <button className="quiet" onClick={onCancelNote}>{menu("取消")}</button>
          </div>
        </div>
      )}
    </article>
  );
});

// 外壳的 UI state（⌘K・overlay）变化时不重渲染整个视圖。props 都是稳定引用。
export default memo(InterviewReview);
