"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { PREP_V2_SECTIONS, getPrepV2Section, prepInlineText, type InterviewPrepDoc, type PrepExternalLink } from "@/lib/interview-prep-doc";
import { prepSourceHost, prepV2BlockLinks, prepV2Overview } from "@/lib/interview-prep-v2";
import { selectRelevantInterviewPrepDoc, type InterviewPrepSeries } from "@/lib/interview-prep-index";
import { companyMotivationAssetTarget, type SharedAssetTarget } from "@/lib/interview-shared-assets";
import type { Note } from "@/lib/notes";
import { Blocks } from "./prep-doc-render";
import { copySelectionWithoutRuby } from "./ruby-copy";
import PrepMaterialReader from "./prep-material-reader";
import { OPEN_NOTE_LABEL } from "@/lib/ui-labels";
import { menuLabel } from "@/lib/ui-menu-labels";
import { useUiLocale } from "./ui-locale";

type SectionId = typeof PREP_V2_SECTIONS[number]["id"] | "company";

// 这一轮新加的文案；共用菜单词表（lib/ui-menu-labels）照旧兜底。
const V2_COPY_JA: Record<string, string> = {
  "临场卡": "当日カード",
  "只看要说的话 ↗": "話す言葉だけ ↗",
  "今天": "今日",
  "明天": "明日",
  "{n} 天后": "{n}日後",
  "{n} 天前": "{n}日前",
};

/**
 * 页头倒计时。两边都是 `YYYY-MM-DD` 的日本日期，按 UTC 算整天差：
 * 不能用本机时区的 Date 去解析，否则海外时区会把「明天」算成「今天」。
 */
function prepCountdown(date: string, today: string): { days: number; tone: "hot" | "near" | "later" | "past" } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return { days, tone: days < 0 ? "past" : days <= 1 ? "hot" : days <= 3 ? "near" : "later" };
}

/**
 * 滑动指示条：量出 host 里当前选中项的位置，直接写到自己的 style 上（不走 state，免得每次切换多渲染一轮）。
 * 第一次落位不播过渡——否则一进页面就看到它从左上角飞过来；落位后的下一帧才给 host 打上 ready。
 */
function SlidingIndicator({ selector, watch, className }: { selector: string; watch: unknown; className: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const indicator = ref.current;
    const host = indicator?.parentElement;
    if (!indicator || !host) return;
    const place = () => {
      const target = host.querySelector<HTMLElement>(selector);
      if (!target) {
        indicator.style.opacity = "0";
        return;
      }
      indicator.style.opacity = "1";
      indicator.style.width = `${target.offsetWidth}px`;
      indicator.style.height = `${target.offsetHeight}px`;
      indicator.style.transform = `translate(${target.offsetLeft}px, ${target.offsetTop}px)`;
    };
    place();
    const frame = window.requestAnimationFrame(() => { host.dataset.indicator = "ready"; });
    const observer = new ResizeObserver(place);
    observer.observe(host);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [selector, watch]);
  return <span ref={ref} className={className} aria-hidden="true" />;
}

/** `YYYY-MM-DD` の翌日（UTC 計算で十分：日付文字列同士の比較にしか使わない）。 */
function nextDay(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, 10);
}
const MAIN_SECTIONS: { id: SectionId; navLabel: string }[] = [{ id: "company", navLabel: "公司总览" }, ...PREP_V2_SECTIONS.filter((section) => section.id !== "backup").map((section) => ({ ...section, navLabel: section.id === "overview" ? "面谈纵览" : section.navLabel }))];

/** URL の ?prepTab= を読む。殻の ?section= は原笔记 drawer の見出し用なので別名にする。 */
function tabFromUrl(): SectionId | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("prepTab");
  return value && (value === "company" || value === "backup" || PREP_V2_SECTIONS.some((section) => section.id === value)) ? value as SectionId : null;
}

