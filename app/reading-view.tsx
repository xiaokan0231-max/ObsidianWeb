"use client";

import { useEffect, useMemo, useState } from "react";
import type { Note } from "@/lib/notes";
import {
  LANGUAGE_READING_LIST_CATEGORIES,
  LANGUAGE_READING_LIST_TYPE,
  parseLanguageReadingList,
  type LanguageReadingList,
  type LanguageReadingListItem,
  type LanguageReadingListFinding,
} from "@/lib/language-reading-list";
import { ReadModelFetchError, readReadModelJSON } from "./read-model-resource";
import { useReadModelLibrary } from "./use-read-model-library";
import { enumCodec, textCodec, useUrlState } from "./use-url-state";
import { useUiLocale } from "./ui-locale";

const COPY = {
  "zh-CN": {
    module: "专题速览", library: "阅读资料", contents: "本文目录", all: "从头阅读", original: "原话",
    suggested: "建议说法", reminder: "一句提醒", search: "查找原话、建议说法或提醒", searchShort: "查找这份清单", firstOnly: "只看优先项",
    source: "出处", sourcePrivate: "原稿未公开", openNote: "打开资料原笔记", loading: "正在读取专题资料…", empty: "还没有阅读专题",
    emptyDetail: "整理好的专题资料会出现在这里。", failed: "这份专题暂时无法打开", retry: "重试",
    notFound: "没有找到这份专题", showFirst: "打开最新专题", noMatch: "没有匹配的表达", clear: "清除筛选",
    more: "更多专题", rows: "条", sources: "份来源", shown: "当前显示", first: "先改", optional: "顺手改",
    syncing: "资料正在更新，当前保留上一完整版本。", syncFailed: "资料更新暂未完成，当前保留上一完整版本。",
    finding: "表达类型", allFindings: "全部类型", rule: "句式", boundary: "使用边界",
    findings: { correction: "句型需修", alternative: "原句可用", uncertain: "转写待核" },
    categories: { "语体": "语体与句尾", "含义": "含义与分寸", "搭配": "用词与搭配", "语法": "语法提醒" },
  },
  ja: {
    module: "テーマ別資料", library: "読む資料", contents: "目次", all: "最初から読む", original: "元の表現",
    suggested: "言い換え例", reminder: "ポイント", search: "元の表現・言い換え・ポイントを検索", searchShort: "この資料を検索", firstOnly: "優先項目のみ",
    source: "出典", sourcePrivate: "原文は非公開", openNote: "元の資料を開く", loading: "資料を読み込んでいます…", empty: "読む資料はまだありません",
    emptyDetail: "整理されたテーマ別資料がここに表示されます。", failed: "この資料を開けませんでした", retry: "再試行",
    notFound: "この資料が見つかりません", showFirst: "最新の資料を開く", noMatch: "一致する表現がありません", clear: "絞り込みを解除",
    more: "ほかの資料", rows: "件", sources: "資料", shown: "表示中", first: "優先", optional: "参考",
    syncing: "資料を更新中です。前回の完全な資料を表示しています。", syncFailed: "更新は未完了です。前回の完全な資料を表示しています。",
    finding: "表現の分類", allFindings: "すべての分類", rule: "構文", boundary: "使う際の注意",
    findings: { correction: "構文の修正", alternative: "原文も使える", uncertain: "文字起こし要確認" },
    categories: { "语体": "文体と文末", "含义": "意味と伝え方", "搭配": "言葉の組み合わせ", "语法": "文法の確認" },
  },
};

/** 检索只针对已打开的专题，不把目录卡片当正文，也不扫描面试原稿。 */
export function readingListMatches(item: LanguageReadingListItem, query: string, firstOnly: boolean, finding: LanguageReadingListFinding | "all" = "all") {
  if (firstOnly && item.priority !== "先改") return false;
  if (finding !== "all" && item.finding !== finding) return false;
  const haystack = [item.pattern, item.original, item.suggested, item.reminder, item.rule, item.boundary, ...item.sources.map(source => `${source.label} ${source.locator}`)]
    .join(" ").normalize("NFKC").toLocaleLowerCase("ja-JP");
  return query.normalize("NFKC").toLocaleLowerCase("ja-JP").trim().split(/\s+/u).filter(Boolean).every(term => haystack.includes(term));
}

type ReadingProps = { revision?: number; onOpenSource: (path: string, revision?: string) => void };
type DocumentState = { key: string; document: LanguageReadingList | null; error: boolean };

