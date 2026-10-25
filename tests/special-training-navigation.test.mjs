import assert from "node:assert/strict";
import test from "node:test";
import {
  SPECIAL_MODULES,
  specialTrainingRoute,
  specialTrainingHref,
  specialCourseHref,
  specialQuestionCounts,
  specialSavedReadings,
} from "../lib/special-training-navigation.ts";
import { textbookPositionKey } from "../lib/language-textbook-position.ts";

const detailParams = {
  specialModule:"practice", course:"old-course", chapter:"old-chapter", knowledge:"old-point", lessonView:"source",
  questionSet:"old-set", questionTopic:"career", questionReview:"pending", questionKind:"agency", questionSearch:"旧检索",
  questionPage:"3", questionView:"language", languageCategory:"grammar", languagePoint:"gram-old", questionId:"q-old",
  note:"20_求職/株式会社テスト/原稿.md", section:"旧标题",
};
const parseHref = href => new URL(href,"http://localhost:3000");

test("专项模块目录只有约定的三个模块，裸地址是总览且不读取旧课程或阅读缓存",()=>{
  assert.deepEqual(SPECIAL_MODULES.map(item=>item.id),["questions","textbook","practice"]);
  const original=globalThis.window;
  globalThis.window={localStorage:{getItem(){throw new Error("首页路由不应读取缓存课程或教材位置");}}};
  try{
    for(const search of ["","?ui=ja","?specialModule=home","?questionPage=3&questionSearch=残留检索"]){
      assert.deepEqual(specialTrainingRoute(search),{kind:"home"});
    }
  }finally{if(original===undefined)delete globalThis.window;else globalThis.window=original;}
});

test("显式总览或模块列表优先于旧详情参数，列表不会被上次课程接管",()=>{
  for(const id of ["home","questions","textbook","practice"]){
    const params=new URLSearchParams({...detailParams,specialModule:id});
    assert.deepEqual(specialTrainingRoute(params.toString()),id==="home"?{kind:"home"}:{kind:"module",module:id});
  }
});

test("旧深链保留course优先chapter优先questionSet，语言视图由questionView区分",()=>{
  const rows=[
    ["?course=course-a&chapter=chapter-a&questionSet=set-a&questionView=language",{kind:"course",module:"practice",courseId:"course-a"}],
    ["?chapter=chapter-a&questionSet=set-a&questionView=language",{kind:"chapter",module:"textbook",chapterId:"chapter-a"}],
    ["?questionSet=set-a&questionTopic=career",{kind:"questions",module:"questions",collectionId:"set-a"}],
    ["?questionSet=set-a&questionView=language&languageCategory=grammar&languagePoint=gram-a",{kind:"language",module:"questions",collectionId:"set-a"}],
    ["?questionSet=set-a&questionView=unknown",{kind:"questions",module:"questions",collectionId:"set-a"}],
    ["?knowledge=point-a&lessonView=contrast",{kind:"chapter",module:"textbook",chapterId:""}],
    ["?lessonView=examples",{kind:"chapter",module:"textbook",chapterId:""}],
  ];
  for(const [search,expected] of rows){
    assert.deepEqual(specialTrainingRoute(search),expected);
    assert.deepEqual(specialTrainingRoute(`${search}&specialModule=unsupported`),expected);
  }
  assert.deepEqual(specialTrainingRoute("?specialModule=unsupported"),{kind:"home"});
});

test("返回总览或模块列表清理全部旧详情键，保留无关参数且能往返解析",()=>{
  const search=new URLSearchParams({...detailParams,ui:"ja",unrelated:"保留值"}).toString();
  const home=parseHref(specialTrainingHref(search));
  assert.equal(home.pathname,"/training/topics");
  for(const key of Object.keys(detailParams))assert.equal(home.searchParams.has(key),false,key);
  assert.equal(home.searchParams.get("ui"),"ja");assert.equal(home.searchParams.get("unrelated"),"保留值");
  assert.deepEqual(specialTrainingRoute(home.search),{kind:"home"});
  assert.equal(specialTrainingHref(""),"/training/topics");
  for(const moduleId of ["questions","textbook","practice"]){
    const next=parseHref(specialTrainingHref(search,moduleId));
    assert.equal(next.searchParams.get("specialModule"),moduleId);
    for(const key of Object.keys(detailParams).filter(key=>key!=="specialModule"))assert.equal(next.searchParams.has(key),false,key);
    assert.equal(next.searchParams.get("ui"),"ja");
    assert.deepEqual(specialTrainingRoute(next.search),{kind:"module",module:moduleId});
  }
});