export default function InterviewSessionV2({ doc, series, selectedSeries, sources, today, onSelect, onOpen, onOpenWiki, onOpenCard, onOpenAsset, companyOverview, contextPicker, companyAction, briefing }: {
  companyOverview: ReactNode;
  /** v1 の「本轮提醒」（復盤から出た弱点）。纵览の頭に出す——skill が既定で v2 を出す今、ここに無いと復盤の沈殿が次の面接に届かない。 */
  briefing?: ReactNode;
  contextPicker: ReactNode;
  companyAction: ReactNode;
  doc: InterviewPrepDoc;
  series: InterviewPrepSeries[];
  selectedSeries: InterviewPrepSeries | null;
  sources: PrepExternalLink[];
  today: string;
  onSelect: (doc: InterviewPrepDoc) => void;
  onOpen: (note: Note) => void;
  onOpenWiki: (target: string, section?: string) => void;
  onOpenCard: (id: string) => void;
  onOpenAsset: (asset: SharedAssetTarget) => void;
}) {
  const { locale } = useUiLocale();
  const t = (label: string, values: Record<string, string | number> = {}) =>
    (locale === "ja" ? V2_COPY_JA[label] ?? menuLabel(label, locale) : label)
      .replace(/\{(\w+)\}/g, (match, name: string) => String(values[name] ?? match));
  // 既定タブ：URL に書いてあればそれ、面接が明日までに迫っていれば纵览、そうでなければ会社総覧。
  // 以前は常に会社総覧で、当日に日历から来ても「面谈纵览」をもう一度押す必要があった。
  const [active, setActive] = useState<SectionId>(() => {
    const fromUrl = tabFromUrl();
    if (fromUrl) return fromUrl;
    const imminent = /^\d{4}-\d{2}-\d{2}$/.test(doc.date) && doc.date <= nextDay(today) && doc.date >= today;
    return imminent ? "overview" : "company";
  });
  // section：当前章节的专注阅读；stage：临场卡，只留三章里要说出口的台词。
  const [reading, setReading] = useState<"section" | "stage" | null>(null);
  const [currentHeading, setCurrentHeading] = useState<number | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const railRef = useRef<HTMLElement>(null);
  const positionsRef = useRef<Partial<Record<SectionId, number>>>({});
  const overview = useMemo(() => prepV2Overview(doc), [doc]);
  const section = active === "company" ? null : getPrepV2Section(doc.sections, active);
  const blocks = useMemo(() => active === "overview" ? overview.blocks : section?.blocks ?? [], [active, overview.blocks, section]);
  const headings = useMemo(() => blocks.flatMap((block, index) => block.kind === "heading" && block.level === 3
    ? [{ index, title: prepInlineText(block.inline) }] : []), [blocks]);
  const prefix = `session-v2-${active}`;
  const savePosition = () => {
    positionsRef.current[active] = window.scrollY;
  };
  const switchSection = (next: SectionId) => {
    if (next === active) return;
    savePosition();
    setCurrentHeading(null);
    setActive(next);
    // 刷新・共有で同じタブに戻れるよう URL に残す（履歴には積まない）。
    const params = new URLSearchParams(window.location.search);
    if (next === "company") params.delete("prepTab"); else params.set("prepTab", next);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${params.toString() ? `?${params}` : ""}`);
  };
  useLayoutEffect(() => {
    if (railRef.current) railRef.current.scrollTop = 0;
    const position = positionsRef.current[active];
    if (position !== undefined) window.scrollTo({ top: position, behavior: "instant" });
    else if (active !== "company" && headerRef.current && navRef.current) {
      // sticky 元素的可见位置已随滚动变化，需从正常流中的页头计算章节起点。
      const top = headerRef.current.getBoundingClientRect().bottom + window.scrollY - parseFloat(getComputedStyle(navRef.current).top);
      window.scrollTo({ top: Math.max(0, top), behavior: "instant" });
    }
  }, [active, doc.note.path]);
  useEffect(() => {
    const elements = [...(mainRef.current?.querySelectorAll<HTMLElement>('h3[id^="session-v2-"]') ?? [])];
    const update = () => {
      const current = elements.filter((element) => element.getBoundingClientRect().top < 220).at(-1) ?? elements[0];
      setCurrentHeading(current ? Number(current.id.split("-h-").at(-1)) : null);
    };
    const observer = new IntersectionObserver(update, { rootMargin: "-120px 0px -55% 0px" });
    elements.forEach((element) => observer.observe(element));
    update();
    return () => observer.disconnect();
  }, [active, blocks]);
  const currentIndex = currentHeading ?? headings[0]?.index ?? 0;
  const nextIndex = headings.find((heading) => heading.index > currentIndex)?.index ?? blocks.length;
  const citations = prepV2BlockLinks(blocks.slice(currentIndex, nextIndex));
  const featured = sources.filter((source) => source.starred).slice(0, 3);
  const refs = {
    onOpenWiki: (target: string, heading?: string) => { savePosition(); onOpenWiki(target, heading); },
    onOpenCard: (id: string) => { savePosition(); onOpenCard(id); },
  };
  const navKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % MAIN_SECTIONS.length;
    else if (event.key === "ArrowLeft") next = (index + MAIN_SECTIONS.length - 1) % MAIN_SECTIONS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = MAIN_SECTIONS.length - 1;
    else return;
    event.preventDefault();
    switchSection(MAIN_SECTIONS[next].id);
    navRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus({ preventScroll: true });
  };
  const openMotivation = () => {
    const asset = companyMotivationAssetTarget(doc);
    if (asset) { savePosition(); onOpenAsset(asset); }
    else switchSection("motivation");
  };
  const select = (next: InterviewPrepDoc) => { savePosition(); onSelect(next); };
  const countdown = prepCountdown(doc.date, today);
  const countdownText = countdown === null ? "" : countdown.days === 0 ? t("今天") : countdown.days === 1 ? t("明天")
    : countdown.days > 0 ? t("{n} 天后", { n: countdown.days }) : t("{n} 天前", { n: -countdown.days });
  // 三章里一句台词都没有时不出入口：点进去只剩一句空提示，等于白跑一趟。
  const stageSections = (["motivation", "questions", "backup"] as const).flatMap((id) => {
    const found = getPrepV2Section(doc.sections, id);
    return found ? [{ id: found.id, title: found.title, blocks: found.blocks }] : [];
  });
  const hasStageLines = stageSections.some((item) => item.blocks.some((block) => block.kind === "say"));
  const sourceList = (links: PrepExternalLink[]) => <ol className="v2-source-list">{links.map((link) => <li key={link.href}>
    <a href={link.href} target="_blank" rel="noopener noreferrer"><span>{link.label.replace(/^★\s*/, "")}</span><span aria-hidden="true">↗</span></a>
    <small>{prepSourceHost(link.href)}</small>
  </li>)}</ol>;

  return <div className="session-v2" onCopy={copySelectionWithoutRuby}>
    <header className="v2-header" ref={headerRef}>
      <div className="v2-heading">
        <p className="v2-kicker">{t("本场面试")} <span>{doc.round || "轮次未定"}</span>
          {countdown && <b className={`v2-countdown ${countdown.tone}`}>{countdownText}</b>}</p>
        <h1>{doc.company || doc.title}</h1>
        {overview.position && <p className="v2-position">{overview.position}</p>}
      </div>
      <div className="v2-switches">
        {contextPicker || <label>{t("公司／案件")}<select aria-label={t("切换公司、案件或面谈")} value={selectedSeries?.key ?? ""} onChange={(event) => {
          const item = series.find((candidate) => candidate.key === event.target.value);
          const next = item && selectRelevantInterviewPrepDoc(item.rounds, today);
          if (next) select(next);
        }}>{series.map((item) => <option key={item.key} value={item.key}>{item.company}{series.filter((other) => other.company === item.company).length > 1 ? `｜${item.caseLink || item.meetingLink}` : ""}（{item.rounds.length}{t("轮")}）</option>)}</select></label>}
        {(selectedSeries?.rounds.length ?? 0) > 1 && <label>{t("轮次")}<select aria-label={t("切换当前公司的面试轮次")} value={doc.note.path} onChange={(event) => {
          const next = selectedSeries?.rounds.find((candidate) => candidate.note.path === event.target.value);
          if (next) select(next);
        }}>{selectedSeries?.rounds.map((item) => <option key={item.note.path} value={item.note.path}>{item.round} · {item.date || "未定"}</option>)}</select></label>}
        {companyAction}
      </div>
      <div className="v2-logistics"><time>{overview.dateTime}</time><span>{doc.format}</span>{overview.place !== doc.format && overview.place !== "进入会议" && <span>{overview.place}</span>}<span>{doc.interviewers || "面试官未定"}</span>
        {overview.meetingUrl && <a className="v2-meeting" href={overview.meetingUrl} target="_blank" rel="noopener noreferrer">{t("进入会议")} <span aria-hidden="true">↗</span></a>}
      </div>
    </header>
    <nav className="v2-nav" ref={navRef} aria-label={t("面试准备章节")}>
      <div role="tablist" aria-label={t("准备正文")}>{MAIN_SECTIONS.map((item, index) => <button key={item.id} type="button" role="tab"
        id={`v2-tab-${item.id}`} aria-controls="v2-panel" aria-selected={active === item.id} tabIndex={active === item.id || (active === "backup" && index === 0) ? 0 : -1}
        onKeyDown={(event) => navKey(event, index)} onClick={() => switchSection(item.id)}><span className="v2-tab-number" aria-hidden="true">0{index + 1}</span>{t(item.navLabel)}</button>)}
        <SlidingIndicator className="v2-tab-indicator" selector={'[role="tab"][aria-selected="true"]'} watch={`${active}:${locale}`} /></div>
      <button type="button" className={`v2-backup${active === "backup" ? " active" : ""}`} aria-pressed={active === "backup"} onClick={() => switchSection("backup")}>{t("临场备用")}</button>
    </nav>
    <div className={`v2-layout${active === "company" ? " v2-company-layout" : ""}`}>
      {active === "company" ? <main key="company" id="v2-panel" role="tabpanel" aria-labelledby="v2-tab-company" tabIndex={0} className="v2-company-panel" ref={mainRef}>{companyOverview}</main> : <>
      <main key={active} id="v2-panel" role={active === "backup" ? "region" : "tabpanel"} aria-labelledby={active === "backup" ? "v2-section-title" : `v2-tab-${active}`} tabIndex={0} className={`v2-body v2-${active}`} ref={mainRef}>
        {active === "overview" && briefing}
        <header className="v2-section-head"><h2 id="v2-section-title">{active === "overview" ? "面谈纵览" : section?.title ?? "临场备用"}</h2><button type="button" onClick={() => { savePosition(); setReading("section"); }}>{t("专注阅读")}</button></header>
        {blocks.length ? <Blocks blocks={blocks} refs={refs} idPrefix={prefix} /> : <p className="v2-empty">本轮没有需要补充的内容，可从回答库打开共用话术。</p>}
        {active === "resources" && sources.some((source) => !doc.externalLinks.some((current) => current.href === source.href)) && <section className="v2-carried-sources"><h3>前轮沿用资料 · 截至本轮</h3><p>本轮新增资料见上文；以下来源保留前轮的阅读范围。</p>{sourceList(sources.filter((source) => !doc.externalLinks.some((current) => current.href === source.href)))}</section>}
        {active === "backup" && <div className="v2-library"><button type="button" onClick={() => refs.onOpenCard("p01")}>{t("回答库")}</button><button type="button" onClick={() => refs.onOpenWiki("自己紹介_音読台本")}>{t("自我介绍")}</button><button type="button" onClick={() => refs.onOpenWiki("当日フレーズ集")}>{t("当日短语")}</button><button type="button" onClick={() => refs.onOpenWiki("NG集_禁句と口癖")}>{t("表达提醒")}</button></div>}
      </main>
      <aside className="v2-rail" ref={railRef} aria-label={t("章节目录与研究来源")}>
        <div className="v2-quick"><button type="button" onClick={openMotivation}>志望動機 <span>{t("20 秒版 ↗")}</span></button><button type="button" onClick={() => switchSection("questions")}>逆質問 <span>{t("3 个主问题 →")}</span></button>
          {hasStageLines && <button type="button" className="v2-stage-entry" onClick={() => { savePosition(); setReading("stage"); }}>{t("临场卡")} <span>{t("只看要说的话 ↗")}</span></button>}</div>
        {headings.length > 1 && <nav className="v2-toc" aria-label={t("本章目录")}><h3>{t("本章目录")}</h3><ol>{headings.map((heading) => <li key={heading.index}><a href={`#${prefix}-h-${heading.index}`} onClick={(event) => {
          event.preventDefault();
          document.getElementById(`${prefix}-h-${heading.index}`)?.scrollIntoView({ block: "start", behavior: "instant" });
        }} aria-current={currentHeading === heading.index ? "location" : undefined}>{heading.title}</a></li>)}</ol>
          <SlidingIndicator className="v2-toc-indicator" selector="a[aria-current]" watch={`${active}:${currentHeading}`} /></nav>}
        {citations.length > 0 && <section><h3>{t("当前主题的来源")}</h3>{sourceList(citations)}</section>}
        {featured.length > 0 && <section><h3>{t("优先阅读")}</h3>{sourceList(featured)}</section>}
        <div className="v2-original"><button type="button" onClick={() => { savePosition(); onOpen(doc.note); }}>{t(OPEN_NOTE_LABEL)}</button>{(doc.caseLink || doc.meetingLink) && <button type="button" onClick={() => refs.onOpenWiki(doc.caseLink || doc.meetingLink)}>{t(doc.caseLink ? "案件记录" : "面谈记录")}</button>}</div>
      </aside>
      </>}
    </div>
    {reading === "section" && <PrepMaterialReader prepVersion={2} documentKey={`${doc.note.path}:${active}`} title={section?.title ?? "临场备用"} sections={[{ id: section?.id ?? active, title: section?.title ?? "临场备用", blocks }]} onClose={() => setReading(null)} onOpenWiki={refs.onOpenWiki} onOpenCard={refs.onOpenCard} />}
    {reading === "stage" && <PrepMaterialReader prepVersion={2} presentation="stage" documentKey={`${doc.note.path}:stage`} title={`${doc.company || doc.title} · ${t("临场卡")}`} sections={stageSections} onClose={() => setReading(null)} onOpenWiki={refs.onOpenWiki} onOpenCard={refs.onOpenCard} />}
  </div>;
}
