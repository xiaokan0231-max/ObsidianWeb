/*
 * 快捷键一览：设置中心「快捷键」页的唯一数据源，只读，不做改键。
 *
 * 为什么要一张表：快捷键处理散在二十来个文件的 keydown 里，以前只有 3D 两处各自带一张帮助表，
 * 别的页面按什么键全靠记。为什么不改键：R 同时是全库重读和 3D 视角复位、快练里又被吞掉，
 * 这些靠 defaultPrevented 和监听顺序分辨，开放改键会让这些约定一起失效。
 *
 * 表与实现靠 tests/shortcuts.test.mjs 对齐：每一条都要在 source 列出的文件里找到对应的按键判断，
 * 实现删了键、表还留着，测试就会红。
 */

export type ShortcutEntry = {
  /** 组内唯一，测试按 `${group}:${id}` 找对应的源码判据。 */
  id: string;
  /** 键帽，每个元素渲染成一个 <kbd>；同一动作有多种按法时并列。 */
  keys: readonly string[];
  /** [中文, 日本語]。 */
  label: readonly [string, string];
};

export type ShortcutGroup = {
  id: string;
  title: readonly [string, string];
  /** 在哪里生效、什么时候让出（输入框里一律不触发）。 */
  scope: readonly [string, string];
  /** 处理这些键的源文件（相对仓库根），测试在这些文件里核对。 */
  source: readonly string[];
  entries: readonly ShortcutEntry[];
};

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    id: "global",
    title: ["全局", "全体"],
    scope: ["任何页面；在输入框里打字时 R 不触发", "どのページでも。入力欄で入力中は R は無効"],
    source: ["app/memory-atlas.tsx"],
    entries: [
      { id: "palette", keys: ["⌘K", "Ctrl+K"], label: ["打开搜索与命令面板，再按一次关闭", "検索・コマンドパネルを開く（もう一度で閉じる）"] },
      { id: "reload", keys: ["R"], label: ["重新读取 Obsidian 记忆库", "Obsidian の記憶庫を再読み込み"] },
      { id: "escape", keys: ["Esc"], label: ["逐层关闭：先命令面板，再原笔记，再浮层", "一段ずつ閉じる：パネル → 元ノート → オーバーレイ"] },
    ],
  },
  {
    id: "quick",
    title: ["快练", "クイック練習"],
    scope: ["练习屏；R 在这里被吞掉，不会误触全库重读", "練習画面。R は無効化され、全体の再読み込みは起きない"],
    source: ["app/language-quick-drill.tsx"],
    entries: [
      { id: "choose", keys: ["1–4"], label: ["选择题：选第几个选项", "選択問題：番号の選択肢を選ぶ"] },
      { id: "rate", keys: ["1–3"], label: ["翻卡自评：记得／模糊／忘了", "フリップの自己評価：覚えた／あいまい／忘れた"] },
      { id: "reveal", keys: ["Space"], label: ["翻卡：揭晓答案", "フリップ：答えを表示"] },
      { id: "next", keys: ["Enter"], label: ["看完反馈进入下一题（Space、→ 同效）", "フィードバック後に次の問題へ（Space・→ でも可）"] },
      { id: "giveUp", keys: ["?"], label: ["不知道：直接看答案", "分からない：そのまま答えを見る"] },
      { id: "easy", keys: ["E"], label: ["太简单：30 天后用辨析题验证一次", "簡単すぎ：30日後に識別問題で一度確認"] },
      { id: "suspend", keys: ["X"], label: ["这题不再出", "この問題を今後出さない"] },
      { id: "undo", keys: ["Z"], label: ["撤销刚才的「不再出」", "直前の「今後出さない」を取り消す"] },
      { id: "back", keys: ["←"], label: ["回看上一题", "前の問題を見返す"] },
      { id: "forward", keys: ["→"], label: ["回看时往后一题", "見返し中に次の問題へ"] },
      { id: "end", keys: ["Esc"], label: ["结束本组（做到一半前要再按一次确认）", "このセットを終える（半分未満なら確認のためもう一度）"] },
    ],
  },
  {
    id: "triage",
    title: ["快速过一遍", "ざっと仕分け"],
    scope: ["快速过一遍的分流屏", "仕分け画面"],
    source: ["app/language-quick-triage.tsx"],
    entries: [
      { id: "judge", keys: ["1", "2", "3"], label: ["会／不确定／不会", "分かる／あいまい／分からない"] },
      { id: "back", keys: ["←"], label: ["上一条", "前の項目"] },
      { id: "forward", keys: ["→"], label: ["下一条", "次の項目"] },
      { id: "done", keys: ["Enter"], label: ["全部过完后回到总览", "すべて終えたら概要へ戻る"] },
      { id: "end", keys: ["Esc"], label: ["结束快速过一遍", "仕分けを終える"] },
    ],
  },
  {
    id: "calendar",
    title: ["日历", "カレンダー"],
    scope: ["日历页；抽屉或浮层打开时让出", "カレンダー。ドロワーやオーバーレイ表示中は無効"],
    source: ["app/calendar-view.tsx"],
    entries: [
      { id: "page", keys: ["[", "]"], label: ["上一月／下一月（周视图为整周）", "前月／翌月（週表示では週単位）"] },
      { id: "today", keys: ["T"], label: ["回到今天", "今日に戻る"] },
      { id: "day", keys: ["←", "→"], label: ["前一天／后一天", "前日／翌日"] },
      { id: "week", keys: ["↑", "↓"], label: ["月视图：上一周／下一周的同一天", "月表示：前週／翌週の同じ曜日"] },
      { id: "open", keys: ["Enter"], label: ["打开选中日的第一场", "選択日の最初の予定を開く"] },
    ],
  },
  {
    id: "jobs",
    title: ["岗位机会", "求人機会"],
    scope: ["岗位页；在输入框里不触发", "求人ページ。入力欄では無効"],
    source: ["app/jobs-view.tsx", "app/jobs-decision.tsx"],
    entries: [
      { id: "search", keys: ["/"], label: ["聚焦搜索框", "検索欄へ移動"] },
      { id: "close", keys: ["Esc"], label: ["关闭对比或岗位详情", "比較・求人詳細を閉じる"] },
      { id: "step", keys: ["J", "K"], label: ["决策台：下一条／上一条（↓ ↑ 同效）", "判断デスク：次／前（↓ ↑ でも可）"] },
    ],
  },
  {
    id: "library",
    title: ["资料库", "資料庫"],
    scope: ["资料库结果列表", "資料庫の検索結果"],
    source: ["app/library-view.tsx"],
    entries: [
      { id: "move", keys: ["J", "K"], label: ["在结果间移动", "結果の間を移動"] },
      { id: "open", keys: ["Enter"], label: ["焦点不在控件上时打开第一篇", "どこにもフォーカスがない時は先頭を開く"] },
    ],
  },
  {
    id: "review",
    title: ["面试复盘", "面接の振り返り"],
    scope: ["复盘原文面板", "振り返りの原文パネル"],
    source: ["app/interview-review.tsx"],
    entries: [
      { id: "filter", keys: ["1–9"], label: ["切换逐字稿筛选", "逐語記録の絞り込みを切り替え"] },
    ],
  },
  {
    id: "reading",
    title: ["阅读层", "閲覧レイヤー"],
    scope: ["全屏阅读与临场卡", "全画面の閲覧と本番カード"],
    source: ["app/reading-mode.tsx"],
    entries: [
      { id: "step", keys: ["←", "→"], label: ["临场卡：上一句／下一句", "本番カード：前の文／次の文"] },
      { id: "close", keys: ["Esc"], label: ["关闭阅读层", "閲覧レイヤーを閉じる"] },
    ],
  },
  {
    id: "graph3d",
    title: ["3D 星图", "3D 星図"],
    scope: ["探索模式 · 3D 关系图；按 ? 在舞台上显示同一张表", "探索モードの 3D 関係図。? で舞台上にも表示"],
    source: ["app/knowledge-graph-three.tsx", "app/three-stage-chrome.tsx"],
    entries: [
      { id: "search", keys: ["/"], label: ["全文搜索", "全文検索"] },
      { id: "fullscreen", keys: ["F"], label: ["全屏", "全画面"] },
      { id: "dossier", keys: ["D"], label: ["档案居中／停靠", "資料を中央／ドック"] },
      { id: "open", keys: ["O"], label: ["打开完整记忆", "記憶の全文を開く"] },
      { id: "zoom", keys: ["+", "−"], label: ["文字缩放", "文字の拡大・縮小"] },
      { id: "zoomReset", keys: ["0"], label: ["文字恢复 100%", "文字を 100% に戻す"] },
      { id: "step", keys: ["←", "→"], label: ["切换节点", "ノードを切り替え"] },
      { id: "pause", keys: ["P"], label: ["暂停／继续动态", "動きを一時停止／再開"] },
      { id: "reset", keys: ["R"], label: ["回到全景（不触发全库重读）", "全景に戻る（全体の再読み込みはしない）"] },
      { id: "help", keys: ["?"], label: ["显示／隐藏快捷键", "ショートカットの表示／非表示"] },
    ],
  },
  {
    id: "timeline3d",
    title: ["时间航道", "タイムライン航路"],
    scope: ["探索模式 · 3D 时间线；/、F、D、O、缩放与 P、? 同星图", "探索モードの 3D タイムライン。/・F・D・O・拡大縮小・P・? は星図と同じ"],
    source: ["app/timeline-three.tsx"],
    entries: [
      { id: "view", keys: ["V"], label: ["俯瞰／巡航切换", "俯瞰／巡航の切り替え"] },
      { id: "step", keys: ["←", "→"], label: ["切换日期", "日付を切り替え"] },
      { id: "month", keys: ["[", "]"], label: ["月份跳跃（PgUp／PgDn 同效）", "月単位で移動（PgUp／PgDn でも可）"] },
      { id: "home", keys: ["Home"], label: ["回到当下", "現在に戻る"] },
      { id: "end", keys: ["End"], label: ["最早的一站", "最も古い地点へ"] },
      { id: "reset", keys: ["R"], label: ["回到当下（不触发全库重读）", "現在に戻る（全体の再読み込みはしない）"] },
    ],
  },
];
