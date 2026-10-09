import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAppModule } from "./helpers/render-tsx.mjs";

const chapter = (id, order, title, body) => ({
  path: `20_求職/_素材/${id}.md`, tags: [], stat: { ctime: 1, mtime: 1, size: 1 },
  frontmatter: { type: "material", material_kind: "language-textbook-chapter", chapter_id: id, chapter_order: order,
    chapter_group: order === 10 ? "基础表达" : "句子展开", title, chapter_summary: `${title}的知识点`, study_minutes: 18, exercise_course_id: "practice-a" },
  content: `# ${title}\n\n## 用法\n\n${body}\n\n## 例句\n\nその点について、教えてください。\n\n| 对照 | 作用 |\n| --- | --- |\n| は | 话题 |\n\n[[20_求職/株式会社テスト/原稿#q01|原问答]]`,
});
const first = chapter("particles", 10, "が与は：主语和话题", "这是第一章全部说明，无需作答就能阅读。");
const second = chapter("connections", 20, "から与ので：原因怎样连接", "这是第二章完整讲解。");
const lesson = {
  durationMinutes: 20, introZh: "旧课保留", evidence: [{ kind: "transcript", path: "20_求職/株式会社テスト/原稿.md", locator: "q01", excerpt: "質問です。" }],
  observationsZh: ["保留原问答。"], hypotheses: [{ kind: "asr-uncertain", confidence: "low", detailZh: "不诊断。" }], counterexamplesZh: ["存在清楚作答。"],
  steps: ["listen", "verify", "stance", "respond", "repair", "transfer", "reflect"].map((kind, index) => ({ id: `s-${index}`, kind, titleZh: `步骤${index}`, instructionZh: "先自行作答。", ...(kind === "listen" ? { promptJa: "質問です。" } : {}), expectedZh: ["任务"], hintsZh: [], examplesJa: [] })),
};
const oldCourse = { ...first, path: "20_求職/_素材/旧课.md", frontmatter: { type: "material", material_kind: "language-expression-course", schema_version: 2, course_id: "practice-a", title: "保留的旧练习", topic: "练习" }, content: `<!-- language-scenario-json:start -->\n\`\`\`json\n${JSON.stringify(lesson)}\n\`\`\`\n<!-- language-scenario-json:end -->` };

async function render(notes, search = "") {
  const component = await loadAppModule("app/language-expression-courses.tsx", {
    globals: { window: { location: { search }, localStorage: { getItem: () => null } } },
  });
  return renderToStaticMarkup(createElement(component.default, { notes, onOpen() {}, onOpenWiki() {}, onVaultChanged: async () => {} }));
}

test("明确打开教材章节后展示全文、具体目录及可选练习，不出现答题门槛", async () => {
  const html = await render([second, oldCourse, first], "?chapter=particles");
  assert.match(html, /面谈日语：语法、助词与自然表达/);
  assert.match(html, /这是第一章全部说明，无需作答就能阅读/);
  assert.match(html, /その点について、教えてください/);
  assert.match(html, /aria-label="学习章节目录"/);
  assert.match(html, /aria-current="page"[^]*?が与は/);
  assert.match(html, /查看可选练习/);
  assert.match(html, /进入本章练习/);
  assert.match(html, /下一章/);
  assert.match(html, /<table/);
  assert.match(html, /原问答/);
  for (const forbidden of ["<textarea", "确认这次作答", "正在恢复本机训练草稿", "已掌握"]) assert.equal(html.includes(forbidden), false);
  const anchors = [...html.matchAll(/href="#(doc-h-\d+)"/g)].map((match) => match[1]);
  assert.equal(anchors.length, 2);
  for (const anchor of anchors) assert.ok(html.includes(`id="${anchor}"`));
});

