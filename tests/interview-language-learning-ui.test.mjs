import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAppModule as loadModule } from "./helpers/render-tsx.mjs";

const loadAppModule = (path, options = {}) => loadModule(path, { ...options, stubs: { ...options.stubs, "./ui-locale": { useUiLocale: () => ({ locale: "zh-CN" }) } } });
import { languageIndexOf } from "../lib/interview-language.ts";

const source = {id:"test-source",path:"20_求職/株式会社テスト/原稿.md",date:"2026-09-01",company:"株式会社テスト",kind:"employer",transcriptType:"asr",scope:"primary",sha256:"a".repeat(64),lineCount:100,readCoverage:"full",limitations:["未核验录音。"]};
const question = (id,text) => ({id,sourceId:source.id,topicId:"introduction",intentId:"summary",intentZh:"简要说明",originalText:text,questionText:text,meaningZh:"请简短说明。",answerScopeZh:"说明指定内容。",detailsZh:[],structureZh:[],lineStart:10,lineEnd:12,questionKind:"request",confidence:"high",reviewStatus:"accepted",reviewReasonZh:"连续问答支持提问定位。",speakerBasisZh:"前后话者交替。",annotations:[]});
const occurrence = (questionId,quote) => ({questionId,quote,highlights:[{start:quote.indexOf("説明"),end:quote.indexOf("説明")+2,text:"説明",role:"core",labelZh:"要做的动作"}],coreMeaningZh:"说明问题指定的内容。",limitsZh:["只谈被问到的范围。"],explanationZh:"请求说明；ASR 没有当成已核验原音。"});
const point = (id,dimension,occurrences) => ({id,dimension,titleZh:`学习${id}`,patternJa:"〜を説明してください",meaningZh:"把说明对象和请求动作分开。",explanationZh:["先找出要说明的内容。","具体接续看动词形式。"],pitfallsZh:["礼貌形式不改变说明对象。"],occurrences,readingJa:"せつめい",teachingExamples:[{ja:"手順を説明してください。",zh:"请说明步骤。",noteZh:"新编教学例，不代表本人经历。"}],practice:{promptZh:"教学问题要求先说明哪一项？",answerZh:"先说明指定对象，再补必要信息。",simpleJa:"はい、説明します。",noteZh:"只示范承接，不代填本人经历或意愿。"}});
function fixture(){
  const questions=Array.from({length:43},(_,i)=>question(`q-${i}`,`経歴${i}を説明してください。`));
  questions.push({...questions[42],id:"q-duplicate"});
  const index={schemaVersion:1,sourceCollectionId:"test-questions",points:[point("hon-request","honorific",[occurrence("q-0",questions[0].questionText),occurrence("q-duplicate",questions[42].questionText)]),point("gram-object","grammar",[occurrence("q-0",questions[0].questionText)])],auditNotes:["精选语句，不声称覆盖全部语法。"]};
  const collection={schemaVersion:1,collectionId:"test-questions",title:"测试问题集",window:{start:"2026-07-03",end:"2026-10-04",timezone:"Asia/Tokyo"},phase:"complete",publishedTopicIds:["introduction"],sources:[source],questions,excludedCandidates:[],auditNotes:[],languageIndex:index};
  assert.ok(languageIndexOf(collection));
  return {collection,index};
}
const walk=value=>!value||typeof value!=="object"?[]:Array.isArray(value)?value.flatMap(walk):[value,...walk(value.props?.children)];
const findButton=(tree,label)=>walk(tree).find(node=>node.type==="button"&&JSON.stringify(node.props.children).includes(label));
const noops={onSelectPoint(){},onSelectQuestion(){},onBrowseQuestions(){},onOpenQuestion(){},onBack(){},onOpenWiki(){}};
const asNote=value=>({path:"20_求職/_素材/测试问题集.md",tags:[],stat:{ctime:1,mtime:1,size:1},frontmatter:{type:"material",material_kind:"interview-question-collection",collection_id:value.collectionId},content:`<!-- interview-questions-json:start -->\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\`\n<!-- interview-questions-json:end -->`});
const textbook={path:"20_求職/_素材/测试教材.md",tags:[],stat:{ctime:1,mtime:1,size:1},frontmatter:{type:"material",material_kind:"language-textbook-chapter",chapter_id:"sample",chapter_order:1,title:"原教材",chapter_group:"表达"},content:"# 原教材\n\n原教材正文。"};

