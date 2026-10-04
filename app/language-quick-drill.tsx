"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { QuickAnswerResult, QuickCard, QuickSelfRating } from "@/lib/language/quick-types";
import { QUICK_EMPTY } from "@/lib/language/quick-types";
import { gradeQuickCard } from "@/lib/language/quick-cards";
import {
  currentQuickEntry,
  type QuickSessionAction,
  type QuickSessionEntry,
  type QuickSessionPhase,
  type QuickSessionRecord,
  type QuickSessionState,
} from "@/lib/language/quick-session";
import { isTypingTarget } from "@/lib/keyboard";
import { formatClock } from "@/lib/training-rhythm";
import {
  QUICK_GROUP_COPY,
  QUICK_PROMPT_COPY,
  QUICK_RATING_COPY,
  QUICK_REASON_COPY,
  QUICK_TYPE_COPY,
  useQuickCopy,
  type QuickSaveStatus,
} from "./language-quick-sync";

/*
 * 快练练习屏：一题一屏，键盘优先。
 * 会话状态（首答定成败、错题隔 3 题重出、不知道、不再出）全在 lib/language/quick-session.ts 的 reducer 里，
 * 这里只负责显示、计时与把按键翻译成 reducer 动作；提交由外壳的答案队列做。
 */

// ── 键盘守卫（总览、小结共用） ─────────────────────────────────────

/**
 * 单键快捷键该不该让出去：已被别处处理、按住连发、输入法组字中、带修饰键、焦点在输入场景里，
 * 或浮层／抽屉打开（aria-modal、inert 祖先）。按住连发一律忽略，免得按住 Enter 连跳好几题。
 */
export function quickShortcutBlocked(event: KeyboardEvent) {
  if (event.defaultPrevented || event.repeat) return true;
  // keyCode 229：部分浏览器在组字的第一键 isComposing 还是 false，只能靠它认出来。
  if (event.isComposing || event.keyCode === 229) return true;
  if (event.metaKey || event.ctrlKey || event.altKey) return true;
  if (isTypingTarget(event.target)) return true;
  if (typeof document !== "undefined" && document.querySelector('[aria-modal="true"]')) return true;
  return Boolean((event.target as Element | null)?.closest?.("[inert]"));
}

/** 焦点在按钮、链接、summary 上时，Enter／Space 归原生激活（例如展开 details、点焦点所在的按钮）。 */
export function yieldsToNative(event: KeyboardEvent) {
  if (event.key !== "Enter" && event.key !== " ") return false;
  return Boolean((event.target as Element | null)?.closest?.("button, a, summary"));
}

/**
 * 焦点所在按钮的原生激活不经过全局守卫：按住 Enter 的连发会一路点下去（跳过反馈、在小结里直接开下一组）。
 * 在按钮自己的 keydown 上吞掉连发。
 */
export function swallowRepeat(event: { repeat: boolean; preventDefault: () => void }) {
  if (event.repeat) event.preventDefault();
}

/** 「下一题」在出反馈后这段时间内不响应：答题那一下的 Enter 不能顺手把反馈跳过去。 */
export const QUICK_NEXT_LOCK_MS = 250;

const CHOICE_KEYS = ["1", "2", "3", "4"] as const;
const RATING_KEYS: Record<string, QuickSelfRating> = { "1": "remembered", "2": "fuzzy", "3": "forgot" };

const isChoice = (card: QuickCard) => card.type !== "flip" && card.type !== "short_input" && card.options.length > 0;
const htmlLang = (lang: "ja" | "zh") => lang === "zh" ? "zh-CN" : "ja";
/** 识义题的选项与答案是中文，其余题型都是日语。 */
const answerLang = (card: QuickCard) => card.type === "meaning_choice" ? "zh-CN" : "ja";

// ── 小部件 ─────────────────────────────────────────────────────

/** 按 [start, end) 高亮；空区间（删除型差异）画一个窄插入记号。 */
function Marked({ text, mark }: { text: string; mark?: [number, number] }) {
  if (!mark || mark[0] < 0 || mark[1] > text.length || mark[0] > mark[1]) return <>{text}</>;
  const [start, end] = mark;
  return (
    <>
      {text.slice(0, start)}
      {start === end ? <mark className="quick-gap" aria-hidden="true" /> : <mark>{text.slice(start, end)}</mark>}
      {text.slice(end)}
    </>
  );
}

