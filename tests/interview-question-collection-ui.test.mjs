import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAppModule as loadModule } from "./helpers/render-tsx.mjs";

const loadAppModule = (path, options = {}) => loadModule(path, { ...options, stubs: { ...options.stubs, "./ui-locale": { useUiLocale: () => ({ locale: "zh-CN" }) } } });
import { questionCollectionHref } from "../lib/interview-question-collection.ts";

const source = (id, extra = {}) => ({id,path:`20_求職/株式会社テスト/${id}.md`,date:"2026-09-01",company:"株式会社テスト",kind:"employer",transcriptType:"asr",scope:"primary",sha256:"a".repeat(64),lineCount:100,readCoverage:"full",limitations:["没有据此核验原音。"],...extra});
const question = (id, sourceId, extra = {}) => ({id,sourceId,topicId:"introduction",intentId:"brief-introduction",intentZh:"简要介绍本人",originalText:"自己紹介をお願いします。本人回答只在来源内。",questionText:"自己紹介をお願いします。",meaningZh:"请作自我介绍。",answerScopeZh:"介绍本人概况，不替本人补充经历。",detailsZh:["没有指定分钟数。"],structureZh:[],lineStart:10,lineEnd:12,questionKind:"request",confidence:"high",speakerBasisZh:"根据前后问答确认由对方提出。",contextBefore:"前文记录。",contextAfter:"后续问答记录。",annotations:[{path:"20_求職/株式会社テスト/批注.md",lineStart:2,lineEnd:3,excerpt:"本人说明了当时的理解。",nature:"self-note"}],...extra});
const collection = {
  schemaVersion:1,collectionId:"interview-questions",title:"面试官问题集",window:{start:"2026-07-03",end:"2026-10-04",timezone:"Asia/Tokyo"},phase:"phase-one",publishedTopicIds:["introduction"],
  sources:[source("test-a"),source("test-b",{kind:"agency",date:"2026-09-02"}),source("test-memory",{transcriptType:"memory",scope:"nonverbatim"}),source("test-background",{date:"2026-06-25",scope:"background"})],
  questions:[question("a-1","test-a"),question("b-1","test-b"),question("memory-1","test-memory",{originalText:"回忆：对方请我介绍近况。",questionText:undefined}),question("background-1","test-background"),question("career-1","test-a",{topicId:"career",intentId:"career",originalText:"未发布主题私有问法。",questionText:undefined})],
  excludedCandidates:[{sourceId:"test-a",lineStart:20,lineEnd:21,excerpt:"本人向企业反问。",reason:"本人逆问，不是面试官提问。"}],auditNotes:["已读范围与主题发布分别记录。"],
};
const asNote = value => ({path:"20_求職/_素材/面试官问题集.md",tags:[],stat:{ctime:1,mtime:1,size:1},frontmatter:{type:"material",material_kind:"interview-question-collection",collection_id:value.collectionId},content:`<!-- interview-questions-json:start -->\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\`\n<!-- interview-questions-json:end -->`});
const textbook = {path:"20_求職/_素材/教材.md",tags:[],stat:{ctime:1,mtime:1,size:1},frontmatter:{type:"material",material_kind:"language-textbook-chapter",chapter_id:"sample",chapter_order:1,title:"保留的学习章",chapter_group:"表达"},content:"# 保留的学习章\n\n教材正文保持可读。"};
async function renderCollection(value=collection,topicId="introduction",filters={}) {
  const {default:View}=await loadAppModule("app/interview-question-collection.tsx");
  return renderToStaticMarkup(createElement(View,{collection:value,topicId,...filters,onSelectTopic(){},onFilterChange(){},onBack(){},onOpenWiki(){}}));
}
async function renderPage(search="") {
  const {default:Page}=await loadAppModule("app/language-expression-courses.tsx",{globals:{window:{location:{search},localStorage:{getItem:()=>null}}}});
  return renderToStaticMarkup(createElement(Page,{notes:[textbook,asNote(collection)],onOpen(){},onOpenWiki(){},onVaultChanged:async()=>{}}));
}

