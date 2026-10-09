"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  findInterviewPrepLibrary,
  interviewPrepPlainText,
  type InterviewPrepItem,
} from "@/lib/interview-prep";
import { parseInline } from "@/lib/interview-prep-doc";
import ScopeLoading from "./scope-loading";
import type { Note } from "@/lib/notes";
import { Inlines } from "./prep-doc-render";
import { copySelectionWithoutRuby } from "./ruby-copy";
import { isTypingTarget, PrepSearchBox, useSlashFocus } from "./prep-search";
import { useCopyFlash } from "./copy-flash";
import ReadingMode from "./reading-mode";
import { headingPlainText } from "@/lib/reading-document";
import { OPEN_NOTE_LABEL } from "@/lib/ui-labels";
import { textCodec, useUrlState } from "./use-url-state";
import { menuLabel } from "@/lib/ui-menu-labels";
import { useUiLocale } from "./ui-locale";

const PREP_MENU_JA: Record<string, string> = {
  "搜索问题、能力或关键词（/ 聚焦）": "質問・能力・キーワードを検索（/ でフォーカス）",
  "搜索标准回答": "標準回答を検索",
  "答案分类": "回答の分類",
  "全部": "すべて",
  "面试问题": "面接の質問",
  // 以下是回答库「全文阅读」阅读层的文案：眉题、返回、元数据与每篇回答的栏目名。
  "面试标准回答库": "面接標準回答集",
  "准备材料": "準備資料",
  "返回回答库": "回答集に戻る",
  "{n} 篇回答": "{n} 件の回答",
  "全部分类 · 连续阅读": "全分類 · 通して読む",
  "优先必练": "最優先で練習",
  "{p}级": "{p} ランク",
  "问题": "質問",
  "回答目的": "回答の目的",
  "标准参考答案": "標準の参考回答",
  "30秒版": "30 秒版",
  "回答结构": "回答の構成",
  "使用边界": "使える範囲",
  "事实与证据": "事実と証拠",
};

function GuidanceBlock({
  title,
  text,
  tone,
}: {
  title: string;
  text: string;
  // 取值必须和 globals.css 的 .prep-guidance-card.<tone> 修饰类一一对应。
  // 加新语气＝同时加 CSS 规则，否则就是编译通过但没样式的死值（"safe" 当初就是这么留下的）
  tone?: "warm";
}) {
  if (!text) return null;
  return (
    <section className={`prep-guidance-card ${tone ?? ""}`}>
      <h3>{title}</h3>
      <p>{interviewPrepPlainText(text)}</p>
    </section>
  );
}