test("chapter参数恢复第二章，旧course链接在有无章节材料时均可恢复", async () => {
  const html = await render([oldCourse, first, second], "?chapter=connections");
  assert.match(html, /这是第二章完整讲解/);
  assert.equal(html.includes("这是第一章全部说明"), false);
  assert.match(html, /上一章/);
  for (const [notes, query] of [[[oldCourse, first, second], "?chapter=connections&course=practice-a"], [[oldCourse], "?course=practice-a"]]) {
    const legacy = await render(notes, query);
    assert.match(legacy, /保留的旧练习/);
    assert.match(legacy, /正在恢复本机训练草稿/);
    assert.equal(legacy.includes("这是第一章全部说明"), false);
    assert.equal(legacy.includes("这是第二章完整讲解"), false);
  }
});

const learningPoint = (id,title) => ({id,titleZh:title,patternJa:"設計を担当する",meaningZh:"负责设计",explanationZh:["先找动词，再确定连接。"],
  examples:[{ja:"設計を担当しました。",zh:"负责设计。"}],contrasts:[{leftJa:"設計を担当しました。",leftZh:"承担职责",rightJa:"設計について説明しました。",rightZh:"说明话题",explanationZh:"两句含义不同，不能互换。"}],cautionZh:"只说真实工作。"});
const learningModule={summaryZh:"用四种关系说明工作。",points:[learningPoint("object","を与动作对象"),learningPoint("role","として与身份")],recapZh:["先找动词。"]};

test("有模块时短摘要和所有知识点入口可见，完整长文默认收起",async()=>{
  const source={...first,frontmatter:{...first.frontmatter,learning_module:learningModule}};
  const html=await render([source], "?chapter=particles");
  assert.match(html,/aria-label="本章重点概览"/);
  assert.match(html,/aria-label="知识点学习方式"/);
  assert.match(html,/role="tabpanel"/);
  assert.match(html,/为什么这样用/);
  assert.match(html,/<nav class="learning-point-picker" aria-label="切换学习重点"/);
  const picker=html.match(/<nav class="learning-point-picker"[\s\S]*?<\/nav>/)[0];
  assert.equal((picker.match(/<button /g)||[]).length,2);
  assert.equal(picker.includes("<details"),false);
  assert.ok(html.indexOf("用四种关系说明工作。") < html.indexOf('class="learning-point-picker"'));
  assert.match(html,/<div class="learning-inline-example"><small>看一个例句/);
  assert.equal((html.match(/class="learning-inline-example"/g)||[]).length,1);
  assert.match(html,/<p lang="ja">設計を担当しました。<\/p>/);
  assert.match(html,/class="textbook-full-lesson"><summary/);
  assert.equal(/class="textbook-full-lesson" open/.test(html),false);
  assert.equal(html.includes('aria-label="本章目录"'),false);
  for(const forbidden of ["<textarea","已掌握","确认这次作答"])assert.equal(html.includes(forbidden),false);
});

test("知识点与对比视图从URL恢复，先辨别再展开完整含义，不使用宽表或对错判决",async()=>{
  const source={...first,frontmatter:{...first.frontmatter,learning_module:learningModule}};
  const html=await render([source],"?knowledge=role&lessonView=contrast");
  assert.match(html,/当前知识点 2 \/ 2/);
  assert.match(html,/learning-contrast-options/);
  assert.match(html,/说明话题/);
  assert.match(html,/設計を担当しました。/);
  assert.match(html,/設計について説明しました。/);
  assert.equal(html.includes("承担职责"),false);
  assert.equal(html.includes("两句含义不同"),false);
  assert.equal(html.includes('aria-label="易混对比翻页"'),false);
  assert.equal(html.split('class="textbook-full-lesson"')[0].includes("<table"),false);
  const ui=await interactiveModule(learningModule,"contrast");
  ui.setPosition({knowledge:"role",lessonView:"contrast"});
  ui.click(ui.step(),"直接看解释");
  for(const text of ["承担职责","说明话题","两句含义不同"]) assert.ok(ui.html().includes(text));
  assert.deepEqual(ui.position(),{knowledge:"role",lessonView:"contrast"});
});

