"use client";

import { useMemo, useRef, useState } from "react";
import {
  isRoundSpecificAsset,
  parseSharedAssetDocument,
  type SharedAssetTarget,
} from "@/lib/interview-shared-assets";
import { parseInline, prepBlockText } from "@/lib/interview-prep-doc";
import type { Note } from "@/lib/notes";
import { Blocks, Inlines } from "./prep-doc-render";
import { copySelectionWithoutRuby } from "./ruby-copy";
import { PrepSearchBox, useSlashFocus } from "./prep-search";
import { useCopyFlash } from "./copy-flash";
import PrepMaterialReader from "./prep-material-reader";

export default function InterviewSharedAsset({
  note,
  target,
  onOpenCard,
  onOpenWiki,
}: {
  note: Note;
  target: SharedAssetTarget;
  onOpenCard: (cardId: string) => void;
  onOpenWiki: (target: string, section?: string) => void;
}) {
  const doc = useMemo(
    () => parseSharedAssetDocument(note, target.section),
    [note, target.section],
  );
  const initialActive = Math.max(
    0,
    doc?.sections.findIndex((section) => section.title === target.defaultSection) ?? 0,
  );
  const [active, setActive] = useState(initialActive);
  const [query, setQuery] = useState("");
  const [readerOpen, setReaderOpen] = useState(false);
  // この画面のコピー対象は「いま開いている節」1つだけなので、id は固定でよい。
  const { copiedId, flash, clear } = useCopyFlash();
  const copied = copiedId === "section";
  const searchRef = useRef<HTMLInputElement>(null);
  const articleRef = useRef<HTMLElement>(null);

  const plain = useMemo(
    () => doc?.sections.map((section) => `${section.title}\n${section.plainText}`) ?? [],
    [doc],
  );
  const needle = query.trim().toLocaleLowerCase();
  const hits = useMemo(
    () =>
      needle
        ? plain.map((text) => text.toLocaleLowerCase().split(needle).length - 1)
        : plain.map(() => 0),
    [needle, plain],
  );
  const current = doc?.sections[active] ?? null;

  useSlashFocus(searchRef);

  if (!doc || !current) {
    return (
      <div className="shared-asset-missing">
        <span>SECTION NOT FOUND</span>
        <h1>找不到指定的面试话术章节</h1>
        <p>{target.note}{target.section ? ` › ${target.section}` : ""}</p>
      </div>
    );
  }

  const goTo = (index: number) => {
    setActive(index);
    clear();
    window.setTimeout(() => articleRef.current?.scrollIntoView({ block: "start" }), 0);
  };

  const copyCurrent = async () => {
    const text = current.blocks.map(prepBlockText).filter(Boolean).join("\n");
    await navigator.clipboard.writeText(text);
    flash("section");
  };

  const visibleIndexes = doc.sections
    .map((_, index) => index)
    .filter((index) => !needle || hits[index] > 0);
  const roundSpecific = isRoundSpecificAsset(target);
  const isV2 = roundSpecific && String(note.frontmatter.prep_version) === "2";

  return (
    <div className={`shared-asset-view${isV2 ? " shared-asset-v2" : ""}`}>
      <h1 className="sr-only">{target.label}</h1>

      <div className="shared-asset-tools">
        <PrepSearchBox
          value={query}
          onChange={setQuery}
          inputRef={searchRef}
          placeholder={roundSpecific ? "搜索这份回答（/ 聚焦）" : "搜索这份资产（/ 聚焦）"}
          label={roundSpecific ? "搜索本轮志望動機" : "搜索共通资产"}
        />
        <p>
          {doc.sections.length} 章 · {" "}
          {doc.restrictedToSection
            ? "仅展示面试可直接朗读的指定区段"
            : doc.sourceTitle}
        </p>
        <button type="button" className="reader-entry" onClick={() => setReaderOpen(true)}>
          全文阅读
        </button>
      </div>

      {doc.intro.length > 0 && (
        <aside className="shared-asset-guide">
          <span>使用说明</span>
          <div className="prep-doc-body">
            <Blocks blocks={doc.intro} refs={{ onOpenCard, onOpenWiki, query: needle }} />
          </div>
        </aside>
      )}

      <div className="shared-asset-workbench">
        <aside className="shared-asset-index">
          <header>
            <strong>{needle ? `${visibleIndexes.length} 个命中章节` : `${doc.sections.length} 个章节`}</strong>
            <small>点击切换正文</small>
          </header>
          <nav aria-label={`${target.label}章节`}>
            {visibleIndexes.map((index) => {
              const section = doc.sections[index];
              return (
                <button
                  key={section.id}
                  type="button"
                  className={index === active ? "active" : ""}
                  onClick={() => goTo(index)}
                  title={section.title}
                >
                  <b>{`${index + 1}`.padStart(2, "0")}</b>
                  <span>
                    <strong>{section.navLabel}</strong>
                    <small>{section.plainText.slice(0, 54) || "正文"}</small>
                  </span>
                  {hits[index] > 0 && <i>{hits[index]}</i>}
                </button>
              );
            })}
          </nav>
          {visibleIndexes.length === 0 && <p>没有找到“{query}”</p>}
        </aside>

        <article
          ref={articleRef}
          className="shared-asset-article"
          onCopy={copySelectionWithoutRuby}
        >
          <header>
            <div>
              <p>SECTION {`${active + 1}`.padStart(2, "0")} / {`${doc.sections.length}`.padStart(2, "0")}</p>
              <h2>
                <Inlines nodes={parseInline(current.title)} refs={{ onOpenCard, onOpenWiki }} />
              </h2>
            </div>
            <button type="button" onClick={() => void copyCurrent()}>
              {copied ? "已复制（不含假名）" : "复制本节（不含假名）"}
            </button>
          </header>
          <div className="prep-doc-body">
            <Blocks
              blocks={current.blocks}
              refs={{ onOpenCard, onOpenWiki, query: needle }}
            />
          </div>
          <footer>
            <button type="button" disabled={active === 0} onClick={() => goTo(active - 1)}>
              ← 上一节
            </button>
            <span>{current.navLabel}</span>
            <button
              type="button"
              disabled={active === doc.sections.length - 1}
              onClick={() => goTo(active + 1)}
            >
              下一节 →
            </button>
          </footer>
        </article>
      </div>
      {readerOpen && (
        <PrepMaterialReader
          prepVersion={isV2 ? 2 : 1}
          documentKey={`prep-asset:${note.path}#${target.section ?? ""}`}
          title={target.label}
          sections={doc.sections}
          intro={doc.intro}
          notice={doc.restrictedToSection ? "按原有范围，连续呈现指定区段的全部内容。" : undefined}
          onClose={() => setReaderOpen(false)}
          onOpenCard={onOpenCard}
          onOpenWiki={onOpenWiki}
        />
      )}
    </div>
  );
}
