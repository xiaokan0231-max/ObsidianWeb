import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTrainingCopy, trainingDate, trainingDateTime, trainingDimensionCopy, trainingTopicCopy } from "../lib/special-training-i18n.ts";
import { QUESTION_TOPICS } from "../lib/interview-question-collection.ts";
import { LANGUAGE_DIMENSIONS } from "../lib/interview-language.ts";
import { loadAppModule } from "./helpers/render-tsx.mjs";

const dictionary = { count: ["{count} 条", "{count} 件"], missing: ["中文回退", ""], name: ["{name}：{count}", "{name}：{count}"] };

test("沿用中日locale规则，插值按locale格式化，不漏消息key或未替换参数", () => {
  for (const locale of ["zh-CN", "ja"]) {
    const copy = createTrainingCopy(dictionary, locale);
    for (const count of [0, 1, 2, 1234]) assert.equal(copy.t("count", { count }), `${new Intl.NumberFormat(locale).format(count)} ${locale === "ja" ? "件" : "条"}`);
    assert.equal(copy.t("count"), `— ${locale === "ja" ? "件" : "条"}`);
    assert.equal(copy.t("name", { name: "原文", count: 1200 }), "原文：1,200");
    assert.equal(copy.number(NaN), "—");
    assert.equal(copy.label("原始资料标题"), "原始资料标题");
    assert.equal(copy.t("not-a-visible-key"), locale === "ja" ? "表示できません" : "暂无法显示");
  }
  assert.equal(createTrainingCopy(dictionary, "ja").t("missing"), "中文回退");
  assert.equal(createTrainingCopy(dictionary, "en").t("count", { count: 1 }), "1 条");
});

test("日期校验和JST显示独立于机器时区，纯日期不会捏造时刻", () => {
  for (const locale of ["zh-CN", "ja"]) {
    assert.equal(trainingDate("2026-10-04", locale), new Intl.DateTimeFormat(locale, {year:"numeric",month:"long",day:"numeric",timeZone:"Asia/Tokyo"}).format(new Date("2026-10-04T00:00:00+09:00")));
    assert.equal(trainingDateTime("2026-10-04", locale), trainingDate("2026-10-04", locale));
    assert.equal(trainingDateTime("2026-10-04T15:30:00Z", locale), trainingDateTime("2026-10-05T00:30:00+09:00", locale));
    assert.equal(trainingDateTime("2026-10-05T00:30:00", locale), trainingDateTime("2026-10-05T00:30:00+09:00", locale));
    assert.ok(trainingDateTime("2026-10-04T15:30:00Z", locale).includes("00:30"));
    for (const value of ["2026-02-30", "2026-13-01", "not-a-date", ""]) assert.equal(trainingDate(value, locale), value);
    assert.equal(trainingDateTime("2026-02-30T12:00:00Z", locale), "2026-02-30T12:00:00Z");
  }
});

test("全部主题和语言维度有完整双语显示且不修改正本ID与中文元数据", () => {
  for (const topic of QUESTION_TOPICS) {
    assert.deepEqual(trainingTopicCopy(topic, "zh-CN"), {title:topic.titleZh,summary:topic.summaryZh});
    const ja = trainingTopicCopy(topic, "ja"); assert.ok(ja.title && ja.summary); assert.notEqual(ja.summary, topic.summaryZh);
  }
  for (const dimension of LANGUAGE_DIMENSIONS) {
    assert.deepEqual(trainingDimensionCopy(dimension, "zh-CN"), {title:dimension.titleZh,summary:dimension.summaryZh});
    const ja=trainingDimensionCopy(dimension,"ja"); assert.ok(ja.title && ja.summary);
  }
});

test("专项及关联页面资源无缺翻译或参数集合漂移", async () => {
  for (const [path, name] of [["app/special-training-copy.ts","SPECIAL_TRAINING_COPY"],["app/interview-study-copy.ts","INTERVIEW_STUDY_COPY"],["app/language-textbook-copy.ts","TEXTBOOK_COPY"],["app/language-scenario-copy.ts","SCENARIO_COPY"],["app/language-expression-copy.ts","EXPRESSION_WORKBENCH_COPY"]]) {
    const resource = await loadAppModule(path);
    const table = resource[name]; assert.ok(table, name);
    for (const [key, pair] of Object.entries(table)) {
      assert.equal(pair.length,2,`${name}:${key}`); assert.ok(pair[0].trim() && pair[1].trim(),`${name}:${key}`);
      const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match=>match[1]).sort();
      assert.deepEqual(placeholders(pair[0]),placeholders(pair[1]),`${name}:${key}`);
    }
  }
});

const material = { chapterId:"test-chapter",order:1,group:"原始教材分组",title:"保留的中文教材标题",summary:"保留的中文教学摘要",studyMinutes:10,exerciseCourseId:"",module:{summaryZh:"中文讲解",points:[{id:"test-point",titleZh:"中文知识点标题"}]},note:{content:"原始正文"} };
const question = {id:"test-question",sourceId:"test-source",topicId:"introduction",confidence:"high",reviewStatus:"accepted"};
const collection = {collectionId:"test-questions",title:"保留的问题集原标题",window:{start:"2026-07-03",end:"2026-10-04"},publishedTopicIds:["introduction"],sources:[{id:"test-source",scope:"primary",transcriptType:"asr"}],questions:Array.from({length:1234},(_,i)=>({...question,id:`question-${i}`}))};
const languagePoint={id:"test-language",dimension:"honorific",titleZh:"保留的中文用法标题",meaningZh:"保留的中文教学含义",occurrences:[{questionId:question.id}]};
const props = {chapters:[material],courses:[],questionCollections:[{collection}],languageIndexes:new Map([[collection.collectionId,{points:[languagePoint]}]]),search:"?ui=ja",onNavigate(){},onSelectChapter(){},onSelectCourse(){},onSelectQuestionTopic(){},onSelectLanguagePoint(){}};
async function render(name, locale, extra = {}) {
  const components = await loadAppModule("app/special-training-dashboard.tsx", {stubs:{"./ui-locale":{useUiLocale:()=>({locale})}}});
  return renderToStaticMarkup(createElement(components[name], {...props,...extra}));
}

