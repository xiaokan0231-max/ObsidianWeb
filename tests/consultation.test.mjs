import assert from "node:assert/strict";
import test from "node:test";
import { parseConsultation, projectConsultation, emptyDraft, validateDraft, privacyText, CONSULTATION_PATH, CONSULTATION_RECORD_PATH, parseConsultationHistory } from "../lib/consultation.ts";
import { consultationHash, createConsultationStore } from "../lib/server/consultation-store.ts";
import { loadAppModule } from "./helpers/render-tsx.mjs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

async function fixture() {
  const raw = "開始\n株式会社テストの担当テストです。test@example.com 090-1234-5678\n質問です。\n回答です。\n非公開住所\n追問です。\nおわり";
  const study = "## q01 経験\n- **s001｜面**\n    - 正:: 株式会社テストについて教えてください。\n    - 原:: テストについて\n    - 訳:: 请说明。\n- **s002｜私?**\n    - 正:: 担当テストと相談しました。\n    - 注:: mail@example.com\n- **s003｜面**\n    - 正:: 追加の質問です。";
  const annotations = "- **a001｜s002｜裁定｜answered｜2026-10-01**\n    - 対象:: speaker\n    - 我:: 自分の発言\n";
  const data = { schemaVersion:1,id:"sample",titleJa:"相談",introJa:"本人の背景",introZh:"背景",goalJa:"相談の目的",checkedAt:"2026-10-06",
    sources:[{id:"test-source",company:"株式会社テスト",aliases:["テスト社"],date:"2026-10-01",roleJa:"エンジニア",round:"一次",rawPath:"20_求職/株式会社テスト/raw.md",studyPath:"20_求職/株式会社テスト/study.md",annotationPath:"20_求職/株式会社テスト/annotations.md",
      rawHash:await consultationHash(raw),studyHash:await consultationHash(study),annotationHash:await consultationHash(annotations),bodyRange:[1,7],hiddenRanges:[[5,5]],privateTerms:["担当テスト"]}],
    cases:[{id:"experience",sourceId:"test-source",titleJa:"経験",titleZh:"经历",blocks:["q01"],rawRange:[2,6],reserve:false,cautionJa:"原音未確認",cautionZh:"未核原音",contextJa:"状況",contextZh:"背景",aiJa:"仮説",aiZh:"假设"}] };
  const content = `<!-- consultation:start -->\n\x60\x60\x60json\n${JSON.stringify(data)}\n\x60\x60\x60\n<!-- consultation:end -->`;
  const loaded = { "test-source": { raw, study, annotations, changed:false } };
  const notes = new Map([[CONSULTATION_PATH,content],[data.sources[0].rawPath,raw],[data.sources[0].studyPath,study],[data.sources[0].annotationPath,annotations]]);
  const writes = [];
  let corrupt = false;
  const io = {
    async readNote(path) { if (!notes.has(path)) throw new Error("Obsidian returned 404 private-path"); return {content:notes.get(path)}; },
    async readNoteOrNull(path) { return notes.has(path) ? {content:notes.get(path)} : null; },
    async writeNote(path, value) { writes.push(path); notes.set(path, corrupt ? value+"unexpected" : value); },
  };
  return { data, content, loaded, notes, writes, io, store:createConsultationStore(io), corrupt() {corrupt=true;} };
}
test("老师投影遮蔽正文、路径、注记与整行隐私，同时保留顺序、行号和话者裁定", async () => {
  const f=await fixture();
  const result=projectConsultation(parseConsultation(f.content),f.loaded);
  const serialized=JSON.stringify(result);
  for (const privateText of ["株式会社テスト","担当テスト","example.com","090-1234","非公開住所"]) assert.ok(!serialized.includes(privateText),privateText);
  assert.ok(serialized.includes("企業A"));
  assert.deepEqual(result.cases[0].blocks[0].sentences.map(s=>s.id),["s001","s002","s003"]);
  assert.equal(result.cases[0].blocks[0].sentences[1].speaker,"私");
  assert.equal(result.cases[0].blocks[0].sentences[1].uncertain,false);
  assert.equal(result.sources[0].rawLines[4].number,5);
  assert.match(result.sources[0].rawLines[4].text,/非表示/);
});
test("显示真企业名仍隐藏联系人、邮箱、电话和外部链接", async () => {
  const f=await fixture();
  const result=privacyText("株式会社テスト 担当テスト x@y.test 09012345678 https://test.invalid/private",f.data,true);
  assert.match(result,/株式会社テスト/);
  assert.doesNotMatch(result,/担当テスト|x@y|090|https:/);
});
test("引用不存在或路径穿越不能悄悄显示另一份资料", async () => {
  const f=await fixture();
  f.data.cases[0].blocks=["q99"];
  assert.throws(()=>projectConsultation(f.data,f.loaded),/ID/);
  f.data.sources[0].rawPath="20_求職/../secret.md";
  assert.throws(()=>parseConsultation(f.content.replace('20_求職/株式会社テスト/raw.md','20_求職/../secret.md')),/出典/);
});
test("草稿必须包含本次每段，超长字段与注入字段拒绝",async()=>{
  const f=await fixture(); const draft=emptyDraft(f.data.cases);
  assert.deepEqual(validateDraft(draft,["experience"]),draft);
  assert.throws(()=>validateDraft({...draft,memos:{}},["experience"]));
  draft.memos.experience.received="x".repeat(4001);
  assert.throws(()=>validateDraft(draft,["experience"]));
  assert.throws(()=>validateDraft({...emptyDraft(f.data.cases),status:"内定"},["experience"]));
});
test("保存回读、重载、去重和历史追记，只写咨询记录", async()=>{
  const f=await fixture(); const first=await f.store.get();
  const draft=structuredClone(first.draft); draft.memos.experience.received="先生には具体例が伝わった（本人の要約）";
  const saved=await f.store.save({draft,revision:first.revision,materialRevision:first.materialRevision});
  const reopened=await f.store.get();
  assert.deepEqual(reopened.draft,draft); assert.equal(reopened.revision,saved.revision); assert.equal(saved.historyCount,1);
  await f.store.save({draft,revision:saved.revision,materialRevision:first.materialRevision});
  assert.equal(f.writes.length,1);
  draft.summary.action="次回、同じ説明を試す";
  await f.store.save({draft,revision:saved.revision,materialRevision:first.materialRevision});
  const history=parseConsultationHistory(f.notes.get(CONSULTATION_RECORD_PATH));
  assert.equal(history.entries.length,2); assert.equal(history.entries[0].draft.summary.action,"");
  assert.deepEqual(new Set(f.writes),new Set([CONSULTATION_RECORD_PATH]));
});
test("两个画面竞争保存时拒绝旧版本，不覆盖先保存的反馈",async()=>{
  const f=await fixture(); const state=await f.store.get();
  const a=structuredClone(state.draft),b=structuredClone(state.draft);a.summary.keep="A";b.summary.keep="B";
  const results=await Promise.allSettled([a,b].map(draft=>f.store.save({draft,revision:state.revision,materialRevision:state.materialRevision})));
  assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
  assert.equal(results.find(r=>r.status==="rejected").reason.status,409);
  assert.equal(f.writes.length,1);
});
test("已保存反馈同样执行匿名投影，私有历史保留原记录",async()=>{
  const f=await fixture(); const current=await f.store.get();
  current.draft.memos.experience.received="株式会社テスト 担当テスト test@example.com";
  await f.store.save({draft:current.draft,revision:current.revision,materialRevision:current.materialRevision});
  const reopened=await f.store.get();
  assert.doesNotMatch(reopened.draft.memos.experience.received,/株式会社テスト|担当テスト|example.com/);
  assert.match(f.notes.get(CONSULTATION_RECORD_PATH),/株式会社テスト/);
});
test("任何源稿或批注变更都在返回全文前停止，旧遮蔽行号不会误用",async()=>{
  const f=await fixture();f.notes.set(f.data.sources[0].rawPath,"新增含个人信息的一行\n"+f.loaded["test-source"].raw);
  await assert.rejects(()=>f.store.get(),e=>e.status===409);
  assert.equal(f.writes.length,0);
});
test("保存后内容不一致不报已保存",async()=>{
  const f=await fixture();const state=await f.store.get();f.corrupt();
  await assert.rejects(()=>f.store.save({draft:state.draft,revision:state.revision,materialRevision:state.materialRevision}),e=>e.status===502);
});
test("损坏的已有记录不被当作空白覆盖",async()=>{
  const f=await fixture();f.notes.set(CONSULTATION_RECORD_PATH,"人工内容，格式有待核对");
  await assert.rejects(()=>f.store.get());assert.equal(f.writes.length,0);
});
test("咨询接口拒绝非本机/跨站访问；连接错误不泄露原路径",async()=>{
  const f=await fixture();const routes=await loadAppModule("app/api/consultation/route.ts",{stubs:{"@/lib/server/obsidian":f.io}});
  const response=await routes.GET(new Request("http://localhost:3000/api/consultation"));assert.equal(response.status,200);
  assert.equal((await routes.GET(new Request("https://example.com/api/consultation"))).status,404);
  assert.equal((await routes.GET(new Request("http://localhost:3000/api/consultation",{headers:{"sec-fetch-site":"cross-site"}}))).status,404);
  f.notes.delete(CONSULTATION_PATH);
  const failed=await routes.GET(new Request("http://localhost:3000/api/consultation"));assert.equal(failed.status,503);assert.doesNotMatch(await failed.text(),/private-path|20_求職/);
});
test("首屏日文、无评分，导航和本机保存说明可见",async()=>{
  const f=await fixture();const {ConsultationSession}=await loadAppModule("app/consultation/consultation-view.tsx");
  const markup=renderToStaticMarkup(React.createElement(ConsultationSession,{initial:await f.store.get()}));
  assert.match(markup,/lang="ja"/);assert.match(markup,/先生の受け取り方/);assert.match(markup,/企業名を表示/);assert.match(markup,/メモを保存/);assert.match(markup,/送信・公開なし/);
  assert.doesNotMatch(markup,/overallScore|レーダー|株式会社テスト|非公開住所/);
});