test("原句视图同时保留改动性质与来源可信度，公开依据使用外部链接",async()=>{
  const data=structuredClone(learningModule);
  data.points[0].source={originalJa:"ニーズを聞いて",revisionJa:"ニーズを聞きました。",explanationZh:"只整理成完整句。",reliabilityZh:"仅转写，未核验原音。",natureZh:"原句可接受；未确认错误",refs:["[[20_求職/株式会社テスト/原稿|原始出处]]","https://example.org/grammar"]};
  const html=await render([{...first,frontmatter:{...first.frontmatter,learning_module:data}}],"?lessonView=source");
  for(const text of ["原稿中的表达","最小整理","来源可靠性","修改性质","原句可接受","未核验原音","原始出处"])assert.ok(html.includes(text));
  assert.match(html,/href="https:\/\/example.org\/grammar" target="_blank" rel="noreferrer"/);
  assert.equal(html.includes("你的错误"),false);
});

test("无来源旧 source 链接回讲解并隐藏重复入口，第二点可返回上一点", async () => {
  const source = {...first,frontmatter:{...first.frontmatter,learning_module:learningModule}};
  const html = await render([source], "?knowledge=role&lessonView=source");
  assert.match(html, /为什么这样用/);
  assert.match(html, /上一知识点：/);
  assert.equal(html.includes('id="learning-tab-source"'), false);
  assert.equal(html.includes("看一个例子"), false);
  assert.equal(html.includes("下一知识点："), false);
  const tab = html.match(/id="learning-tab-explain"[^>]+/)[0];
  assert.match(tab, /aria-selected="true"/);
});

test("读音、常用搭配和口语层次直接呈现；正文内部跨章与外链分开", async () => {
  const data = structuredClone(learningModule);
  Object.assign(data.points[0], { readingJa: "せっけいをたんとうする", collocationsJa: ["設計を担当する", "運用を担当する"] });
  data.points[0].examples[0].labelZh = "最小口语";
  data.points[0].examples.push({ja:"設計から運用まで担当しました。",zh:"负责设计到运维。",labelZh:"专业表达"});
  const source = {...first,content: first.content + "\n\n[另章](http://localhost:3000/training/topics?chapter=connections) [公开出处](https://example.org/grammar)",frontmatter:{...first.frontmatter,learning_module:data}};
  const html = await render([source, second], "?chapter=particles");
  for (const text of ["せっけいをたんとうする", "常用搭配", "運用を担当する", "教学例句起点"]) assert.ok(html.includes(text));
  assert.match(html, /href="\/training\/topics\?chapter=connections">另章<\/a>/);
  assert.match(html, /href="https:\/\/example.org\/grammar" target="_blank"/);
  const examples = await render([source], "?lessonView=examples");
  assert.match(examples, /最小口语/);
  assert.equal(examples.includes("专业表达"), false);
  assert.match(examples, /显示日语/);
});

test("面试官来源明确标为原场用语，不呈现为我的表达或本人错误", async () => {
  const data = structuredClone(learningModule);
  data.points[0].source = { speaker: "interviewer", originalJa: "設計について教えてください。", revisionJa: "設計の内容を教えてください。", explanationZh: "整理对方的问题。", reliabilityZh: "仅转写。", natureZh: "语义说明，不是纠错。", refs: ["https://example.org/grammar"] };
  const html = await render([{...first,frontmatter:{...first.frontmatter,learning_module:data}}], "?lessonView=source");
  for (const text of ["原场用语", "对方原场用语", "语义整理"]) assert.ok(html.includes(text));
  assert.equal(html.includes("我的表达"), false);
  assert.equal(html.includes("最小整理"), false);
});

