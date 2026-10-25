import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { interviewAdvisoryOutputSchema, advisorySchemaErrors, advisorySemanticErrors } from "../lib/interview-advisory-contract.mjs";
import { normalizeInterviewAdvisory, normalizeInterviewInsights } from "../lib/interview-advisory.ts";
import { INSIGHT_MODULE_KEYS } from "../lib/interview-advisory-contract.mjs";

const Ajv = createRequire(import.meta.url)("ajv");
const A = "20_求職/株式会社テスト/一次面接_整理稿.md";
const B = "20_求職/株式会社サンプル/一次面接_整理稿.md";
const C = "10_自己/プロフィール.md";
const contract = { evidenceSources: [{sourcePath:A,blocks:[{blockId:"q01",sentenceIds:["s001","s002"]},{blockId:"q02",sentenceIds:["s003"]}]},{sourcePath:B,blocks:[{blockId:"q01",sentenceIds:["s010"]}]}], contextPaths:[C] };
const context = { sources:new Map(contract.evidenceSources.map(source=>[source.sourcePath,new Map(source.blocks.map(block=>[block.blockId,new Set(block.sentenceIds)]))])),contextPaths:new Set([C]) };
const meta = {generatedAt:"2026-01-01T00:00:00Z",model:"test",sourceFingerprint:"test"};
const schema = interviewAdvisoryOutputSchema(contract);
const compiled = new Ajv({allErrors:true}).compile(schema);
const ref = ()=>({sourcePath:A,blockId:"q01",sentenceIds:["s001","s002"]});
const good = ()=>({stage:"matching",commentaryZh:"对方询问经历，回答后继续核对条件。",fitZh:"已有具体开发经验，尚需核对职责。",recommendationZh:"确认项目职责再判断投入。",changeConditionsZh:"项目条件明确后更新判断。",evidence:[ref()],contextPaths:[C],observations:[{id:"o1",titleZh:"具体经历",observationZh:"先询问经历，再确认条件。",interpretationZh:"可能在核对经验适配。",alternativeZh:"也可能只是初步了解。",implicationZh:"保留可复用的具体解释。",evidence:[ref()],contextPaths:[]}],answerOptions:[{id:"a1",titleZh:"复用有效解释",situationZh:"被问已有开发经历时。",whyZh:"先答本人做过的事。",answerJa:"",scope:"general",evidence:[ref()],contextPaths:[]}],nextSteps:[{id:"n1",titleZh:"核对职责",detailZh:"询问具体任务和参与范围。",triggerZh:"收到项目说明时。",evidence:[ref()],contextPaths:[]}]});

test("完整有效稿通过实际 JSON schema 编译器与保存校验，来源/问题/句子配对不串场",()=>{
  const value=good();assert.equal(compiled(value),true,JSON.stringify(compiled.errors));assert.deepEqual(advisorySchemaErrors(value,schema),[]);assert.doesNotThrow(()=>normalizeInterviewAdvisory(value,meta,context));
  const choices=schema.$defs.evidenceReference.anyOf;assert.equal(choices.length,3);
  assert.equal(compiled({...value,evidence:[{sourcePath:A,blockId:"q02",sentenceIds:["s003"]}]}),true);
  for(const evidence of [[{sourcePath:B,blockId:"q02",sentenceIds:["s003"]}],[{sourcePath:A,blockId:"q02",sentenceIds:["s001"]}]]) assert.equal(compiled({...value,evidence}),false);
});

