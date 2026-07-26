# Workflow 脚本模板（多角度起草 + 评审合成）

关键话术（志望動機、自我介绍、想定问答、面接官攻略）**不要一稿定**。用 Workflow 工具多角度并行起草，再让评审 agent 逐句核查候选人口癖并合成最优版——这次会话反复用这个模式，质量明显高于单稿。

前提：Workflow 工具需用户已 opt-in（关键词 ultracode / 明确要求 / 本 skill 触发时可用）。若不可用，就串行地自己多写两版再合并，逻辑相同。

给每个 agent 的 prompt 里**必须塞满 context**：候选人档案、公司情报、定位主轴、口癖清单、输出格式要求。context 越足，产出越可用。

---

## 模式 A：多角度起草 → 评审合成（志望動機/自我介绍等单件话术）

3 个 agent 从不同角度起草（如"最简安全""人柄温度""朗读节奏"或"理念共鸣主导""自身实践主导""口语最优先"），1 个评审 agent 逐句核查口癖后以最优稿为骨架、嫁接其他稿亮点，合成终版。

```js
export const meta = {
  name: 'draft-and-judge',
  description: '多角度起草+评审合成一件关键话术',
  phases: [{ title: 'Draft' }, { title: 'Judge' }],
}
const BG = `【候选人档案】…【公司情报】…【定位主轴】…【口癖清单·必须结构性回避】…【输出格式：20秒版=2〜3句/结论+证据+落点；必要时另写追问追加；日本語带(かな)注音+中文策略；避い形+だと思います/感じします/句尾けど；短句断定】`
const SCHEMA = { type:'object', required:['main','memo'],
  properties:{ main:{type:'string'}, short:{type:'string'}, memo:{type:'string'} } }
const ANGLES = [
  {key:'simple', inst:'角度A【最简安全】：说得顺第一，句最短、零风险。'},
  {key:'warm',   inst:'角度B【人柄温度】：安全前提下突出人となり和温度。'},
  {key:'rhythm', inst:'角度C【朗读节奏】：按呼吸群分行、全注音、当朗读台本写。'},
]
phase('Draft')
const drafts = (await parallel(ANGLES.map(a => () =>
  agent(`资深日语面接指导。为候选人写自我介绍。\n${BG}\n${a.inst}`,
    {label:`draft:${a.key}`, phase:'Draft', schema:SCHEMA})))).filter(Boolean)
phase('Judge')
const judged = await agent(
  `严格的日语面接教练。以下3稿(JSON)。逐句核查口癖(い形+だと思います/感じします/けど/长句)是否为零、口语可说性、人柄、长度。final_short 必须是能自然停住的20秒版（2〜3句），final_main 只作追问追加且不重复20秒版。以最优稿为骨架合成，冗余亮点宁可删除。输出 final_main、final_short、winner、rationale(中文)、grafts。\n${BG}\n草稿：${JSON.stringify(drafts,null,2)}`,
  {label:'judge', phase:'Judge', schema:{type:'object', required:['final_main','rationale'],
    properties:{winner:{type:'string'},final_main:{type:'string'},final_short:{type:'string'},rationale:{type:'string'},grafts:{type:'string'}}}})
return { drafts, judged }
```

## 模式 B：多模块并行 → 整合（大部头，如"最终面接总合准备"）

一个大文档拆成几个独立模块（面接官攻略/语言战略/想定问答/技术深挖），并行生成，再一个高 effort agent 去重整合成连贯章节。

```js
phase('Draft')
const [m1, m2, m3, m4] = await parallel([
  () => agent(`写「面接官攻略」模块…\n${BG}\n${RULES}`, {label:'攻略', phase:'Draft', schema:SCHEMA}),
  () => agent(`写「语言战略」模块…\n${BG}\n${RULES}`, {label:'语言', phase:'Draft', schema:SCHEMA}),
  () => agent(`写「想定问答」模块…至少10题…\n${BG}\n${RULES}`, {label:'问答', phase:'Draft', schema:SCHEMA}),
  () => agent(`写「技术深挖+逆質問」模块…\n${BG}\n${RULES}`, {label:'技术', phase:'Draft', schema:SCHEMA}),
])
phase('Polish')
const merged = await agent(`主编。整合4模块(JSON)成连贯章节：统一格式(中文策略+日语话术带假名)、去重、补「面談直前の一枚」和时效性3项、逻辑排序。公司特化回答先放20秒版，冗余话术直接删除；外部事实保留可点击直接URL并选恰好3条★。输出完整Markdown(content字段)。\n${JSON.stringify([m1,m2,m3,m4].filter(Boolean),null,2)}`,
  {label:'整合', phase:'Polish', schema:SCHEMA, effort:'high'})
return { modules:[m1,m2,m3,m4], merged }
// SCHEMA = {type:'object', required:['title','content'], properties:{title:{type:'string'}, content:{type:'string'}}}
// content 用可直接粘贴的 Markdown（遵循 build_interview_html.py 的格式约定）
```

## 模式 C：场景分组生成（当日フレーズ集等清单型）

按场景把清单拆给几个 agent 并行（如"到着〜入室""面接中救急""退室〜意外"），每 agent 出该场景的一组短句，含"对方可能说→你怎么接"成对。

```js
const GROUPS = [
  {key:'arrival', inst:'场景组A【到着〜入室】：给若狹様打电话/找不到会议室/受付无人喊「有人吗」/自报家门/被让座端茶/敲门…'},
  {key:'during',  inst:'场景组B【面接中救急】：没听懂三件套/确认理解/要思考时间/说错重来/被夸/破冰雑談…'},
  {key:'closing', inst:'场景组C【逆質問〜退室〜意外】：逆質問开场/能否记笔记/致谢/道别/迟到道歉/紧张自救…'},
]
const SCHEMA = {type:'object', required:['scenes'], properties:{scenes:{type:'array', items:{type:'object',
  required:['title','items'], properties:{title:{type:'string'},
  items:{type:'array', items:{type:'object', required:['ja','zh'],
    properties:{ja:{type:'string', description:'日语句(含かな注音)。对话用【相手】/【あなた】成对'}, zh:{type:'string'}}}}}}}}}
const results = (await parallel(GROUPS.map(g => () =>
  agent(`资深日本商务礼仪+面接指导。生成你负责的场景组短句(每句注音+中文注+【相手】→【あなた】成对)。\n${PROFILE}\n${g.inst}`,
    {label:g.key, schema:SCHEMA})))).filter(Boolean)
return { groups: results }
```

---

## 处理 workflow 输出的注意

- workflow 结果在 task-notification 里可能被**截断**——读 `<transcriptDir>/journal.jsonl` 或 tasks 输出文件拿完整 JSON。外层可能有 `{result:{...}}` 包装，解析时探测一下。
- 生成的 Markdown 片段落 vault 后，先在桌面端 Web「本场面试」验证（## / ### / 【あなた】/ ▷ / 有序列表 / 外部链接）；只有明确需要离线版时再跑 `build_interview_html.py`。
- Python 处理含日语的字符串时，heredoc 里避免用英文引号 `"` 包中文/日语（引号冲突），用全角「」或三引号。