test("日文总览三模块、数量与可访问名称完整切换，正本材料不预挂", async () => {
  const ja = await render("SpecialTrainingDashboard","ja");
  for (const text of ["テーマ別トレーニング","実際の質問を読む","面談で使う日本語を学ぶ","場面別・表現練習","1,234 件"]) assert.ok(ja.includes(text),text);
  for (const text of ["专项训练","进入练习","个知识点","保留的中文教材标题","<textarea"]) assert.equal(ja.includes(text),false,text);
  const zh=await render("SpecialTrainingDashboard","zh-CN"); assert.ok(zh.includes("专项训练")); assert.ok(zh.includes("1,234 条已审核 ASR 记录"));
  const hrefs=html=>[...html.matchAll(/href="([^"]+)"/g)].map(match=>match[1]); assert.deepEqual(hrefs(ja),hrefs(zh));
});

test("模块目录UI使用日文，教学标题/解释仍为中文并标明语言", async () => {
  const textbook = await render("SpecialTrainingModule","ja",{module:"textbook"});
  assert.ok(textbook.includes('lang="zh-CN"')); assert.ok(textbook.includes(material.title)); assert.ok(textbook.includes(material.summary)); assert.ok(textbook.includes("学習項目 1 件")); assert.ok(textbook.includes("解説は中国語"));
  const languages = await render("SpecialTrainingModule","ja",{module:"questions",search:"?specialModule=questions&questionCatalog=language&languageCategory=all"});
  for(const text of ["質問の意図から","言葉の使い方から","すべて","敬語","文法","語彙","この用法を学ぶ",languagePoint.titleZh,languagePoint.meaningZh])assert.ok(languages.includes(text),text);
  assert.match(languages, /<h3 lang="zh-CN">保留的中文用法标题/);
  assert.match(languages, /<time dateTime="2026-07-03">2026年7月3日/);
  assert.equal(languages.includes("学习这个用法"),false);
  const intents=await render("SpecialTrainingModule","ja",{module:"questions"}); assert.ok(intents.includes("自己紹介")); assert.equal(intents.includes("自我介绍"),false);
});

test("日文空态和面包屑不漏中文菜单，深链接在两种locale下相同", async () => {
  for (const moduleId of ["questions","textbook","practice"]) {
    const html=await render("SpecialTrainingModule","ja",{module:moduleId,chapters:[],courses:[],questionCollections:[]});
    assert.equal(html.includes("尚未载入"),false); assert.ok(html.includes("まだ読み込まれていません"));
  }
  const crumb={module:"questions",title:"中文知识点标题",titleLang:"zh-CN",moduleHref:"/training/topics?specialModule=questions&questionCatalog=language&languageCategory=all&ui=ja"};
  const ja=await render("SpecialTrainingBreadcrumbs","ja",crumb); const zh=await render("SpecialTrainingBreadcrumbs","zh-CN",crumb);
  assert.ok(ja.includes("テーマ別トレーニングの概要")); assert.match(ja, /lang="zh-CN">中文知识点标题/);
  const hrefs=html=>[...html.matchAll(/href="([^"]+)"/g)].map(match=>match[1]); assert.deepEqual(hrefs(ja),hrefs(zh));
});

test("日文加载和失效深链提示完整切换，渲染不修改URL或缓存", async () => {
  for (const [search, loading, expected] of [
    ["",true,"テーマ別トレーニングの資料を読み込んでいます"],
    ["?chapter=missing",false,"この章は未読込"],
    ["?chapter=missing",true,"学習する章を読み込んでいます"],
    ["?course=missing",false,"このコースは未読込"],
    ["?course=missing",true,"練習コースを読み込んでいます"],
    ["?questionSet=missing",false,"この質問集は未読込"],
    ["?questionSet=missing",true,"質問集の資料を読み込んでいます"],
  ]) {
    const browser={location:new URL(`http://localhost:3000/training/topics${search}`),localStorage:{getItem:()=>null,setItem(){throw new Error("翻译不能写缓存");}},history:{pushState(){throw new Error("翻译不能导航");},replaceState(){throw new Error("翻译不能导航");}}};
    const before=browser.location.href;
    const {default:Page}=await loadAppModule("app/language-expression-courses.tsx",{globals:{window:browser},stubs:{"./ui-locale":{useUiLocale:()=>({locale:"ja"})}}});
    const html=renderToStaticMarkup(createElement(Page,{notes:[],loading,onOpen(){},onOpenWiki(){},onVaultChanged:async()=>{throw new Error("翻译不能更新数据");}}));
    assert.ok(html.includes(expected),expected);assert.equal(browser.location.href,before);
    for(const text of ["正在读取","返回章节目录","返回练习目录","返回研读目录","专项总览"])assert.equal(html.includes(text),false,text);
    if(loading)assert.ok(html.includes('role="status"'));
  }
});
