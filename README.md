# 回声 · 求职作战室

一个直接读取本机 Obsidian Local REST API 的求职指挥台：AI 推荐岗位、选考进度、面试证据与日语训练闭环都从同一个 Vault 实时读出。

侧栏顺序按求职推进的顺序排列：总览 → AI 推荐岗位 → 待办事项 → 日历 → 面试复盘 → 日语训练 → 时间线 → 关系图 → 记忆库。总览首屏是「现在最重要」与求职进行时，记忆健康度和关系图作为回查用的底层放在下方。

## 本地启动

确保 Obsidian 和 Local REST API with MCP 插件正在运行，然后执行：

```bash
npm run dev:obsidian
```

网页默认位于 `http://localhost:3000`。启动脚本会从本机 Obsidian 插件配置中读取 API key，并只把它传给本地服务端进程；密钥不会进入浏览器代码或仓库。脚本也会同时启动只监听 `127.0.0.1` 的 Codex Bridge。

如需使用不同的 Vault，可在启动前设置 `OBSIDIAN_VAULT_PATH`。也可以使用 `OBSIDIAN_CONFIG_PATH` 和 `OBSIDIAN_API_URL` 覆盖默认位置。

## 数据设计

- Obsidian 仍是唯一数据源，不复制到 MySQL 或浏览器存储。
- `app/api/vault/route.ts` 负责本地代理、递归读取和密钥隔离。
- 页面会从 frontmatter、双链、时间和笔记类型实时构建总览、关系图、时间线与查询视图。

## AI 推荐岗位

`20_求職/` 下 `type: job-case` 的笔记会渲染成筛选台；`origin: ai-reco` 表示由 AI 推荐发现：

- 全文搜索（公司 / 职位 / 技术栈 / 正文，命中词高亮），按匹配度、年収上限、更新时间或公司名排序。
- 多维筛选：应募状态、匹配度门槛、年収上限、リモート可、技術スタック、勤務地、来源、求人原文核对状态。
- 卡片可直接切换应募状态，经 `app/api/jobs/status/route.ts` 只改写该笔记 frontmatter 的 `status` 与 `status_updated`，正文和其他字段原样保留；接口只接受 `20_求職/` 下 `type: job-case` 的笔记和固定状态枚举。进入応募后的状态必须已有实际渠道 `channel`。
- 详情侧边抽屉展示完整分析，最多勾选 3 个岗位并排对比。
- 年収从 `salary` 自由文本解析，`月給` 按 ×12 估算；卡片会标出「原文確認済 / 要確認 / 未核对」，提醒 AI 打分不是权威事实。

## 日语训练

早期的“面试道场”界面已下线，由“面试复盘”和“日语训练”接替；`80_AI分析/面接道場` 等既有道场笔记不会被删除，仍会在生成日语训练库时作为历史上下文读入（`/api/dojo/runtime` 也继续作为 Bridge 状态探针保留）。

- 训练库由 Sol 一次性生成 36 个以上单元，覆盖词汇、读音、语法、搭配、面试与商务表达等八个分类，可按分类扩充；写入 `80_AI分析/日本語訓練`。
- 练习、训练与考试记录分别写入 `30_日本語学習/練習ログ`、`30_日本語学習/訓練ログ`、`30_日本語学習/試験ログ`。
- 选择、读音等客观题由程序直接批改；造句点评与开放题批改在整批提交后由 Terra 一次性完成。
- 个人经历、数字等事实只能来自 `self` 权威事实与逐字稿 / 复盘等直接证据；material 或 AI 报告中的内容只作为语言线索，不会被写成本人事实。

Bridge 每次运行都会验证 Codex 必须为 `Logged in using ChatGPT`。检测到 API-key 登录时会拒绝执行；子进程也不会继承 `OPENAI_API_KEY` 或 `CODEX_API_KEY`。应用没有收费 API 自动回退。这里的“本地 Codex”指本机客户端负责认证与执行，模型推理仍由 OpenAI 服务完成，并非离线模型。

可选环境变量：

- `CODEX_BRIDGE_PORT`：Bridge 端口，默认 `43127`。
- `CODEX_BRIDGE_CODEX_PATH`：Codex 可执行文件路径。
- `CODEX_BRIDGE_SOL_MODEL` / `CODEX_BRIDGE_TERRA_MODEL`：画像与批改使用的模型。

`npm run dev` 与 `npm run dev:obsidian` 都会同时启动网页、Obsidian 连接和本地 Codex Bridge。`npm run dev:web` 只用于不需要这些本机连接的底层网页调试。

如果重复启动时 `43127` 已被另一份 Bridge 占用，启动脚本会为新会话自动选择空闲的本机端口，并把网页和 Bridge 绑定到同一枚临时令牌；因此不会再出现“旧 Bridge 存在，但新网页请求 503”的情况。只有显式设置 `CODEX_BRIDGE_PORT` 时才严格使用指定端口。

## 常用命令

```bash
npm run dev:obsidian
npm run build
npm run lint
npm test
```
