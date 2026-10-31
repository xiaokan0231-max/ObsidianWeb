# 查询索引与发布

Obsidian 是资料正本。Cloudflare D1 保存可重建的目录、关系、搜索块和页面投影；本地使用同一 D1 模拟运行时，不使用 MySQL。完整正文保存在本地 Vault 和明确发布的不可变正文资源中。

## 读取契约

- 目录 `NoteCard`、面试来源 `InterviewSourceRef` 与完整 `Note` 分开，只有单篇正文接口能填充正文缓存。
- 日历范围、单日申请、历史分页：`/api/read-model/calendar/{range,applications,history}`。
- 面试目录、场次依赖、复盘问题块和章节：`/api/interview/{catalog,context,review,trends}`。
- 资料库、搜索、短链消歧和反链：`/api/read-model/{library,search,resolve,backlinks}`。
- 完整正文：`/api/note?path=…&revision=…`。目录返回版本；后续依赖、正文和分页必须沿用它。过期游标返回 409，从第一页重查，不能混合两版。
- 专题速览：用 `type:language-reading-list` 查询资料目录，选中后沿用目录版本读取一篇正文；不加载 `all`、`interview` 或训练正文集合。清单是独立的阅读资料，不回灌为面试原话或训练来源。结构由 `lib/language-reading-list.ts` 校验，资料中的 `publish: false` 继续限制发布范围。
- 搜索保留空格 AND、字段值 `|` OR、正文与 frontmatter 检索。FTS5 trigram 仅用于候选，参数化子串验证保留短中日文及跨块命中。

## 本地同步

使用 `npm run dev`，它会启动持有本地凭据的 Node bridge。bridge 增量检测 Vault 文件变更，在宿主机生成索引，避免在 Worker 请求中复制整库正文。成功写回会精准失效受影响路径。未变正文按哈希复用；新索引可复用 D1 已完成版本中的内容块。

`node scripts/warm-read-model.mjs` 会分批导入并验证索引。只有批次摘要、行数和内容引用都正确，版本才转为 ready；正在同步或失败时保留上一个完整版本，并返回同步状态。首次无完整版本时返回带 Retry-After 的 503，不返回假空列表。

## 发布

`npm run publish:prepare` 明确发布当前本地资料；不要把这个命令放进普通代码构建。

笔记 frontmatter 的 `publish: false` 表示仅保留本地：导出时从全部正文、目录、日历和搜索投影中排除；包含该笔记的旧派生版本也不再保留。原稿、本人补充、相关分析须分别标记，避免从另一份材料带出内容。本地读取不受此标记影响。

仅发布代码且需要重建索引时，用 `npm run publish:index`：它只处理已有公开快照。构建归档应包含 `_published-vault` 资源及新增 D1 迁移。部署完成后对同一站点执行：

```sh
node scripts/warm-read-model.mjs https://YOUR_SITE
```

索引导入完成后再验收页面。保留最近三个完整派生版本及被它们引用的正文资源；清理仅处理派生资源，不删除 Obsidian 原笔记。JST 跨日汇总从同版日历投影重新计算。

公网仍使用已发布快照，业务写入和 AI 生成仍仅在本地执行。老师交流信箱继续使用独立鉴权的 R2，不进入 SQL、公开快照、搜索索引或 AI 输入。
