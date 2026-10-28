"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./feedback-tour.css";

export type TeacherTourMode = "library" | "reader" | "feedback";
type TourLocale = "ja" | "zh-CN";
type TourStepCopy = { target: string; title: [string, string]; text: [string, string] };
type TourStep = TourStepCopy & { fallback?: TourStepCopy };
type TourRect = { left: number; top: number; width: number; height: number };
type TourViewport = { width: number; height: number };
type TourPlacement = { left: number; top: number; side: "top" | "bottom" | "left" | "right" | "center" };

export const TEACHER_TOUR_STORAGE_KEY = "teacher-tour:seen:v3";
export const TEACHER_TOUR_STEPS: Record<TeacherTourMode, TourStep[]> = {
  library: [
    { target: '[data-tour="reading-choice"]', title: ["読み始める入口を選ぶ", "先选一种阅读入口"], text: ["最近の面接、最終面接、ほかの面接の例を、入口ごとに少しずつご紹介します。気になる入口を選び、その下の原稿を一つ開いてみてください。", "从最近的面试、终面或其他面试例子中选一组，每次只展示少量原稿。选好入口后，打开下面的一份原稿即可。"] },
    { target: '[data-tour="reading-preview"]', title: ["このやりとりから読む", "从这段交流开始"], text: ["原文の質問を一部表示しています。気になる項目を押すと、原稿のその部分へ移動できます。", "这里展示原文中的问题摘录，点击即可进入对应的那一段。"], fallback: {
      target: '[data-tour="start-reading"]', title: ["原稿を開いて、コメント", "打开原文并留言"], text: ["このボタンから原稿を開けます。会話の横にある「この部分にコメント」から、ご意見やご質問を送れます。", "从这个按钮打开原文，再点对话旁的“评论这段”即可留下建议或问题。"],
    } },
    { target: '[data-tour="all-materials"]', title: ["ほかの面接も、ここから", "从这里查看完整资料"], text: ["もっと見たいときは、一覧を開けます。企業や日付を見ながら、ご自身のペースで選べます。", "想看其他场次时，从这里打开完整列表，再根据公司、日期等选择。"] },
    { target: '[data-tour="feedback-entry"]', title: ["コメントと返事を確認", "集中查看留言与回复"], text: ["送ったコメントや本人からの返事を、ここから確認できます。操作に迷ったら、隣の「使い方」でこの案内を開けます。", "从这里查看留言和回复。需要帮助时，点旁边的“使用方法”可重新打开引导。"] },
  ],
  reader: [
    { target: '[data-tour="paragraph-comment"]', title: ["気になる部分に、一言", "直接点评这一段"], text: ["このボタンを押すと、横にコメント欄が開きます。原文は自動で添えられるので、場所の説明は不要です。", "点击就会在旁边打开评论框，并自动附上原文，不用另行描述位置。"] },
    { target: '[data-feedback-text]', title: ["一文だけ選ぶことも", "也可以只选一句话"], text: ["一文を取り上げたいときは、文章をドラッグして選びます。表示されるボタンから、その言葉にコメントできます。", "想具体点评一句话时，可以拖动选择文字，再点击出现的评论按钮。"] },
    { target: '[data-tour="feedback-entry"]', title: ["やりとりを、まとめて確認", "集中查看交流和回复"], text: ["あとから続きを話したいときは、ここから。コメントの中の「原文を見る」で、同じ文章に戻れます。", "以后想继续讨论时从这里进入，也能通过“查看原文”回到同一句话。"] },
    { target: '[data-tour="help-entry"]', title: ["困ったときは、ここへ", "需要帮助时点这里"], text: ["この案内は何度でも開けます。短いご意見も、ご質問も、どうぞ気軽にお寄せください。", "可以随时重新打开引导。一句建议或一个问题，都欢迎留下。"] },
  ],
  feedback: [
    { target: '[data-tour="read-materials"]', title: ["資料は、そのまま読めます", "可以先直接阅读资料"], text: ["資料を読むだけなら、アクセスコードは不要です。原稿を読みながら、気になった部分にコメントできます。", "阅读资料不需要访问码。打开原文后，可以直接针对具体内容发表评论。"] },
    { target: '[data-tour="new-question"], [data-tour="feedback-login"], .feedback-login', title: ["相談は、ここから", "从这里开始交流"], text: ["気になることを相談できます。初めてコメントするときは、お名前と共有されたアクセスコードを入力します。", "可以在这里发起咨询。首次交流时，填写姓名与收到的共用访问码即可。"] },
    { target: '[data-tour="discussion-list"]', title: ["気になる相談を選ぶ", "选择想看的话题"], text: ["相談が新しい順に並びます。新しい返事があるものや、特定の資料だけに絞ることもできます。", "话题按最近交流排序，也可以只查看未读回复或某份资料的讨论。"] },
    { target: '[data-tour="discussion-detail"]', title: ["原文と、返事を一緒に", "原文和讨论放在一起"], text: ["引用された文章と、その下のやりとりを一緒に確認できます。続きは同じ場所に返信してください。", "这里保留引用原文及对应讨论，可以在同一话题下继续回复。"] },
    { target: '[data-tour="help-entry"]', title: ["いつでも、もう一度", "随时重新查看引导"], text: ["この「使い方」から、いつでも案内を開けます。ご自身のペースでお使いください。", "随时可以从这里再次打开引导，按照自己的节奏使用即可。"] },
  ],
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));