export default function InterviewPrep({
  notes,
  onOpen,
  initialCardId,
  loading = false,
  syncUrl = false,
}: {
  notes: Note[];
  onOpen: (note: Note) => void;
  /** 本场面试のドキュメントから `[[面接標準回答集#pNN …]]` を踏んで来たときに開くカード */
  initialCardId?: string | null;
  /** この視図の scope がまだ届いていない：空状態ではなく読取中を出す。 */
  loading?: boolean;
  /**
   * 分类与选中的卡片写进 URL。只有独立的回答库页才开：同一组件也在本场面试上以浮层打开，
   * 浮层若改写 URL，会把底下那一页的查询串弄乱。
   */
  syncUrl?: boolean;
}) {
  const { locale } = useUiLocale();
  const ui = (label: string) => locale === "ja" ? PREP_MENU_JA[label] ?? menuLabel(label, locale) : label;
  const library = useMemo(() => findInterviewPrepLibrary(notes), [notes]);
  const [query, setQuery] = useState("");
  const [categoryParam, setCategory] = useUrlState("cat", "全部", textCodec, { enabled: syncUrl });
  const [readerOpen, setReaderOpen] = useState(false);
  const readingHeadings = useMemo(() => (library?.items ?? []).map((item) => ({
    id: `reader-answer-${item.id}`,
    text: headingPlainText(item.title),
  })), [library]);
  // 飛び込みで来たカードを最初の選択にする。以降は本人の選択が優先される。
  // 空文字＝未選択（URL から消える）。浮層では syncUrl が無いので initialCardId がそのまま初期値になる。
  const [selectedId, setSelectedId] = useUrlState("card", initialCardId ?? "", textCodec, { enabled: syncUrl });
  const { copiedId, flash } = useCopyFlash();
  const searchRef = useRef<HTMLInputElement>(null);

  const categories = useMemo(
    () => library ? ["全部", ...new Set(library.items.map((item) => item.category))] : ["全部"],
    [library],
  );
  // URL の分類が改名・削除で無くなっていたら「全部」扱い：空の一覧で行き止まりにしない。
  const category = categories.includes(categoryParam) ? categoryParam : "全部";
  const filteredItems = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    return (library?.items ?? []).filter((item) => {
      if (category !== "全部" && item.category !== category) return false;
      if (!keyword) return true;
      return [
        item.title,
        item.question,
        item.purpose,
        item.category,
        item.tags.join(" "),
        item.standardAnswer,
      ].some((value) => value.toLocaleLowerCase().includes(keyword));
    });
  }, [category, library, query]);
  const selected =
    filteredItems.find((item) => item.id === selectedId) ??
    filteredItems[0] ??
    null;

  useSlashFocus(searchRef);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      const index = Number(event.key) - 1;
      if (!Number.isInteger(index)) return;
      if (index < 0 || index >= Math.min(filteredItems.length, 9)) return;
      event.preventDefault();
      setSelectedId(filteredItems[index].id);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // setSelectedId は useUrlState が返す useState の setter そのもの（参照は不変）。
  }, [filteredItems, setSelectedId]);

  const copyAnswer = async (item: InterviewPrepItem) => {
    await navigator.clipboard.writeText(interviewPrepPlainText(item.standardAnswer));
    flash(item.id);
  };

  if (!library) {
    if (loading) return <div className="prep-view"><ScopeLoading label="标准回答库" /></div>;
    return (
      <div className="prep-view">
        <div className="prep-empty">
          <span>INTERVIEW PREP</span>
          <h1>还没有标准回答库</h1>
          <p>在 Vault 中建立 type: interview-prep-library 的笔记后，这里会自动读取。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="prep-view">
      <section className="prep-command">
        <PrepSearchBox
          value={query}
          onChange={setQuery}
          inputRef={searchRef}
          placeholder={ui("搜索问题、能力或关键词（/ 聚焦）")}
          label={ui("搜索标准回答")}
        />
        <div className="prep-categories" role="tablist" aria-label={ui("答案分类")}>
          {categories.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={category === item}
              className={category === item ? "active" : ""}
              onClick={() => {
                setCategory(item);
                setSelectedId("");
              }}
            >{item === "全部" ? ui("全部") : item}</button>
          ))}
        </div>
        <button className="prep-source" type="button" onClick={() => onOpen(library.note)}>
          {ui(OPEN_NOTE_LABEL)} ↗
        </button>
        <button type="button" className="reader-entry" onClick={() => setReaderOpen(true)}>
          {ui("全文阅读")}
        </button>
      </section>

      {filteredItems.length === 0 ? (
        <p className="prep-no-result">没有符合当前搜索和分类的答案。</p>
      ) : (
        <div className="prep-workbench">
          <nav className="prep-question-list" aria-label={ui("面试问题")}>
            <header>
              <div>
                <span>{filteredItems.length}</span>
                <small>个参考答案</small>
              </div>
              <p><kbd>1–9</kbd> 快速切换</p>
            </header>
            {filteredItems.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={selected?.id === item.id ? "active" : ""}
                onClick={() => setSelectedId(item.id)}
              >
                <span className="prep-index">{index < 9 ? index + 1 : "·"}</span>
                <span className="prep-question-copy">
                  <small>{item.category} · {item.priority === "S" ? "优先必练" : `${item.priority}级`}</small>
                  <strong>{item.title}</strong>
                  <em>{item.question}</em>
                </span>
                <i aria-hidden="true">→</i>
              </button>
            ))}
          </nav>

          {selected && (
            <article className="prep-answer">
              <header>
                <div>
                  <div className="prep-answer-meta">
                    <span>{selected.category}</span>
                    <span className={selected.priority === "S" ? "priority" : ""}>
                      {selected.priority === "S" ? "PRIORITY" : `${selected.priority} LEVEL`}
                    </span>
                  </div>
                  <h2>{selected.title}</h2>
                  <p lang="ja">{selected.question}</p>
                </div>
                <span className="prep-answer-id">{selected.id}</span>
              </header>

              {selected.purpose && (
                <p className="prep-purpose">
                  <span>这题要让对方得到什么</span>
                  {interviewPrepPlainText(selected.purpose)}
                </p>
              )}

              <section className="prep-standard" onCopy={copySelectionWithoutRuby}>
                <header>
                  <div>
                    <span>STANDARD REFERENCE</span>
                    <h3>标准参考答案</h3>
                  </div>
                  <button type="button" onClick={() => void copyAnswer(selected)}>
                    {copiedId === selected.id ? "已复制 ✓" : "复制日语答案"}
                  </button>
                </header>
                <p lang="ja"><Inlines nodes={parseInline(selected.standardAnswer)} /></p>
              </section>

              {selected.shortAnswer && (
                <section className="prep-short">
                  <span>30秒版 · 压力下先说这个</span>
                  <p lang="ja">{interviewPrepPlainText(selected.shortAnswer)}</p>
                </section>
              )}

              <div className="prep-guidance-grid">
                <GuidanceBlock title="回答结构" text={selected.structure} />
                <GuidanceBlock title="使用边界" text={selected.boundary} tone="warm" />
              </div>

              {selected.evidence && (
                <section className="prep-evidence">
                  <span>只使用已经确认的事实</span>
                  <p>{interviewPrepPlainText(selected.evidence)}</p>
                </section>
              )}
            </article>
          )}
        </div>
      )}
      {readerOpen && (
        <ReadingMode
          documentKey={`prep-library:${library.note.path}`}
          title={ui("面试标准回答库")}
          eyebrow={ui("准备材料")}
          metadata={[ui("{n} 篇回答").replace("{n}", String(library.items.length)), ui("全部分类 · 连续阅读")]}
          headings={readingHeadings}
          onClose={() => setReaderOpen(false)}
          backLabel={ui("返回回答库")}
        >
          {library.items.map((item, index) => (
            <section className="reader-section reader-prose" id={`reader-answer-${item.id}`} key={item.id}>
              <header data-reading-anchor={`reader-answer-${item.id}`}>
                <span className="nr-chapter-number">{String(index + 1).padStart(2, "0")}</span>
                <h2>{headingPlainText(item.title)}</h2>
              </header>
              <p className="reader-section-meta">
                {item.category} · {item.priority === "S" ? ui("优先必练") : ui("{p}级").replace("{p}", item.priority)}
                {item.tags.length > 0 ? ` · ${item.tags.join(" / ")}` : ""}
              </p>
              {[
                ["问题", item.question, "ja"],
                ["回答目的", item.purpose, undefined],
                ["标准参考答案", item.standardAnswer, "ja"],
                ["30秒版", item.shortAnswer, "ja"],
                ["回答结构", item.structure, undefined],
                ["使用边界", item.boundary, undefined],
                ["事实与证据", item.evidence, undefined],
              ].map(([label, content, lang], fieldIndex) => content ? (
                <section className="reader-answer-field" data-reading-anchor={`reader-answer-${item.id}-${fieldIndex}`} key={label}>
                  <h3>{label ? ui(label) : label}</h3>
                  <p lang={lang}><Inlines nodes={parseInline(content)} /></p>
                </section>
              ) : null)}
            </section>
          ))}
        </ReadingMode>
      )}
    </div>
  );
}