test("问题集以阅读呈现：同意图同原问折叠，全部来源和原回答保留在关闭的详情中",async()=>{
  const html=await renderCollection();
  assert.match(html,/aria-label="问题语义主题"/);
  assert.match(html,/筛选结果：2 条已审核窗口内记录 · 1 种实见说法 · 1 个意图组/);
  assert.match(html,/来源、连续上下文与批注 · 2 处/);
  assert.match(html,/株式会社テスト · 2026年9月2日 · 中介/);
  assert.match(html,/class="question-sources"><summary/);
  assert.match(html,/class="question-occurrence"><summary/);
  assert.match(html,/本人回答只在来源内/);
  const beforeDetails=html.slice(html.indexOf('class="question-reading-card"'),html.indexOf('class="question-sources"'));
  assert.match(beforeDetails,/自己紹介をお願いします。/);
  assert.equal(beforeDetails.includes("本人回答只在来源内"),false);
  for(const value of ["中文意译","具体要回答什么","易漏限定","本人批注","话者依据","提问定位","不是 ASR 原句可靠度","全文 100 行"]) assert.ok(html.includes(value));
  for(const value of ["<textarea","确认这次作答","自评","标准答案","展开复杂句结构"]) assert.equal(html.includes(value),false);
});

test("未发布问题不可浏览，来源清单仍可看；回忆和窗口前背景不混入主计数",async()=>{
  const html=await renderCollection();
  assert.equal(html.includes("未发布主题私有问法"),false);
  assert.match(html,/回忆内容，非原句/);
  assert.match(html,/窗口前背景/);
  assert.equal(html.includes("回忆：对方请我介绍近况。"),false);
  assert.equal(html.includes('id="question-background-1"'),false);
  assert.match(html,/完整来源清单与覆盖说明 · 4 份材料/);
  const unpublished=await renderCollection(collection,"career");
  assert.match(unpublished,/这个主题尚未发布/);
  assert.equal(unpublished.includes("未发布主题私有问法"),false);
  assert.match(unpublished,/完整来源清单与覆盖说明/);
});

test("可读整理明确分层，复杂句才出现拆解；AI批注不算本人确认",async()=>{
  const value=structuredClone(collection);
  value.questions[0].readableJa="簡単に自己紹介をお願いします。";
  value.questions[0].structureZh=["请求外壳包围自我介绍这个动作。"];
  value.questions[0].uncertaintyZh="称呼转写可能损坏，提问意图仍可识别。";
  value.questions[0].annotations[0].nature="ai-note";
  const html=await renderCollection(value);
  for(const value of ["可读整理 · 不是现场原句","展开复杂句结构","称呼转写可能损坏","AI 整理批注（非本人确认）"]) assert.ok(html.includes(value));
});

test("旧低置信度条目默认移入待核，显式审核状态优先",async()=>{
  const value=structuredClone(collection);
  value.questions[0].confidence="low";
  value.questions[0].uncertaintyZh="无法确认是否向本人提问。";
  const html=await renderCollection(value);
  assert.match(html,/筛选结果：1 条已审核窗口内记录/);
  assert.equal(html.includes("无法确认是否向本人提问"),false);
  const pending=await renderCollection(value,"introduction",{review:"pending"});
  assert.match(pending,/筛选结果：1 条待核记录/);
  assert.match(pending,/无法确认是否向本人提问/);
  value.questions[0].reviewStatus="accepted";
  value.questions[0].reviewReasonZh="已核对前后话者。";
  const accepted=await renderCollection(value);
  assert.match(accepted,/筛选结果：2 条已审核窗口内记录/);
  assert.match(accepted,/无法确认是否向本人提问/);
});

test("专项总览提供研读模块，显式问题集与主题URL恢复，旧章节仍优先",async()=>{
  const home=await renderPage();
  assert.match(home,/aria-label="专项训练总览"/);
  assert.match(home,/真实提问研读/);
  assert.equal(home.includes("教材正文保持可读"),false);
  const opened=await renderPage("?questionSet=interview-questions&questionTopic=introduction");
  assert.match(opened,/aria-label="面试官问题集"/);
  assert.equal(opened.includes("教材正文保持可读"),false);
  const pending=await renderPage("?questionSet=interview-questions&questionTopic=career");
  assert.match(pending,/这个主题尚未发布/);
  const legacy=await renderPage("?questionSet=interview-questions&chapter=sample");
  assert.match(legacy,/教材正文保持可读/);
  assert.equal(legacy.includes('aria-label="问题语义主题"'),false);
});

test("进入问题集清除课程与教材参数，保留无关页面参数",()=>{
  const href=questionCollectionHref("?course=old&chapter=sample&knowledge=point&lessonView=source&note=old&section=old&ui=ja","interview-questions","introduction");
  const params=new URL(href,"http://localhost:3000").searchParams;
  assert.equal(params.get("questionSet"),"interview-questions");
  assert.equal(params.get("questionTopic"),"introduction");
  assert.equal(params.get("ui"),"ja");
  for(const key of ["course","chapter","knowledge","lessonView","note","section"]) assert.equal(params.has(key),false);
});

