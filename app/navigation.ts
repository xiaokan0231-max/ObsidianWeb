import type { AppView } from "./app-route.ts";
import type { UiLocale } from "../lib/ui-locale.ts";

/*
 * 导航表的正本：左栏、顶部章节带、移动端底栏、⌘K 页面命令都从这里读。
 *
 * 为什么单独成模块：以前左栏的表住在 memory-atlas.tsx 里，⌘K 的命令另写了三条，
 * 新增一页时只改了一边，搜索面板里就永远跳不过去。放在无 JSX 的纯数据模块里，
 * node 测试能直接 import，检查「每个视图都能从导航和 ⌘K 到达」。
 */

export type PrimaryNavId =
  | "actions"
  | "career"
  | "interview"
  | "training"
  | "resources"
  | "settings";
export type NavIconName = "actions" | "career" | "interview" | "training" | "resources" | "settings";

export type PrimaryNavigationItem = {
  id: PrimaryNavId;
  label: string;
  mobileLabel: string;
  glyph: NavIconName;
  target: AppView;
  views: AppView[];
  /** footer：渲染在侧栏底部（收起按钮上方），数据仍留在这张表里，⌘K 与可达性测试照常覆盖。 */
  placement?: "footer";
};

export type SecondaryNavigationItem = {
  id: AppView;
  label: string;
  // 二级菜单是「章节标签」：汉字印章负责一眼辨认，拉丁小字负责分层，两者都不是装饰的可选项。
  glyph: string;
  caption: string;
};

// 日历作为首页，先查看已约定的日程，再进入对应的求职和面试材料。
export const NAVIGATION: PrimaryNavigationItem[] = [
  {
    id: "actions",
    label: "日历",
    mobileLabel: "日历",
    glyph: "actions",
    target: "calendar",
    views: ["calendar", "actions", "activity"],
  },
  {
    id: "interview",
    label: "面试作战",
    mobileLabel: "面试",
    glyph: "interview",
    target: "session",
    views: ["session", "review", "insights", "practice", "prep"],
  },
  {
    id: "training",
    label: "训练中心",
    mobileLabel: "训练",
    glyph: "training",
    target: "language",
    views: ["language", "topics", "reading"],
  },
  {
    id: "career",
    label: "求职",
    mobileLabel: "求职",
    glyph: "career",
    target: "jobs",
    views: ["jobs", "analytics"],
  },
  {
    id: "resources",
    label: "资料库",
    mobileLabel: "资料",
    glyph: "resources",
    target: "library",
    views: ["library", "timeline", "graph"],
  },
  {
    id: "settings",
    label: "设置",
    mobileLabel: "设置",
    glyph: "settings",
    target: "settings",
    views: ["settings"],
    placement: "footer",
  },
];

export const SECONDARY_NAVIGATION: Partial<Record<PrimaryNavId, SecondaryNavigationItem[]>> = {
  actions: [
    { id: "calendar", label: "日历", glyph: "暦", caption: "CALENDAR" },
    { id: "activity", label: "最近进展", glyph: "報", caption: "RECENT UPDATES" },
  ],
  career: [
    { id: "jobs", label: "岗位机会", glyph: "機", caption: "OPPORTUNITIES" },
    { id: "analytics", label: "选考与分析", glyph: "選", caption: "PIPELINE" },
  ],
  interview: [
    { id: "session", label: "面试准备", glyph: "準", caption: "INTERVIEW PREP" },
    { id: "review", label: "面试复盘", glyph: "復", caption: "REVIEW" },
    { id: "insights", label: "公司对比", glyph: "比", caption: "COMPARE" },
    { id: "practice", label: "回答重练", glyph: "練", caption: "PRACTICE" },
    { id: "prep", label: "通用准备", glyph: "備", caption: "PLAYBOOK" },
  ],
  training: [
    { id: "language", label: "日语训练", glyph: "話", caption: "NIHONGO" },
    { id: "topics", label: "专项训练", glyph: "専", caption: "FOCUS" },
    { id: "reading", label: "专题速览", glyph: "読", caption: "READING" },
  ],
  resources: [
    { id: "library", label: "全部资料", glyph: "庫", caption: "ARCHIVE" },
    { id: "timeline", label: "时间线", glyph: "歴", caption: "TIMELINE" },
    { id: "graph", label: "关系图", glyph: "網", caption: "GRAPH" },
  ],
};