test("所有必需属性、文字、空值、枚举、路径及引用边界同时与保存校验一致",()=>{
  const mutations=[
    value=>{delete value.fitZh;},value=>{value.commentaryZh="  ";},value=>{value.stage="agency_guess";},
    value=>{value.observations[0].id="日本語";},value=>{value.observations[0].alternativeZh=null;},
    value=>{value.answerOptions[0].answerJa=null;},value=>{value.answerOptions[0].scope="all";},
    value=>{value.nextSteps[0].triggerZh="";},value=>{value.evidence=[];},
    value=>{value.evidence[0].sourcePath="一次面接.md";},value=>{value.evidence[0].blockId="q01/q02";},
    value=>{value.evidence[0].blockId="q99";},value=>{value.evidence[0].sentenceIds=[];},
    value=>{value.evidence[0].sentenceIds=["s003"];},value=>{value.contextPaths=["20_求職/未提供.md"];},
    value=>{value.observations[0].contextPaths=["/absolute.md"];},value=>{value.overallScore=99;},
    value=>{value.observations[0].evidence[0].extra="invented";},
  ];
  for(const change of mutations){const value=good();change(value);assert.equal(compiled(value),false);assert.ok(advisorySchemaErrors(value,schema).length);assert.throws(()=>normalizeInterviewAdvisory(value,meta,context),/顾问复盘数据无效/);}
});

test("不能由 schema 表达的全报告唯一性仍由共享语义校验拒绝，合法空字符串保留",()=>{
  const mutations=[value=>{value.nextSteps[0].id="o1";},value=>{value.evidence.push(ref());},value=>{value.contextPaths=[C,C];}];
  for(const change of mutations){const value=good();change(value);assert.equal(compiled(value),true);assert.ok(advisorySemanticErrors(value).length);assert.throws(()=>normalizeInterviewAdvisory(value,meta,context),/重复/);}
  const value=good();value.observations[0].alternativeZh="";assert.equal(compiled(value),true);assert.doesNotThrow(()=>normalizeInterviewAdvisory(value,meta,context));
});

test("实际观察到的三类失败均可复现拒绝，模拟值明确不是未留存的真实完整输出",async()=>{
  const observed=JSON.parse(await readFile(new URL("./fixtures/advisory-observed-failures.json",import.meta.url),"utf8"));assert.equal(observed.fullOutputAvailable,false);assert.equal(observed.observedErrors.length,3);
  for(const change of [value=>{value.observations[0].evidence=[];},value=>{value.observations[0].evidence[0].sourcePath="错误路径.md";},value=>{value.evidence[0].blockId="无效编号";}]){const value=good();change(value);assert.equal(compiled(value),false);assert.throws(()=>normalizeInterviewAdvisory(value,meta,context));}
});

test("横向五模块、引用配对和不同场次条件同样覆盖，空 findings 合法",()=>{
  const crossSchema=interviewAdvisoryOutputSchema(contract,"insights");const check=new Ajv({allErrors:true}).compile(crossSchema);
  const value={overviewZh:"按不同场次原话核对。",modules:INSIGHT_MODULE_KEYS.map(key=>({key,titleZh:key,commentaryZh:"现有材料的分析边界。",findings:[]}))};
  value.modules[0].findings=[{id:"finding_a",titleZh:"对照范围",bodyZh:"两场都有实际可追溯原句。",boundaryZh:"不能据此推定录用意图。",evidence:[ref(),{sourcePath:B,blockId:"q01",sentenceIds:["s010"]}],contextPaths:[]}];
  assert.equal(check(value),true);assert.doesNotThrow(()=>normalizeInterviewInsights(value,meta,context));
  const sameSource=structuredClone(value);sameSource.modules[0].findings[0].evidence[1]={sourcePath:A,blockId:"q02",sentenceIds:["s003"]};assert.equal(check(sameSource),true);assert.ok(advisorySemanticErrors(sameSource,"insights").some(error=>error.includes("两个不同场次")));assert.throws(()=>normalizeInterviewInsights(sameSource,meta,context));
  const duplicate=structuredClone(value);duplicate.modules[1].key=duplicate.modules[0].key;assert.equal(check(duplicate),true);assert.throws(()=>normalizeInterviewInsights(duplicate,meta,context),/重复横向模块/);
  const missing=structuredClone(value);missing.modules.pop();assert.equal(check(missing),false);assert.throws(()=>normalizeInterviewInsights(missing,meta,context),/五个模块/);
});
