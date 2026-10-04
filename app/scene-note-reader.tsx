"use client";

import { useMemo } from "react";
import type { Note } from "@/lib/notes";
import { noteBacklinks } from "@/lib/memory-atlas-data";
import NoteReader from "./note-reader";

/** 只接管全文呈现，不替换或重新装载背后的星图、时间航道。 */
export default function SceneNoteReader({ note, section, allNotes, scene, onClose, onOpen, onOpenWiki, wikiIndexComplete = false }: {
  note: Note;
  section: string | null;
  allNotes: Note[];
  /** allNotes 是否为全库；见 NoteReader。 */
  wikiIndexComplete?: boolean;
  scene: "graph" | "timeline";
  onClose: () => void;
  onOpen: (note: Note) => void;
  onOpenWiki: (target: string, section?: string) => void;
}) {
  // 反链与原笔记详情页同一口径（noteBacklinks 按整批 notes 建一次索引）。
  const backlinks = useMemo(() => noteBacklinks(allNotes, note), [allNotes, note]);

  return <NoteReader note={note} section={section} backlinks={backlinks} scene={scene} allNotes={allNotes} wikiIndexComplete={wikiIndexComplete}
    onClose={onClose} onOpen={onOpen} onOpenWiki={onOpenWiki} />;
}
