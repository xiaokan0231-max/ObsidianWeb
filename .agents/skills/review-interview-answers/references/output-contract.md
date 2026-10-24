# 输出契约

## 回答质量 Bridge JSON

Bridge 模式返回一个 JSON 对象，不输出代码围栏或说明文字。顶层字段：

```json
{
  "dimensions": {
    "questionUnderstanding": { "deductions": [], "rationaleZh": "", "evidenceBlockIds": ["q01"] },
    "coverage": { "deductions": [], "rationaleZh": "", "evidenceBlockIds": ["q01"] },
    "directness": { "deductions": [], "rationaleZh": "", "evidenceBlockIds": ["q01"] },
    "evidenceCredibility": { "deductions": [], "rationaleZh": "", "evidenceBlockIds": ["q01"] },
    "riskControl": { "deductions": [], "rationaleZh": "", "evidenceBlockIds": ["q01"] }
  },
  "overviewZh": "",
  "summaryZh": "",
  "strengths": [],
  "weaknesses": [],
  "priorityBlockIds": [],
  "blocks": []
}
```

**不要返回任何分数。** 不返回 `overallScore`，也不返回 `dimensions[*].score`：
维度分＝`100 − Σdeductions.points`，总分＝五维各 20%，都由服务器计算。

## 综合导读与评分摘要

- `overviewZh`：新生成报告必填的非空中文字符串，以空行（`\n\n`）分隔自然段。解释整场面试的重心与互动、本人表现、对方可能的判断及推进意愿、已确认结果与待定事项。所有判断要能回到输入证据；在行文中区分观察、推断和未知。后来收到的结果须说明时间关系。不要输出 Markdown 标题、列表或录用概率。
- `summaryZh`：回答质量及评分理由的摘要，保留诊断用途，不重复导读。

Markdown 和 Web 都在评分前展示 `overviewZh`。旧报告允许缺少该字段；缺失只代表尚未补导读，不用旧评分摘要冒充。只为旧报告补导读时同步更新可读 Markdown 与 JSON 正本，保留旧评分和逐题分析，并记录本次增补的作者与日期。

## 扣分明细

`dimensions[*].deductions[]` 的每一条必须包含：

| 字段 | 说明 |
|---|---|
| `blockId` | 本场真实存在的 qNN |
| `severity` | `major` \| `moderate` \| `minor` \| `opportunity` |
| `points` | 正整数，必须落在该 severity 的区间内（越界会被服务器夹回） |
| `labelZh` | 一句话说清扣在哪，能被单独读懂 |
| `detailZh` | 现场实际发生了什么 → 为什么这会影响面试官的判断 |
| `fixZh` | 下次具体怎么做就不会再扣，可执行、可练 |
| `evidenceSentenceIds` | 该 blockId 块内的 sNN |

区间：`major` 10–25、`moderate` 5–9、`minor` 2–4、`opportunity` 1–3。分档口径见 `scoring-rubric.md`。

一维没有可举证的扣分点就返回 `[]`（＝100 分）。每维最多 12 条，超出会被 `validate-review.mjs` 判错
（正本侧还会先把溢出部分截掉，砍掉扣分＝这一维分数被抬高，所以溢出没有任何好处）。
12 是上限不是目标：要合并同类项而不是罗列到上限——反复出现的同一个毛病写成一条按 `major`/`moderate` 记。

每个 `blocks[]` 必须包含：

- `blockId`, `questionTitle`, `interviewerIntentZh`
- `askedPoints`, `answeredPoints`, `missedPoints`
- `comprehension`: `clear | partial | likely_missed`
- `relevance`: `direct | partial | off_target`
- `quality`: `strong | mixed | weak | neutral`
- `strategyTags`
- `evidenceSentenceIds`
- `evaluationZh`, `improvementZh`, `improvedAnswerJa`

## 固定策略标签

只能使用：

- `compound-question-miss`：复合问题漏答。
- `no-conclusion-first`：没有先给结论，影响答案提取。
- `negative-oversharing`：主动扩展不必要的负面材料。
- `weak-evidence`：关键主张缺少具体证据。
- `over-absolute`：不必要的绝对化或过度概括。
- `role-mismatch`：回答重点与岗位、职级或提问意图错位。
- `numbers-confusion`：年份、金额、规模、周期等口径混乱。

标签描述行为，不描述人格。一次面试内可以多次命中；跨面试趋势由 Web 仅在至少两场不同面试重复时计算。

## 证据约束

- qNN 和 sNN 必须来自输入，不能新造。
- `evidenceSentenceIds` 必须属于该 `blockId`。
- 好评也需要证据；纯寒暄可标 `neutral`，但仍保留对应句证据。
- `priorityBlockIds` 必须来自 `blocks[]`，最多 8 个。
- 所有输入 qNN 都必须有一个输出块，不遗漏、不重复。

## 独立顾问与横向 Bridge JSON

共享 schema 正本为 `lib/interview-advisory-contract.mjs`，运行时校验与 Markdown 正本读写在 `lib/interview-advisory.ts`。Bridge 只返回下列分析字段；服务器增加 `version: 1`、`generatedAt`、`model`、`sourceFingerprint`，不让模型自填来源指纹、覆盖统计或评分。

