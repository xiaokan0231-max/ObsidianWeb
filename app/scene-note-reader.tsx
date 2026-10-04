"use client";

import { useEffect, useMemo } from "react";
import type { Note } from "@/lib/notes";
import { noteBacklinks } from "@/lib/memory-atlas-data";
import { NOTE_EXIT_MS } from "@/lib/exit-transition";
import NoteReader from "./note-reader";

/** 只接管全文呈现，不替换或重新装载背后的星图、时间航道。 */
export default function SceneNoteReader({ note, section, allNotes, scene, onClose, onOpen, onOpenWiki, wikiIndexComplete = false, closing = false }: {
  note: Note;
  section: string | null;
  allNotes: Note[];
  /** allNotes 是否为全库；见 NoteReader。 */
  wikiIndexComplete?: boolean;
  scene: "graph" | "timeline";
  /** 外壳正在播退场（lib/exit-transition.ts）：只淡出，卸载仍由外壳在计时结束后做。 */
  closing?: boolean;
  onClose: () => void;
  onOpen: (note: Note) => void;
  onOpenWiki: (target: string, section?: string) => void;
}) {
  // 反链与原笔记详情页同一口径（noteBacklinks 按整批 notes 建一次索引）。
  const backlinks = useMemo(() => noteBacklinks(allNotes, note), [allNotes, note]);

  // 阅读层的根节点由 ReadingMode 经 portal 挂到舞台（或 body）上，不在这棵 DOM 子树里，
  // 拿不到 ref；同一时刻只有一个场景阅读层，按类名找到它，只写退场用的 data-state 与时长变量。
  useEffect(() => {
    if (!closing) return;
    const reader = document.querySelector<HTMLElement>(".novel-reader.scene-reader");
    if (!reader) return;
    reader.dataset.state = "closing";
    reader.style.setProperty("--note-exit-duration", `${NOTE_EXIT_MS}ms`);
    return () => {
      // 退场途中换了篇（取消关闭）时撤掉，新的一篇照常显示。
      delete reader.dataset.state;
      reader.style.removeProperty("--note-exit-duration");
    };
  }, [closing]);

  return <NoteReader note={note} section={section} backlinks={backlinks} scene={scene} allNotes={allNotes} wikiIndexComplete={wikiIndexComplete}
    onClose={onClose} onOpen={onOpen} onOpenWiki={onOpenWiki} />;
}
