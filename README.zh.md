# ObsidianWeb

**以 Obsidian vault 为唯一数据源、不带数据库的本地优先知识工作台。**

一堆 Markdown 笔记（frontmatter・双链・标题）本身就是领域模型，
由它实时构建案件看板、日历、面试准备、时间线、3D 知识图谱和学习闭环。
Next.js (vinext) / React 19 / TypeScript，部署到 Cloudflare Workers。

![ObsidianWeb](public/og.png)

- 🇯🇵 [日本語](README.md) ・ 🇬🇧 [English](README.en.md)

---

## 这个设计有意思在哪

### 1. 「不要数据库」是个主动决定

`db/schema.ts` **是空的，且是有意为之**。持久层就是 Obsidian 的 vault——一个 Markdown 目录。

```
Obsidian (Local REST API) ──► app/api/vault?scope=… ──► readAllNotes() ──► 各视图
        ▲                          │
        └── 写回：状态改 frontmatter 标量行／复盘・练习追记到专用笔记 ──┘
```

- 不做副本 ⇒ **二重口径在结构上无法产生**。在 Obsidian 改还是在网页改，事实都只有一份。
- API key 只存在于服务端进程，不进浏览器代码、不进仓库（`lib/server/obsidian.ts`）。
- 写回原语只有两个。**状态**（案件的状态・渠道・跟进，TODO 的状态）走 `lib/server/frontmatter-patch.ts`，
  只替换各路由允许的 key 的标量行，正文一个字不碰；**记录**（复盘的批注・反馈・练习）走
  `lib/server/note-append.ts`，追记到专用笔记的正文。由于「读→改→写」不是原子操作，
  每条路由按笔记路径分片串行（`createKeyedSerialQueue`），不同笔记、不同路由互不等待。
- 乐观锁：有 `status_updated` 的案件带它、TODO 带磁盘上的 `mtime` 作为版本，不一致就返回 409 让页面重新加载。
  案件状态写完之后把派生统计标成 `derivedState: stale`，在 `vault:stats` 重跑前不冒充「同一时点的汇总」。
- 投递渠道是**历史事实**，改状态时不允许覆盖；未评分显示「—」而不是 0 分。

### 2. 「生成区块」：派生值的单一事实源

汇总数、占比、推移这类**派生数据，机制上禁止人手写**。

```markdown
<!-- generated:<id> 勿手改 -->
（只有脚本能改这里）
<!-- /generated -->
```

派生值一旦被打成散文就和上游断开：上游变它不变，写错也没人报错。
这个事故真的发生过，所以把**事实（人写）和派生（机器算）**分成两类，
由 `npm run vault:check`（frontmatter 校验）和 `npm run vault:stats`（重新生成）强制。

同一思路也用在评价数据上。公司的六维契合评价只从 frontmatter 的结构化 YAML 里画，
没有依据的轴保持 `null`、**留空**，不合成总分（`lib/company-overview.ts`）。
schema 版本和评价口径版本分开记，旧口径的雷达不会和新口径并排比较。

### 3. 检查不放 CI，放三层

vault 是「换台机器可能根本不存在」的外部数据，绑进代码测试会让 CI 无故变红，
红灯多了就没人看了。于是拆成三层：

| 层 | 触发 | 行为 |
|---|---|---|
| Agent 的 Stop hook | AI 每轮回答结束 | 不一致就 **exit 2 拦住**，理由回灌给 AI |
| `npm run dev` 启动 | 你要看页面时 | 只 warning，不阻塞 |
| vault 仓库 pre-commit | `git commit` 时 | 不一致就**拒绝提交** |

`vault:check` 校验的不只是枚举值：准备稿各版本（`prep_version`）的章节结构、
`case`／`meeting` 二选一、公司画像与契合报告的嵌套 YAML 都在内。

### 4. 增量缓存：按「运行时没有 fs」来设计

每次读全库太慢，但服务端跑在 workerd 上（`nodejs_compat` 是虚拟文件系统），拿不到 `fs` 的 mtime。

