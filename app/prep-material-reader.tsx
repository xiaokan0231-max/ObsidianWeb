"use client";

import { useMemo } from "react";
import { type PrepBlock } from "@/lib/interview-prep-doc";
import { headingPlainText } from "@/lib/reading-document";
import ReadingMode from "./reading-mode";
import { Blocks } from "./prep-doc-render";
import { useUiLocale } from "./ui-locale";

// 阅读层入口自己的界面文案（眉题、元数据、返回）。中文即键名，日文只在界面语言为日语时替换。
const STAGE_COPY_JA: Record<string, string> = {
  "临场卡": "当日カード",
  "准备材料": "準備資料",
  "{n} 个章节": "{n} 章",
  "原文连读": "原文を通して読む",
  "返回准备": "準備に戻る",
  "← → 切换台词": "← → で台詞を移動",
  "这一轮准备稿里还没有写成台词的内容。": "この回の準備資料には、まだ台詞として書かれた内容がありません。",
};

export default function PrepMaterialReader({ documentKey, title, sections, intro = [], notice, prepVersion = 1, presentation = "page", onClose, onOpenWiki, onOpenCard }: {
  documentKey: string;
  title: string;
  sections: { id: string; title: string; blocks: PrepBlock[] }[];
  intro?: PrepBlock[];
  notice?: string;
  prepVersion?: 1 | 2;
  /**
   * stage：临场卡。放大台词字号，←/→ 在台词之间跳。卡上留哪些块由调用方定（lib/interview-prep-v2 的
   * prepV2StageSections）：除了台词，冒頭的朗读节链接和当日お礼也要上卡，阅读层不再二次筛。
   */
  presentation?: "page" | "stage";
  onClose: () => void;
  onOpenWiki: (target: string, section?: string) => void;
  onOpenCard: (cardId: string) => void;
}) {
  const stage = presentation === "stage";
  const { locale } = useUiLocale();
  const st = (label: string, n?: number) =>
    (locale === "ja" ? STAGE_COPY_JA[label] ?? label : label).replace("{n}", String(n ?? ""));
  const shown = useMemo(() => stage ? sections.filter((section) => section.blocks.length > 0) : sections, [sections, stage]);
  const headings = useMemo(() => shown.map((section, index) => ({ id: `reader-prep-${index}`, text: headingPlainText(section.title) })), [shown]);
  const refs = {
    onOpenWiki: (target: string, section?: string) => { onClose(); onOpenWiki(target, section); },
    onOpenCard: (cardId: string) => { onClose(); onOpenCard(cardId); },
  };
  return <ReadingMode documentKey={documentKey} title={title} eyebrow={st(stage ? "临场卡" : "准备材料")}
    metadata={stage ? [st("{n} 个章节", shown.length), st("← → 切换台词")] : [st("{n} 个章节", sections.length), st("原文连读")]} headings={headings}
    presentation={stage ? "stage" : "page"}
    onClose={onClose} backLabel={st("返回准备")} headerNote={notice ? <p className="nr-translation-note">{notice}</p> : undefined}>
    {intro.length > 0 && <div className="reader-prose reader-prep-intro"><Blocks blocks={intro} refs={refs} idPrefix="reader-intro" /></div>}
    {stage && shown.length === 0 && <p className="reader-stage-empty">{st("这一轮准备稿里还没有写成台词的内容。")}</p>}
    {shown.map((section, index) => <section key={`${section.id}-${index}`} className={`reader-section reader-prose${prepVersion === 2 ? " reader-prep-v2" : ""}`} id={headings[index].id}>
      <header data-reading-anchor={headings[index].id}><span className="nr-chapter-number">{String(index + 1).padStart(2, "0")}</span><h2>{headings[index].text}</h2></header>
      {stage
        // 每句台词各包一层锚点：阅读层按 data-stage-line 在台词之间跳，位置记忆按 data-reading-anchor 复原。
        // 【面接官】是逆質問的预想回答，只作提示、不进 ←/→；紧跟其后的【あなた】是接话，缩进与它成组，
        // 免得问法、预想回答、接话连成一长串同样大小的台词。
        ? section.blocks.map((block, blockIndex) => {
          const anchor = `${headings[index].id}-line-${blockIndex}`;
          if (block.kind !== "say") return <Blocks key={blockIndex} blocks={[block]} refs={refs} idPrefix={`${headings[index].id}-h-${blockIndex}`} />;
          if (block.speaker === "interviewer") return <div key={blockIndex} className="reader-stage-cue" data-reading-anchor={anchor}>
            <Blocks blocks={[block]} refs={refs} idPrefix={anchor} />
          </div>;
          const previous = section.blocks[blockIndex - 1];
          const reply = previous?.kind === "say" && previous.speaker === "interviewer";
          return <div key={blockIndex} className={`reader-stage-line${reply ? " reader-stage-reply" : ""}`} data-stage-line data-reading-anchor={anchor}>
            <Blocks blocks={[block]} refs={refs} idPrefix={anchor} />
          </div>;
        })
        : <Blocks blocks={section.blocks} refs={refs} idPrefix={`reader-prep-${index}`} />}
    </section>)}
  </ReadingMode>;
}
