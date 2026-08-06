# 输出契约

## Bridge JSON

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
  "summaryZh": "",
  "strengths": [],
  "weaknesses": [],
  "priorityBlockIds": [],
  "blocks": []
}
```

**不要返回任何分数。** 不返回 `overallScore`，也不返回 `dimensions[*].score`：
维度分＝`100 − Σdeductions.points`，总分＝五维各 20%，都由服务器计算。

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

## 人工反馈语义

- `agree` 确认旧评价。
- `disagree` 要求重新核对旧评价，不代表可以篡改现场发言。
- `context` 是本人补充事实；用于解释潜在能力、背景或真实意图。

当反馈“其实会回答，但现场没说”时：现场覆盖仍判为遗漏，同时在评价和改善回答中使用该能力事实。不要把两层混为一谈。

## 持久化报告

ObsidianWeb 在 `*_回答品質復盤.md` 中保存可读 Markdown 和 `<!-- interview-answer-review-data -->` 后的 JSON 正本。持久化对象会增加：

- `generatedAt`
- `model`
- `dimensions[*].score`：`100 − Σdeductions.points`（下限 0）
- `overallScore`：五维等权平均的四舍五入值

schema v2 的旧报告只有 `score` 和 `rationaleZh`、没有 `deductions`，Web 会退回旧版渲染并提示重新生成。
读旧报告时不要把它的 `score` 反推成扣分明细——那些分数本来就没有逐条依据。

不要手写或修改逐字稿、整理稿、`*_批注.md`、`*_回答品質批注.md`、`*_回答練習.md`。人工反馈和重练选择必须继续由各自的 Web API 追记。
