"use client";

import { useMemo } from "react";
import { type PrepBlock } from "@/lib/interview-prep-doc";
import { headingPlainText } from "@/lib/reading-document";
import ReadingMode from "./reading-mode";
import { Blocks } from "./prep-doc-render";
import { useUiLocale } from "./ui-locale";

// 临场卡新增的几句界面文案。阅读层其余的固定字（准备材料、原文连读）沿用原样。
const STAGE_COPY_JA: Record<string, string> = {
  "临场卡": "当日カード",
  "{n} 个章节": "{n} 章",
  "← → 切换台词": "← → で台詞を移動",
  "这一轮准备稿里还没有写成台词的内容。": "この回の準備資料には、まだ台詞として書かれた内容がありません。",
};

/**
 * 临场卡只留「要说出口的话」：say 台词，加上它紧邻的那个小标题（不然一串台词分不清是哪一问的）。
 * 背景、分析、资料一概不要——面试前最后几分钟只看要说的。
 * 一个标题下没有台词时连标题一起丢，免得卡上出现一排空标题。
 */
export function stageCardBlocks(blocks: PrepBlock[]): PrepBlock[] {
  const kept: PrepBlock[] = [];
  let heading: PrepBlock | null = null;
  for (const block of blocks) {
    if (block.kind === "heading") {
      heading = block;
    } else if (block.kind === "say") {
      if (heading) {
        kept.push(heading);
        heading = null;
      }
      kept.push(block);
    }
  }
  return kept;
}

export default function PrepMaterialReader({ documentKey, title, sections, intro = [], notice, prepVersion = 1, presentation = "page", onClose, onOpenWiki, onOpenCard }: {
  documentKey: string;
  title: string;
  sections: { id: string; title: string; blocks: PrepBlock[] }[];
  intro?: PrepBlock[];
  notice?: string;
  prepVersion?: 1 | 2;
  /** stage：临场卡。只留台词与紧邻标题、放大字号，←/→ 在台词之间跳。 */
  presentation?: "page" | "stage";
  onClose: () => void;
  onOpenWiki: (target: string, section?: string) => void;
  onOpenCard: (cardId: string) => void;
}) {
  const stage = presentation === "stage";
  const { locale } = useUiLocale();
  const st = (label: string, n?: number) =>
    (locale === "ja" ? STAGE_COPY_JA[label] ?? label : label).replace("{n}", String(n ?? ""));
  const shown = useMemo(() => stage
    ? sections.map((section) => ({ ...section, blocks: stageCardBlocks(section.blocks) })).filter((section) => section.blocks.length > 0)
    : sections, [sections, stage]);
  const headings = useMemo(() => shown.map((section, index) => ({ id: `reader-prep-${index}`, text: headingPlainText(section.title) })), [shown]);
  const refs = {
    onOpenWiki: (target: string, section?: string) => { onClose(); onOpenWiki(target, section); },
    onOpenCard: (cardId: string) => { onClose(); onOpenCard(cardId); },
  };
  return <ReadingMode documentKey={documentKey} title={title} eyebrow={stage ? st("临场卡") : "准备材料"}
    metadata={stage ? [st("{n} 个章节", shown.length), st("← → 切换台词")] : [`${sections.length} 个章节`, "原文连读"]} headings={headings}
    presentation={stage ? "stage" : "page"}
    onClose={onClose} backLabel="返回准备" headerNote={notice ? <p className="nr-translation-note">{notice}</p> : undefined}>
    {intro.length > 0 && <div className="reader-prose reader-prep-intro"><Blocks blocks={intro} refs={refs} idPrefix="reader-intro" /></div>}
    {stage && shown.length === 0 && <p className="reader-stage-empty">{st("这一轮准备稿里还没有写成台词的内容。")}</p>}
    {shown.map((section, index) => <section key={`${section.id}-${index}`} className={`reader-section reader-prose${prepVersion === 2 ? " reader-prep-v2" : ""}`} id={headings[index].id}>
      <header data-reading-anchor={headings[index].id}><span>{String(index + 1).padStart(2, "0")}</span><h2>{headings[index].text}</h2></header>
      {stage
        // 每句台词各包一层锚点：阅读层按 data-stage-line 在台词之间跳，位置记忆按 data-reading-anchor 复原。
        ? section.blocks.map((block, blockIndex) => block.kind === "say"
          ? <div key={blockIndex} className="reader-stage-line" data-stage-line data-reading-anchor={`${headings[index].id}-line-${blockIndex}`}>
            <Blocks blocks={[block]} refs={refs} idPrefix={`${headings[index].id}-line-${blockIndex}`} />
          </div>
          : <Blocks key={blockIndex} blocks={[block]} refs={refs} idPrefix={`${headings[index].id}-h-${blockIndex}`} />)
        : <Blocks blocks={section.blocks} refs={refs} idPrefix={`reader-prep-${index}`} />}
    </section>)}
  </ReadingMode>;
}
