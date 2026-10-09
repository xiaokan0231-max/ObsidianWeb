import { getString, getType, stripFrontmatter, type Note } from "./notes.ts";
import { parseTextbookModule, type TextbookModule } from "./language-textbook-module.ts";
import type { TextbookPosition } from "./language-textbook-position.ts";

export type LanguageTextbookChapter = {
  chapterId: string;
  order: number;
  group: string;
  title: string;
  summary: string;
  studyMinutes: number | null;
  exerciseCourseId: string;
  module?: TextbookModule;
  note: Note;
};

export function isLanguageTextbookChapter(note: Note) {
  return getType(note) === "material" && note.frontmatter.material_kind === "language-textbook-chapter";
}

export function parseLanguageTextbookChapter(note: Note): LanguageTextbookChapter | null {
  if (!isLanguageTextbookChapter(note)) return null;
  const fm = note.frontmatter;
  const chapterId = getString(fm.chapter_id).trim();
  const title = getString(fm.title).trim();
  const order = Number(fm.chapter_order);
  if (!/^[a-z][a-z0-9_-]{0,99}$/.test(chapterId) || !title || fm.chapter_order == null
    || !Number.isFinite(order) || order < 0 || !stripFrontmatter(note.content).trim()) return null;
  const minutes = Number(fm.study_minutes);
  return {
    chapterId, order, title, note,
    group: getString(fm.chapter_group).trim() || "学习章节",
    summary: getString(fm.chapter_summary).trim(),
    studyMinutes: Number.isFinite(minutes) && minutes > 0 ? minutes : null,
    exerciseCourseId: getString(fm.exercise_course_id).trim(),
    module: parseTextbookModule(fm.learning_module),
  };
}

export function findLanguageTextbookChapters(notes: Note[]) {
  const parsed = notes.map(parseLanguageTextbookChapter).filter((chapter): chapter is LanguageTextbookChapter => chapter !== null);
  const counts = new Map<string, number>();
  for (const chapter of parsed) counts.set(chapter.chapterId, (counts.get(chapter.chapterId) ?? 0) + 1);
  // 相同稳定 ID 不能悄悄指向另一章；修正源材料前先不展示冲突项。
  return parsed.filter((chapter) => counts.get(chapter.chapterId) === 1)
    .sort((a, b) => a.order - b.order || a.chapterId.localeCompare(b.chapterId));
}

export function languageTextbookSelection(chapters: LanguageTextbookChapter[], chapterId: string, courseId: string) {
  const chapter = chapters.find((item) => item.chapterId === chapterId) ?? chapters[0] ?? null;
  return { mode: courseId || !chapter ? "practice" as const : "study" as const, chapter };
}

export function languageChapterHref(search: string, chapterId: string, position?: TextbookPosition) {
  const params = new URLSearchParams(search);
  params.set("chapter", chapterId);
  params.delete("course");
  params.delete("note");
  params.delete("section");
  params.delete("knowledge");
  params.delete("lessonView");
  if (position) {
    params.set("knowledge", position.knowledge);
    params.set("lessonView", position.lessonView);
  }
  return `/training/topics?${params.toString()}`;
}
