# ObsidianWeb

**以 Obsidian vault 为唯一数据源、不带数据库的本地优先知识工作台。**

一堆 Markdown 笔记（frontmatter・双链・标题）本身就是领域模型，
由它实时构建案件看板、日历、时间线、3D 知识图谱和学习闭环。
Next.js (vinext) / React 19 / TypeScript，部署到 Cloudflare Workers。

![ObsidianWeb](public/og.png)

- 🇯🇵 [日本語](README.md) ・ 🇬🇧 [English](README.en.md)

---

## 这个设计有意思在哪

### 1. 「不要数据库」是个主动决定

`db/schema.ts` **是空的，且是有意为之**。持久层就是 Obsidian 的 vault——一个 Markdown 目录。

```
Obsidian (Local REST API) ──► app/api/vault ──► readAllNotes() ──► 各视图
        ▲                          │
        └──── 写回只允许白名单内的 frontmatter 字段 ────┘
```

- 不做副本 ⇒ **二重口径在结构上无法产生**。在 Obsidian 改还是在网页改，事实都只有一份。
- API key 只存在于服务端进程，不进浏览器代码、不进仓库（`app/api/vault/route.ts`）。
- 写入口收敛成一条，路径・笔记类型・值域三重白名单约束；只替换对应的 frontmatter 行，
  正文一个字不碰。由于「读→改→写」不是原子操作，写入放进短的串行区间，
  防止看板连点造成后写覆盖前写（`app/api/jobs/status/route.ts`、`lib/server/serial-queue.ts`）。

### 2. 「生成区块」：派生值的单一事实源

汇总数、占比、推移这类**派生数据，机制上禁止人手写**。

```markdown
<!-- generated:stats 勿手改 -->
（只有脚本能改这里）
<!-- /generated -->
```

派生值一旦被打成散文就和上游断开：上游变它不变，写错也没人报错。
这个事故真的发生过，所以把**事实（人写）和派生（机器算）**分成两类，
由 `npm run vault:check`（frontmatter 校验）和 `npm run vault:stats`（重新生成）强制。

### 3. 检查不放 CI，放三层

vault 是「换台机器可能根本不存在」的外部数据，绑进代码测试会让 CI 无故变红，
红灯多了就没人看了。于是拆成三层：

| 层 | 触发 | 行为 |
|---|---|---|
| Agent 的 Stop hook | AI 每轮回答结束 | 不一致就 **exit 2 拦住**，理由回灌给 AI |
| `npm run dev` 启动 | 你要看页面时 | 只 warning，不阻塞 |
| vault 仓库 pre-commit | `git commit` 时 | 不一致就**拒绝提交** |

### 4. 增量缓存：按「运行时没有 fs」来设计

每次读全库太慢，但服务端跑在 workerd 上（`nodejs_compat` 是虚拟文件系统），拿不到 `fs` 的 mtime。

于是改成**给 REST API 的 `POST /search/` 发一条 JsonLogic `{"var":"stat.mtime"}`，
一次请求拿到全库 mtime**（实测 12ms）。之后每次读都是「1 次扫描 + 只重取变过的文件」
（`lib/server/vault-cache.ts`）。

写后读一致性、写入串行化、metadata cache 滞留这些竞态，都按实测结果固定进了测试——
而不是照着猜测写防御。

### 5. 3D 视图与手势操作

用 three.js 把笔记间的语义关系画成 2.5D「记忆星图」，把活动量画成 3D 时间线。
全屏时可以用 MediaPipe Tasks Vision 的手部追踪操作镜头；
wasm 和模型文件**自托管**（由 `scripts/fetch-mediapipe.mjs` 取回）。

### 6. 本地 LLM 桥

生成走只监听 `127.0.0.1` 的本地桥（`scripts/codex-bridge.mjs`）。

- 每次启动签发一次性令牌，网页和桥用同一枚令牌绑定
- 校验登录方式，检测到 API key 登录**直接拒绝执行**
- 子进程不继承 `OPENAI_API_KEY` / `CODEX_API_KEY`
- 端口冲突时自动选空闲端口，消除「旧桥还在，新页面 503」

---

## 视图

| 视图 | 内容 |
|---|---|
| 总览 | 「现在最重要的事」与进行中的案件 |
| 案件看板 | 全文搜索（命中词高亮）、多轴筛选、最多 3 件并排对比 |
| 待办 / 日历 | 同时抓 frontmatter 的期日和正文里提到的日程 |
| 面试复盘 | 逐字稿与批注对照，按五维给回答质量打分 |
| 日语训练 | 词汇・读音・语法等八分类的练习／训练／考试闭环 |
| 时之航道 | 用光柱可视化每日活动量的 3D 时间线 |
| 记忆星图 | 描绘语义关系的 2.5D 知识图谱 |

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
npm test       # tsc --noEmit → build → node --test（298 个测试）
npm run lint   # eslint --max-warnings 0
```

`npm test` 含类型检查和一次生产构建。测试集中在被抽成纯函数的数据层
（`lib/*.ts` / `lib/*.mjs`），覆盖解析、规范化、竞态和渲染结果。

实际在生产里坏过的形状——公司名的全半角差异、「株式会社」的前后位置、括号别名——
每一种都被固定成了测试。

---

## 技术栈

| 领域 | 选型 |
|---|---|
| 框架 | Next.js 16 / vinext / React 19（RSC） |
| 语言 | TypeScript 5.9（`strict`） |
| 运行时 | Cloudflare Workers（wrangler / vite） |
| 3D・输入 | three.js / MediaPipe Tasks Vision |
| 样式 | Tailwind CSS 4 + 视图单位 CSS |
| 测试 | `node:test`（不用外部 runner） |
| 数据 | Obsidian Local REST API（**无数据库**） |

## 目录

```
app/         路由・API 路由・视图（React）
lib/         数据层。尽量 zero-import 纯函数，保证可测
lib/server/  仅服务端：Obsidian 连接・缓存・写入・桥
scripts/     vault 校验／重算、开发服务器、桥
tests/       node:test，298 个用例
```

## 许可

个人项目，未设许可证（All rights reserved）。
