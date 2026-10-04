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

test("默认直接展示首章全文、具体目录及可选练习，不出现答题门槛", async () => {
  const html = await render([second, oldCourse, first]);
  assert.match(html, /面谈日语：语法、助词与自然表达/);
  assert.match(html, /这是第一章全部说明，无需作答就能阅读/);
  assert.match(html, /その点について、教えてください/);
  assert.match(html, /aria-label="学习章节目录"/);
  assert.match(html, /aria-current="page"[^]*?が与は/);
  assert.match(html, /课后练习（可选）／旧课程/);
  assert.match(html, /进入本章练习/);
  assert.match(html, /下一章/);
  assert.match(html, /<table/);
  assert.match(html, /原问答/);
  for (const forbidden of ["<textarea", "确认这次作答", "正在恢复本机训练草稿", "已掌握"]) assert.equal(html.includes(forbidden), false);
  const anchors = [...html.matchAll(/href="#(doc-h-\d+)"/g)].map((match) => match[1]);
  assert.equal(anchors.length, 2);
  for (const anchor of anchors) assert.ok(html.includes(`id="${anchor}"`));
});

test("chapter参数恢复第二章，旧course链接及无章节场景仍展示旧课", async () => {
  const html = await render([oldCourse, first, second], "?chapter=connections");
  assert.match(html, /这是第二章完整讲解/);
  assert.equal(html.includes("这是第一章全部说明"), false);
  assert.match(html, /上一章/);
  for (const [notes, query] of [[[oldCourse, first, second], "?chapter=connections&course=practice-a"], [[oldCourse], ""]]) {
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

test("有模块时首屏呈现重点和可切换知识点，完整长文放在关闭的详情中",async()=>{
  const source={...first,frontmatter:{...first.frontmatter,learning_module:learningModule}};
  const html=await render([source]);
  assert.match(html,/aria-label="本章重点概览"/);
  assert.match(html,/aria-label="知识点学习方式"/);
  assert.match(html,/role="tabpanel"/);
  assert.match(html,/为什么这样用/);
  assert.match(html,/class="textbook-full-lesson"><summary/);
  assert.equal(/class="textbook-full-lesson" open/.test(html),false);
  assert.equal(html.includes('aria-label="本章目录"'),false);
  for(const forbidden of ["<textarea","已掌握","确认这次作答"])assert.equal(html.includes(forbidden),false);
});

test("知识点与对比视图从URL恢复，成对含义卡不使用宽表或对错判决",async()=>{
  const source={...first,frontmatter:{...first.frontmatter,learning_module:learningModule}};
  const html=await render([source],"?knowledge=role&lessonView=contrast");
  assert.match(html,/当前知识点 2 \/ 2/);
  assert.match(html,/learning-contrast-pair/);
  assert.match(html,/承担职责/);
  assert.match(html,/说明话题/);
  assert.match(html,/两句含义不同/);
  assert.equal(html.split('class="textbook-full-lesson"')[0].includes("<table"),false);
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
  const html = await render([source, second]);
  for (const text of ["せっけいをたんとうする", "常用搭配", "運用を担当する", "最小口语"]) assert.ok(html.includes(text));
  assert.match(html, /href="\/training\/topics\?chapter=connections">另章<\/a>/);
  assert.match(html, /href="https:\/\/example.org\/grammar" target="_blank"/);
  const examples = await render([source], "?lessonView=examples");
  assert.match(examples, /最小口语/);
  assert.match(examples, /专业表达/);
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
    stubs: { "./use-textbook-position": { useTextbookPosition: () => [position, next => { position = next; }] } },
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
