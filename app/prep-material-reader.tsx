"use client";

import { useMemo } from "react";
import { type PrepBlock } from "@/lib/interview-prep-doc";
import { headingPlainText } from "@/lib/reading-document";
import ReadingMode from "./reading-mode";
import { Blocks } from "./prep-doc-render";

export default function PrepMaterialReader({ documentKey, title, sections, intro = [], notice, prepVersion = 1, onClose, onOpenWiki, onOpenCard }: {
  documentKey: string;
  title: string;
  sections: { id: string; title: string; blocks: PrepBlock[] }[];
  intro?: PrepBlock[];
  notice?: string;
  prepVersion?: 1 | 2;
  onClose: () => void;
  onOpenWiki: (target: string, section?: string) => void;
  onOpenCard: (cardId: string) => void;
}) {
  const headings = useMemo(() => sections.map((section, index) => ({ id: `reader-prep-${index}`, text: headingPlainText(section.title) })), [sections]);
  const refs = {
    onOpenWiki: (target: string, section?: string) => { onClose(); onOpenWiki(target, section); },
    onOpenCard: (cardId: string) => { onClose(); onOpenCard(cardId); },
  };
  return <ReadingMode documentKey={documentKey} title={title} eyebrow="准备材料" metadata={[`${sections.length} 个章节`, "原文连读"]} headings={headings}
    onClose={onClose} backLabel="返回准备" headerNote={notice ? <p className="nr-translation-note">{notice}</p> : undefined}>
    {intro.length > 0 && <div className="reader-prose reader-prep-intro"><Blocks blocks={intro} refs={refs} idPrefix="reader-intro" /></div>}
    {sections.map((section, index) => <section key={`${section.id}-${index}`} className={`reader-section reader-prose${prepVersion === 2 ? " reader-prep-v2" : ""}`} id={headings[index].id}>
      <header data-reading-anchor={headings[index].id}><span>{String(index + 1).padStart(2, "0")}</span><h2>{headings[index].text}</h2></header>
      <Blocks blocks={section.blocks} refs={refs} idPrefix={`reader-prep-${index}`} />
    </section>)}
  </ReadingMode>;
}