// 大型列表只聚焦可见的开头，避免一个镂空把整页都照亮。
export function teacherTourSpotlight(rect: TourRect, viewport: TourViewport): TourRect {
  const left = clamp(rect.left - 8, 12, viewport.width - 76);
  const top = clamp(rect.top - 8, 12, viewport.height - 76);
  return { left, top, width: Math.min(Math.max(rect.width + 16, 64), viewport.width - left - 12), height: Math.min(Math.max(rect.height + 16, 52), 244, viewport.height - top - 12) };
}

export function teacherTourPlacement(rect: TourRect | null, viewport: TourViewport, card: { width: number; height: number }): TourPlacement {
  const gap = 22, edge = 24;
  const center = { left: Math.round((viewport.width - card.width) / 2), top: Math.round((viewport.height - card.height) / 2), side: "center" as const };
  if (!rect) return center;
  const centeredY = clamp(rect.top + rect.height / 2 - card.height / 2, edge, viewport.height - card.height - edge);
  const centeredX = clamp(rect.left + rect.width / 2 - card.width / 2, edge, viewport.width - card.width - edge);
  if (viewport.width - rect.left - rect.width - gap >= card.width + edge) return { left: rect.left + rect.width + gap, top: centeredY, side: "right" };
  if (rect.left - gap >= card.width + edge) return { left: rect.left - gap - card.width, top: centeredY, side: "left" };
  if (viewport.height - rect.top - rect.height - gap >= card.height + edge) return { left: centeredX, top: rect.top + rect.height + gap, side: "bottom" };
  if (rect.top - gap >= card.height + edge) return { left: centeredX, top: rect.top - gap - card.height, side: "top" };
  return { left: viewport.width - card.width - edge, top: viewport.height - card.height - edge, side: "center" };
}

// 浮层高度取实际测量值；宽入口居中时没有足够的上下空间，要把入口移向阅读区顶部。
export function teacherTourNeedsStartScroll(rect: TourRect, viewport: TourViewport, card: { width: number; height: number }): boolean {
  if (teacherTourPlacement(rect, viewport, card).side !== "center") return false;
  // 不可滚动的固定入口或过矮窗口也可能无法腾出空间；只为可容纳的组合尝试一次定位。
  return rect.height + card.height + 22 + 48 <= viewport.height;
}

function findTarget(selector: string): HTMLElement | null {
  return [...document.querySelectorAll<HTMLElement>(selector)].find(element => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && !element.hidden;
  }) ?? null;
}

// 没有原文摘录时改为介绍真实的阅读按钮，避免说明一个当前不存在的功能入口。
export function teacherTourStepVariant(step: TourStep, hasTarget: (selector: string) => boolean): TourStepCopy | null {
  if (hasTarget(step.target)) return step;
  if (step.fallback && hasTarget(step.fallback.target)) return step.fallback;
  return null;
}

function findStepTarget(step: TourStep) {
  const copy = teacherTourStepVariant(step, selector => Boolean(findTarget(selector)));
  return copy ? { copy, target: findTarget(copy.target)! } : null;
}

