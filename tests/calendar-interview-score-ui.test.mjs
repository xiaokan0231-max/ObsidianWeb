import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadAppModule } from './helpers/render-tsx.mjs';
import { resolveCalendarInterview } from '../lib/calendar-interview.ts';

const note=(path,frontmatter)=>({path,frontmatter,content:'',tags:[],stat:{ctime:0,mtime:0,size:0}});
const make=(id,date,score,local=false)=>{
 const s=note(`20_求職/株式会社テスト/${id}_整理稿.md`,{type:'transcript-study',company:'株式会社テスト',date,round:'一次面接',time:'10:00'});
 const event={id,note:s,kind:'event',date,time:'10:00',endTime:'11:00',company:s.frontmatter.company,label:s.frontmatter.round,phase:'past',caseId:'',prepPath:''};
 const r=note(`80_AI分析/${id}.md`,{type:'ai-report',report_kind:'interview-reassessment',report_role:'session',source_path:s.path,company:s.frontmatter.company,date,round:s.frontmatter.round,generated_at:'2026-10-07',evaluation_mode:'scored_evidence',assessment_scope:local?'partial':'full_available_text',overall_score:local?null:score,dimension_scores:local?{}:{coverage:50,directness:85,questionUnderstanding:75},historical_score:99,local_assessments:local&&score!==null?[{score,titleZh:'保存片段'}]:[]});
 return {s,event,r};
};
const cases=[make('a','2026-09-10',60),make('b','2026-09-11',85,true),make('c','2026-09-12',null)];
const notes=cases.flatMap(x=>[x.s,x.r]),events=cases.map(x=>x.event),interviewTargets=new Map(events.map(e=>[e.id,resolveCalendarInterview(e,notes)]));
const props={notes,events,interviewTargets,today:'2026-09-13',onOpen(){},onInterview(){}};
const load=(search,locale='zh-CN',react)=>loadAppModule('app/calendar-view.tsx',{globals:{window:{location:{search}}},stubs:{'./ui-locale':{useUiLocale:()=>({locale})},...(react?{react}: {})}});
const badges=html=>[...html.matchAll(/<span class="calendar-interview-score"[^>]*>[^<]*<\/span>/g)].map(x=>x[0]);

test('month, week and agenda display full/local labels with accessible event actions and no old number',async()=>{
 for(const search of ['?month=2026-09','?calview=week&calweek=2026-09-07']){
  const c=await load(search);const html=renderToStaticMarkup(React.createElement(c.default,props));
  assert.ok(badges(html).some(x=>x.includes('data-kind="overall"')&&x.includes('60分')));
  assert.ok(badges(html).some(x=>x.includes('data-kind="local"')&&x.includes('局部85分')));
  assert.ok(badges(html).every(x=>!x.includes('99')&&!x.includes('null')));
  assert.match(html,/aria-label="2026-09-10[^\"]*60分 · 面试复盘/);
  assert.match(html,/aria-label="2026-09-11[^\"]*局部85分 · 面试复盘/);
  if (search.includes('month')) {
    const cards = [...html.matchAll(/<button[^>]*class="calendar-event [^>]*>[\s\S]*?<\/button>/g)].map(x=>x[0]);
    assert.ok(cards.some(card => /data-kind="overall"[^>]*data-compact="true"[^>]*title="60分"[^>]*>60<\/span>/.test(card)));
    assert.ok(cards.some(card => /data-kind="local"[^>]*data-compact="true"[^>]*title="局部85分"[^>]*>85<\/span>/.test(card)));
    assert.doesNotMatch(html, /<button[^>]*class="calendar-event [^>]*><span class="calendar-status-dot"/);
  }
  const unscored=[...html.matchAll(/<button[^>]*aria-label="2026-09-12[^\"]*"[^>]*>[\s\S]*?<\/button>/g)].map(x=>x[0]);
  assert.ok(unscored.length);assert.ok(unscored.every(x=>!x.includes('calendar-interview-score')));
  assert.doesNotMatch(html,/<button[^>]*>[\s\S]*?<button(?=[^>]*class="calendar-interview-score")/);
 }
});

test('Japanese interface translates point and partial labels while preserving source company names',async()=>{
 const c=await load('?month=2026-09','ja');const html=renderToStaticMarkup(React.createElement(c.default,props));
 assert.match(html,/60点/);assert.match(html,/部分85点/);assert.match(html,/60点 · 面接の振り返り/);assert.doesNotMatch(html,/60分|局部85分/);
});

test('the actual native scored event button dispatches the exact interview target; no extra button changes touch/keyboard behavior',async()=>{
 const opened=[];const fake={...React,useContext(){return null;},useSyncExternalStore(_subscribe,read){return read();},useState(initial){return [typeof initial==='function'?initial():initial,()=>{}];},useMemo(fn){return fn();},useRef(initial){return {current:initial};},useEffect(){},useLayoutEffect(){},useCallback(fn){return fn;},useEffectEvent(fn){return fn;}};
 const c=await load('?month=2026-09','zh-CN',fake);const component=c.default.type??c.default;
 const tree=component({...props,onInterview:e=>opened.push(e.id)});
 function walk(node){if(!React.isValidElement(node))return [];return [node,...React.Children.toArray(node.props.children).flatMap(walk)];}
 const buttons=walk(tree).filter(node=>node.type==='button'&&node.props.className?.startsWith('calendar-event '));
 assert.equal(buttons.length,3);
 const full=buttons.find(node=>node.props['aria-label'].includes('60分'));
 const local=buttons.find(node=>node.props['aria-label'].includes('局部85分'));
 assert.ok(full&&local);full.props.onClick();local.props.onClick();assert.deepEqual(opened,['a','b']);
 assert.equal(interviewTargets.get(opened[0]).path,cases[0].s.path);assert.equal(interviewTargets.get(opened[1]).path,cases[1].s.path);
 assert.ok(buttons.every(node=>walk(node).slice(1).every(child=>child.type!=='button'&&child.props?.role!=='button')));
});
