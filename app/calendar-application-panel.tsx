"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AI_APPLICATION_BUCKETS, type AiApplicationBucket, type AiApplicationDay } from "@/lib/calendar-applications";
import { getString, getTitle, type Note } from "@/lib/notes";
import { useUiLocale } from "./ui-locale";
import "./styles/calendar-application-panel.css";

const COPY = {
  "zh-CN": {
    title: (date: string) => `${date}代投 · 当前进展`, close: "关闭申请详情", all: "全部", search: "搜索公司、岗位或下一步", empty: "没有符合筛选的记录。", clear: "清空搜索",
    buckets: { "needs-user": "待我处理", progressing: "推进中", unknown: "待核对", waiting: "等待对方", paused: "暂缓", closed: "已结束" },
    counts: (companies: string, positions: string) => `${companies} 家公司 · ${positions} 个岗位`,
    open: "打开当日申请详情", preview: "当日申请概览", progressCounts: "当前进展（公司数）", filters: "按公司当前进展筛选", results: "筛选结果", recorded: "依据已记录状态；站内未实时核验。",
    fetched: "资料读取", noFetched: "读取时间未提供", missing: "未记录", noPosition: "岗位未记载", status: "原始状态", next: "记录的下一步", source: "查看来源记录", company: "查看公司", required: "关联待办", review: "关联待办待核对", submitted: (agent: string) => `由 ${agent} 提交`,
    groups: "同一公司按优先级归入一个分类；岗位原始状态分别保留。", hint: "点击固定详情，移开指针不会关闭。", unavailable: "这一天的申请记录已不在当前材料中。",
  },
  ja: {
    title: (date: string) => `${date}の代行応募 · 現在の進捗`, close: "応募の詳細を閉じる", all: "すべて", search: "会社・職種・次の対応を検索", empty: "条件に一致する記録はありません。", clear: "検索をクリア",
    buckets: { "needs-user": "対応が必要", progressing: "選考進行中", unknown: "要確認", waiting: "返信待ち", paused: "保留", closed: "終了" },
    counts: (companies: string, positions: string) => `${companies} 社 · ${positions} 求人`,
    open: "この日の応募詳細を開く", preview: "この日の応募概要", progressCounts: "現在の進捗（会社数）", filters: "会社の現在の進捗で絞り込む", results: "絞り込み結果", recorded: "記録済みの状況に基づきます。応募サイトの状況はリアルタイムに確認していません。",
    fetched: "資料の読み込み", noFetched: "読み込み時刻は未提供", missing: "記録なし", noPosition: "職種未記載", status: "記録された状況", next: "記録された次の対応", source: "出典の記録を見る", company: "会社を見る", required: "関連する対応事項", review: "関連する対応事項の確認が必要", submitted: (agent: string) => `${agent} が提出`,
    groups: "同じ会社は優先順に一つの分類へ集約し、各求人の元の状況はそのまま表示します。", hint: "クリックすると詳細を固定表示します。ポインターを離しても閉じません。", unavailable: "この日の応募記録は現在の資料に含まれていません。",
  },
} as const;

export type OpenApplicationDay = (day: AiApplicationDay, trigger: HTMLButtonElement) => void;

type ApplicationProgressCounts = Record<AiApplicationBucket, number>;
const progressDescription = (counts: ApplicationProgressCounts, locale: keyof typeof COPY) => {
  const number = new Intl.NumberFormat(locale);
  return AI_APPLICATION_BUCKETS.filter(bucket => counts[bucket] > 0).map(bucket => `${COPY[locale].buckets[bucket]} ${number.format(counts[bucket])}`).join(" · ");
};

