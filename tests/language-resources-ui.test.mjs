import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAppModule } from "./helpers/render-tsx.mjs";

const note = (path, kind, title) => ({
  path, frontmatter: { type: "material", material_kind: kind },
  content: `# ${title}\n\n这段材料由 Vault 提供。`, tags: [], stat: { ctime: 1, mtime: 1, size: 1 },
});
const guide = note("20_求職/_素材/新学习说明.md", "language-scenario-guide", "从听辨到自由回应");
const coverage = note("20_求職/_素材/新出处说明.md", "language-scenario-coverage", "材料来源与阅读范围");
const unrelated = note("20_求職/_素材/其他.md", "interview-library", "无关材料不进入口");

async function render(notes, locale = "zh") {
  const component = await loadAppModule("app/language-expression-courses.tsx", {
    stubs: { "./ui-locale": { useUiLocale: () => ({ locale }) } },
  });
  return renderToStaticMarkup(createElement(component.default, {
    notes, onOpen() {}, onVaultChanged: async () => {},
  }));
}

test("课程为空时学习说明仍可打开，按指南、覆盖顺序展示笔记原题", async () => {
  const html = await render([coverage, unrelated, guide]);
  assert.match(html, /aria-label="学习顺序与覆盖说明"/);
  assert.match(html, /还没有可用的专项课程/);
  assert.ok(html.indexOf("从听辨到自由回应") < html.indexOf("材料来源与阅读范围"));
  assert.equal(html.includes("无关材料不进入口"), false);
  assert.equal(html.includes("这段材料由 Vault 提供"), false);
});

test("无说明时不出现空入口，日语菜单保留材料原题", async () => {
  assert.equal((await render([unrelated])).includes("expression-course-resources"), false);
  const html = await render([guide], "ja");
  assert.match(html, /学習順序と出典の説明/);
  assert.match(html, /从听辨到自由回应/);
});