const JAPANESE_PRIMARY_LABELS: Record<PrimaryNavId, { label: string; mobileLabel: string }> = {
  actions: { label: "カレンダー", mobileLabel: "予定" },
  career: { label: "就職活動", mobileLabel: "就活" },
  interview: { label: "面接対策", mobileLabel: "面接" },
  training: { label: "トレーニング", mobileLabel: "練習" },
  resources: { label: "資料ライブラリ", mobileLabel: "資料" },
  settings: { label: "設定", mobileLabel: "設定" },
};

const JAPANESE_SECONDARY_LABELS: Record<Exclude<AppView, "calendar">, string> = {
  actions: "あなたの対応が必要",
  activity: "最近の進展",
  jobs: "求人・応募先",
  analytics: "選考・分析",
  session: "面接準備",
  prep: "基本の準備",
  review: "面接の振り返り",
  insights: "企業比較",
  practice: "回答練習",
  language: "日本語練習",
  topics: "テーマ別練習",
  reading: "テーマ別資料",
  library: "すべての資料",
  timeline: "タイムライン",
  graph: "関連図",
  settings: "設定",
};

/** 只翻译显示文言，让两种语言共用同一套 URL 和视图归属。 */
export function getNavigation(locale: UiLocale): PrimaryNavigationItem[] {
  if (locale === "zh-CN") return NAVIGATION;
  return NAVIGATION.map((item) => ({ ...item, ...JAPANESE_PRIMARY_LABELS[item.id] }));
}

export function getSecondaryNavigation(locale: UiLocale): Partial<Record<PrimaryNavId, SecondaryNavigationItem[]>> {
  if (locale === "zh-CN") return SECONDARY_NAVIGATION;
  return Object.fromEntries(
    Object.entries(SECONDARY_NAVIGATION).map(([id, items]) => [
      id,
      items.map((item) => ({
        ...item,
        label: item.id === "calendar" ? "カレンダー" : JAPANESE_SECONDARY_LABELS[item.id],
      })),
    ]),
  );
}

/**
 * 二级导航住在哪：
 * 资料库的三项是**同一批笔记的三种看法**（列表・时序・关系），切换是浏览时的常态动作，
 * 值得在内容区顶部常驻一条章节标签带。
 * 面试作战・训练中心的子项是三件**不同的事**，内容互不相干，切换属于换任务——
 * 那种跳转归左栏。而且这两个分区的页面自己已经有一层切换（当前面试的 6 章节导航、
 * 专项训练的 5 种练法），再压一条带子就是三层标签叠在 150px 里。
 *
 * 移动端没有左栏，所以那两个分区的带子在 820px 以下会回来（CSS 按 data-placement 切）。
 */
export const TOP_BAR_SECTION_IDS: ReadonlySet<PrimaryNavId> = new Set<PrimaryNavId>(["career", "resources"]);

export const MOBILE_PRIMARY_NAV_IDS: ReadonlySet<PrimaryNavId> = new Set<PrimaryNavId>([
  "actions",
  "career",
  "interview",
]);

/** 事项是进展工作区内的记录页，保留旧链接但不再占一个导航入口。 */
export function navigationView(view: AppView): AppView {
  return view === "actions" ? "activity" : view;
}

export type PageCommand = {
  view: AppView;
  label: string;
  description: string;
  keywords: string;
};

/**
 * ⌘K 里的一句说明和检索词。名字（label）不写在这里，从导航表取——
 * 左栏改名时 ⌘K 跟着变，不会出现两边叫法不同的同一页。
 * 检索词混写中・日・英：本人会按当时脑子里的那个词去搜（「応募」「复盘」「calendar」都有）。
 */