/** 只投影已经按公司互斥归类的桶，不在视图里按岗位重新计算进度。 */
export function ApplicationProgressBar({ bucketCounts, legend = "none", className = "", id }: {
  bucketCounts: ApplicationProgressCounts; legend?: "none" | "counts" | "labels"; className?: string; id?: string;
}) {
  const { locale } = useUiLocale();
  const copy = COPY[locale];
  const buckets = AI_APPLICATION_BUCKETS.filter(bucket => bucketCounts[bucket] > 0);
  const total = buckets.reduce((sum, bucket) => sum + bucketCounts[bucket], 0);
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const description = progressDescription(bucketCounts, locale);
  return <span id={id} className={`application-progress ${className}`.trim()} role="img" aria-label={`${copy.progressCounts}${description ? `：${description}` : "：0"}`}>
    <span className="application-progress-track" aria-hidden="true">
      {buckets.map(bucket => <span key={bucket} className="application-progress-segment" data-bucket={bucket}
        style={{ width: `${bucketCounts[bucket] / total * 100}%` }} title={`${copy.buckets[bucket]} ${number(bucketCounts[bucket])}`} />)}
    </span>
    {legend !== "none" && <span className={`application-progress-legend application-progress-legend-${legend}`} aria-hidden="true">
      {buckets.map(bucket => <span key={bucket} data-bucket={bucket} title={`${copy.buckets[bucket]} ${number(bucketCounts[bucket])}`}>
        <i />{legend === "labels" && <span>{copy.buckets[bucket]}</span>}<b>{number(bucketCounts[bucket])}</b>
      </span>)}
    </span>}
  </span>;
}

/** 月格・週見出し・当日概要を同じ操作にする。プレビューには操作を置かない。 */
export function CalendarApplicationTrigger({ day, expanded, onOpen, className, children, label, showCounts = false }: {
  day: AiApplicationDay; expanded: boolean; onOpen: OpenApplicationDay; className: string; children: ReactNode; label: string; showCounts?: boolean;
}) {
  const { locale } = useUiLocale();
  const copy = COPY[locale];
  const [preview, setPreview] = useState<{ left: number; top: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const cancel = () => { if (timer.current !== null) clearTimeout(timer.current); timer.current = null; setPreview(null); };
  const schedule = () => {
    if (expanded || timer.current !== null) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      const rect = button.current?.getBoundingClientRect();
      if (!rect) return;
      setPreview({ left: Math.max(12, Math.min(rect.left, window.innerWidth - 332)), top: Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - 230)) });
    }, 300);
  };
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);
  const previewId = `application-preview-${day.date}-${className.replace(/\W/g, "-")}`;
  return <>
    <button ref={button} type="button" className={className} data-ai-date={day.date} data-heat={Math.min(day.companyCount, 4)} aria-label={showCounts ? `${label}；${progressDescription(day.bucketCounts, locale)}` : label}
      aria-expanded={expanded} aria-controls={expanded ? "calendar-application-panel" : undefined} aria-describedby={preview ? previewId : undefined}
      onPointerEnter={schedule} onPointerLeave={cancel} onFocus={schedule} onBlur={cancel}
      onKeyDown={event => { if (event.key === "Escape") { cancel(); event.stopPropagation(); } }}
      onClick={event => { cancel(); onOpen(day, event.currentTarget); }}>
      {children}
      {showCounts && <span className="calendar-ai-graphic" aria-hidden="true">
        <ApplicationProgressBar bucketCounts={day.bucketCounts} legend="counts" />
      </span>}
    </button>
    {preview && !expanded && createPortal(<div className="calendar-application-preview" role="tooltip" id={previewId} style={preview} lang={locale}>
      <small>{copy.preview} · {day.date} JST</small><strong>{copy.counts(number(day.companyCount), number(day.positionCount))}</strong>
      <div>{AI_APPLICATION_BUCKETS.filter(bucket => day.bucketCounts[bucket] > 0).map(bucket => <span key={bucket}>{copy.buckets[bucket]} {number(day.bucketCounts[bucket])}</span>)}</div>
      <p>{copy.recorded}</p><small>{copy.hint}</small>
    </div>, document.body)}
  </>;
}