export function TeacherTour({ mode = "library", active = true, locale = "ja", onClose }: { mode?: TeacherTourMode; active?: boolean; locale?: TourLocale; onClose?: () => void }) {
  const steps = useMemo(() => TEACHER_TOUR_STEPS[mode], [mode]);
  const [mounted, setMounted] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [stage, setStage] = useState(-1);
  const [available, setAvailable] = useState<number[]>([]);
  const [geometry, setGeometry] = useState<{ stage: number; rect: TourRect } | null>(null);
  const [viewport, setViewport] = useState({ width: 1280, height: 900 });
  const [cardSize, setCardSize] = useState({ width: 376, height: 300 });
  const card = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const t = (ja: string, zh: string) => locale === "ja" ? ja : zh;
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    let current = true;
    queueMicrotask(() => { if (current) setMounted(true); });
    return () => { current = false; };
  }, []);
  const finish = useCallback((useNow = false) => {
    try { localStorage.setItem(TEACHER_TOUR_STORAGE_KEY, "1"); } catch { /* 浏览器不允许存储时仍可结束引导。 */ }
    setDismissed(true); onCloseRef.current?.();
    if (useNow) requestAnimationFrame(() => {
      const target = mode === "library" ? findTarget('[data-tour="start-reading"]') ?? findTarget('[data-tour="open-transcript"]')
        : findTarget(mode === "reader" ? '[data-tour="paragraph-comment"]' : '[data-tour="new-question"], .feedback-login input');
      target?.scrollIntoView({ block: "center", inline: "center", behavior: "instant" }); target?.focus({ preventScroll: true });
    });
  }, [mode]);
  const visible = active && mounted && !dismissed;
  useEffect(() => {
    if (!visible) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    const siblings = [...document.body.children].filter((element): element is HTMLElement => element instanceof HTMLElement && !element.classList.contains("teacher-tour"));
    const inert = siblings.map(element => ({ element, before: element.inert }));
    inert.forEach(({ element }) => { element.inert = true; });
    document.body.style.overflow = "hidden";
    card.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish(); }
      if (event.key === "Tab") {
        const controls = [...(card.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex="0"]') ?? [])];
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && (document.activeElement === first || !card.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !card.current?.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", keyboard, true);
    return () => { window.removeEventListener("keydown", keyboard, true); document.body.style.overflow = overflow; inert.forEach(({ element, before }) => { element.inert = before; }); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [visible, finish]);
  useEffect(() => {
    if (!visible) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = { width: window.innerWidth, height: window.innerHeight };
        setViewport(old => old.width === next.width && old.height === next.height ? old : next);
        if (stage >= 0 && stage < steps.length) {
          const target = findStepTarget(steps[stage])?.target;
          if (target) { const rect = teacherTourSpotlight(target.getBoundingClientRect(), next); setGeometry({ stage, rect }); }
        }
        const size = card.current?.getBoundingClientRect();
        if (size) setCardSize(old => old.width === size.width && old.height === size.height ? old : { width: size.width, height: size.height });
      });
    };
    const target = stage >= 0 && stage < steps.length ? findStepTarget(steps[stage])?.target : null;
    if (target) {
      const rect = target.getBoundingClientRect();
      const nextViewport = { width: window.innerWidth, height: window.innerHeight };
      const needsRoom = teacherTourNeedsStartScroll(teacherTourSpotlight(rect, nextViewport), nextViewport, cardSize);
      if (needsRoom || rect.top < 100 || rect.bottom > window.innerHeight - 30 || rect.left < 12 || rect.right > window.innerWidth - 12) target.scrollIntoView({ block: needsRoom || rect.height > 244 ? "start" : "center", inline: "center", behavior: "instant" });
    }
    measure();
    const observer = new ResizeObserver(measure);
    if (target) observer.observe(target);
    if (card.current) observer.observe(card.current);
    window.addEventListener("resize", measure); window.addEventListener("scroll", measure, true);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [visible, stage, steps, cardSize, viewport.width, viewport.height]);
  if (!visible) return null;

  const begin = () => {
    const indices = steps.flatMap((step, index) => findStepTarget(step) ? [index] : []);
    setAvailable(indices); setStage(indices[0] ?? steps.length);
  };
  const index = available.indexOf(stage);
  const welcome = stage < 0;
  const complete = stage >= steps.length;
  const activeStep = !welcome && !complete ? findStepTarget(steps[stage]) : null;
  const step = activeStep?.copy ?? steps[stage];
  const rect = activeStep && geometry?.stage === stage ? geometry.rect : null;
  const position = teacherTourPlacement(rect, viewport, cardSize);
  const next = () => {
    const remaining = available.slice(index + 1).filter(candidate => findStepTarget(steps[candidate]));
    if (!remaining.length) { try { localStorage.setItem(TEACHER_TOUR_STORAGE_KEY, "1"); } catch { /* 完成状态不依赖存储是否可用。 */ } }
    setStage(remaining[0] ?? steps.length);
  };
  const back = () => setStage(index > 0 ? available[index - 1] : -1);
  const arrow = rect ? { "--tour-arrow-x": `${clamp(rect.left + rect.width / 2 - position.left, 28, cardSize.width - 28)}px`, "--tour-arrow-y": `${clamp(rect.top + rect.height / 2 - position.top, 28, cardSize.height - 28)}px` } : {};
  return createPortal(<div className={`teacher-tour${welcome || complete || !rect ? " teacher-tour-centered" : ""}`}>
    <div className="teacher-tour-shade" aria-hidden="true" />
    {rect && <div className="teacher-tour-spotlight" aria-hidden="true" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} />}
    <section className="teacher-tour-card" ref={card} role="dialog" aria-modal="true" aria-labelledby="teacher-tour-title" aria-describedby="teacher-tour-description" data-placement={position.side} style={{ left: position.left, top: position.top, ...arrow }}>
      <header className="teacher-tour-top"><span>{t("使い方ガイド", "使用引导")}</span><button type="button" aria-label={t("案内を閉じる", "关闭引导")} onClick={() => finish()}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg></button></header>
      {(welcome || complete) && <div className={`teacher-tour-illustration${complete ? " is-complete" : ""}`} aria-hidden="true"><svg viewBox="0 0 72 72" fill="none"><rect x="12" y="15" width="39" height="29" rx="9" stroke="currentColor" strokeWidth="2.5" /><path d="m22 43-5 9 15-9M24 27h16M24 34h10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /><rect x="34" y="32" width="25" height="21" rx="7" fill="currentColor" opacity=".16" /><path d="m44 42 4 4 7-8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg><i /><b /></div>}
      {!welcome && !complete && <div className="teacher-tour-progress" aria-label={`${index + 1} / ${available.length}`}><div>{available.map((item, number) => <span key={item} className={number <= index ? "is-active" : ""} />)}</div><span>{index + 1} / {available.length}</span></div>}
      <h2 id="teacher-tour-title">{welcome ? t("読む、その場で伝える。", "看到哪里，就聊到哪里。") : complete ? t("気軽に、一言から。", "从一句建议开始。") : t(...step.title)}</h2>
      <p id="teacher-tour-description">{welcome ? mode === "library" ? t("最初に読む原稿の選び方と、コメントの送り方を、画面に沿ってご案内します。", "跟随页面重点，了解怎样从少量入口选择原文、查看介绍并留下评论。") : t("資料の読み方とコメントの送り方を、画面を見ながらご案内します。", "跟随页面上的重点，了解怎样阅读资料、留下评论和查看回复。") : complete ? t("気になる部分からコメントすると、原文も一緒に届きます。ご質問も、短いご意見も歓迎です。", "从原文旁发起评论，就会自动附上那段内容。一句建议或一个问题都可以。") : t(...step.text)}</p>
      <footer className="teacher-tour-actions"><button type="button" className="teacher-tour-secondary" onClick={welcome || complete ? () => finish() : back}>{welcome ? t("あとで", "以后再看") : complete ? t("閉じる", "关闭") : t("戻る", "上一步")}</button><button type="button" className="teacher-tour-primary" onClick={welcome ? begin : complete ? () => finish(true) : next}>{welcome ? t("案内をはじめる", "开始引导") : complete ? t(mode === "library" ? "原稿を選ぶ" : mode === "reader" ? "コメントしてみる" : "相談をはじめる", "开始使用") : index === available.length - 1 ? t("終了", "完成") : t("次へ", "下一步")}<span aria-hidden="true">→</span></button></footer>
      {!welcome && !complete && <button type="button" className="teacher-tour-skip" onClick={() => finish()}>{t("案内をスキップ", "跳过引导")}</button>}
    </section>
  </div>, document.body);
}
