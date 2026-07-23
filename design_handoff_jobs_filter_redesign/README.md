# Handoff: AI 推荐岗位筛选台 — 重新设计（双栏 + 多视图）

## Overview
这是对现有 `回声 / ObsidianWeb` 求职看板中 **AI 推荐岗位** 界面（`app/jobs-view.tsx`）的重新设计。目标是把原来的「横向 chip 筛选行 + 双列卡片」升级为 **双栏筛选台**：左侧常驻分组筛选栏、右侧更宽的结果区，并新增 **卡片 / 列表 / 看板 / 周复盘** 四种视图。功能不变（同样的 facet、搜索、排序、状态下拉、并排对比），改的是信息架构与视觉层级。

## About the Design Files
本目录里的 `AI推荐岗位筛选台.dc.html` 是一个 **用 HTML 做的设计参考稿**（原型），演示预期的外观与交互，**不是可以直接拷进代码库的生产代码**。它用一套自带的模板运行时（`support.js`）+ 内联示例数据渲染，与你的 Next.js 环境无关。

任务是：**在现有 `ObsidianWeb` 代码库（Next.js + React + 全局 CSS）里，用它已有的模式与数据，重现这份设计**——沿用 `@/lib/jobs`、`@/lib/job-status`、`@/lib/notes` 中已经存在的派生逻辑与类型，只改 `app/jobs-view.tsx` 的结构/JSX 和 `app/globals.css` 里 `.jobs-view` 相关样式。不要引入设计稿的运行时或内联假数据。

## Fidelity
**High-fidelity (hifi)。** 颜色、字号、间距、圆角、边框、交互态都是最终值，请按下文 Design Tokens 与各视图规格 **像素级** 还原，落到代码库的 CSS 变量/类名体系中。

---

## 复用现有代码（重要）
设计稿里用内联 JS 重新实现了一遍筛选逻辑，**代码库里已经有对应实现，请直接复用，不要重写**：

- `@/lib/job-status.ts` — `JOB_STATUSES` 枚举（顺序即看板/筛选展示顺序）：`未応募 / 応募済 / 書類通過 / 面接中 / 内定 / 保留 / 不採用`；`DEFAULT_JOB_STATUS`、`normalizeJobStatus`、`isJobStatus`。看板列顺序、状态下拉选项都用它，别硬编码。
- `@/lib/jobs.ts` — `toJobCard`、`compareJobs`、`jobMatchesQuery`、`JOB_SORTS`、`VERIFICATION_LABEL`、`OFFICIAL_APPLY_LABEL`、`JobCard / JobSort / JobVerification` 类型。卡片数据、搜索、排序、对比都走这里。
- `app/jobs-view.tsx` 现有常量 `RATING_STEPS`、`SALARY_STEPS`、`VERIFICATIONS`、`COMPARE_LIMIT`、`Filters` / `EMPTY_FILTERS`、`toggle`、`salaryLabel`、`<Highlight>` — 全部保留。
- 状态来自笔记的 `status`（经 `normalizeJobStatus`）与 `date` 字段；salary 来自 `JobCard.salary`（`{ min, max, estimated }`）。周复盘和看板的分组就建立在这两者之上。

设计稿里的 `JOBS` 数组、`decorate()`、`facetCount()`、`buildChips()` 只是为了让原型能独立运行——**对照它们理解数据形状即可，实现时接你真实的 notes 数据源。**

---

## Screens / Views
容器 `.jobs-view` 内为两部分：顶部 section intro（标题 + 统计），下方 `grid-template-columns: 280px minmax(0,1fr)` 的双栏（左筛选栏 aside + 右结果区）。

### 1. Section intro（顶部）
- 背景 `#fbfaf6`，下边框 `1px solid #e0dcd2`，内边距 `34px 40px 24px`，flex 两端对齐。
- 左：小标签「AI JOB MATCH」（Geist Mono 9px，字距 .18em，`#8e938f`，前置 6px 橙点 `#e66d45`）；H1「AI 推荐岗位」（Noto Serif SC 44px，weight 520，letter-spacing −.03em）；一段说明文（max-width 560px，12px，行高 1.75，`#777e79`，其中「分析/假设」用 `#b5842f` 加粗强调）。
- 右：4 个统计块，右对齐，数值 30px weight 600，标签 11px `#6f7772`：**条推荐 / 8 点以上 / 未应募 / 最高年収**。