test("上一及下一知识点按钮实际切换对象并回讲解页签", async () => {
  let position = { knowledge: "role", lessonView: "contrast" };
  const { default: LearningModule } = await loadAppModule("app/language-textbook-module.tsx", {
    stubs: { react: {useRef: () => ({current:null}),useEffect(){}}, "./ui-locale": {useUiLocale:()=>({locale:"zh-CN"})}, "./use-textbook-position": { useTextbookPosition: () => [position, next => { position = next; }] } },
  });
  const walk = value => !value || typeof value !== "object" ? [] : Array.isArray(value) ? value.flatMap(walk) : [value, ...walk(value.props?.children)];
  const view = () => LearningModule({chapterId:"particles",chapterIds:["particles"],module:learningModule,onOpenWiki(){}});
  const previous = walk(view()).find(node => node.type === "button" && JSON.stringify(node.props.children).includes("上一知识点"));
  previous.props.onClick();
  assert.deepEqual(position, { knowledge: "object", lessonView: "explain" });
  const next = walk(view()).find(node => node.type === "button" && JSON.stringify(node.props.children).includes("下一知识点"));
  next.props.onClick();
  assert.deepEqual(position, { knowledge: "role", lessonView: "explain" });
});

test("默认原场保留证据两轴，讲解步骤常驻判断性质并将完整来源收入关闭抽屉", async () => {
  const data=structuredClone(learningModule);
  data.points[0].explanationZh=["先说清谁负责哪个动作。","名词化的详细接续保留在这里。","另一个适用条件也仍可读。"];
  data.points[0].source={originalJa:"設計を担当して",revisionJa:"設計を担当しました。",explanationZh:"这里只整理句尾，不扩大职责。",reliabilityZh:"仅ASR，未核原音。",natureZh:"原句可接受；不认定本人说错。",refs:["[[20_求職/株式会社テスト/原稿|原场出处]]"]};
  const fresh=await render([{...first,frontmatter:{...first.frontmatter,learning_module:data}}], "?chapter=particles");
  assert.match(fresh,/第 1 \/ 4 步/);
  assert.match(fresh,/这里只整理句尾，不扩大职责/);
  const html=await render([{...first,frontmatter:{...first.frontmatter,learning_module:data}}],"?lessonView=explain");
  const beforeTabs=html.slice(html.indexOf('class="learning-point-brief"'),html.indexOf('role="tablist"'));
  assert.match(beforeTabs,/材料能确认什么/);
  assert.match(beforeTabs,/原句可接受；不认定本人说错。/);
  assert.ok(beforeTabs.includes("这里只整理句尾"));
  const preview=html.slice(html.indexOf('class="learning-source-drawer"'),html.indexOf('class="learning-explanation"'));
  for(const text of ["設計を担当して","設計を担当しました。","来源可靠性","仅ASR"]) assert.ok(preview.includes(text));
  assert.match(html,/<details class="learning-source-drawer"><summary>原场对照与判断依据/);
  assert.ok(html.indexOf('class="learning-source-drawer"') > html.indexOf('role="tabpanel"'));
  assert.match(preview,/class="learning-evidence"><summary/);
  assert.ok(html.indexOf("先说清谁负责哪个动作。") < html.indexOf('class="learning-extra-reasons"'));
  assert.match(html,/class="learning-extra-reasons"><summary/);
  assert.match(html,/名词化的详细接续保留在这里/);
  assert.match(html,/另一个适用条件也仍可读/);
  assert.match(html,/<div class="learning-inline-example"><small/);
  assert.match(html,/第 2 \/ 4 步/);
  for(const text of ["回看原场","抓住用法","辨别含义","开口练习"]) assert.ok(html.includes(text));
  assert.equal(html.includes("你的错误"),false);
});