于是改成**给 REST API 的 `POST /search/` 发一条 JsonLogic `{"var":"stat.mtime"}`，
一次请求拿到全库 mtime**（实测 12ms）。之后每次读都是「1 次扫描 + 只重取变过的文件」
（`lib/server/vault-cache.ts`）。视图通过 `/api/vault?scope=` 只取自己需要的笔记类型（`lib/vault-scope.ts`）。

写后读一致性和 metadata cache 滞留按实测结果固定进了测试，而不是照着猜测写防御；
看板连点造成的后写覆盖前写由路由内的串行队列挡住。

### 5. 准备稿的版本在 vault 里共存

同一个案件的面试准备稿会混着旧 12 节（v1）和新 5 章（v2）。历史稿正文不改写，
网页**按选中的那份稿切换布局**。研究资料只累积到「这份稿的时点」为止，
后一轮的 URL 不会倒灌进前一轮（`lib/interview-prep-index.ts`）。
没有 job-case 的面谈可以用 `meeting: [[面谈TODO]]` 单独成系列。

追记专用的笔记也这么读。回答练习队列只追加 `attempt / complete / snooze` 事件，
`queued / active / completed / snoozed` 由**折叠事件**导出（`lib/review-practice.ts`）。
话者裁定只认最新一条明确裁定，「记不清了」这类不确定的申告会让那句话回到未解决。

### 6. 3D 舞台：把交互力学抽成零依赖纯函数

用 three.js 把语义关系画成四旋臂的「记忆星图」，把活动量画成「时之航道」。
UnrealBloom＋高光软肩、三层星空、指针的「能量探针」和粒子动量场。

- 探针的位置・倾斜走临界阻尼、能量走指数 attack／release——都是**解析解**（`lib/stage-interaction.mjs`），
  粒子滑行走动量场的**解析解**（`lib/stage-motion.mjs`）。与帧率无关，
  GLSL 和 CPU 侧的公式由**测试逐字比对**
- 鼠标与手部追踪共用一个状态机；按压／拖拽期间锁定输入源
- 手部追踪（MediaPipe Tasks Vision，wasm 和模型**自托管**）：捏合阈值按
  每只手的**自适应包络**（已按画面宽高比校正）＞ 存档校准 ＞ 默认值 决定，短捏最短 24ms。
  捏住／握拳拖动复用 OrbitControls 自己的旋转数学，双手负责平移・缩放・旋转；
  握拳即时接管和按位移判定抓取由识别侧负责
- 默认是 2D 的「关系地图」（一跳邻域）和「时间列表」（月索引・日密度），3D 作为「探索模式」被记住

### 7. 本地 LLM 桥

生成走只监听 `127.0.0.1` 的本地桥（`scripts/codex-bridge.mjs`，由 `scripts/dev-with-obsidian.sh` 拉起）。

- 启动脚本每次启动签发一枚用完即弃的令牌，网页和桥用同一枚令牌绑定
- 校验登录方式，检测到 API key 登录**直接拒绝执行**
- 子进程不继承 `OPENAI_API_KEY` / `CODEX_API_KEY`
- 启动脚本在端口冲突时自动选空闲端口，消除「旧桥还在，新页面 503」

---

## 视图

主导航：总览／行动／求职／面试作战／训练中心／资料库。⌘K 打开页面命令和全文搜索。

