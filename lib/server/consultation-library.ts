import { readAllNotes } from "./obsidian";

export async function loadConsultationNotes(force = false) {
  // 面试材料和旧応募日台账分属两个来源集合；合并后按路径去重，避免台账日期在老师页丢失。
  const groups = await Promise.all([
    readAllNotes({ scope: "interview", force }),
    readAllNotes({ scope: "jobs", force }),
  ]);
  return [...new Map(groups.flat().map(note => [note.path, note])).values()];
}
