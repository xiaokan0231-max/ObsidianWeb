---
name: review-interview-answers
description: >-
  Analyze completed interview transcripts as evidence-backed answer-quality reviews: recover interviewer intent and compound subquestions, identify answered and missed points or off-target answers, score question understanding, coverage, directness, evidence credibility, and risk control, produce concise Japanese improved answers, and attach stable strategy tags for cross-interview trends. Use for 面试复盘、深度复盘、回答质量、漏答、答非所问、日本面试风险、五维评分、AI/MCP/DDD 复合问题，or when generating, regenerating, or auditing ObsidianWeb `*_回答品質復盤.md` from a `*_整理稿.md` after human transcript decisions are complete.
---

# 面试回答深度复盘

把本技能作为分析内核，不作为状态库。让 Web/Vault 负责裁定进度、追记、持久化和跨面试聚合；本技能只依据证据生成结构化评价。

## 选择运行模式

- 提示中含 `INPUT_JSON`：执行 **Bridge 模式**。只分析输入，不调用工具、不读文件、不写 Vault；严格返回请求方 JSON schema。
- 用户给出整理稿或要求直接复盘：执行 **Vault 模式**。先读项目 `AGENTS.md`、Vault 的 `99_系统/_整理稿スペック.md`，再读同场面试的整理稿、批注、回答品质批注和旧报告。
- 用户要求检查现有报告：执行 **审计模式**。读取报告与整理稿，运行校验脚本并报告证据或契约问题；除非用户同时要求修改，否则不重生成。

在 ObsidianWeb 中，以 `lib/review-deep.ts` 和 `scripts/codex-bridge.mjs` 为运行时字段契约，以 Vault 的 `_整理稿スペック.md` 为文件契约。序列化细节冲突时遵循代码；分析口径遵循本技能。

## 必须读取的参考

Vault 模式或审计模式下，生成或审计评价前完整读取：

1. `references/scoring-rubric.md`：五维评分与日本面试风险口径。
2. `references/output-contract.md`：字段、枚举、反馈语义和输出规则。

Bridge 模式不得为了读取参考而突破调用方的“不可调用工具、不可访问文件”边界；使用本文件内的工作流和调用方提供的 JSON schema。调用方的 schema 会确定性执行 `output-contract.md` 的字段约束。

## 工作流

### 1. 建立证据层级

按以下优先级取证：

1. 面试官与候选人的逐句内容，以及已完成的本人裁定。
2. `humanFeedback` / `*_回答品質批注.md` 中本人补充的事实与对旧 AI 评价的反对。
3. 整理稿中的翻译、注释和同场事实。
4. 旧 AI 复盘，只作为待复核线索，不能覆盖前三层。

不得把改善回答、旧 AI 推测、职位刻板印象写成本人已具备的经历。改善回答只能使用证据层已有事实；材料不足时使用有边界的表达，如“正在学习”“实务经验有限”。

### 2. 检查执行门槛

- 仅在整理稿的全部 `疑`、错误归属和话者疑问已有人工作出裁定后生成深度复盘。
- Bridge 模式下可依赖服务器已经完成门槛检查，但不得忽略输入中仍可见的冲突。
- Vault 模式下若无法证明裁定已完成，停止生成并列出仍需裁定的 sNN/目标；不要替本人猜测。

### 3. 逐个问题块恢复问题结构

对每个 qNN，包括寒暄和流程块，完成以下判断：

1. 从面试官原话与追问链提取 `interviewerIntentZh`。
2. 把并列问法拆成 `askedPoints`，不要按候选人实际回答反推问题范围。
3. 只把候选人明确说出的内容列入 `answeredPoints`。
4. 把未回答、只回答一半或被其他话题替代的部分列入 `missedPoints`。
5. 区分三件事：没听懂问题、听懂但不知道、知道却没有在现场说出来。
6. 用 sNN 记录好坏评价的直接证据。

回归检查：面试官同时问 AI、MCP、DDD，而候选人只谈 DDD 时，必须把 AI、MCP 列为漏答。本人补充“其实会 AI/MCP”只能说明潜在能力，不能改写“现场没有回答”的事实。

### 4. 评价每个问题块

- 给出理解度、相关性和质量等级。
- 先描述实际效果，再给改进方向；不要重复一层已经完成的逐句语法评分。
- 仅在确有证据时附固定策略标签。不要为了形成趋势而给每个块贴标签。
- 对无需改写的强回答把 `improvedAnswerJa` 留空。
- 对需要重练的回答，日语改善稿先覆盖全部子问，再用一个最强证据展开；保持可在压力下说出口。