| 视图 | 内容 |
|---|---|
| 总览 | 「当前行动」卡（就地把 TODO 写成 進行中／完了／保留）＋ 行动・进行中案件・待应募岗位・7 天内日程・等待回复・复盘・今日重练 |
| 行动清单 / 日历 | 面试・行动期限・等待回复作为「承诺」在一张日历上按类型着色。面试事件直接跳到该轮的准备稿（未来）或复盘（过去）；公司・日期・轮次・时间不全部匹配时给空状态，不猜第一候选 |
| 岗位机会（案件看板） | 「决策台」（待判断队列＋详情）为默认。全文搜索・多轴筛选・最多 3 件并排对比。改状态时一并保存渠道，可写回跟进（等待对象／跟进日／下一场日程） |
| 选考与分析 | 进行中・面试阶段・结果等待・可应募四张 glance 卡与手札分析 |
| 本场面试 | 按案件／面谈的准备稿。v2 是 公司总览／面谈纵览／志望動機／逆質問／资料 五个 tab＋临场备用。六维契合雷达（缺依据的轴留空）、最多 3 家并排对比。v1 稿有面试前通读的「导读」模式 |
| 通用准备 | 回答库（可进全文阅读层连读）。共通资产从本场面试的资料链接以浮层打开 |
| 面试复盘 | 整场「综合导读」→ 逐字稿与批注对照 → 五维评分。小说式全文阅读（中文／日本語切换・话者裁定生效） |
| 回答重练 | 复盘里攒下的改善回答，先自己说出来再揭示。顺畅／卡顿／不会的自评和 完成／明日再练 只追记 |
| 日语训练 | 从面试证据组出的集中训练：主动词块・错误修正・面试官表达・回答结构・岗位技术・事实口径六种，按 快速扫描→集中修正→压力测试 三阶段推进。能力画像・问题地图・训练语料 tab |
| 专项训练 | 中译日词块・固定搭配补全・句型替换・随机表达・安全改写五种练法 |
| 资料库 | 信任层徽标＋摘要卡片，分区・场景交叉筛选，scope／sort 记在 URL 里 |
| 阅读模式 | 从笔记详情进入书页式全屏阅读器：五档字号・目录・文档信息・反链・恢复阅读位置。在记忆星图／时之航道里以舞台内的暗色阅读层打开，不离开场景 |
| 关系地图 / 记忆星图 | 默认是以公司／技能／笔记为中心的一跳邻域 2D 地图。3D 是四旋臂星系，鼠标／手势共用能量探针 |
| 时间列表 / 时之航道 | 默认是带月索引・日密度・类型筛选的编年列表。3D 落在今天，侧栏按日列出当天的笔记和日程 |

---

## 运行

确保 Obsidian 和 **Local REST API** 插件正在运行：

```bash
npm install
npm run dev
```

打开 `http://localhost:3000`。启动脚本会从 Obsidian 插件配置读 API key，只传给服务端进程。

| 环境变量 | 用途 |
|---|---|
| `OBSIDIAN_VAULT_PATH` | vault 位置 |
| `OBSIDIAN_CONFIG_PATH` / `OBSIDIAN_API_URL` | 覆盖默认值 |
| `CODEX_BRIDGE_PORT` | 桥端口（默认 `43127`） |

---

## 质量门禁

```bash
npm test       # tsc --noEmit → build → node --test（440 个测试）
npm run lint   # eslint --max-warnings 0
```

`npm test` 含类型检查和一次生产构建。测试集中在被抽成纯函数的数据层
（`lib/*.ts` / `lib/*.mjs`），覆盖解析、规范化、竞态、渲染结果、GLSL 与 CPU 公式一致性、手势帧序列。

实际在生产里坏过的形状——公司名的全半角差异、「株式会社」的前后位置、括号别名——
每一种都被固定成了测试。

---

## 技术栈

| 领域 | 选型 |
|---|---|
| 框架 | Next.js 16 / vinext / React 19（RSC） |
| 语言 | TypeScript 5.9（`strict`） |
| 运行时 | Cloudflare Workers（wrangler / vite） |
| 3D・输入 | three.js（EffectComposer / UnrealBloomPass） / MediaPipe Tasks Vision |
| 样式 | Tailwind CSS 4 + 设计令牌（`base.css`）＋ 跨页原语层（`ux-refresh.css`）＋ 视图级密度 CSS |
| 测试 | `node:test`（不用外部 runner） |
| 数据 | Obsidian Local REST API（**无数据库**） |

## 目录

```
app/         路由・API 路由・视图（React）
lib/         数据层。尽量 zero-import 纯函数，保证可测
lib/server/  仅服务端：Obsidian 连接・缓存・frontmatter 补丁・串行队列・桥
scripts/     vault 校验／重算、开发服务器、桥、MediaPipe 取回
tests/       node:test，440 个用例
```

## 许可

个人项目，未设许可证（All rights reserved）。