### 2. 左侧筛选栏 aside（280px，sticky top:0）
背景 `#fbfaf6`，右边框 `1px solid #e0dcd2`，内边距 `22px 22px 30px`。顶部一行：左「筛选 · FILTERS」（Geist Mono 10px）、右「重置(n)」文字按钮（`#e66d45`，选中筛选数 >0 时显示计数）。下面 5 个分组，组间距 22px，每组标题 10.5px 字距 .12em `#8e938f`，chips `flex-wrap` gap 6px：
- **应募状态** — 来自 `JOB_STATUSES` 的 facet（多选）
- **匹配度** — `RATING_STEPS`（单选：全部 / 7+ / 8+ / 9+）
- **年収上限** — `SALARY_STEPS`（单选）+ 末尾「リモート可」开关 chip
- **技術スタック** — stack facet，按出现次数降序（多选）
- **原文核对** — `VERIFICATIONS`，标签用 `VERIFICATION_LABEL`（多选）

每个 chip 右侧带一个 facet 计数 `<small>`（10.5px，opacity .6）。chip 两态见 Design Tokens。

### 3. 结果区（右栏，padding 22px 26px 34px）
**Toolbar**（flex，gap 10px，高 40px）：
- 搜索框 flex:1，含 ⌕ 图标，placeholder「搜索公司、职位、技术栈、推荐理由…」；边框 `1px solid #d8d5ca` 背景 `#fbfaf6`。
- 排序 `<select>`：匹配度 / 年収上限 / 更新时间 / 公司名（用现有 `JOB_SORTS`）。
- **视图切换段**（新增）：一个 4 段联排按钮组，边框包裹，段间 `1px solid #e0dcd2` 竖分隔：**卡片 / 列表 / 看板 / 周复盘**。选中段 `#18231e` 底 `#f3f0e8` 字，未选中透明底 `#6f7772` 字。

卡片/列表/看板视图上方有一行结果计数：左「**n** / total 条 · 关键词「…」」，右「已选 m 个筛选」（Geist Mono 10px `#959a96`）。周复盘视图不显示这行。空结果显示虚线框提示 + 「清空筛选」按钮。

#### 3a. 卡片视图（默认）
2 列网格（`repeat(2,minmax(0,1fr))` gap 14px）。每张卡（`#fbfaf6`，`1px solid #d8d5ca`，padding 20px 22px，flex column gap 13px，hover 轻微上浮）：
- **header**：左侧 46px 圆形匹配度徽章（底色 `accentSoft(rating)`，数字 Noto Serif SC 22px，色 `accent(rating)`）+ 公司名（17px 600）/ 职位（12.5px `#6f7772`）；右侧原文核对徽章（`VERIFICATION_LABEL`，配色见 verifyStyle）。
- **薪资行**：`salaryLabel` 用 Noto Serif SC 22px weight 600 `#2f6b59`，后跟「匹配度 r/10」11px `#959a96`。
- **元信息 chips**：雇用形态、勤務地边框 chip；`remote` 为真时加紫色「リモート可」chip（`#7466a9`）。
- **技術スタック tags**：Geist Mono 11px，`#7466a9` 字 / `rgba(116,102,169,.09)` 底。
- **推荐理由**：上分隔线，小标签「推荐理由」+ 截断到 ~92 字的 reason（12.5px 行高 1.65）。
- **footer**：状态下拉（`<select>` 覆盖在彩色 pill 上，选项 = `JOB_STATUSES`，配色见 statusStyle）、对比按钮（切换加入对比，满 `COMPARE_LIMIT=3` 时禁用，已选态紫色）、详情按钮（右对齐）。