### 5. 逐条列出扣分，不要打分

按 `references/scoring-rubric.md` 分别评价问题理解、覆盖完整度、直接性、证据可信度、风险控制。

**每一维只输出 `deductions`（扣分明细）、`rationaleZh` 和 qNN 证据，不输出分数。**
维度分＝`100 − Σpoints`，总分＝五维等权平均，都由服务器计算。这条是整个评分契约的支点：
分数从扣分推导出来，所以**说不出扣在哪一题、扣多少、为什么，就不能扣分**。

每条扣分给 `severity`（决定 points 区间）、`labelZh`、`detailZh`、`fixZh` 和块内 sNN 证据。
找不到可举证的扣分点就返回空数组＝100 分：满分是起点，不是奖赏。

审计模式可展示计算值，但必须与 `100 − Σpoints` 和五维平均一致。
不要为了继承旧总分而编造扣分项——旧分里本来就有说不出理由的部分，分数变高是修正。

### 6. 处理本人对 AI 的反馈

- `agree`：把该结论视为已获本人确认，但仍保留证据引用。
- `disagree`：重新核对逐字证据，不得机械重复旧结论。若本人反馈与现场发言指向不同层面，分别写“现场表现”和“潜在能力”。
- `context`：把补充事实纳入解释；不得用它改写逐字稿中实际发生的回答。

不修改或删除反馈。撤回和修正也应由新的人工条目表达。

### 7. 选出优先项并输出

- `priorityBlockIds` 最多 8 个，优先选择漏答、答非所问、高风险表达和岗位关键能力缺口。
- 强项和弱项都引用具体 qNN，不写空泛人格评价。
- Bridge 模式严格返回 `references/output-contract.md` 中的 JSON，不加 Markdown 前后文。
- Vault 模式只更新 `*_回答品質復盤.md` 这份 AI 派生报告；不改逐字稿、整理稿、批注、回答品质批注或回答练习。

### 8. 验证

生成持久化报告后运行：

```bash
node .agents/skills/review-interview-answers/scripts/validate-review.mjs \
  --review '<回答品質復盤.md>' \
  --source '<整理稿.md>'
```

修复所有 error 后才报告完成。warning 需要人工判断，不要静默忽略。

### 9. 回流到面试标准回答库（闭环，Vault 模式）

复盘只诊断这一场；诊断出的失分点要能进入面试**前**查阅的标准回答库，否则库会和最新面试脱节。生成报告后，对本场 `priorityBlockIds` 里的每个漏答/答非所问/高风险表达做一次回流检查——对象是 `20_求職/_素材/面接標準回答集.md`（`type: interview-prep-library`，Web「面试准备」页读取；结构契约见 `99_系统/_数据字典.md`）：

- **已有对应卡**（如复合问题漏答↔p12、转职次数↔p08、他社選考↔p24、结尾一言↔p25）：把本场新证据追加进该卡的「证据」节（`[[本場整理稿#qNN …]]`），必要时据此修订「使用边界」。不重写已验证的口径。
- **没有对应卡且是跨公司通用题**：新增一张 `## p{下一个编号}` 卡，分节结构照库内现有卡；每条证据必须回链到具体整理稿/復盤，不写无出典的漂亮话。
- **公司特有题**（志望動機的具体桥接、逆質問等）：不进通用库，留在该公司文件夹或面接准备文档。

回流是本技能的**边界内动作**（写的是独立的回答库，不是复盘报告本身，也不碰逐字稿/整理稿/批注）。改动回答库后，若本机有 vault 环境，运行 `npm run vault:check` 确认无枚举/结构问题。判断为「本场无需回流」时，一句话说明理由，不要静默跳过。

## 完成标准

1. 所有 qNN 都有且只有一个评价块。
2. 复合问题的子问、现场回答和漏答互不混淆。
3. 每个维度有理由和 qNN 证据；每一分扣分都指得到具体 qNN、sNN 和一句可执行的 `fixZh`；
   维度分等于 `100 − Σpoints`，持久化总分等于五维平均。
4. 所有 sNN 证据属于对应 qNN，策略标签属于固定枚举。
5. 本人反对或补充已被重新核对，旧 AI 结论没有被机械复读。
6. 原文与人工事实层没有被改写。
7. 已对本场优先失分点做回流检查：或更新/新增面试标准回答库卡片（证据回链本场），或说明本场无需回流。
