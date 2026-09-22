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

type SectionId = typeof PREP_V2_SECTIONS[number]["id"] | "company";
const MAIN_SECTIONS: { id: SectionId; navLabel: string }[] = [{ id: "company", navLabel: "公司总览" }, ...PREP_V2_SECTIONS.filter((section) => section.id !== "backup").map((section) => ({ ...section, navLabel: section.id === "overview" ? "面谈纵览" : section.navLabel }))];

export default function InterviewSessionV2({ doc, series, selectedSeries, sources, today, onSelect, onOpen, onOpenWiki, onOpenCard, onOpenAsset, companyOverview, contextPicker, companyAction }: {
  companyOverview: ReactNode;
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
  const [active, setActive] = useState<SectionId>("company");
  const [reading, setReading] = useState(false);
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
  const sourceList = (links: PrepExternalLink[]) => <ol className="v2-source-list">{links.map((link) => <li key={link.href}>
    <a href={link.href} target="_blank" rel="noopener noreferrer"><span>{link.label.replace(/^★\s*/, "")}</span><span aria-hidden="true">↗</span></a>
    <small>{prepSourceHost(link.href)}</small>
  </li>)}</ol>;

  return <div className="session-v2" onCopy={copySelectionWithoutRuby}>
    <header className="v2-header" ref={headerRef}>
      <div className="v2-heading">
        <p className="v2-kicker">本场面试 <span>{doc.round || "轮次未定"}</span></p>
        <h1>{doc.company || doc.title}</h1>
        {overview.position && <p className="v2-position">{overview.position}</p>}
      </div>
      <div className="v2-switches">
        {contextPicker || <label>公司／案件<select aria-label="切换公司、案件或面谈" value={selectedSeries?.key ?? ""} onChange={(event) => {
          const item = series.find((candidate) => candidate.key === event.target.value);
          const next = item && selectRelevantInterviewPrepDoc(item.rounds, today);
          if (next) select(next);
        }}>{series.map((item) => <option key={item.key} value={item.key}>{item.company}{series.filter((other) => other.company === item.company).length > 1 ? `｜${item.caseLink || item.meetingLink}` : ""}（{item.rounds.length}轮）</option>)}</select></label>}
        {(selectedSeries?.rounds.length ?? 0) > 1 && <label>轮次<select aria-label="切换当前公司的面试轮次" value={doc.note.path} onChange={(event) => {
          const next = selectedSeries?.rounds.find((candidate) => candidate.note.path === event.target.value);
          if (next) select(next);
        }}>{selectedSeries?.rounds.map((item) => <option key={item.note.path} value={item.note.path}>{item.round} · {item.date || "未定"}</option>)}</select></label>}
        {companyAction}
      </div>
      <div className="v2-logistics"><time>{overview.dateTime}</time><span>{doc.format}</span>{overview.place !== doc.format && overview.place !== "进入会议" && <span>{overview.place}</span>}<span>{doc.interviewers || "面试官未定"}</span>
        {overview.meetingUrl && <a className="v2-meeting" href={overview.meetingUrl} target="_blank" rel="noopener noreferrer">进入会议 <span aria-hidden="true">↗</span></a>}
      </div>
    </header>
    <nav className="v2-nav" ref={navRef} aria-label="面试准备章节">
      <div role="tablist" aria-label="准备正文">{MAIN_SECTIONS.map((item, index) => <button key={item.id} type="button" role="tab"
        id={`v2-tab-${item.id}`} aria-controls="v2-panel" aria-selected={active === item.id} tabIndex={active === item.id || (active === "backup" && index === 0) ? 0 : -1}
        onKeyDown={(event) => navKey(event, index)} onClick={() => switchSection(item.id)}><span className="v2-tab-number" aria-hidden="true">0{index + 1}</span>{item.navLabel}</button>)}</div>
      <button type="button" className={`v2-backup${active === "backup" ? " active" : ""}`} aria-pressed={active === "backup"} onClick={() => switchSection("backup")}>临场备用</button>
    </nav>
    <div className={`v2-layout${active === "company" ? " v2-company-layout" : ""}`}>
      {active === "company" ? <main id="v2-panel" role="tabpanel" aria-labelledby="v2-tab-company" tabIndex={0} className="v2-company-panel" ref={mainRef}>{companyOverview}</main> : <>
      <main id="v2-panel" role={active === "backup" ? "region" : "tabpanel"} aria-labelledby={active === "backup" ? "v2-section-title" : `v2-tab-${active}`} tabIndex={0} className={`v2-body v2-${active}`} ref={mainRef}>
        <header className="v2-section-head"><h2 id="v2-section-title">{active === "overview" ? "面谈纵览" : section?.title ?? "临场备用"}</h2><button type="button" onClick={() => { savePosition(); setReading(true); }}>专注阅读</button></header>
        {blocks.length ? <Blocks blocks={blocks} refs={refs} idPrefix={prefix} /> : <p className="v2-empty">本轮没有需要补充的内容，可从回答库打开共用话术。</p>}
        {active === "resources" && sources.some((source) => !doc.externalLinks.some((current) => current.href === source.href)) && <section className="v2-carried-sources"><h3>前轮沿用资料 · 截至本轮</h3><p>本轮新增资料见上文；以下来源保留前轮的阅读范围。</p>{sourceList(sources.filter((source) => !doc.externalLinks.some((current) => current.href === source.href)))}</section>}
        {active === "backup" && <div className="v2-library"><button type="button" onClick={() => refs.onOpenCard("p01")}>回答库</button><button type="button" onClick={() => refs.onOpenWiki("自己紹介_音読台本")}>自我介绍</button><button type="button" onClick={() => refs.onOpenWiki("当日フレーズ集")}>当日短语</button><button type="button" onClick={() => refs.onOpenWiki("NG集_禁句と口癖")}>表达提醒</button></div>}
      </main>
      <aside className="v2-rail" ref={railRef} aria-label="章节目录与研究来源">
        <div className="v2-quick"><button type="button" onClick={openMotivation}>志望動機 <span>20 秒版 ↗</span></button><button type="button" onClick={() => switchSection("questions")}>逆質問 <span>3 个主问题 →</span></button></div>
        {headings.length > 1 && <nav className="v2-toc" aria-label="本章目录"><h3>本章目录</h3><ol>{headings.map((heading) => <li key={heading.index}><a href={`#${prefix}-h-${heading.index}`} onClick={(event) => {
          event.preventDefault();
          document.getElementById(`${prefix}-h-${heading.index}`)?.scrollIntoView({ block: "start", behavior: "instant" });
        }} aria-current={currentHeading === heading.index ? "location" : undefined}>{heading.title}</a></li>)}</ol></nav>}
        {citations.length > 0 && <section><h3>当前主题的来源</h3>{sourceList(citations)}</section>}
        {featured.length > 0 && <section><h3>优先阅读</h3>{sourceList(featured)}</section>}
        <div className="v2-original"><button type="button" onClick={() => { savePosition(); onOpen(doc.note); }}>打开原笔记</button>{(doc.caseLink || doc.meetingLink) && <button type="button" onClick={() => refs.onOpenWiki(doc.caseLink || doc.meetingLink)}>{doc.caseLink ? "案件记录" : "面谈记录"}</button>}</div>
      </aside>
      </>}
    </div>
    {reading && <PrepMaterialReader prepVersion={2} documentKey={`${doc.note.path}:${active}`} title={section?.title ?? "临场备用"} sections={[{ id: section?.id ?? active, title: section?.title ?? "临场备用", blocks }]} onClose={() => setReading(false)} onOpenWiki={refs.onOpenWiki} onOpenCard={refs.onOpenCard} />}
  </div>;
}