#### 3b. 列表视图（新增）
一个表格式列表，边框卡包裹。列模板 `minmax(0,2.4fr) 62px minmax(0,1.2fr) minmax(0,1.9fr) 96px 84px`，gap 14px：**公司/职位 · 匹配 · 年収 · 技術スタック · 状态 · 核对**。表头 Geist Mono 9px 字距 .12em `#959a96`，行间 `1px solid #ece9e0`，整行可点。匹配度用 Noto Serif SC 17px 上色；stack tags 单行溢出隐藏（max-height 22px）。

#### 3c. 看板视图（新增）
横向可滚动的状态列。列顺序 = `JOB_STATUSES`；核心列 `未応募/応募済/書類通過/面接中/内定` 始终显示，`保留/不採用` 仅有数据时显示。每列宽 228px，`#fbfaf6` 底、`1px solid #e0dcd2`、顶部 3px 状态色条（statusStyle 的字色）。列头：状态名 + 计数。列内卡片（白底、左 3px accent 色条、padding 11px 12px）：公司名 + 匹配度、职位（单行省略）、年収。空列显示「—」。

> 分组依据：`normalizeJobStatus(note.status)` 落到 `JOB_STATUSES`。这正是拖拽改状态可对接的结构（设计稿未做拖拽，但列结构已按 DnD 预留）。

#### 3d. 周复盘视图（新增）
顶部周导航：`‹` / 周标题（本周复盘 / n 周前 / n 周后，Noto Serif SC 20px）+ 周范围（Geist Mono 10px）/ `›`。当前周（offset 0）有数据，其它周演示为空态「这一周还没有求职记录。」。有数据时：
- **4 个 KPI 卡**（`repeat(4,1fr)` gap 12px）：本周应募/进展、面接进行中、选考推进中、待投递(8+)。数值 Noto Serif SC 30px 上色，标签 11px。
- 下方 `minmax(0,1.35fr) minmax(0,1fr)` 两栏：
  - 左「本周动态 · TIMELINE」：按 `date` 落在本周（`2026-07-14`〜`2026-07-20`）的岗位，按日期倒序，每行 `7/日` + 状态色点 + 公司 + 事件文案（由状态推导）。
  - 右上「下周重点 · NEXT」：面接中/書類通過/9+ 未応募 的待办清单（复选框占位 + 公司 + action，action 里拼接该岗位 caution）。
  - 右下「复盘提醒」琥珀色便签（`rgba(181,132,47,.06)` 底、`#b5842f` 标题），文案强调「状态/日期是证据层，AI 匹配度只是假设」。

> KPI 与时间线的口径都来自笔记的 `status` + `date`；实现时把设计稿里写死的 `2026-07-14/20` 换成「以选中周为准」的真实区间。

### 全局浮层（沿用现有并排对比）
- **对比工具条**：选中 ≥1 个岗位后，底部居中深色条（`#18231e`），显示 `n/3 已选`、已选岗位可点移除、「并排对比」按钮（≥2 才可用）、清空。
- **对比 Modal**：≥2 岗位点开后，`repeat(n,1fr)` 并排卡，逐项对比匹配度/年収/勤務地/状态/原文核对/技術スタック/推荐理由/注意点。这套代码库里已有，保留即可。

---

## Interactions & Behavior
- **筛选**：状态/技術/核对多选（toggle），匹配度/年収单选（阈值），リモート开关；facet 计数实时反映数据。「重置」清空全部并显示已选计数。
- **搜索**：空格分词 AND 匹配 company/position/stack/location/reason；沿用 `jobMatchesQuery` + `<Highlight>` 高亮命中。
- **排序**：匹配度（默认，次级按公司名 ja localeCompare）/ 年収上限 / 更新时间 / 公司名 —— 用 `JOB_SORTS` / `compareJobs`。
- **视图切换**：`viewMode` 状态在 card/list/kanban/weekly 间切换；周复盘不受筛选影响（或按需接筛选），其余三视图共享同一 `visible` 结果集。
- **状态改写**：卡片/详情里的状态下拉写回笔记 `status`（设计稿用本地 `statusOverride` 演示；真实实现走你现有的写回路径）。
- **对比**：最多 3 个，满额禁用加入按钮；≥2 可打开 Modal。
- **hover/transition**：卡片 `transform 160ms ease, box-shadow 160ms ease` 轻微上浮；chip、按钮即时态切换，无额外动画。