export default function CalendarApplicationPanel({ day, date, fetchedAt, onClose, onOpen, onOpenCompany }: {
  day?: AiApplicationDay; date: string; fetchedAt?: number | null; onClose: () => void; onOpen: (note: Note) => void;
  onOpenCompany?: (company: string, contextNote: Note) => void;
}) {
  const { locale } = useUiLocale();
  const copy = COPY[locale];
  const [bucket, setBucket] = useState<AiApplicationBucket | "all">("all");
  const [query, setQuery] = useState("");
  const panel = useRef<HTMLElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => { close.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      // 原笔记是外壳的模态层；先让它关闭，不同时关闭底下的申请详情。
      if (event.key !== "Escape" || event.defaultPrevented || panel.current?.closest("[inert]") || document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault(); event.stopImmediatePropagation(); onClose();
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [onClose]);
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const companies = (day?.companies ?? []).filter(company => bucket === "all" || company.bucket === bucket).map(company => ({ ...company,
    applications: company.applications.filter(application => {
      const searchable = [company.company, application.company, application.position, getString(application.note.frontmatter.status), getString(application.note.frontmatter.next_action), ...application.requiredActions.map(note => getString(note.frontmatter.action) || getTitle(note))].join(" ").toLocaleLowerCase();
      return words.every(word => searchable.includes(word));
    }),
  })).filter(company => company.applications.length > 0);
  const resetScroll = () => { if (scroll.current) scroll.current.scrollTop = 0; };
  const timestamp = fetchedAt != null && Number.isFinite(fetchedAt) ? new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Tokyo" }).format(new Date(fetchedAt)) : null;
  const dateLabel = new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", timeZone: "Asia/Tokyo" }).format(new Date(`${date}T00:00:00+09:00`));
  return <aside ref={panel} id="calendar-application-panel" className="calendar-application-panel" aria-labelledby="calendar-application-title" lang={locale}>
    <header><div><small>{date} · JST</small><h2 id="calendar-application-title">{copy.title(dateLabel)}</h2><strong>{copy.counts(number(day?.companyCount ?? 0), number(day?.positionCount ?? 0))}</strong></div><button ref={close} type="button" className="calendar-application-close" onClick={onClose} aria-label={copy.close}>×</button></header>
    <div className="calendar-application-controls"><p>{copy.recorded}</p><small>{timestamp ? `${copy.fetched}：${timestamp} JST` : copy.noFetched}</small>
      <label><span>{copy.search}</span><input type="search" value={query} onChange={event => { setQuery(event.target.value); resetScroll(); }} /></label>
      <div className="calendar-application-filters" role="group" aria-label={copy.filters}>{(["all", ...AI_APPLICATION_BUCKETS] as const).map(value => <button key={value} type="button" aria-pressed={bucket === value} onClick={() => { setBucket(value); resetScroll(); }}>
        {value === "all" ? copy.all : copy.buckets[value]} <span>{number(value === "all" ? day?.companyCount ?? 0 : day?.bucketCounts[value] ?? 0)}</span>
      </button>)}</div>
      <small>{copy.groups}</small>
    </div>
    <div className="calendar-application-scroll" ref={scroll} tabIndex={0} aria-label={copy.results}>
      {!day ? <p className="calendar-application-empty">{copy.unavailable}</p> : <>
        <p className="calendar-application-result" role="status">{copy.counts(number(companies.length), number(companies.reduce((sum, company) => sum + company.applications.length, 0)))}</p>
        {companies.length === 0 && <p className="calendar-application-empty">{copy.empty}{query && <button type="button" onClick={() => setQuery("")}>{copy.clear}</button>}</p>}
        {companies.map(company => <section className="calendar-application-company" key={company.key}><header><h3 lang="und">{company.company}</h3><span data-bucket={company.bucket}>{copy.buckets[company.bucket]}</span>{onOpenCompany && <button type="button" onClick={() => onOpenCompany(company.company, company.applications[0].note)}>{copy.company} ↗</button>}</header>
          {company.applications.map(application => <article key={application.id} className="calendar-application-position"><h4 lang="und">{application.position || copy.noPosition}</h4><small>{copy.submitted(application.agent)}</small>
            <dl><dt>{copy.status}</dt><dd lang="und">{getString(application.note.frontmatter.status) || copy.missing}</dd><dt>{copy.next}</dt><dd lang="und">{getString(application.note.frontmatter.next_action) || copy.missing}</dd></dl>
            {application.requiredActions.length > 0 && <div className="calendar-application-actions"><small>{copy.required}</small>{application.requiredActions.map(note => <button key={note.path} type="button" onClick={() => onOpen(note)} lang="und">{getString(note.frontmatter.action) || getTitle(note)} ↗</button>)}</div>}
            {application.reviewActions.length > 0 && <details><summary>{copy.review}</summary>{application.reviewActions.map(note => <button key={note.path} type="button" onClick={() => onOpen(note)} lang="und">{getString(note.frontmatter.action) || getTitle(note)} ↗</button>)}</details>}
            <button type="button" className="calendar-application-source" onClick={() => onOpen(application.note)}>{copy.source} ↗</button>
          </article>)}
        </section>)}
      </>}
    </div>
  </aside>;
}