function OptionText({ value, mark }: { value: string; mark?: [number, number] }) {
  const { t } = useQuickCopy();
  if (value === QUICK_EMPTY) return <>{QUICK_EMPTY} <small>{t("不填")}</small></>;
  return <Marked text={value} mark={mark} />;
}

/** 计时单独成组件：每秒的刷新只重绘这一小块，不让整个练习屏每秒重渲染。 */
export function QuickClock({ startedAt }: { startedAt: { readonly current: number } }) {
  const { t } = useQuickCopy();
  const [elapsedMs, setElapsedMs] = useState(0);
  // 用 setInterval 而不是 CSS 动画：减弱动效会把动画压到近 0，计时不能跟着失效。
  // 子组件的 effect 先于父组件执行，起点要到下一拍才写好，所以首帧用 setTimeout 0。
  useEffect(() => {
    const update = () => {
      if (startedAt.current) setElapsedMs(Date.now() - startedAt.current);
    };
    const timer = window.setInterval(update, 1_000);
    const first = window.setTimeout(update, 0);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(first);
    };
  }, [startedAt]);
  return <strong className="quick-clock" role="timer" aria-label={t("本次用时")}>{formatClock(elapsedMs)}</strong>;
}

export function quickSaveText(status: QuickSaveStatus, t: ReturnType<typeof useQuickCopy>["t"]) {
  const parts: string[] = [];
  if (status.saving) parts.push(t("保存中"));
  else if (status.failed) parts.push(t("保存失败，稍后重试"));
  if (status.pending && !status.saving) parts.push(t("{count} 题待保存", { count: status.pending }));
  if (status.rejected) parts.push(t("{count} 题未能保存", { count: status.rejected }));
  return parts.length ? parts.join(" · ") : t("已保存");
}

// ── 卡片 ───────────────────────────────────────────────────────

export type QuickCardViewProps = {
  entry: QuickSessionEntry;
  phase: QuickSessionPhase;
  revealed: boolean;
  /** 本卡这一轮的作答（出反馈后才有）。 */
  record?: QuickSessionRecord;
  /** 服务端应答里的判分；和本地不一致时以它为准。 */
  serverPassed?: boolean;
  cardRef?: RefObject<HTMLElement | null>;
  inputRef?: RefObject<HTMLInputElement | null>;
  nextRef?: RefObject<HTMLButtonElement | null>;
  onChoose: (option: string) => void;
  onSubmit: (text: string) => void;
  onReveal: () => void;
  onRate: (rating: QuickSelfRating) => void;
  onGiveUp: () => void;
  onSuspend: () => void;
  onNext: () => void;
  onEnd: () => void;
};

