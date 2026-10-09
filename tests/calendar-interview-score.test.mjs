import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarInterviewScore } from '../lib/calendar-interview-score.ts';
import { resolveCalendarInterview } from '../lib/calendar-interview.ts';
import { noteInVaultScope } from '../lib/vault-scope.ts';

const note = (path, frontmatter, content='') => ({path,frontmatter,content,tags:[],stat:{mtime:0,ctime:0,size:0}});
const study = (id,date='2026-09-10',round='一次面接',time='10:00') => note(`20_求職/株式会社テスト/${id}_整理稿.md`,{type:'transcript-study',company:'株式会社テスト',date,round,time});
const event = s => ({id:s.path,note:s,kind:'event',date:s.frontmatter.date,time:s.frontmatter.time,company:s.frontmatter.company,label:s.frontmatter.round,phase:'past',caseId:'',prepPath:''});
const report = (s,score=60,extra={}) => note(`80_AI分析/${s.path.split('/').at(-1)}_v3.md`,{type:'ai-report',report_kind:'interview-reassessment',report_role:'session',source_path:s.path,company:s.frontmatter.company,date:s.frontmatter.date,round:s.frontmatter.round,generated_at:'2026-10-07T11:00:00Z',method_version:'2026-10-v3',evaluation_mode:'scored_evidence',assessment_scope:'full_available_text',overall_score:score,dimension_scores:{questionUnderstanding:75,coverage:50,directness:85,evidenceCredibility:85,riskControl:null},historical_score:99,...extra});
const read = (s,notes) => {const e=event(s);return calendarInterviewScore(e,resolveCalendarInterview(e,notes),notes);};

test('calendar reads the exact new report value, never recomputing or borrowing historical 99',()=>{
 const s=study('a'),r=report(s),old=report(s,99,{generated_at:'2026-10-06',evaluation_mode:'evidence'});old.path='80_AI分析/old.md';
 assert.deepEqual(read(s,[s,r,old]),{kind:'overall',scores:[60]});
 const newest=report(s,null,{generated_at:'2026-10-08',assessment_scope:'memory',dimension_scores:{},local_scores:['旧说明85分，不是数字正本']});
 assert.equal(read(s,[s,r,newest]),null);
 });
test('limited material exposes structured local values only and does not average distinct local scores',()=>{
 const s=study('b');
 assert.deepEqual(read(s,[s,report(s,95,{assessment_scope:'partial',dimension_scores:{},local_assessments:[{score:85,titleZh:'保存片段'}]})]),{kind:'local',scores:[85]});
 assert.deepEqual(read(s,[s,report(s,null,{assessment_scope:'partial',local_assessments:[{score:75},{score:85},{score:85},{score:101},{score:'99'}]})]),{kind:'local',scores:[75,85]});
 assert.equal(read(s,[s,report(s,null,{assessment_scope:'memory',dimension_scores:{},local_scores:['局部85分'],local_assessments:[]})]),null);
 });
test('same company dates, same-day rounds and same-day times keep their own source identities',()=>{
 const sources=[study('a','2026-09-10','一次面接','10:00'),study('b','2026-09-10','二次面接','11:00'),study('c','2026-09-10','一次面接','14:00'),study('d','2026-09-11','一次面接','10:00')];
 const scores=[60,85,80,75],notes=[...sources,...sources.map((s,i)=>report(s,scores[i]))];
 sources.forEach((s,i)=>assert.deepEqual(read(s,notes),{kind:'overall',scores:[scores[i]]}));
 // Unknown time and round cannot borrow any of three same-day sessions.
 const unknown={...event(sources[0]),note:note('unknown.md',{type:'todo'}),time:'',label:'面试'};
 assert.equal(calendarInterviewScore(unknown,resolveCalendarInterview(unknown,notes),notes),null);
 });
test('identity conflicts, tied reports, missing review destination and non-interviews expose no number',()=>{
 const s=study('c'),r=report(s);
 for(const wrong of [{date:'2026-09-11'},{round:'二次面接'}])assert.equal(read(s,[s,report(s,85,wrong)]),null);
 // 改动理由：报告已按 source_path 精确命中这场整理稿时，company 只是写法不同（文件夹别名），不再算身份冲突；
 // 真正指向别场的情况由 source_path 不同挡住（见 tests/calendar-display-fixes.test.mjs）。
 assert.deepEqual(read(s,[s,report(s,85,{company:'株式会社別テスト'})]),{kind:'overall',scores:[85]});
 const duplicate={...r,path:'80_AI分析/duplicate.md'};assert.equal(read(s,[s,r,duplicate]),null);
 const e=event(s),target=resolveCalendarInterview(e,[s,r]);
 assert.equal(calendarInterviewScore(e,{...target,path:null},[s,r]),null);
 assert.equal(calendarInterviewScore(e,{...target,view:'session'},[s,r]),null);
 assert.equal(calendarInterviewScore({...e,label:'説明会'},target,[s,r]),null);
 });
test('single-session regeneration is read only through an explicit source note; old numeric review is excluded',()=>{
 const s=study('d');const keys=['questionUnderstanding','coverage','directness','evidenceCredibility','riskControl'];
 const body={overallScore:75,evaluationMode:'scored_evidence',evaluation:{conclusionZh:'测试',coverageZh:'完整文本',limitsZh:'无原音',scoringEligible:true,eligibilityZh:'核心维度可评',materialScope:'full_available_text'},dimensions:Object.fromEntries(keys.map(k=>[k,{baseScore:75,score:75,level:'supported',basisZh:'q01所问回答已交付',positiveEvidenceBlockIds:['q01'],rationaleZh:'q01',evidenceBlockIds:['q01'],deductions:[]}])),blocks:[{blockId:'q01',questionTitle:'测试',evidenceSentenceIds:['s001']}],summaryZh:'测试',strengths:[],weaknesses:[],priorityBlockIds:[]};
 const q=note('20_求職/株式会社テスト/d_回答品質復盤.md',{type:'interview-answer-review',company:s.frontmatter.company,date:s.frontmatter.date,round:s.frontmatter.round,source_note:'[[d_整理稿]]',generated_at:'2026-10-07'},'<!-- interview-answer-review-data -->\n```json\n'+JSON.stringify(body)+'\n```');
 assert.deepEqual(read(s,[s,q]),{kind:'overall',scores:[75]});
 assert.equal(read(s,[s,{...q,frontmatter:{...q.frontmatter,source_note:'[[他场_整理稿]]'}}]),null);
 const historical={...body,evaluationMode:undefined,overallScore:99,dimensions:undefined};
 assert.equal(read(s,[s,{...q,content:'<!-- interview-answer-review-data -->\n'+JSON.stringify(historical)}]),null);
 });
test('calendar cold scope loads only session score reports, keeping unrelated AI notes out',()=>{
 const s=study('e'),r=report(s);assert.equal(noteInVaultScope(r,'actions'),true);
 assert.equal(noteInVaultScope(note('quality.md',{type:'interview-answer-review'}),'actions'),true);
 for(const fields of [{report_kind:'company-fit'},{report_role:'index'},{report_role:'method'},{report_role:'actions'}])assert.equal(noteInVaultScope({...r,frontmatter:{...r.frontmatter,...fields}},'actions'),false);
 });
