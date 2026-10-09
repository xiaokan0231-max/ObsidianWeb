import assert from 'node:assert/strict';
import test from 'node:test';
import { findInterviewQuestionCollections, groupInterviewQuestions, parseInterviewQuestionCollection,
  questionCollectionHref, questionMatchesSearch, questionReviewStatus } from '../lib/interview-question-collection.ts';
import { noteInVaultScope } from '../lib/vault-scope.ts';

const source = (id='test-2026-08-01', extra={}) => ({id,path:'20_求職/株式会社テスト/原稿.md',date:'2026-08-01',company:'株式会社テスト',
  kind:'employer',transcriptType:'asr',scope:'primary',sha256:'a'.repeat(64),lineCount:30,readCoverage:'full',limitations:['原音未核验。'],...extra});
const question = (id='test-q1', extra={}) => ({id,sourceId:'test-2026-08-01',topicId:'introduction',intentId:'intro-overview',intentZh:'简短概览',
  originalText:'簡単に自己紹介をお願いします。',meaningZh:'请简单介绍自己。',answerScopeZh:'介绍自己的经历概览。',detailsZh:['简短概览。'],structureZh:[],
  lineStart:10,lineEnd:10,questionKind:'request',confidence:'high',speakerBasisZh:'后续实际回答自我介绍。',annotations:[],...extra});
const collection = (extra={}) => ({schemaVersion:1,collectionId:'interview-questions',title:'面试官问题集',
  window:{start:'2026-07-04',end:'2026-10-04',timezone:'Asia/Tokyo'},phase:'phase-one',publishedTopicIds:['introduction'],
  sources:[source()],questions:[question()],excludedCandidates:[],auditNotes:['转写和回忆分开。'],...extra});
const note = value => ({path:'20_求職/_素材/问题集.md',frontmatter:{type:'material',material_kind:'interview-question-collection',collection_id:'interview-questions'},
  content:'<!-- interview-questions-json:start -->\n```json\n'+JSON.stringify(value)+'\n```\n<!-- interview-questions-json:end -->',tags:[],stat:{ctime:1,mtime:1,size:1}});

test('原文、可读整理和窗口边界验证；回忆不能冒充逐字原问',()=>{
  assert.ok(parseInterviewQuestionCollection(collection()));
  for(const bad of [collection({sources:[source(undefined,{transcriptType:'memory'})]}),
    collection({sources:[source(undefined,{date:'2026-07-01'})]}),collection({window:{start:'2026-09-31',end:'2026-10-04',timezone:'Asia/Tokyo'}}),
    collection({questions:[question(undefined,{questionText:'これまでの経歴を教えてください。'})]}),
    collection({questions:[question(undefined,{lineEnd:31})]}),collection({questions:[question(),question()]})]) {
    assert.equal(parseInterviewQuestionCollection(bad),null);
  }
  const memory=collection({sources:[source(undefined,{scope:'nonverbatim',transcriptType:'memory'})]});
  assert.ok(parseInterviewQuestionCollection(memory));
});

test('重复问法折叠时保留每条出处；范围不同或只有整理句相同仍分开',()=>{
  const first=question();
  const duplicate=question('test-q2',{sourceId:'another-2026-08-02'});
  const scoped=question('test-q3',{detailsZh:['同时说明当前求职状况。'],answerScopeZh:'职历与当前求职状况。'});
  const uncertain=question('test-q4',{originalText:'自己紹介方…',readableJa:first.originalText,uncertaintyZh:'转写截断。'});
  const groups=groupInterviewQuestions([first,duplicate,scoped,uncertain]);
  assert.equal(groups.length,1);
  assert.equal(groups[0].variants.length,3);
  assert.deepEqual(groups[0].variants[0].occurrences.map(item=>item.id),['test-q1','test-q2']);
});

test('坏资料和同ID冲突不静默换内容，training scope只加载指定问题集',()=>{
  const value=note(collection());
  assert.equal(findInterviewQuestionCollections([value]).length,1);
  assert.equal(findInterviewQuestionCollections([value,value]).length,0);
  assert.equal(findInterviewQuestionCollections([{...value,content:value.content.replace('"schemaVersion":1','"schemaVersion":99')}]).length,0);
  assert.equal(noteInVaultScope(value,'training'),true);
  assert.equal(noteInVaultScope({...value,frontmatter:{...value.frontmatter,material_kind:'other'}},'training'),false);
});

test('查询包含原句、中文限定和来源；入口清理旧阅读或作答参数',()=>{
  assert.equal(questionMatchesSearch(question(),'自己紹介 简短',source()),true);
  assert.equal(questionMatchesSearch(question(),'株式会社テスト 2026-08',source()),true);
  assert.equal(questionMatchesSearch(question(),'领导职责',source()),false);
  const href=questionCollectionHref('?chapter=old&course=legacy&knowledge=x&lessonView=source&note=source.md&ui=ja','interview-questions','introduction');
  const params=new URL(href,'http://localhost:3000').searchParams;
  assert.equal(params.get('questionSet'),'interview-questions');
  assert.equal(params.get('questionTopic'),'introduction');
  assert.equal(params.get('ui'),'ja');
  for(const key of ['chapter','course','knowledge','lessonView','note'])assert.equal(params.has(key),false);
});

test('正式发布要求逐条审核状态；兼容首阶段低置信默认待核',()=>{
  assert.equal(questionReviewStatus(question()),'accepted');
  assert.equal(questionReviewStatus(question(undefined,{confidence:'low'})),'pending');
  assert.equal(questionReviewStatus(question(undefined,{reviewStatus:'pending',confidence:'high'})),'pending');
  assert.equal(parseInterviewQuestionCollection(collection({phase:'complete'})),null);
  assert.ok(parseInterviewQuestionCollection(collection({phase:'complete',questions:[question(undefined,{reviewStatus:'accepted',reviewReasonZh:'独立读连续问答确认了请求。'})]})));
  assert.equal(parseInterviewQuestionCollection(collection({questions:[question(undefined,{reviewStatus:'accepted'})]})),null);
});
