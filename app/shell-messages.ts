import type { UiLocale } from "../lib/ui-locale.ts";

const zh = {
  primaryNav: "主导航", calendarBack: "返回日历", subNav: "二级导航",
  expandRail: "展开侧边导航", collapseRail: "收起侧边导航", collapse: "收起",
  nextEvent: "最近安排", reloadHint: "按 R 重新读取",
  rebuildHint: "点击立即重算派生统计", autoStatsHint: "写入后自动重算派生统计（点击改为手动）",
  manualStatsHint: "派生统计手动重算（点击改为自动）", rebuild: "重算统计", rebuilding: "重算中…",
  statsAuto: "统计 · 自动", statsManual: "统计 · 手动", searchCommands: "搜索与命令", search: "搜索", reload: "重读",
  loading: "正在读取", offline: "离线", connected: "Obsidian 已连接", retry: "重试", closeNotice: "关闭提示",
  more: "更多", moreFeatures: "更多功能", mobileNav: "移动端主导航", mobileMore: "移动端更多导航",
  loadingTitle: "正在加载求职作战室…", loadingDetail: "读取岗位、日程与面试资料", reconnect: "重新连接",
  sessionBack: "返回本场面试", escapeBack: "也可返回", answerLibrary: "回答库",
  snapshot: "快照", justUpdated: "刚刚更新", cached: "已缓存", unavailable: "数据暂不可用",
  stalePrefix: "同步中断，正在显示", staleSuffix: "的可用快照。",
  syncedJustNow: "刚刚同步", syncedMinutesAgo: "{n} 分钟前同步",
  connectionSteps: ["确认 Obsidian 已打开这个 vault", "确认 Local REST API 插件已启用", "用 npm run dev 启动开发服务器"],
  retryIn: "{n} 秒后自动重试",
};

const ja: typeof zh = {
  primaryNav: "メインナビゲーション", calendarBack: "カレンダーに戻る", subNav: "サブナビゲーション",
  expandRail: "サイドバーを開く", collapseRail: "サイドバーを閉じる", collapse: "閉じる",
  nextEvent: "次の予定", reloadHint: "R キーで再読み込み",
  rebuildHint: "集計を今すぐ更新", autoStatsHint: "保存後に集計を自動更新（クリックで手動に変更）",
  manualStatsHint: "集計を手動更新（クリックで自動に変更）", rebuild: "集計を更新", rebuilding: "更新中…",
  statsAuto: "集計 · 自動", statsManual: "集計 · 手動", searchCommands: "検索とコマンド", search: "検索", reload: "再読込",
  loading: "読み込み中", offline: "オフライン", connected: "Obsidian 接続済み", retry: "再試行", closeNotice: "通知を閉じる",
  more: "その他", moreFeatures: "その他の機能", mobileNav: "メインナビゲーション", mobileMore: "その他のナビゲーション",
  loadingTitle: "転職作戦室を読み込み中…", loadingDetail: "求人・予定・面接資料を読み込んでいます", reconnect: "再接続",
  sessionBack: "今回の面接に戻る", escapeBack: "でも戻れます", answerLibrary: "回答集",
  snapshot: "スナップショット", justUpdated: "更新したばかり", cached: "キャッシュ済み", unavailable: "データを取得できません",
  stalePrefix: "同期が中断しました。", staleSuffix: "のスナップショットを表示しています。",
  syncedJustNow: "たった今同期", syncedMinutesAgo: "{n} 分前に同期",
  connectionSteps: ["Obsidian でこの vault を開いているか確認", "Local REST API プラグインが有効か確認", "npm run dev で開発サーバーを起動"],
  retryIn: "{n} 秒後に自動で再試行",
};

export const SHELL_MESSAGES: Record<UiLocale, typeof zh> = { "zh-CN": zh, ja };