test("从列表打开课程清理模块与其他详情参数，课程深链可独立恢复",()=>{
  const href=parseHref(specialCourseHref(new URLSearchParams({...detailParams,ui:"ja"}).toString(),"course-b"));
  assert.equal(href.pathname,"/training/topics");assert.equal(href.searchParams.get("course"),"course-b");
  for(const key of Object.keys(detailParams).filter(key=>key!=="course"))assert.equal(href.searchParams.has(key),false,key);
  assert.equal(href.searchParams.get("ui"),"ja");
  assert.deepEqual(specialTrainingRoute(href.search),{kind:"course",module:"practice",courseId:"course-b"});
});

const source=(id,extra={})=>({id,path:`20_求職/株式会社テスト/${id}.md`,date:"2026-09-01",company:"株式会社テスト",kind:"employer",transcriptType:"asr",scope:"primary",sha256:"a".repeat(64),lineCount:100,readCoverage:"full",limitations:[],...extra});
const question=(id,sourceId,extra={})=>({id,sourceId,topicId:"introduction",intentId:"summary",intentZh:"自我介绍",originalText:"自己紹介をお願いします。",meaningZh:"请自我介绍。",answerScopeZh:"概述本人经历。",detailsZh:[],structureZh:[],lineStart:1,lineEnd:2,questionKind:"request",confidence:"high",reviewStatus:"accepted",reviewReasonZh:"已核对提问话者。",speakerBasisZh:"连续问答。",annotations:[],...extra});

test("首页数字计审核通过的窗口内ASR记录，重复说法仍计来源记录而非独立问题",()=>{
  const collection={schemaVersion:1,collectionId:"test-set",title:"测试问题集",window:{start:"2026-07-03",end:"2026-10-04",timezone:"Asia/Tokyo"},phase:"phase-one",publishedTopicIds:["introduction","career"],sources:[source("main"),source("agency",{kind:"agency"}),source("memory",{scope:"nonverbatim",transcriptType:"memory"}),source("review",{scope:"nonverbatim",transcriptType:"review"}),source("background",{scope:"background"})],questions:[
    question("accepted","main"),question("duplicate","agency"),question("career","main",{topicId:"career"}),
    question("pending","main",{reviewStatus:"pending"}),question("old-low","main",{reviewStatus:undefined,confidence:"low"}),
    question("confirmed-low","main",{confidence:"low"}),question("old-high","main",{reviewStatus:undefined}),
    question("unpublished","main",{topicId:"projects-technology"}),question("memory","memory"),question("review","review"),question("background","background"),
  ],excludedCandidates:[],auditNotes:[]};
  assert.deepEqual(specialQuestionCounts(collection),{acceptedAsr:5,topics:2});
  assert.deepEqual(specialQuestionCounts({...collection,questions:[]}),{acceptedAsr:0,topics:2});
});

const point=id=>({id,titleZh:"说明职责",patternJa:"担当する",meaningZh:"说明负责内容",explanationZh:["先确认动作对象。"],examples:[{ja:"設計を担当します。",zh:"负责设计。"}],contrasts:[{leftJa:"担当します。",leftZh:"承担职责",rightJa:"説明します。",rightZh:"进行说明",explanationZh:"动作不同。"}],cautionZh:"不代填本人经验。"});
const chapter=id=>({chapterId:id,order:1,group:"表达",title:`教材${id}`,summary:"学习说明",studyMinutes:15,exerciseCourseId:"",module:{summaryZh:"学习职责表达",points:[point("one"),point("two")],recapZh:["先找对象。"]},note:{path:`20_求職/_素材/${id}.md`,tags:[],stat:{ctime:1,mtime:1,size:1},frontmatter:{type:"material"},content:"# 测试教材"}});

test("已保存阅读只返回实际存在的知识点，不从章节列表捏造最后阅读",()=>{
  const chapters=[chapter("a"),chapter("b")];const saved=new Map([[textbookPositionKey("b"),JSON.stringify({knowledge:"two",lessonView:"contrast"})]]);
  const readKeys=[];const readings=specialSavedReadings(chapters,key=>{readKeys.push(key);return saved.get(key)??null;});
  assert.deepEqual(readings,[{chapter:chapters[1],position:{knowledge:"two",lessonView:"contrast"}}]);
  assert.ok(readKeys.includes(textbookPositionKey("a")));assert.ok(readKeys.includes(textbookPositionKey("b")));
  assert.deepEqual(specialSavedReadings(chapters,()=>null),[]);
});

test("坏JSON、已删除知识点和无学习模块不被当作可续读位置",()=>{
  for(const raw of ["{bad","null","[]","42",JSON.stringify({knowledge:"deleted",lessonView:"examples"}),JSON.stringify({lessonView:"explain"})]){
    assert.deepEqual(specialSavedReadings([chapter("a")],()=>raw),[],raw);
  }
  const withoutModule={...chapter("plain"),module:undefined};
  assert.deepEqual(specialSavedReadings([withoutModule],()=>JSON.stringify({knowledge:"one",lessonView:"explain"})),[]);
});
