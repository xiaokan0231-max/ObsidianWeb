"use client";

import type { IndexedNoteLinks } from "./use-read-model-library";
import { useUiLocale } from "./ui-locale";
import ReadModelSyncStatus from "./read-model-sync-status";

/** 反链索引未到齐不是零条；正文仍然可读，相关资料独立重试。 */
export default function IndexedNoteLinksStatus({ links }: { links: IndexedNoteLinks }) {
  const { locale } = useUiLocale();
  if (links.error) return <div className="note-links-status" role="alert">
    <p>{locale === "ja" ? "関連ノートを読み込めませんでした。" : "相关笔记读取失败。"}</p>
    <button type="button" onClick={() => void links.retry()}>{locale === "ja" ? "再試行" : "重试"}</button>
  </div>;
  if (links.loading) return <p className="note-links-status" role="status">{locale === "ja" ? "関連ノートを読み込み中…" : "正在读取相关笔记…"}</p>;
  return <ReadModelSyncStatus state={links.syncState} />;
}
