# ObsidianWeb — AI 作业规则

> 这份文件同时是 `CLAUDE.md`（软链）。改这里，两个工具一起生效。
> 只写「不知道就会做错」的事。操作细节留在 vault 笔记里，这里只放指路。

@AGENTS.local.md

> ↑ 本机私有规则（个人事实・账号・具体案件）在 `AGENTS.local.md`，不进仓库。
> Claude Code 会自动加载；**Codex 不支持 @import，改求职数据前请手动读一遍。**

## 这个项目是什么

Next(vinext/Cloudflare Workers) 前端，**读 Obsidian vault 作为唯一数据源**。

- Vault 路径由 `OBSIDIAN_VAULT_PATH` 指定（本机实际路径见 `AGENTS.local.md`）。
  vault 是独立的 git 仓库，不属于本仓库。
- **没有数据库。** `db/schema.ts` 是空的，是有意为之。别加表、别引入 MySQL。
  页面数据来自 `app/api/vault/route.ts` → `readAllNotes()` → Obsidian Local REST API。
- `npm run dev` 会先从 Obsidian 插件配置里读 API key，不要直接跑 `dev:web`。

## 🔴 求职数据：改一处不等于改完

同一个事实散在多处。下面每组**必须同时更新**，只改一处就是没改完。

### 应募结果变化（收到拒信 / 通过 / 面接决定）

| # | 落点 | 说明 |
|---|---|---|
| 1 | `20_求職/` 配下对应 `type: job-case` 案件的 `status`（连带 `channel` / `status_updated`） | **驱动 Web 看板**。AI推荐只是 `origin: ai-reco`；公司卷宗不持有 status。`channel` 以受理邮件为准 |
| 2 | 跑 `npm run vault:stats` | 重算汇总，并重新生成台帳的「追記分」表和全社照合リスト。**台帳不再手写任何行** |

`status` 合法值只有这 7 个，写别的会被 `normalizeJobStatus()` 判为 null 而静默失效：

```
未応募 / 応募済 / 書類通過 / 面接中 / 内定 / 保留 / 不採用
```

后面可以带括号补充，例如 `不採用（YYYY-MM-DD・書類選考／経路名）`，
但**括号前必须是上面 7 个之一**。校验：`npm run vault:check`。
各字段含义和「想查什么→读哪张笔记」路由 → vault 侧 `99_系统/_数据字典.md`。

### 跨落点的「共通事実」

在留資格・希望条件这类事实同时写在多个外部站点上，各站点位置不同，
**改一个就要改全部**。具体落点表和各站点的坑在 `AGENTS.local.md`（本机私有）。

## 🔴 生成区块：不许手改

笔记里被下面这对标记包住的内容，**人和 AI 都不许手写**：

```markdown
<!-- generated:xxx 勿手改 -->
...
<!-- /generated -->
```

要改就改上游数据，然后跑脚本重新生成。

**为什么：** 派生数字一旦被打成散文就和上游断开了，上游变它不变，写错也没人报错。
实际发生过的事故形状：台帳里手写的汇总社数被人改动后，
下游又基于这个手写数字推出了方向性结论——回查原始 CSV 才发现两边对不上，
而且真实数据指向的结论正好相反。**错误从手写数字开始，被二次引用放大。**

区分标准：

- **事实**（人写，来自现实）：某社某日发来拒信、応募ID、面接官说了什么
- **派生**（机器算）：总社数、渠道占比、月别推移、到达率 → **永远不手写**

## 🔴 外部求人站点：一律用本人已登录的会话

求人站点的搜索和阅览必须走本人已登录的浏览器会话
（Claude Code 走 claude-in-chrome 扩展；Codex 用本人的 Chrome 配置文件）。

- 未登录＝游客视角，**会员限定岗位直接不显示**，搜出来的「没有」是假阴性。
- 登录会话不可用时**停下来请本人接通**，不许退到无登录浏览器搜完就下结论，
  也不许代替本人执行登录操作。

站点别的具体 URL 和账号 → `AGENTS.local.md`。

## 🔴 外部网站：写完必须回读验证

这类站点写入静默失败和成功在界面上长得一样。
满足下面两条才算「完成」，否则不许报成功：

1. **重新加载页面**，从服务器返回值里确认新值在
2. **打开生成物**目视确认（写入表单 ≠ 生成物已更新）

另注意 **保存 ≠ 提交**：部分站点存盘后还要单独点提交，且提交物可能有多份、各提各的。
各站点的具体坑 → `AGENTS.local.md`。

## 常用命令

```bash
npm run dev          # 带 Obsidian 的开发服务器（启动时顺带体检 vault，不阻塞）
npm run vault:check  # 校验 vault frontmatter（status 枚举・owns 唯一性等）
npm run vault:stats  # 重算台帳・数据字典的 generated 区块
npm run vault:verify # 上面两个的只读版，不写文件
npm test             # build + node --test（不含 vault 检查，见下）
npm run lint
```

## 自动检查装在哪

`npm test` **故意不含** vault 检查：vault 是另一台机器上可能不存在的外部数据，
把它绑进代码测试会让 CI／换机器无故失败，红灯多了就没人看了。改为三层：

| 层 | 触发时机 | 覆盖谁 | 行为 |
|---|---|---|---|
| Stop hook | Claude Code 每轮回答结束 | 只有 Claude Code | 不一致则 **exit 2 拦住**，理由回灌给 AI |
| `npm run dev` 启动 | 你要看页面时 | 所有人 | 只 warning，不阻塞 |
| vault 仓库 pre-commit | `git commit` 时 | 所有人（含 Codex／手改） | 不一致则**拒绝提交** |

- Stop hook：`scripts/stop-hook-vault-verify.sh`，配置在 `.claude/settings.local.json`。
  必须检查 stdin 的 `stop_hook_active`，否则「拦住→再应答→又拦」会无限循环。
- pre-commit：`<vault>/.git/hooks/pre-commit`（不在本仓库，git 不跟踪）。
  应急放行 `git commit --no-verify`。
- **Codex 不会触发 Stop hook**（那是 Claude Code 的机制）。Codex 改完靠 pre-commit 兜。

## 写代码时

- 注释和文档跟随周围风格：本仓库注释用中文，说明「为什么」而不是「做了什么」。
- `position` 是 Obsidian metadata cache 的保留键，Local REST API 会剥掉，
  读不到时从 H1 或文件名兜底（见 `lib/jobs.ts` 的 `jobPosition`）。
- **仓库是公开的。** 提交前确认没有把个人事实（真实公司名・邮箱・在留資格・
  具体选考结果）写进代码、注释、测试 fixture 或提交信息。
  测试用的公司名一律用虚构名（`株式会社テスト` 等）。
