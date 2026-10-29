"use client";

import type { ReadModelSyncState } from "./read-model-resource";
import { useUiLocale } from "./ui-locale";

export default function ReadModelSyncStatus({ state }: { state?: ReadModelSyncState | null }) {
  const { locale } = useUiLocale();
  if (!state || state === "ready") return null;
  return <p className="read-model-sync-status" role={state === "failed" ? "alert" : "status"}>
    {state === "building" ? (locale === "ja" ? "資料の索引を同期中です。前回の完全な資料を表示しています。" : "资料索引正在同步，显示上次完整资料。") : (locale === "ja" ? "資料の索引を同期できませんでした。前回の完全な資料を表示しています。" : "资料索引同步失败，显示上次完整资料。")}
  </p>;
}