`review_interview_advisory`：

- `stage`: `agency | matching | technical | final | other`，描述本次会谈阶段。
- `commentaryZh`、`fitZh`、`recommendationZh`、`changeConditionsZh`：整场顾问评论、双方匹配、投入建议及改变判断的条件；中文充分展开，不设固定长度。
- `evidence`、`contextPaths`：顶层评论的原句与背景依据。
- `observations[]`: `{ id, titleZh, observationZh, interpretationZh, alternativeZh, implicationZh, evidence, contextPaths }`，精读对话；其他解释无意义时可空。
- `answerOptions[]`: `{ id, titleZh, situationZh, whyZh, answerJa, scope, evidence, contextPaths }`。`scope=general | company`；包含有效表达和无需扣分的提升机会，必要时给真实日语方案。
- `nextSteps[]`: `{ id, titleZh, detailZh, triggerZh, evidence, contextPaths }`，不自动成为待办或外发消息。

`review_interview_insights`：

- `overviewZh`：跨场整体解释。
- `modules[]`：五个 key 各一次：`employerPriorities | positioning | effectiveAnswers | opportunities | nextStage`。
- 每个 module 为 `{ key, titleZh, commentaryZh, findings }`；资料不足可 `findings=[]`。
- 每个 finding 为 `{ id, titleZh, bodyZh, boundaryZh, evidence, contextPaths }`，至少引用两份不同 sourcePath 的实际原话，保留反例与阶段边界。

两类任务的引用都使用 `{ sourcePath, blockId, sentenceIds }`。sourcePath 是完整 Vault 相对路径，qNN/sNN 必须属于该场次，不允许用日期+轮次替代身份。contextPaths 仅能引用输入存在的背景、通知或反馈笔记；模型不能新增来源。条目 ID 使用英文、数字、下划线或短横线，全报告唯一。

后续结果只以可追溯资料确认，并注明在现场之后；不能用结果倒推当场意图。数量、比例与覆盖范围由程序计算。旧 AI 意见、评分和错误标签不能作为新判断的事实依据。

## 人工反馈语义

- `agree` 只确认原对象、原版本与判断快照，不能自动继承给新观点。
- `disagree` 要求重新核对旧评价，不代表可以篡改现场发言。
- `context` 是本人补充事实；用于解释潜在能力、背景或真实意图。

当反馈“其实会回答，但现场没说”时：现场覆盖仍判为遗漏，同时在评价和改善回答中使用该能力事实。不要把两层混为一谈。

旧 POST `{ notePath, blockId, kind, text }` 与旧 qNN 人工记录继续可用。新顾问/洞察反馈使用 `{ notePath, kind, text, target: { type: "advisory" | "insight", id, revision, snapshot } }`，revision 为目标分析 generatedAt。服务器检查当前版本和 ID，并从当前报告获取 snapshot，不信任客户端快照；过期反馈返回 409，不能写成新版本已同意。

单场反馈仍追记 `*_回答品質批注.md`，跨场反馈追记 `20_求職/_素材/面接横断_顧問批注.md`。新条目标题使用 `fNNN｜advisory:id` 或 `fNNN｜insight:id`，`対象::` 保存目标 JSON，`我::` 保留本人内容。去重同时包含对象、版本、快照和反馈内容。没有版本的旧 qNN 反馈不能绑定顾问观点。

## 持久化报告

ObsidianWeb 在 `*_回答品質復盤.md` 中保存可读 Markdown 和 `<!-- interview-answer-review-data -->` 后的 JSON 正本。持久化对象会增加：

- `generatedAt`
- `model`
- `dimensions[*].score`：`100 − Σdeductions.points`（下限 0）
- `overallScore`：五维等权平均的四舍五入值

schema v2 的旧报告只有 `score` 和 `rationaleZh`、没有 `deductions`，Web 会退回旧版渲染并提示重新生成。
读旧报告时不要把它的 `score` 反推成扣分明细——那些分数本来就没有逐条依据。

不要手写或修改逐字稿、整理稿、`*_批注.md`、`*_回答品質批注.md`、`*_回答練習.md`。人工反馈和重练选择必须继续由各自的 Web API 追记。

单场顾问层保存在原回答质量 JSON 的可选 `advisory` 中，独立版本化；只更新顾问时不重算旧 dimensions、overallScore 或 blocks。横向分析保存为 `20_求職/_素材/面接横断_顧問分析.md`（type: interview-insights）。两者由服务端定向合并，不覆盖报告的人工追加正文；失败不写入半成品。新完整复盘按回答质量 → 单场顾问 → 横向分析顺序执行，批量历史补齐最后统一汇总，来源指纹未变则跳过已有内容。


横向 Markdown 的生成内容及 JSON 正本位于 `<!-- interview-insights:start -->` / `<!-- interview-insights:end -->` 内；更新只替换该区和生成元数据，区外人工追加与自定义 frontmatter 保留。标记不完整时拒绝覆盖。单场标记仍为 `interview-advisory:start/end`，两类均保存作者署名与独立版本。
输入含 `provenance.reconstruction=memory` 或 `provenance.verbatim=false` 时，必须标明本人记忆重构，不把重构句用于现场措辞、语速或语法判断；横向输入同样传递该限制。