test("四组对比首屏只有第一对选项与目标含义，解释默认隐藏", async () => {
  const data=structuredClone(learningModule);
  data.points[0].contrasts=Array.from({length:4},(_,index)=>({leftJa:`比較A${index}`,leftZh:`A含义${index}`,rightJa:`比較B${index}`,rightZh:`B含义${index}`,explanationZh:`区别说明${index}`}));
  const html=await render([{...first,frontmatter:{...first.frontmatter,learning_module:data}}],"?lessonView=contrast");
  assert.equal((html.match(/class="[^"]*learning-contrast-options[^"]*"/g)||[]).length,1);
  for(const text of ["第 1 / 4 对","比較A0","比較B0","A含义0","直接看解释"]) assert.ok(html.includes(text));
  for(const text of ["B含义0","区别说明0",'class="learning-contrast-explanation"']) assert.equal(html.includes(text),false);
  assert.equal(html.includes("比較A1"),false);
  assert.match(html,/aria-label="易混对比翻页"/);
  assert.match(html,/disabled="">← 上一对/);
});

async function interactiveModule(data, initialView) {
  let position={knowledge:"object",lessonView:initialView};
  let states=[]; let cursor=0; let mountedKey=null;
  const {default:LearningModule}=await loadAppModule("app/language-textbook-module.tsx",{
    stubs:{react:{useRef:()=>({current:null}),useEffect(){},useState(initial){const slot=cursor++;if(!(slot in states))states[slot]=initial;return[states[slot],value=>{states[slot]=value;}];}},"./ui-locale":{useUiLocale:()=>({locale:"zh-CN"})},"./use-textbook-position":{useTextbookPosition:()=>[position,next=>{position=next;}]}},
  });
  const walk=value=>!value||typeof value!=="object"?[]:Array.isArray(value)?value.flatMap(walk):[value,...walk(value.props?.children)];
  const root=()=>LearningModule({chapterId:"particles",chapterIds:["particles"],module:data,onOpenWiki(){}});
  const step=()=>{
    const element=walk(root()).find(node=>typeof node.type==="function" && ["ContrastStep","ExampleStep"].includes(node.type.name));
    if(element.key!==mountedKey){states=[];mountedKey=element.key;}
    cursor=0;
    return element.type(element.props);
  };
  const click=(tree,label)=>walk(tree).find(node=>node.type==="button" && JSON.stringify(node.props.children).includes(label)).props.onClick();
  return {root,step,click,html:()=>renderToStaticMarkup(step()),position:()=>position,setPosition:next=>{position=next;}};
}

test("逐对导航可完整读取四组对比，前后边界明确，换知识点重置临时索引", async () => {
  const data=structuredClone(learningModule);
  data.points[0].contrasts=Array.from({length:4},(_,index)=>({leftJa:`比較A${index}`,leftZh:`A含义${index}`,rightJa:`比較B${index}`,rightZh:`B含义${index}`,explanationZh:`区别说明${index}`}));
  const ui=await interactiveModule(data,"contrast");
  for(let index=0;index<4;index++){
    assert.equal(ui.html().includes(`区别说明${index}`),false);
    ui.click(ui.step(),"直接看解释");
    const html=ui.html();
    for(const text of [`比較A${index}`,`比較B${index}`,`A含义${index}`,`B含义${index}`,`区别说明${index}`]) assert.ok(html.includes(text));
    if(index<3)ui.click(ui.step(),"下一对");
  }
  assert.match(ui.html(),/disabled="">下一对/);
  ui.click(ui.step(),"上一对");
  assert.match(ui.html(),/第 3 \/ 4 对/);
  assert.equal(ui.html().includes("区别说明2"),false);
  ui.setPosition({knowledge:"role",lessonView:"contrast"});
  assert.match(ui.html(),/第 1 \/ 1 对/);
  assert.equal(ui.html().includes("比較A2"),false);
  assert.equal(ui.html().includes('aria-label="易混对比翻页"'),false);
});

