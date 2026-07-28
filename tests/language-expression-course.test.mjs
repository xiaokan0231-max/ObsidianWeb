import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  deriveLanguageExpressionProgress,
  languageExpressionProgressPath,
  parseLanguageExpressionCourse,
  parseLanguageExpressionProgress,
  renderLanguageExpressionProgressEvent,
} from "../lib/language-expression-course.ts";

function item(prefix, index) {
  return `${prefix}${String(index).padStart(2, "0")}`;
}

function courseContent() {
  const chunks = Array.from({ length: 28 }, (_, index) => {
    const id = item("c", index + 1);
    return `### ${id}｜語句${index + 1}
- 级别:: ${index < 16 ? "core" : "extended"}
- 日语:: 表現${index + 1}
- 读音:: ひょうげん${index + 1}
- 中文功能:: 中文${index + 1}
- 固定搭配:: 搭配A／搭配B
- 例句:: 短い例です。
- 近义表达:: 言い換えA／言い換えB
- 主题:: AI活用／組織
- 事实边界:: ${index === 0 ? "仅可作为观点表达" : "无"}
`;
  }).join("\n");
  const patterns = Array.from({ length: 18 }, (_, index) => {
    const id = item("s", index + 1);
    return `### ${id}｜句型${index + 1}
- 级别:: ${index < 12 ? "core" : "extended"}
- 功能:: 组织观点
- 句型:: 〜と考えています
- 槽位:: 〜替换成自己的判断
- 例句:: 一つの要因だと考えています。
- 例句:: 段階的に進める必要があると考えています。
- 主题:: 原因／对策
`;
  }).join("\n");
  return `# AI活用推進

${chunks}
${patterns}
### i01｜原因卡
- 类别:: cause
- 关键词:: 技能／责任
- 说明:: 随机抽取一个原因。
- 相关词块:: c01／c02

### i02｜对策卡
- 类别:: solution
- 关键词:: 培训／小规模试点
- 说明:: 随机抽取一个对策。
- 相关词块:: c03

### e01｜明確的に
- 原句:: 明確的に
- 修正:: 明確に
- 替换练习:: 用「明確にする」造一个短句。
- 证据:: [[面談_整理稿#q11|q11 / s001]]、[[面談_整理稿#q06|q06 / s002]]

### n01｜国籍标签
- 危险表达:: 日本人は保守的です
- 安全表达:: 新しい技術への慣れには個人差があります
- 原因:: 避免国籍标签和绝对化。
- 替换练习:: 把主语换成「社員の中には」。

### r01｜原因和对策
- 原因类别:: cause
- 对策类别:: solution
- 句型级别:: core／extended
- 提示:: 抽取一个原因、一个对策和一个句型，自由说二到四句。
`;
}

function note(content = courseContent()) {
  return {
    path: "20_求職/_素材/AI活用推進_語彙・定型表現・瞬発練習.md",
    frontmatter: {
      type: "material",
      material_kind: "language-expression-course",
      course_id: "ai-adoption",
      schema_version: 1,
      title: "AI活用推進：語彙・定型表現・瞬発練習",
      topic: "AI活用推進",
    },
    content,
  };
}

test("专项课程解析稳定 ID、词块、句型和关联", () => {
  const course = parseLanguageExpressionCourse(note());
  assert.ok(course);
  assert.equal(course.chunks.length, 28);
  assert.equal(course.chunks.filter((entry) => entry.level === "core").length, 16);
  assert.equal(course.patterns.length, 18);
  assert.deepEqual(course.ideaCards[0].relatedChunkIds, ["c01", "c02"]);
  assert.equal(course.corrections[0].correctedJa, "明確に");
  assert.deepEqual(course.corrections[0].evidenceRefs, [
    "[[面談_整理稿#q11|q11 / s001]]",
    "[[面談_整理稿#q06|q06 / s002]]",
  ]);
  assert.equal(course.safeRewrites[0].safeJa, "新しい技術への慣れには個人差があります");
  assert.deepEqual(course.recipes[0].patternLevels, ["core", "extended"]);
  assert.equal(
    languageExpressionProgressPath(course),
    "30_日本語学習/専門コースログ/AI活用推進_進捗.md",
  );
});

test("课程禁止保存标准答案和 20／60 秒背诵稿", () => {
  assert.throws(
    () => parseLanguageExpressionCourse(note(`${courseContent()}\n## 20秒版\n全文台本`)),
    /禁止保存标准回答或 20／60 秒背诵稿/u,
  );
  assert.throws(
    () => parseLanguageExpressionCourse(note(`${courseContent()}\n標準回答`)),
    /禁止保存标准回答或 20／60 秒背诵稿/u,
  );
});

test("课程拒绝不存在的词块关联", () => {
  assert.throws(
    () =>
      parseLanguageExpressionCourse(
        note(courseContent().replace("- 相关词块:: c01／c02", "- 相关词块:: c01／c99")),
      ),
    /i01 引用了不存在的词块：c99/u,
  );
});

test("进度 marker 可往返解析，普通练习取最后状态，即兴完成次数累计", () => {
  const events = [
    {
      eventId: "evt-1",
      courseId: "ai-adoption",
      itemId: "c01",
      exercise: "recall",
      action: "completed",
      at: "2026-07-28T01:00:00.000Z",
    },
    {
      eventId: "evt-2",
      courseId: "ai-adoption",
      itemId: "c01",
      exercise: "recall",
      action: "reopened",
      at: "2026-07-28T01:01:00.000Z",
    },
    {
      eventId: "evt-3",
      courseId: "ai-adoption",
      itemId: "n01",
      exercise: "rewrite",
      action: "completed",
      at: "2026-07-28T01:02:00.000Z",
    },
    {
      eventId: "evt-4",
      courseId: "ai-adoption",
      itemId: "r01",
      exercise: "improv",
      action: "completed",
      at: "2026-07-28T01:03:00.000Z",
    },
    {
      eventId: "evt-5",
      courseId: "ai-adoption",
      itemId: "r01",
      exercise: "improv",
      action: "completed",
      at: "2026-07-28T01:04:00.000Z",
    },
  ];
  const content = events.map(renderLanguageExpressionProgressEvent).join("");
  const parsed = parseLanguageExpressionProgress(content);
  assert.deepEqual(parsed, events);
  assert.deepEqual(deriveLanguageExpressionProgress([...parsed, parsed.at(-1)]), {
    completedKeys: ["rewrite:n01"],
    improvCount: 2,
    lastEventAt: "2026-07-28T01:04:00.000Z",
  });
});

test("进度 API 只接受业务 ID，路径和时间均由服务端决定", async () => {
  const source = await readFile(
    new URL("../app/api/language/topics/progress/route.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /body\.(?:path|notePath|at)\b/u);
  assert.match(source, /languageExpressionProgressPath\(course\)/u);
  assert.match(source, /at:\s*new Date\(\)\.toISOString\(\)/u);
  assert.match(source, /event\.eventId === eventId/u);
  assert.match(source, /let progressQueue = Promise\.resolve\(\)/u);
});
