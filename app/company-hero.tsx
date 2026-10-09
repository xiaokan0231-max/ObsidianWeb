"use client";

import { useMemo } from "react";
import { buildCompanyHero, isJapaneseName, splitCompanyName, type CompanyHeroFact, type CompanyHeroLink, type CompanyNameParts } from "@/lib/company-hero";
import type { CompanyOverview } from "@/lib/company-overview";
import type { InterviewPrepDoc } from "@/lib/interview-prep-doc";
import type { Note } from "@/lib/notes";

// 公司画像页的头部。原来左列只有公司名和岗位名，右列的切换卡片反而更高，
// 整块头部三分之二是空白；案件走到哪一步、条件如何、下一步做什么都得往下翻。
// 现在左列自上而下是：kicker → 社名＋状态胶囊 → 岗位 → 进度行 → 条件行＋链接 → 「此刻」一行。
// 取舍与空态都在 lib/company-hero.ts；这里只负责画。

/** h1 的 textContent 仍是完整社名，只是法人格前后缀降为小字。只有真正的日文社名才标 lang="ja"。 */
function CompanyName({ name, japanese }: { name: CompanyNameParts; japanese: boolean }) {
  // 分隔符原样留在文本里（复制・页内搜索拿到的是完整社名），只是字号跟法人格一起降下来。
  const separator = name.separator && <span className="co-hero-sep">{name.separator}</span>;
  return <h1 className="co-hero-name" lang={japanese ? "ja" : undefined}>{name.prefix && <small className="co-hero-prefix">{name.prefix}</small>}{name.prefix && separator}{name.core}{name.suffix && separator}{name.suffix && <small className="co-hero-suffix">{name.suffix}</small>}</h1>;
}

function factClass(fact: CompanyHeroFact, extra = "") {
  return [extra, fact.tone ?? "", fact.muted ? "muted" : ""].filter(Boolean).join(" ") || undefined;
}

function Link({ link, onOpen }: { link: CompanyHeroLink; onOpen: () => void }) {
  if (link.muted) return <li><span className="co-hero-link-missing">{link.label}</span></li>;
  return <li>
    {link.url
      ? <a href={link.url} target="_blank" rel="noopener noreferrer" title={link.title}>{link.label} ↗</a>
      : <button type="button" onClick={onOpen}>{link.label} ↗</button>}
    {link.badge && <i className={`co-hero-badge ${link.badgeTone ?? "quiet"}`}>{link.badge}</i>}
  </li>;
}

export default function CompanyHeroCard({ context, rounds, today, linkedCase = null, fallbackCompany, fallbackTitle = "", onOpen }: {
  context: CompanyOverview | null;
  /** 该案件／面谈已关联的准备稿（借用面接日用）。 */
  rounds: InterviewPrepDoc[];
  today: string;
  /** 面谈 todo 通过 case_id 挂着的案件；日時写在案件上时从这里借。 */
  linkedCase?: Note | null;
  /** 没有正本时（旧准备稿、或什么都没选）退回显示的公司名与轮次。 */
  fallbackCompany: string;
  fallbackTitle?: string;
  onOpen: (note: Note) => void;
}) {
  const hero = useMemo(() => (context ? buildCompanyHero(context, { rounds, today, linkedCase }) : null), [context, rounds, today, linkedCase]);
  if (!context || !hero) {
    return <div className="co-hero co-hero-empty"><p className="co-kicker">公司画像</p><CompanyName name={splitCompanyName(fallbackCompany || "公司总览")} japanese={!!fallbackCompany && isJapaneseName(fallbackCompany)} /><p className="co-context-title">{fallbackTitle || "选择一个真实案件或面谈，查看公司与岗位的最新资料。"}</p></div>;
  }
  const openRecord = () => onOpen(context.note);
  const now = hero.now;
  // 单行会被截断，title 是看全文的唯一途径：面談段要带上「面談」二字，否则悬停分不清最后那个日期是跟进还是约定。
  const nowTitle = now ? [now.action, now.waiting, now.followUp?.label, now.event && `面談 ${now.event.label}`].filter(Boolean).join(" · ") : "";
  return <div className="co-hero">
    <p className="co-kicker" title={hero.kickerTitle || undefined}>公司画像 · {hero.kicker}</p>
    <div className="co-hero-title-row">
      <CompanyName name={hero.name} japanese={isJapaneseName(context.company)} />
      <em className={`co-hero-pill tone-${hero.status.tone}`} title={hero.status.note || undefined}>{hero.status.label}</em>
    </div>
    {hero.title && <p className="co-context-title" title={hero.title}>{hero.title}</p>}
    <ul className="co-hero-progress" aria-label={hero.kind === "meeting" ? "面谈安排" : "选考进度"}>
      {hero.progress.map((fact) => <li key={fact.id} className={factClass(fact, fact.id === "note" ? "co-hero-note" : "")}>{fact.label && <span>{fact.label}</span>}<b title={fact.title}>{fact.value}</b></li>)}
      {hero.kind === "meeting" && <li className="co-hero-progress-link"><button type="button" onClick={openRecord}>面谈记录 ↗</button></li>}
    </ul>
    {hero.facts.length > 0 && <div className="co-hero-facts">
      <dl>{hero.facts.map((fact) => <div key={fact.id} className={factClass(fact)}><dt>{fact.label}</dt><dd title={fact.title}>{fact.value}</dd></div>)}</dl>
      <ul className="co-hero-links" aria-label="打开">{hero.links.map((link) => <Link key={link.id} link={link} onOpen={openRecord} />)}</ul>
    </div>}
    {now && <p className={`co-hero-now${now.followUp?.overdue ? " overdue" : ""}${now.placeholder ? " muted" : ""}`} title={nowTitle || undefined}>
      <span className="co-hero-now-label">下一步</span>
      {now.placeholder && <span className="co-hero-now-seg">{now.placeholder}</span>}
      {now.action && <span className="co-hero-now-seg action">{now.action}</span>}
      {now.waiting && <span className="co-hero-now-seg">{now.waiting}</span>}
      {now.followUp && <span className={`co-hero-now-seg${now.followUp.overdue ? " overdue-seg" : ""}`}>{now.followUp.label}</span>}
      {now.event && <span className={`co-hero-now-seg ${now.event.past ? "past" : "event"}`} title={now.event.borrowedFrom ? `借自准备稿 ${now.event.borrowedFrom}` : undefined}>面談 {now.event.label}</span>}
    </p>}
  </div>;
}