test("语言学习分四维、一次只读一条真引用，教学和参考默认折叠且没有答题状态",async()=>{
  const {default:View}=await loadAppModule("app/interview-language-learning.tsx");
  const html=renderToStaticMarkup(React.createElement(View,{...fixture(),...noops}));
  for(const text of ["敬语","常见表达","语法","词汇","这句要回答什么","易漏的范围与限定","ASR 转写","教学整理，非原问","非实见原问、非本人经历","可跳过，也可直接看参考","L10–12","颜色表示句子中的作用，不表示错误"])assert.ok(html.includes(text),text);
  assert.match(html,/第 1 \/ 2 条/);
  assert.equal(html.includes("経歴42"),false);
  assert.match(html,/<details><summary>查看参考与理由/);
  assert.equal(html.includes("<textarea"),false); assert.equal(html.includes("<input"),false); assert.equal(html.includes("<details open"),false);
  const second=renderToStaticMarkup(React.createElement(View,{...fixture(),...noops,pointId:"hon-request",questionId:"q-duplicate"}));
  assert.match(second,/第 2 \/ 2 条/); assert.match(second,/経歴42/); assert.equal(second.includes("経歴0"),false);
});

test("高亮精确保留UTF16文本，HTML只显示文字，每个标记有可见标签关联",async()=>{
  const {HighlightedQuestion}=await loadAppModule("app/interview-language-learning.tsx");
  const quote="🙂<script>説明</script>をお願いします。";
  const highlights=[{start:2,end:10,text:"<script>",role:"term",labelZh:"保留字面符号"},{start:10,end:12,text:"説明",role:"core",labelZh:"动作"}];
  const html=renderToStaticMarkup(React.createElement(HighlightedQuestion,{quote,highlights,labelPrefix:"sample"}));
  assert.match(html,/🙂<strong[^>]+>&lt;script&gt;<\/strong><strong[^>]+>説明<\/strong>&lt;\/script&gt;をお願いします。/);
  assert.equal(html.includes("<script>"),false); assert.match(html,/aria-describedby="sample-10"/);
  const {default:View}=await loadAppModule("app/interview-language-learning.tsx");
  const content=renderToStaticMarkup(React.createElement(View,{...fixture(),...noops}));
  assert.match(content,/id="language-mark-hon-request-q-0-4"/); assert.match(content,/核心任务/);
});

test("分类、知识点和真实例切换受URL控制；无内容分类不伪造例句",async()=>{
  const {default:View}=await loadAppModule("app/interview-language-learning.tsx");
  let selection; let example; let opened;
  const props={...fixture(),...noops,onSelectPoint:(...args)=>{selection=args;},onSelectQuestion:(...args)=>{example=args;},onOpenQuestion:id=>{opened=id;}};
  findButton(View(props),"下一条").props.onClick();assert.deepEqual(example,["q-duplicate","honorific","hon-request"]);
  findButton(View(props),"查看完整原问").props.onClick();assert.equal(opened,"q-0");
  findButton(View(props),"语法").props.onClick();assert.deepEqual(selection,["grammar"]);
  const restored=View({...props,dimensionId:"grammar",pointId:"hon-request",questionId:"q-duplicate"});
  assert.ok(JSON.stringify(restored).includes("経歴42"));
  const empty=renderToStaticMarkup(React.createElement(View,{...props,dimensionId:"vocabulary"}));assert.match(empty,/这个分类尚未整理知识点/);assert.equal(empty.includes("language-real-example"),false);
});

test("原问合并来源关联到知识点，跳入时保留实际引用qid；未关联题不作能力判断",async()=>{
  const {default:View}=await loadAppModule("app/interview-question-collection.tsx",{stubs:{react:{useMemo:fn=>fn(),useEffect(){}}}});
  const {collection,index}=fixture();let selected;
  const tree=View({collection,topicId:"introduction",page:3,languageIndex:index,onOpenLanguage:(...args)=>{selected=args;},onSelectTopic(){},onBack(){},onOpenWiki(){}});
  const card=walk(tree).find(node=>node.props?.variant?.question.id==="q-42");
  const content=card.type(card.props);
  findButton(content,"学习hon-request").props.onClick();assert.deepEqual(selected,["honorific","hon-request","q-duplicate"]);
  const other=walk(tree).find(node=>node.props?.variant?.question.id==="q-40");
  assert.equal(JSON.stringify(other.type(other.props)).includes("从这句继续学"),false);
});