test("例句可直接显示日语，切条后重新看中文，所有例句可读且不持久化显示状态", async () => {
  const data=structuredClone(learningModule);
  data.points[0].examples=[{ja:"例文一を説明します。",zh:"先说明第一句。",labelZh:"最小口语"},{ja:"例文二を比較します。",zh:"再比较第二句。",labelZh:"专业表达"}];
  const ui=await interactiveModule(data,"examples");
  assert.match(ui.html(),/先说明第一句/);
  assert.equal(ui.html().includes("例文一を説明します"),false);
  ui.click(ui.step(),"显示日语");
  assert.match(ui.html(),/例文一を説明します/);
  ui.click(ui.step(),"下一例句");
  assert.match(ui.html(),/专业表达/);
  assert.match(ui.html(),/再比较第二句/);
  assert.equal(ui.html().includes("例文二を比較します"),false);
  ui.click(ui.step(),"显示日语");
  assert.match(ui.html(),/例文二を比較します/);
  assert.match(ui.html(),/disabled="">下一例句/);
  ui.click(ui.step(),"上一例句");
  assert.equal(ui.html().includes("例文一を説明します"),false);
  assert.deepEqual(ui.position(),{knowledge:"object",lessonView:"examples"});
  for(const text of ["textarea","已掌握","评分","提交答案"]) assert.equal(ui.html().includes(text),false);
});

test("编号步骤可前后推进及直接跳转，仍保存原有 URL 视图名称", async () => {
  const data=structuredClone(learningModule);
  data.points[0].source={originalJa:"設計を担当して",revisionJa:"設計を担当しました。",explanationZh:"只整理句尾。",reliabilityZh:"仅ASR。",natureZh:"可接受表达。",refs:["https://example.org/grammar"]};
  const ui=await interactiveModule(data,"source");
  ui.click(ui.root(),"下一步"); assert.equal(ui.position().lessonView,"explain");
  ui.click(ui.root(),"下一步"); assert.equal(ui.position().lessonView,"contrast");
  ui.click(ui.root(),"上一步"); assert.equal(ui.position().lessonView,"explain");
  ui.click(ui.root(),"开口练习"); assert.equal(ui.position().lessonView,"examples");
  assert.match(renderToStaticMarkup(ui.root()),/aria-label="这一轮带走什么"/);
  ui.click(ui.root(),"再辨别一次"); assert.equal(ui.position().lessonView,"contrast");
});

test("各步骤常驻判断性质；原场对照、完整首句理由及可靠性可按需阅读",async()=>{
  const data=structuredClone(learningModule);
  data.points[0].source={originalJa:"設計を担当して",revisionJa:"設計を担当しました。",explanationZh:"把「設計を担当しました。」作为完整句展示，原片段并未确认有错。详细背景和适用边界保留在全文。",reliabilityZh:"仅ASR，尚未核验录音。",natureZh:"可接受表达的句尾整理，不是确认纠错。",refs:["https://example.org/grammar"]};
  const notes=[{...first,frontmatter:{...first.frontmatter,learning_module:data}}];
  for(const lessonView of ["source","explain","contrast","examples"]){
    const html=await render(notes,`?knowledge=object&lessonView=${lessonView}`);
    const beforeTabs=html.slice(html.indexOf('class="learning-point-brief"'),html.indexOf('role="tablist"'));
    assert.match(beforeTabs,/可接受表达的句尾整理，不是确认纠错/);
    assert.equal(beforeTabs.includes("详细背景"),false);
    assert.equal(beforeTabs.includes("learning-source-preview"),false);
    const preview=html.slice(html.indexOf('aria-label="原场表达与修改性质"'));
    const summary=beforeTabs.match(/<dl>([\s\S]*?)<\/dl>/)[1];
    assert.match(summary,/可接受表达的句尾整理，不是确认纠错/);
    assert.match(summary,/把「設計を担当しました。」作为完整句展示，原片段并未确认有错。/);
    assert.equal(summary.includes("详细背景"),false);
    assert.match(preview,/<details class="learning-evidence"><summary>来源可靠性与出处/);
    assert.match(preview,/仅ASR，尚未核验录音/);
    if(lessonView==="source"){
      assert.equal(html.includes("learning-source-drawer"),false);
    }else {
      assert.match(html,/<details class="learning-source-drawer"><summary>原场对照与判断依据<\/summary><section class="learning-source-preview"/);
      assert.ok(html.indexOf('class="learning-source-drawer"') > html.indexOf('role="tabpanel"'));
    }
    assert.equal(preview.includes("learning-source-revisit"),false);
    assert.match(html,/<details class="learning-source-reason"><summary>展开整理理由与使用边界/);
    assert.match(html,/详细背景和适用边界保留在全文/);
    assert.equal(/<details[^>]*\bopen(?:[=>\s])/.test(html),false);
  }
});