## State Management
需要的 UI 状态（大多已在 `jobs-view.tsx`）：
- `filters: Filters`（statuses / minRating / minSalary / stacks / regions / sources / verifications / remoteOnly）
- `query: string`、`sort: JobSort`
- `compare: string[]`（岗位 id，≤ `COMPARE_LIMIT`）、`compareOpen: boolean`
- **新增** `viewMode: "card" | "list" | "kanban" | "weekly"`（默认 `"card"`）
- **新增** `weekOffset: number`（周复盘导航，0 = 本周）
- 状态改写走现有笔记写回；不要引入设计稿的 `statusOverride` 本地映射。

## Design Tokens
颜色（沿用代码库现有纸墨主题，勿新造）：
- 纸底 `#f3f0e8`；卡/栏底 `#fbfaf6`；画布底（设计稿外层）`#e7e3d8`
- 墨绿主色 `#18231e`；正文次色 `#6f7772` / `#777e79`；弱色 `#8e938f` / `#959a96`
- 强调橙 `#e66d45`（hover `#ee7c55`）；链接同橙
- 绿（薪资/通过）`#2f6b59`；琥珀（未応募/警示）`#b5842f`；紫（技術/对比）`#7466a9`
- 边框 `#d8d5ca`（强）/ `#e0dcd2` / `#ece9e0` / `#e4e0d7`（弱）

匹配度 accent 阶梯：`≥9 #e66d45`、`≥7 #2f6b59`、`≥5 #b5842f`、`else #6f7772`；对应 `accentSoft` 为同色 `.12` alpha。

**状态配色 statusStyle**：未応募 → 琥珀（`#b5842f`/底 .08/边 .4）；応募済·書類通過·面接中 → 绿（`#2f6b59`）；内定 → 绿底白字（底 `#2f6b59` 字 `#f3f0e8`）；不採用 → 灰（`#8f938e`/透明/边 `#d8d5ca`）。
**核对配色 verifyStyle**：verified → 绿；warned → 橙；unchecked → 灰。

Chip 两态：
- 默认 `border:1px solid #d8d5ca; background:transparent; color:#6f7772; padding:4px 11px; font-size:12px; border-radius:2px;`
- 选中 `border:1px solid #18231e; background:#18231e; color:#f3f0e8;`（其余同上）

字体：`Noto Serif SC`（标题/数值）、`Noto Sans SC`（正文）、`Geist Mono`（标签/计数/字距强调）。代码库里已有对应字体栈时用代码库的（宋体 Songti SC + Geist Mono），Noto Serif/Sans SC 是 Web 预览的替身。
圆角：普遍 2–3px（几乎方角）；匹配度徽章 50% 圆形。阴影：容器 `0 24px 60px rgba(28,37,32,.14)`；对比 Modal `0 30px 80px rgba(28,37,32,.3)`；对比条 `0 18px 45px rgba(24,35,30,.4)`。
间距尺度常用：6 / 10 / 12 / 14 / 22 / 26 / 34 / 40px。

## Assets
无图片/图标资源。图标用 Unicode 字形（⌕ 搜索、‹ › 周导航、⌄ 下拉、× 关闭）。字体走 Google Fonts（预览）或代码库现有字体栈（生产）。

## Files
- `AI推荐岗位筛选台.dc.html` — 本设计的完整原型（含 1b 新设计 + 1a 现状还原两版并列；以 **1b** 为准，1a 只是对照）。
- 目标改动文件：`app/jobs-view.tsx`（结构 + `viewMode`/`weekOffset` + 三个新视图）、`app/globals.css`（`.jobs-view` 起，约 3308 行附近）。
- 复用不改：`lib/job-status.ts`、`lib/jobs.ts`、`lib/notes.ts`。