export function QuickCardView({
  entry,
  phase,
  revealed,
  record,
  serverPassed,
  cardRef,
  inputRef,
  nextRef,
  onChoose,
  onSubmit,
  onReveal,
  onRate,
  onGiveUp,
  onSuspend,
  onNext,
  onEnd,
}: QuickCardViewProps) {
  const { card } = entry;
  const { t, pick } = useQuickCopy();
  const answered = phase === "feedback" && Boolean(record);
  const passed = serverPassed ?? record?.passed;
  const longStem = card.stem.length > 20;

  return (
    <article
      ref={cardRef as RefObject<HTMLElement>}
      className={`quick-card type-${card.type}${answered ? " is-answered" : ""}`}
      tabIndex={-1}
      aria-labelledby={`quick-stem-${entry.key}`}
    >
      <header className="quick-card-meta">
        <span className="quick-type">{pick(QUICK_TYPE_COPY[card.type])}</span>
        <span>{pick(QUICK_GROUP_COPY[card.group])}</span>
        <em>{entry.round === 1 ? t("重出") : pick(QUICK_REASON_COPY[card.reason])}</em>
      </header>

      <p className="quick-prompt">{pick(QUICK_PROMPT_COPY[card.prompt])}</p>
      <p id={`quick-stem-${entry.key}`} className={`quick-stem${longStem ? " is-long" : ""}`} lang={htmlLang(card.stemLang)}>
        <Marked text={card.stem} mark={card.mark} />
      </p>

      {isChoice(card) && (
        <div className={`quick-options${card.options.length === 2 ? " is-binary" : ""}`} role="group" aria-label={t("选择")}>
          {card.options.map((option, index) => {
            const correct = answered && gradeQuickCard(card, { response: option }).passed === true;
            const chosen = answered && record?.response === option;
            const tone = !answered ? "" : correct ? " is-correct" : chosen ? " is-wrong" : " is-dim";
            return (
              <button
                key={`${index}:${option}`}
                type="button"
                className={`quick-option${tone}`}
                aria-disabled={answered || undefined}
                aria-keyshortcuts={CHOICE_KEYS[index]}
                onClick={() => { if (!answered) onChoose(option); }}
              >
                <kbd aria-hidden="true">{index + 1}</kbd>
                <span lang={answerLang(card)}><OptionText value={option} mark={card.optionMarks?.[index]} /></span>
              </button>
            );
          })}
        </div>
      )}

      {card.type === "short_input" && (
        <QuickInput
          key={entry.key}
          answered={answered}
          response={record?.response ?? ""}
          inputRef={inputRef}
          onSubmit={onSubmit}
          onEnd={onEnd}
        />
      )}

      {card.type === "flip" && (
        // 未揭晓时背面不进 DOM：先回想再看，读屏和「查看源代码」都看不到答案。
        revealed ? (
          <div className="quick-flip-back">
            <p className="quick-flip-answer" lang="ja">{card.reveal.ja || card.answer}</p>
            {card.reveal.reading && <p className="quick-flip-reading" lang="ja">{card.reveal.reading}</p>}
            {card.reveal.meaning && <p className="quick-flip-meaning">{card.reveal.meaning}</p>}
            {phase === "question" && (
              <div className="quick-rate" role="group" aria-label={t("自评")}>
                {(["remembered", "fuzzy", "forgot"] as const).map((rating, index) => (
                  <button key={rating} type="button" className={`quick-rate-${rating}`} aria-keyshortcuts={String(index + 1)} onClick={() => onRate(rating)}>
                    <kbd aria-hidden="true">{index + 1}</kbd>{pick(QUICK_RATING_COPY[rating])}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <button type="button" className="quick-reveal" aria-keyshortcuts="Space" onClick={onReveal}>
            {t("揭晓")}<kbd aria-hidden="true">Space</kbd>
          </button>
        )
      )}

      <footer className="quick-card-actions">
        {phase === "question" ? (
          <button type="button" className="quick-quiet" aria-keyshortcuts="Shift+?" onClick={onGiveUp}>
            <kbd aria-hidden="true">?</kbd>{t("不知道")}
          </button>
        ) : <span />}
        <button type="button" className="quick-quiet" aria-keyshortcuts="X" onClick={onSuspend}>
          <kbd aria-hidden="true">X</kbd>{t("这题有问题")}
        </button>
        {answered && (
          <button
            ref={nextRef}
            type="button"
            className="quick-next"
            aria-keyshortcuts="Enter Space ArrowRight"
            onKeyDown={swallowRepeat}
            onClick={onNext}
          >
            {t("下一题")}<kbd aria-hidden="true">Enter</kbd>
          </button>
        )}
      </footer>

      {/* 反馈区始终占位：答前显示淡色提示，答后版面不跳。 */}
      <div className={`quick-feedback${answered ? " is-shown" : ""}`} role="status" aria-live="polite">
        {answered && record ? (
          <QuickFeedback card={card} record={record} passed={passed} serverPassed={serverPassed} />
        ) : (
          <p className="quick-feedback-hint">{t("反馈占位")}</p>
        )}
      </div>
    </article>
  );
}

function QuickInput({
  answered,
  response,
  inputRef,
  onSubmit,
  onEnd,
}: {
  answered: boolean;
  response: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  onSubmit: (text: string) => void;
  onEnd: () => void;
}) {
  const { t } = useQuickCopy();
  const [text, setText] = useState("");
  const submit = () => {
    if (!answered && text.trim()) onSubmit(text);
  };
  // 不用 <form>：单个文本框的表单会被浏览器隐式提交，Safari 上输入法确认候选的 Enter 也可能触发。
  return (
    <div className="quick-input">
      <input
        ref={inputRef}
        lang="ja"
        type="text"
        autoComplete="off"
        spellCheck={false}
        maxLength={16}
        readOnly={answered}
        value={answered ? response : text}
        aria-label={t("你的回答")}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          // 输入框是输入场景，全局快捷键都让出来了，Enter / Esc 在这里自己处理；组字中一律不处理。
          if (event.nativeEvent.isComposing || event.keyCode === 229 || event.repeat) return;
          if (event.key === "Enter") {
            event.preventDefault();
            submit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            onEnd();
          }
        }}
      />
      <button type="button" disabled={answered || !text.trim()} onClick={submit}>{t("确定")}</button>
      <small>{t("输入提示")}</small>
    </div>
  );
}

function QuickFeedback({
  card,
  record,
  passed,
  serverPassed,
}: {
  card: QuickCard;
  record: QuickSessionRecord;
  passed?: boolean;
  serverPassed?: boolean;
}) {
  const { t, pick } = useQuickCopy();
  const flip = card.type === "flip";
  const verdict = record.gaveUp
    ? { tone: "fail", glyph: "?", text: `${t("不知道")} · ${t("已显示答案")}` }
    : record.rating
      // 自评不画 ✓/×：它不是对错，只决定复习间隔。
      ? { tone: "self", glyph: "", text: t("自评：{rating}", { rating: pick(QUICK_RATING_COPY[record.rating]) }) }
      : passed
        ? { tone: "pass", glyph: "✓", text: t("答对了") }
        : { tone: "fail", glyph: "×", text: t("这次没对") };
  const disagree = serverPassed !== undefined && record.passed !== undefined && serverPassed !== record.passed;
  const { reveal } = card;
  // 题面、答案、释义常有重合：已经出现在屏幕上的不再重复一遍。
  const shown = new Set([card.stem, card.answer]);
  const extraJa = !flip && reveal.ja && !shown.has(reveal.ja) ? reveal.ja : "";
  const extraMeaning = !flip && reveal.meaning && !shown.has(reveal.meaning) ? reveal.meaning : "";
  const evidence = reveal.evidence.slice(0, 2);

  return (
    <>
      <p className={`quick-verdict is-${verdict.tone}`}>
        {verdict.glyph && <b aria-hidden="true">{verdict.glyph}</b>}
        <strong>{verdict.text}</strong>
      </p>
      {disagree && <p className="quick-server-note">{serverPassed ? t("服务端判为正确") : t("服务端判为错误")}</p>}
      <dl className="quick-reveal-facts">
        {!flip && (
          <div><dt>{t("正确答案")}</dt><dd lang={answerLang(card)}>{card.answer === QUICK_EMPTY ? `${QUICK_EMPTY} ${t("不填")}` : card.answer}</dd></div>
        )}
        {!flip && record.response && passed === false && (
          <div><dt>{t("你的回答")}</dt><dd lang={answerLang(card)}>{record.response}</dd></div>
        )}
        {reveal.wrong && (
          <div><dt>{t("你当时说")}</dt><dd lang="ja"><s>{reveal.wrong}</s> → {reveal.ja || card.answer}</dd></div>
        )}
        {extraJa && !reveal.wrong && <div><dt>{t("日语")}</dt><dd lang="ja">{extraJa}</dd></div>}
        {!flip && reveal.reading && <div><dt>{t("读音")}</dt><dd lang="ja">{reveal.reading}</dd></div>}
      </dl>
      {extraMeaning && <p className="quick-meaning">{extraMeaning}</p>}
      {reveal.explain && <p className="quick-explain">{reveal.explain}</p>}
      {evidence.length > 0 && (
        <ul className="quick-evidence" aria-label={t("出处")}>
          {evidence.map((entry) => (
            <li key={`${entry.path}:${entry.sentenceId ?? entry.label}`}>
              <span>{entry.label}</span>
              {entry.excerpt && <q lang="ja">{entry.excerpt}</q>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ── 右栏 ───────────────────────────────────────────────────────

function dotTone(record: QuickSessionRecord | undefined) {
  if (!record) return "";
  if (record.action === "suspend") return "is-skip";
  if (record.rating) return record.rating === "remembered" ? "is-self" : "is-self-miss";
  return record.passed ? "is-pass" : "is-fail";
}

function QuickRail({ session }: { session: QuickSessionState }) {
  const { t } = useQuickCopy();
  const byKey = new Map(session.records.map((record) => [record.key, record]));
  const firsts = session.records.filter((record) => record.round === 0 && record.action === "answer" && record.grading === "auto");
  const pass = firsts.filter((record) => record.passed).length;
  return (
    <aside className="quick-rail" aria-label={t("本组进度")}>
      <ol className="quick-dots">
        {session.queue.map((entry, index) => {
          const current = index === session.cursor && session.phase !== "ended";
          return (
            <li
              key={entry.key}
              className={[dotTone(byKey.get(entry.key)), current ? "is-current" : "", entry.round === 1 ? "is-retry" : ""].filter(Boolean).join(" ")}
              title={t("第 {index} 题", { index: index + 1 })}
            />
          );
        })}
      </ol>
      <p className="quick-rail-count">{t("答对 {pass} · 答错 {fail}", { pass, fail: firsts.length - pass })}</p>
      <dl className="quick-keys">
        <div><dt><kbd>1</kbd>–<kbd>4</kbd></dt><dd>{t("选择")}</dd></div>
        <div><dt><kbd>Space</kbd></dt><dd>{t("揭晓")}</dd></div>
        <div><dt><kbd>Enter</kbd></dt><dd>{t("下一题")}</dd></div>
        <div><dt><kbd>?</kbd></dt><dd>{t("不知道")}</dd></div>
        <div><dt><kbd>X</kbd></dt><dd>{t("这题有问题")}</dd></div>
        <div><dt><kbd>Esc</kbd></dt><dd>{t("结束本组")}</dd></div>
      </dl>
    </aside>
  );
}

// ── 练习屏 ─────────────────────────────────────────────────────

export function QuickDrill({
  session,
  saveStatus,
  results,
  onAction,
}: {
  session: QuickSessionState;
  saveStatus: QuickSaveStatus;
  results: ReadonlyMap<string, QuickAnswerResult>;
  onAction: (action: QuickSessionAction) => void;
}) {
  const { t } = useQuickCopy();
  const entry = currentQuickEntry(session);
  const record = entry && session.phase === "feedback"
    ? session.records.findLast((candidate) => candidate.key === entry.key)
    : undefined;
  const result = record ? results.get(record.input.eventId) : undefined;
  const serverPassed = result && result.status !== "stale" ? result.passed : undefined;

  const cardRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const nextRef = useRef<HTMLButtonElement | null>(null);
  const startedAt = useRef(0);
  const shownAt = useRef(0);
  const answeredAt = useRef(0);

  useEffect(() => {
    startedAt.current = Date.now();
  }, [session.setId]);

  // 换题：选择题把焦点放到卡片容器（Enter/Space 才会到这里的处理，而不是被上一题的按钮吃掉），输入题放到输入框。
  const entryKey = entry?.key;
  const entryType = entry?.card.type;
  useEffect(() => {
    if (!entryKey) return;
    shownAt.current = Date.now();
    if (entryType === "short_input") inputRef.current?.focus({ preventScroll: true });
    else cardRef.current?.focus({ preventScroll: true });
  }, [entryKey, entryType]);

  // 出反馈：焦点移到「下一题」，鼠标点过的选项按钮不再挡住 Enter。
  useEffect(() => {
    if (session.phase !== "feedback") return;
    answeredAt.current = Date.now();
    nextRef.current?.focus({ preventScroll: true });
  }, [session.phase, entryKey]);

  const elapsed = () => (shownAt.current ? Date.now() - shownAt.current : undefined);
  const actions = {
    choose: (option: string) => onAction({ type: "answer", response: option, elapsedMs: elapsed() }),
    submit: (text: string) => onAction({ type: "answer", response: text, elapsedMs: elapsed() }),
    reveal: () => onAction({ type: "reveal" }),
    rate: (rating: QuickSelfRating) => onAction({ type: "answer", rating, elapsedMs: elapsed() }),
    giveUp: () => onAction({ type: "gaveUp", elapsedMs: elapsed() }),
    suspend: () => onAction({ type: "suspend", elapsedMs: elapsed() }),
    next: () => {
      if (Date.now() - answeredAt.current < QUICK_NEXT_LOCK_MS) return;
      onAction({ type: "next" });
    },
    end: () => onAction({ type: "end" }),
  };

  // 监听只绑一次，处理函数每次渲染更新到 ref 里：不必随每一题解绑重绑。
  const handlerRef = useRef<(event: KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    handlerRef.current = (event: KeyboardEvent) => {
      if (quickShortcutBlocked(event) || !entry) return;
      const { key } = event;
      if (key === "Escape") {
        event.preventDefault();
        actions.end();
        return;
      }
      if (yieldsToNative(event)) return;
      const letter = key.length === 1 ? key.toLowerCase() : "";
      if (letter === "x" && !event.shiftKey) {
        event.preventDefault();
        actions.suspend();
        return;
      }
      if (session.phase === "feedback") {
        if (key === "Enter" || key === " " || key === "ArrowRight") {
          event.preventDefault();
          actions.next();
        }
        return;
      }
      const { card } = entry;
      if (key === "?") {
        event.preventDefault();
        actions.giveUp();
        return;
      }
      if (event.shiftKey) return;
      if (card.type === "flip") {
        if (!session.revealed && key === " ") {
          event.preventDefault();
          actions.reveal();
        } else if (session.revealed && RATING_KEYS[key]) {
          event.preventDefault();
          actions.rate(RATING_KEYS[key]);
        }
        return;
      }
      if (isChoice(card)) {
        const index = CHOICE_KEYS.indexOf(key as (typeof CHOICE_KEYS)[number]);
        if (index >= 0 && index < card.options.length) {
          event.preventDefault();
          actions.choose(card.options[index]);
        }
      }
    };
  });
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => handlerRef.current(event);
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);

  const total = session.queue.length;
  const done = Math.min(total, session.cursor + (session.phase === "feedback" ? 1 : 0));
  const position = Math.min(total, session.cursor + 1);

  return (
    <section className="quick-drill" aria-label={t("快练")}>
      <header className="quick-topbar">
        <div className="quick-topbar-title">
          <span aria-hidden="true">語</span>
          <div><strong>{t("快练")}</strong><small aria-live="polite">{quickSaveText(saveStatus, t)}</small></div>
        </div>
        <div className="quick-progress">
          <span className="quick-progress-count"><b>{position}</b> / {total}</span>
          <span
            className="quick-progress-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={done}
            aria-label={t("本组进度")}
          >
            <i style={{ transform: `scaleX(${total ? done / total : 0})` }} />
          </span>
        </div>
        <QuickClock startedAt={startedAt} />
        <button type="button" className="quick-end" aria-keyshortcuts="Escape" onClick={actions.end}>
          {t("结束本组")}<kbd aria-hidden="true">Esc</kbd>
        </button>
      </header>
      <div className="quick-stage">
        {entry ? (
          <QuickCardView
            entry={entry}
            phase={session.phase}
            revealed={session.revealed}
            record={record}
            serverPassed={serverPassed}
            cardRef={cardRef}
            inputRef={inputRef}
            nextRef={nextRef}
            onChoose={actions.choose}
            onSubmit={actions.submit}
            onReveal={actions.reveal}
            onRate={actions.rate}
            onGiveUp={actions.giveUp}
            onSuspend={actions.suspend}
            onNext={actions.next}
            onEnd={actions.end}
          />
        ) : <div className="quick-card" />}
        <QuickRail session={session} />
      </div>
    </section>
  );
}