const PAGE_COMMAND_HINTS: Record<AppView, { description: string; keywords: string }> = {
  actions: { description: "你现在必须采取的具体行动与待核事项", keywords: "需要你处理 本人 待办 任务 确认 action todo task 対応 確認" },
  activity: { description: "查看选考进展、待关注事项与处理记录", keywords: "最近 进展 进度 日报 回复 记录 需要你处理 待办 事项 todo action activity updates recent daily 進展 経過 記録" },
  calendar: { description: "已约定的面试与面谈日程", keywords: "日历 首页 日程 安排 面试时间 home calendar schedule 予定 カレンダー" },
  jobs: { description: "判断下一项応募", keywords: "岗位 机会 求职 応募 求人 就職 就活 job" },
  analytics: { description: "选考进度、渠道与到达率", keywords: "选考 分析 进度 统计 漏斗 渠道 pipeline analytics progress 選考 応募状況" },
  session: { description: "当前这场面试的准备稿与话术", keywords: "本场 面试 当日 准备稿 session interview 面接 本番 志望動機 逆質問" },
  prep: { description: "通用回答库与标准答案", keywords: "通用 准备 回答库 标准答案 playbook prep answers 回答集 自己紹介" },
  review: { description: "面试复盘与待裁定的批注", keywords: "复盘 面试 裁定 批注 review 振り返り 反省" },
  insights: { description: "并排比较公司的外部口碑、岗位契合与工作条件", keywords: "公司 企业 对比 比较 外部 评价 评分 口碑 岗位 条件 近期 高分 OpenWork 転職会議 compare company insights 横向 对照 企業 比較 評価" },
  practice: { description: "开始今天的素振り", keywords: "回答 重练 练习 practice 面试 面接 練習 素振り" },
  language: { description: "日语表达与会话训练", keywords: "日语 训练 会话 日本語 nihongo japanese language 敬語" },
  topics: { description: "按专项练习日语表达", keywords: "专项 训练 表达 课程 topics focus course 表現 練習" },
  reading: { description: "按专题阅读表达清单与学习资料", keywords: "专题 速览 阅读 表达 清单 资料 reading reference themes テーマ 資料 一覧 読む" },
  library: { description: "浏览全部笔记与资料", keywords: "资料 全部 笔记 资料库 library archive notes ノート 資料" },
  timeline: { description: "按时间回看事件与记录", keywords: "时间线 历史 时序 timeline history 年表 履歴" },
  graph: { description: "笔记之间的关系图", keywords: "关系 关系图 图谱 双链 graph network links 関係 グラフ" },
  settings: { description: "皮肤配色、界面语言、侧栏与各页默认偏好", keywords: "设置 偏好 配置 皮肤 主题 配色 外观 语言 快捷键 settings preferences theme skin appearance 設定 環境設定 テーマ 着せ替え 外観" },
};

const JAPANESE_COMMAND_DESCRIPTIONS: Record<AppView, string> = {
  actions: "今あなたが行う必要のある具体的な対応と確認待ち事項",
  activity: "選考の進展・確認事項・対応の記録を見る",
  calendar: "確定した面接・面談の予定",
  jobs: "次の応募先を検討する",
  analytics: "選考の進捗・応募経路・通過率",
  session: "今回の面接の準備メモ・回答例",
  prep: "共通の回答集・標準回答",
  review: "面接の振り返り・未確認のコメント",
  insights: "企業の口コミ・職種の適合・勤務条件を並べて比較する",
  practice: "今日の回答練習を始める",
  language: "日本語の表現・会話練習",
  topics: "テーマ別に日本語表現を練習する",
  reading: "テーマ別の表現一覧と学習資料を読む",
  library: "すべてのノート・資料を見る",
  timeline: "出来事・記録を時系列で振り返る",
  graph: "ノート同士のつながりを見る",
  settings: "スキン・表示言語・サイドバーと各ページの既定動作",
};

/** 每个视图恰好一条，顺序与左栏一致。 */
export function getPageCommands(locale: UiLocale): readonly PageCommand[] {
  const commands: PageCommand[] = [];
  const seen = new Set<AppView>();
  const secondaryNavigation = getSecondaryNavigation(locale);
  for (const primary of getNavigation(locale)) {
    const secondary = secondaryNavigation[primary.id] ?? [];
    for (const view of primary.views) {
      if (navigationView(view) !== view) continue;
      if (seen.has(view)) continue;
      seen.add(view);
      const label = secondary.find((item) => item.id === view)?.label ?? primary.label;
      const chineseLabel = SECONDARY_NAVIGATION[primary.id]?.find((item) => item.id === view)?.label ?? NAVIGATION.find((item) => item.id === primary.id)?.label ?? "";
      const japaneseLabel = view === "calendar" ? "カレンダー" : JAPANESE_SECONDARY_LABELS[view];
      commands.push({
        view,
        label,
        // 切换界面语言后，仍可用另一种语言的菜单名找到同一页。
        keywords: `${PAGE_COMMAND_HINTS[view].keywords} ${chineseLabel} ${japaneseLabel}`,
        description: locale === "ja" ? JAPANESE_COMMAND_DESCRIPTIONS[view] : PAGE_COMMAND_HINTS[view].description,
      });
    }
  }
  return commands;
}

export const PAGE_COMMANDS: readonly PageCommand[] = getPageCommands("zh-CN");

/**
 * 没输入关键词时只摆这几条：全部页面按钮摊开，搜索面板就先变成了第二个左栏，
 * 盖住下面的快捷查询。这三件是每天都会做的事。
 */
export const DEFAULT_PAGE_COMMAND_VIEWS: readonly AppView[] = ["calendar", "session", "jobs"];