test("主题、搜索和返回触发受控导航，不新增答案或自评状态",async()=>{
  let query=""; let selected=""; let returned=false;
  const {default:View}=await loadAppModule("app/interview-question-collection.tsx",{stubs:{react:{useMemo:fn=>fn(),useEffect(){}}}});
  const walk=value=>!value||typeof value!=="object"?[]:Array.isArray(value)?value.flatMap(walk):[value,...walk(value.props?.children)];
  const view=()=>View({collection,topicId:"introduction",query,onFilterChange:change=>{if(change.query!==undefined)query=change.query;},onSelectTopic:id=>{selected=id;},onBack:()=>{returned=true;},onOpenWiki(){}});
  const input=walk(view()).find(node=>node.type==="input");
  input.props.onChange({target:{value:"不存在的片段"}});
  assert.ok(JSON.stringify(view()).includes("当前筛选下没有匹配记录"));
  const career=walk(view()).find(node=>node.type==="button" && JSON.stringify(node.props.children).includes("职历与经历"));
  career.props.onClick(); assert.equal(selected,"career");
  const back=walk(view()).find(node=>node.type==="button" && JSON.stringify(node.props.children).includes("返回研读目录"));
  back.props.onClick(); assert.equal(returned,true);
});

test("主题导航写入历史且返回清理问题集参数，旧章节入口可按 back 地址恢复",async()=>{
  const history=[];
  const browser={location:new URL("http://localhost:3000/training/topics?specialModule=questions&ui=ja"),localStorage:{getItem:()=>null},dispatchEvent(){},history:{state:{preserved:true},pushState(state,_title,href){history.push(browser.location.href);this.state=state;browser.location=new URL(href,browser.location);},replaceState(state,_title,href){this.state=state;browser.location=new URL(href,browser.location);}}};
  const {default:Page}=await loadAppModule("app/language-expression-courses.tsx",{globals:{window:browser},stubs:{react:{...React,useMemo:fn=>fn(),useCallback:fn=>fn,useSyncExternalStore:(_subscribe,snapshot)=>snapshot()},"./ui-locale":{useUiLocale:()=>({locale:"zh"})}}});
  const props={notes:[textbook,asNote(collection)],onOpen(){},onOpenWiki(){},onVaultChanged:async()=>{}};
  const walk=value=>!value||typeof value!=="object"?[]:Array.isArray(value)?value.flatMap(walk):[value,...walk(value.props?.children)];
  const view=()=>Page.type(props);
  const entry=walk(view()).find(node=>node.props?.module==="questions" && node.props?.onSelectQuestionTopic);
  entry.props.onSelectQuestionTopic("interview-questions", "introduction");
  assert.equal(browser.location.searchParams.get("questionSet"),"interview-questions");
  assert.equal(browser.location.searchParams.has("chapter"),false);
  const collectionView=()=>walk(view()).find(node=>node.props?.collection?.collectionId==="interview-questions");
  collectionView().props.onSelectTopic("career");
  assert.equal(browser.location.searchParams.get("questionTopic"),"career");
  browser.location=new URL(history.pop());
  assert.equal(collectionView().props.topicId,"introduction");
  collectionView().props.onFilterChange({review:"pending"});
  collectionView().props.onFilterChange({sourceKind:"agency"});
  collectionView().props.onFilterChange({query:"具体 搜索"},true);
  collectionView().props.onFilterChange({page:2});
  assert.equal(browser.location.searchParams.get("questionReview"),"pending");
  assert.equal(browser.location.searchParams.get("questionKind"),"agency");
  assert.equal(browser.location.searchParams.get("questionSearch"),"具体 搜索");
  assert.equal(collectionView().props.page,2);
  collectionView().props.onFilterChange({query:"新词"},true);
  assert.equal(browser.location.searchParams.has("questionPage"),false);
  collectionView().props.onFilterChange({query:"all"},true);
  assert.equal(browser.location.searchParams.get("questionSearch"),"all");
  collectionView().props.onFilterChange({review:"excluded"});
  assert.equal(collectionView().props.topicId,"all");
  collectionView().props.onSelectTopic("introduction");
  assert.equal(collectionView().props.review,"accepted");
  collectionView().props.onBack();
  assert.equal(browser.location.searchParams.get("specialModule"),"questions");
  assert.equal(browser.location.searchParams.has("chapter"),false);
  assert.equal(browser.location.searchParams.has("questionSet"),false);
  for(const key of ["questionTopic","questionReview","questionKind","questionSearch","questionPage"]) assert.equal(browser.location.searchParams.has(key),false);
  assert.equal(browser.location.searchParams.get("ui"),"ja");
  assert.equal(browser.history.state.preserved,true);
});

