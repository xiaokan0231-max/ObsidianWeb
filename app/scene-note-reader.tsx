"use client";

import { useMemo } from "react";
import { noteBasename, type Note } from "@/lib/notes";
import { noteLinks } from "@/lib/memory-atlas-data";
import NoteReader from "./note-reader";

/** 只接管全文呈现，不替换或重新装载背后的星图、时间航道。 */
export default function SceneNoteReader({ note, section, allNotes, scene, onClose, onOpen, onOpenWiki }: {
  note: Note;
  section: string | null;
  allNotes: Note[];
  scene: "graph" | "timeline";
  onClose: () => void;
  onOpen: (note: Note) => void;
  onOpenWiki: (target: string, section?: string) => void;
}) {
  const backlinks = useMemo(() => {
    const basename = noteBasename(note.path);
    return allNotes.filter((candidate) => noteLinks(candidate).includes(basename));
  }, [allNotes, note.path]);

  return <NoteReader note={note} section={section} backlinks={backlinks} scene={scene}
    onClose={onClose} onOpen={onOpen} onOpenWiki={onOpenWiki} />;
}