export default function ReadingView({ revision: refreshVersion, onOpenSource }: ReadingProps) {
  const { locale } = useUiLocale();
  const t = COPY[locale];
  const catalog = useReadModelLibrary({ query: `type:${LANGUAGE_READING_LIST_TYPE}`, scope: "language", sort: "recent" }, true, refreshVersion);
  const [path, setPath] = useUrlState("readingList", "", textCodec);
  const [search, setSearch] = useUrlState("readingSearch", "", textCodec);
  const [priority, setPriority] = useUrlState("readingPriority", "all", enumCodec(["all", "first"] as const));
  const [finding, setFinding] = useUrlState("readingFinding", "all", enumCodec(["all", "correction", "alternative", "uncertain"] as const));
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<DocumentState>({ key: "", document: null, error: false });
  // 明确的阅读路径不依赖目录当前分页；后续页资料刷新后也能直接回到同一篇。
  const selectedPath = path || catalog.items[0]?.path;
  const revision = catalog.page?.revision;
  const key = selectedPath && revision ? `${revision}:${selectedPath}` : "";
  const { retry: refreshCatalog } = catalog;

  useEffect(() => {
    if (!selectedPath || !revision) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]);
    const requestKey = `${revision}:${selectedPath}`;
    void readReadModelJSON<{ note: Note }>(`/api/note?${new URLSearchParams({ path: selectedPath, revision })}`, signal)
      .then(body => {
        const document = body.note && parseLanguageReadingList(body.note);
        if (!document || document.path !== selectedPath) throw new Error("Invalid reading document");
        if (!signal.aborted) setState({ key: requestKey, document, error: false });
      }).catch(error => {
        if (controller.signal.aborted) return;
        setState({ key: requestKey, document: null, error: true });
        if (error instanceof ReadModelFetchError && error.status === 409) void refreshCatalog();
      });
    return () => controller.abort();
  }, [selectedPath, revision, refreshVersion, retry, refreshCatalog]);

  const document = state.key === key ? state.document : null;
  const failed = state.key === key && state.error;
  const hasFindings = document?.items.some(item => item.finding) ?? false;
  const sections = document?.sections ?? LANGUAGE_READING_LIST_CATEGORIES;
  const categoryLabel = (category: string) => Object.hasOwn(t.categories, category) ? t.categories[category as keyof typeof t.categories] : category;
  const visible = useMemo(() => document?.items.filter(item => readingListMatches(item, search, priority === "first", hasFindings ? finding : "all")) ?? [], [document, search, priority, hasFindings, finding]);
  const sourceCount = useMemo(() => new Set(document?.items.flatMap(item => item.sources.map(source => source.path))).size, [document]);
  const clear = () => { setSearch(""); setPriority("all"); setFinding("all"); };
  const select = (next: string) => { setPath(next); clear(); };

  if (!catalog.page && catalog.loading) return <div className="reading-status" role="status">{t.loading}</div>;
  if (!catalog.page && catalog.error) return <div className="reading-status" role="alert"><h1>{t.failed}</h1><button type="button" onClick={() => void refreshCatalog()}>{t.retry}</button></div>;
  if (catalog.page && catalog.items.length === 0 && catalog.syncState === "building") return <div className="reading-status" role="status">{t.loading}</div>;
  if (catalog.page && catalog.items.length === 0 && (catalog.error || catalog.syncState === "failed")) return <div className="reading-status" role="alert"><h1>{t.failed}</h1><button type="button" onClick={() => void refreshCatalog()}>{t.retry}</button></div>;
  if (catalog.page && catalog.items.length === 0) return <div className="reading-status"><small>{t.module}</small><h1>{t.empty}</h1><p>{t.emptyDetail}</p></div>;

  return <section className="reading-workspace" aria-label={t.module}>
    {(catalog.items.length > 1 || catalog.page?.nextCursor) && <div className="reading-library-bar">
      <label>{t.library}<select value={selectedPath ?? ""} onChange={event => select(event.target.value)}>
        {document && !catalog.items.some(card => card.path === document.path) && <option value={document.path}>{document.title}</option>}
        {catalog.items.map(card => <option key={card.path} value={card.path}>{card.title}</option>)}
      </select></label>
      {catalog.page?.nextCursor && <button className="reading-more" type="button" onClick={() => void catalog.more()} disabled={catalog.loading}>{t.more}</button>}
    </div>}
    <article className="reading-document" id="reading-start">
      {(catalog.error || catalog.syncState === "building" || catalog.syncState === "failed") && <div className="reading-sync" role="status"><span>{catalog.error || catalog.syncState === "failed" ? t.syncFailed : t.syncing}</span><button type="button" onClick={() => void refreshCatalog()}>{t.retry}</button></div>}
      {!selectedPath && <div className="reading-status"><h1>{t.notFound}</h1><button type="button" onClick={() => select(catalog.items[0].path)}>{t.showFirst}</button></div>}
      {selectedPath && !document && !failed && <div className="reading-status" role="status">{t.loading}</div>}
      {selectedPath && failed && <div className="reading-status" role="alert"><h1>{t.failed}</h1><button type="button" onClick={() => setRetry(value => value + 1)}>{t.retry}</button></div>}
      {document && <>
        <header className="reading-heading">
          <div className="reading-eyebrow"><span>{t.module}</span><div className="reading-metadata"><span>{document.period.start} — {document.period.end}</span><span>{document.items.length} {t.rows}</span><span>{sourceCount} {t.sources}</span></div><button type="button" onClick={() => onOpenSource(document.path, revision)}>{t.openNote} ↗</button></div>
          <h1>{document.title}</h1>
          <p>{document.description}</p>
        </header>
        <div className="reading-controls">
          <nav className="reading-outline" aria-label={t.contents}>
            <a href="#reading-start">{t.all}</a>
            {sections.map((category, index) => {
              const count = visible.filter(item => item.category === category).length;
              return count ? <a href={`#reading-category-${index}`} key={category}>{categoryLabel(category)}<span>{count}</span></a>
                : <span className="reading-outline-empty" aria-disabled="true" key={category}>{categoryLabel(category)}<small>0</small></span>;
            })}
          </nav>
          <div className="reading-toolbar">
            <label className="reading-search"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg><input type="search" value={search} onChange={event => setSearch(event.target.value)} aria-label={t.search} placeholder={t.searchShort} /></label>
            <label className="reading-priority"><input type="checkbox" checked={priority === "first"} onChange={event => setPriority(event.target.checked ? "first" : "all")} />{t.firstOnly}</label>
            {hasFindings && <label className="reading-finding-filter"><select aria-label={t.finding} value={finding} onChange={event => setFinding(event.target.value as LanguageReadingListFinding | "all")}><option value="all">{t.allFindings}</option>{(["correction", "alternative", "uncertain"] as const).map(value => <option key={value} value={value}>{t.findings[value]}</option>)}</select></label>}
            <span className="reading-result-count" role="status">{visible.length} / {document.items.length}</span>
            {(search || priority !== "all" || (hasFindings && finding !== "all")) && <button className="reading-clear" type="button" onClick={clear}>{t.clear}</button>}
          </div>
        </div>
        {!visible.length ? <div className="reading-status"><p>{t.noMatch}</p><button type="button" onClick={clear}>{t.clear}</button></div> : <table className="reading-table">
          <caption>{document.title}</caption>
          <colgroup><col className="reading-original-column" /><col className="reading-suggested-column" /><col /></colgroup>
          <thead><tr><th scope="col">{t.original}</th><th scope="col">{t.suggested}</th><th scope="col">{t.reminder}</th></tr></thead>
          {sections.map((category, index) => {
            const items = visible.filter(item => item.category === category);
            return items.length ? <tbody key={category}>
              <tr className="reading-group" id={`reading-category-${index}`}><th colSpan={3} scope="rowgroup"><span>{String(index + 1).padStart(2, "0")}</span><h2>{categoryLabel(category)}</h2><small>{items.length} {t.rows}</small></th></tr>
              {items.map(item => <tr key={item.id} id={`reading-${item.id}`} className="reading-entry">
                <td><div className="reading-original"><span>{String(item.number).padStart(2, "0")}</span><p lang="ja">{item.original}</p></div><details className="reading-sources"><summary>{t.source}{item.sources.length > 1 ? ` · ${item.sources.length}` : ""}</summary><ul>{item.sources.map(source => <li key={`${source.path}:${source.locator}`}>{source.available === false ? <span className="reading-source-private">{source.label}<small>{source.locator} · {t.sourcePrivate}</small></span> : <button type="button" onClick={() => onOpenSource(source.path, revision)}>{source.label}<small>{source.locator} ↗</small></button>}</li>)}</ul></details></td>
                <td className="reading-suggested" lang="ja">{item.finding && <p className="reading-pattern" lang="zh-CN">{item.pattern}</p>}{item.suggested}</td>
                <td>{item.finding ? <span className={`reading-finding-label ${item.finding}`}>{t.findings[item.finding]}</span> : <span className={`reading-priority-label${item.priority === "先改" ? " first" : ""}`}>{item.priority === "先改" ? t.first : t.optional}</span>}<p className="reading-reminder" lang="zh-CN">{item.reminder}</p>{item.rule && <p className="reading-rule"><span>{t.rule}</span>{item.rule}</p>}{item.boundary && <details className="reading-boundary"><summary>{t.boundary}</summary><p lang="zh-CN">{item.boundary}</p></details>}</td>
              </tr>)}
            </tbody> : null;
          })}
        </table>}
      </>}
    </article>
  </section>;
}