test("教学拓展在每个步骤先给重点与一句理由，不冒充本人错误",async()=>{
  const data=structuredClone(learningModule);
  data.summaryZh="先学一个关系。完整目标保留在展开区。";
  data.points[1].explanationZh=["作为角色与成为角色不同。详细接续仍保留。"];
  for(const lessonView of ["explain","contrast","examples"]){
    const html=await render([{...first,frontmatter:{...first.frontmatter,learning_module:data}}],`?knowledge=role&lessonView=${lessonView}`);
    const brief=html.slice(html.indexOf('class="learning-point-brief"'),html.indexOf('role="tablist"'));
    for(const text of ["教学拓展","本次重点","作为角色与成为角色不同。","不是本人原话"])assert.ok(brief.includes(text),text);
    assert.equal(brief.includes("详细接续"),false);
    assert.equal(brief.includes("你的错误"),false);
    assert.match(html,/<details class="learning-overview-more"><summary>展开本章学习目标/);
    assert.equal(/class="learning-overview-more"[^>]*\bopen(?:[=>\s])/.test(html),false);
  }
});

test("仅显式切知识点在新内容提交后滚动聚焦，恢复位置和切学习步骤不抢焦点",async()=>{
  let position={knowledge:"object",lessonView:"explain"};let refCursor=0;const refs=[];let effects=[];const calls=[];
  const target={scrollIntoView:args=>calls.push(["scroll",position.knowledge,args]),focus:args=>calls.push(["focus",position.knowledge,args])};
  const {default:LearningModule}=await loadAppModule("app/language-textbook-module.tsx",{stubs:{react:{useRef(initial){const slot=refCursor++;return refs[slot]??=( {current:initial} );},useEffect:fn=>effects.push(fn)},"./ui-locale":{useUiLocale:()=>({locale:"zh-CN"})},"./use-textbook-position":{useTextbookPosition:()=>[position,next=>{position=next;}]}}});
  const walk=value=>!value||typeof value!=="object"?[]:Array.isArray(value)?value.flatMap(walk):[value,...walk(value.props?.children)];
  const render=()=>{refCursor=0;effects=[];const tree=LearningModule({chapterId:"particles",chapterIds:["particles"],module:learningModule,onOpenWiki(){}});walk(tree).find(node=>node.props?.className==="learning-focus").props.ref.current=target;for(const effect of effects)effect();return tree;};
  const click=(tree,label)=>walk(tree).find(node=>node.type==="button"&&JSON.stringify(node.props.children).includes(label)).props.onClick();
  let tree=render();assert.deepEqual(calls,[]);
  click(tree,"下一知识点");assert.deepEqual(calls,[]);
  tree=render();assert.deepEqual(calls,[["scroll","role",{block:"start"}],["focus","role",{preventScroll:true}]]);
  calls.length=0;click(tree,"开口练习");tree=render();assert.deepEqual(calls,[]);
  position={knowledge:"object",lessonView:"contrast"};tree=render();assert.deepEqual(calls,[]);
  position={knowledge:"role",lessonView:"examples"};tree=render();assert.deepEqual(calls,[]);
  click(tree,"上一知识点");render();assert.equal(calls[0][1],"object");
});