test("首页入口与语言URL可刷新和back；跳原问定位第三页并清筛选，旧教材优先且返回清理",async()=>{
  const history=[];
  const browser={location:new URL("http://localhost:3000/training/topics?specialModule=questions&questionCatalog=language&ui=ja"),localStorage:{getItem:()=>null},dispatchEvent(){},history:{state:{keep:true},pushState(state,_title,href){history.push(browser.location.href);this.state=state;browser.location=new URL(href,browser.location);},replaceState(state,_title,href){this.state=state;browser.location=new URL(href,browser.location);}}};
  const {default:Page}=await loadAppModule("app/language-expression-courses.tsx",{globals:{window:browser},stubs:{react:{...React,useMemo:fn=>fn(),useCallback:fn=>fn,useSyncExternalStore:(_subscribe,snapshot)=>snapshot()},"./ui-locale":{useUiLocale:()=>({locale:"zh"})}}});
  const {collection}=fixture();const props={notes:[textbook,asNote(collection)],onOpen(){},onOpenWiki(){},onVaultChanged:async()=>{}};
  const view=()=>Page.type(props);const language=()=>walk(view()).find(node=>node.props?.index?.sourceCollectionId==="test-questions");
  walk(view()).find(node=>node.props?.module==="questions" && node.props?.onSelectLanguagePoint).props.onSelectLanguagePoint("test-questions", "honorific", "hon-request");
  assert.equal(browser.location.searchParams.get("questionView"),"language");assert.equal(browser.location.searchParams.has("chapter"),false);
  language().props.onSelectPoint("honorific","hon-request");language().props.onSelectQuestion("q-duplicate","honorific","hon-request");
  const saved=browser.location.href;assert.equal(language().props.questionId,"q-duplicate");
  language().props.onOpenQuestion("q-duplicate");
  assert.equal(browser.location.searchParams.get("questionPage"),"3");assert.equal(browser.location.searchParams.get("questionId"),"q-42");assert.equal(browser.location.searchParams.get("questionTopic"),"introduction");
  for(const key of ["questionView","languageCategory","languagePoint","questionReview","questionKind","questionSearch"])assert.equal(browser.location.searchParams.has(key),false);
  const questionView=walk(view()).find(node=>node.props?.focusedQuestionId==="q-42");assert.equal(questionView.props.page,3);
  browser.location=new URL(history.pop());assert.equal(browser.location.href,saved);assert.equal(language().props.questionId,"q-duplicate");
  language().props.onBrowseQuestions();assert.equal(browser.location.searchParams.get("questionTopic"),"all");assert.equal(browser.location.searchParams.has("questionId"),false);
  browser.location=new URL(saved);language().props.onBack();
  assert.equal(browser.location.searchParams.get("specialModule"),"questions");
  assert.equal(browser.location.searchParams.get("questionCatalog"),"language");
  assert.equal(browser.location.searchParams.get("languageCategory"),"all");
  for(const key of ["chapter","questionSet","questionView","languagePoint","questionId"])assert.equal(browser.location.searchParams.has(key),false);
  assert.equal(browser.location.searchParams.get("ui"),"ja");assert.equal(browser.history.state.keep,true);
  browser.location=new URL(`${saved}&chapter=sample`);assert.equal(language(),undefined);
});

test("定位原问滚动并聚焦真实卡片，不仅追加hash",async()=>{
  const calls=[];const target={scrollIntoView:args=>calls.push(["scroll",args]),focus:args=>calls.push(["focus",args])};
  const {default:View}=await loadAppModule("app/interview-question-collection.tsx",{globals:{document:{getElementById:id=>{calls.push(["id",id]);return target;}}},stubs:{react:{useMemo:fn=>fn(),useEffect:fn=>fn()}}});
  View({collection:fixture().collection,topicId:"introduction",page:3,focusedQuestionId:"q-42",onSelectTopic(){},onBack(){},onOpenWiki(){}});
  assert.deepEqual(calls,[["id","question-q-42"],["scroll",{block:"start"}],["focus",{preventScroll:true}]]);
});

test("坏语言索引不会隐藏原问题集，旧入口和正文继续可读",async()=>{
  const {collection}=fixture();collection.languageIndex={bad:true};
  const {default:Page}=await loadAppModule("app/language-expression-courses.tsx",{globals:{window:{location:{search:"?questionSet=test-questions&questionTopic=introduction"},localStorage:{getItem:()=>null}}}});
  const html=renderToStaticMarkup(React.createElement(Page,{notes:[asNote(collection)],onOpen(){},onOpenWiki(){},onVaultChanged:async()=>{}}));
  assert.match(html,/aria-label="面试官问题集"/);assert.match(html,/経歴0を説明してください。/);assert.equal(html.includes("从真实提问学语言"),false);
});
