import type { AppView } from "./app-route.ts";

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
  | "resources";
export type NavIconName = "actions" | "career" | "interview" | "training" | "resources";

export type PrimaryNavigationItem = {
  id: PrimaryNavId;
  label: string;
  mobileLabel: string;
  glyph: NavIconName;
  target: AppView;
  views: AppView[];
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
    views: ["calendar"],
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
    id: "interview",
    label: "面试作战",
    mobileLabel: "面试",
    glyph: "interview",
    target: "session",
    views: ["session", "prep", "review", "insights", "practice"],
  },
  {
    id: "training",
    label: "训练中心",
    mobileLabel: "训练",
    glyph: "training",
    target: "language",
    views: ["language", "topics"],
  },
  {
    id: "resources",
    label: "资料库",
    mobileLabel: "资料",
    glyph: "resources",
    target: "library",
    views: ["library", "timeline", "graph"],
  },
];

export const SECONDARY_NAVIGATION: Partial<Record<PrimaryNavId, SecondaryNavigationItem[]>> = {
  career: [
    { id: "jobs", label: "岗位机会", glyph: "機", caption: "OPPORTUNITIES" },
    { id: "analytics", label: "选考与分析", glyph: "選", caption: "PIPELINE" },
  ],
  interview: [
    { id: "session", label: "本场面试", glyph: "場", caption: "SESSION" },
    { id: "prep", label: "通用准备", glyph: "備", caption: "PLAYBOOK" },
    { id: "review", label: "面试复盘", glyph: "復", caption: "REVIEW" },
    { id: "insights", label: "横向对照", glyph: "比", caption: "INSIGHTS" },
    { id: "practice", label: "回答重练", glyph: "練", caption: "PRACTICE" },
  ],
  training: [
    { id: "language", label: "日语训练", glyph: "話", caption: "NIHONGO" },
    { id: "topics", label: "专项训练", glyph: "専", caption: "FOCUS" },
  ],
  resources: [
    { id: "library", label: "全部资料", glyph: "庫", caption: "ARCHIVE" },
    { id: "timeline", label: "时间线", glyph: "歴", caption: "TIMELINE" },
    { id: "graph", label: "关系图", glyph: "網", caption: "GRAPH" },
  ],
};

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
  calendar: { description: "已约定的面试与面谈日程", keywords: "日历 首页 日程 安排 面试时间 home calendar schedule 予定 カレンダー" },
  jobs: { description: "判断下一项応募", keywords: "岗位 机会 求职 応募 job" },
  analytics: { description: "选考进度、渠道与到达率", keywords: "选考 分析 进度 统计 漏斗 渠道 pipeline analytics progress 選考 応募状況" },
  session: { description: "当前这场面试的准备稿与话术", keywords: "本场 面试 当日 准备稿 session interview 面接 本番 志望動機 逆質問" },
  prep: { description: "通用回答库与标准答案", keywords: "通用 准备 回答库 标准答案 playbook prep answers 回答集 自己紹介" },
  review: { description: "面试复盘与待裁定的批注", keywords: "复盘 面试 裁定 批注 review 振り返り 反省" },
  insights: { description: "跨场面试的顾问分析与多轮对照", keywords: "横向 对照 洞察 顾问 分析 跨面试 insights advisory 横断 傾向" },
  practice: { description: "开始今天的素振り", keywords: "回答 重练 练习 practice 面试" },
  language: { description: "日语表达与会话训练", keywords: "日语 训练 会话 日本語 nihongo japanese language 敬語" },
  topics: { description: "按专项练习日语表达", keywords: "专项 训练 表达 课程 topics focus course 表現 練習" },
  library: { description: "浏览全部笔记与资料", keywords: "资料 全部 笔记 资料库 library archive notes ノート 資料" },
  timeline: { description: "按时间回看事件与记录", keywords: "时间线 历史 时序 timeline history 年表 履歴" },
  graph: { description: "笔记之间的关系图", keywords: "关系 关系图 图谱 双链 graph network links 関係 グラフ" },
};

/** 每个视图恰好一条，顺序与左栏一致。 */
export const PAGE_COMMANDS: readonly PageCommand[] = (() => {
  const commands: PageCommand[] = [];
  const seen = new Set<AppView>();
  for (const primary of NAVIGATION) {
    const secondary = SECONDARY_NAVIGATION[primary.id] ?? [];
    for (const view of primary.views) {
      if (seen.has(view)) continue;
      seen.add(view);
      const label = secondary.find((item) => item.id === view)?.label ?? primary.label;
      commands.push({ view, label, ...PAGE_COMMAND_HINTS[view] });
    }
  }
  return commands;
})();

/**
 * 没输入关键词时只摆这几条：全部页面按钮摊开，搜索面板就先变成了第二个左栏，
 * 盖住下面的快捷查询。这三件是每天都会做的事。
 */
export const DEFAULT_PAGE_COMMAND_VIEWS: readonly AppView[] = ["calendar", "session", "jobs"];