const complete = () => {
  const value=structuredClone(collection);
  value.phase="complete"; value.publishedTopicIds=["introduction","career"];
  value.questions=value.questions.filter(item=>item.sourceId!=="test-background").map(item=>({...item,reviewStatus:"accepted",reviewReasonZh:"已核对连续问答。"}));
  return value;
};

test("全部主题和来源类别筛选保留各意图问法，搜索可跨主题且不发布空主题",async()=>{
  const value=complete();
  value.sources.push(source("test-platform",{kind:"platform"}));
  value.questions.push(question("platform-1","test-platform",{topicId:"career",intentId:"specific-career",originalText:"検索用の実績を教えてください。",questionText:undefined,reviewStatus:"accepted",reviewReasonZh:"已核对。"}));
  const all=await renderCollection(value,"all");
  assert.match(all,/全部已发布主题/);
  assert.match(all,/検索用の実績/);
  assert.equal(all.includes("尚未发布"),false);
  const platform=await renderCollection(value,"all",{sourceKind:"platform",query:"検索用"});
  assert.match(platform,/筛选结果：1 条已审核窗口内记录/);
  assert.match(platform,/已审核提问记录 · ASR · 平台/);
  assert.equal(platform.includes('id="question-a-1"'),false);
  const introduction=await renderCollection(value,"introduction",{query:"検索用"});
  assert.match(introduction,/当前筛选下没有匹配记录/);
});

test("回忆接受项、回忆待核项和排除片段分别可查，不进入默认题卡",async()=>{
  const value=complete();
  value.questions.push(question("memory-pending","test-memory",{originalText:"尚待确认的回忆题。",questionText:undefined,reviewStatus:"pending",reviewReasonZh:"未记录完整问句。"}));
  const accepted=await renderCollection(value,"all");
  for(const marker of ['id="question-memory-1"','id="question-memory-pending"',"本人向企业反问。"]) assert.equal(accepted.includes(marker),false);
  const memory=await renderCollection(value,"all",{review:"memory"});
  assert.match(memory,/回忆：对方请我介绍近况。/);
  assert.equal(memory.includes('id="question-memory-pending"'),false);
  const pending=await renderCollection(value,"all",{review:"pending"});
  assert.match(pending,/尚待确认的回忆题/);
  assert.match(pending,/待核候选 · 回忆内容，非原句/);
  const excluded=await renderCollection(value,"introduction",{review:"excluded"});
  assert.match(excluded,/本人向企业反问。/);
  assert.match(excluded,/未按语义主题归类/);
  assert.equal(excluded.includes('id="question-a-1"'),false);
});

test("连续追问展示前问文本及原场定位，不把技术ID交给读者",async()=>{
  const value=complete();
  value.questions[1].continuationOf="a-1";
  value.questions[1].originalText="その経験をもう少し教えてください。";
  delete value.questions[1].questionText;
  const html=await renderCollection(value);
  assert.match(html,/承接的前问/);
  assert.match(html,/自己紹介をお願いします。/);
  assert.match(html,/L10–12 · 查看原场/);
  assert.equal(html.includes("承接前问 a-1"),false);
});

test("长意图分页完整覆盖每个问法，跨页仍标出全组问法数",async()=>{
  const value=complete();
  value.questions=Array.from({length:43},(_,index)=>question(`long-${index}`,"test-a",{originalText:`第${index}の内容を説明してください。`,questionText:undefined,reviewStatus:"accepted",reviewReasonZh:"已核对。"}));
  const ids=[];
  for(const page of [1,2,3]) {
    const html=await renderCollection(value,"all",{page});
    assert.match(html,/43 条已审核窗口内记录 · 43 种实见说法 · 1 个意图组/);
    assert.match(html,/本组共 43 种问法/);
    const matches=[...html.matchAll(/id="question-(long-\d+)"/g)].map(match=>match[1]);
    assert.equal(matches.length,page===3?3:20);
    ids.push(...matches);
  }
  assert.equal(new Set(ids).size,43);
  const last=await renderCollection(value,"all",{page:999});
  assert.match(last,/当前显示第 41–43 种表述/);
});
