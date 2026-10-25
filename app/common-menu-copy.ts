"use client";

import { uiCopy } from "@/lib/ui-copy";
import { useUiLocale } from "./ui-locale";

export const COMMON_MENU_JA: Readonly<Record<string, string>> = {
  "正在读取": "読み込み中",
  "正在读取{label}…": "{label}を読み込んでいます…",
  "清除搜索": "検索をクリア",
  "关闭提示": "通知を閉じる",
  "撤销中…": "取り消し中…",
  "撤销": "元に戻す",
  "页面出错了。": "ページでエラーが発生しました。",
  "刷新一次通常就好；反复出现时把下面的原文贴给 Claude。": "再読み込みをお試しください。繰り返す場合は、下のエラー原文を使って原因を確認できます。",
  "重试": "再試行",
  "这个页面暂时无法显示。": "このページを表示できません。",
  "可以先重试；如果页面内容仍未载入，请重新载入页面。侧栏仍可切换到其它页面。": "再試行しても表示されない場合は、ページを再読み込みしてください。サイドバーからほかのページへ移動することもできます。",
  "重新载入页面": "ページを再読み込み",
  "正文表格，可横向滚动": "本文の表。横方向にスクロールできます",
};

export function useCommonMenu() {
  const { locale } = useUiLocale();
  return uiCopy(locale, COMMON_MENU_JA);
}
