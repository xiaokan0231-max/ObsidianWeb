import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAppModule } from "./helpers/render-tsx.mjs";

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

function note(path, { title, body = "", frontmatter = {}, tags = [], mtime = now } = {}) {
  return {
    path, tags, frontmatter: { type: "material", ...frontmatter },
    stat: { ctime: 0, mtime, size: body.length },
    content: `# ${title ?? path}\n\n${body}`,
  };
}

const notes = [
  note("20_求職/a.md", { title: "株式会社テスト 一次面接メモ", body: "面接で逆質問を三つ用意した。", tags: ["面试", "复盘"], mtime: now }),
  note("20_求職/b.md", { title: "長い資料", body: `${"前置き".repeat(20)}ここで逆質問の例を挙げる。${"後書き".repeat(30)}`, tags: ["面试"], mtime: now - 40 * DAY }),
  note("20_求職/c.md", { title: "无关笔记", body: "这里什么都没有。", tags: ["日语"], mtime: now - 400 * DAY }),
];

async function render(props, { search = "", locale = "zh-CN" } = {}) {
  const view = await loadAppModule("app/library-view.tsx", {
    stubs: { "./ui-locale": { useUiLocale: () => ({ locale, setLocale() {} }) } },
    globals: { window: { location: { search }, localStorage: { getItem: () => null } } },
  });
  return renderToStaticMarkup(createElement(view.default, {
    notes, filter: "all", query: "", onFilter() {}, onQuery() {}, onOpen() {}, ...props,
  }));
}

test("有关键词：默认按相关度排序，标题与片段高亮命中词，脚注显示命中处数", async () => {
  const html = await render({ query: "逆質問" });
  assert.match(html, /<option value="relevance" selected="">相关度<\/option>/);
  assert.doesNotMatch(html, /无关笔记/, "没命中的不出现");
  assert.match(html, /<mark class="note-hit">逆質問<\/mark>/);
  assert.match(html, /命中 1 处/);
  // 片段从命中处附近截取，而不是正文开头那串「前置き」。
  const long = html.slice(html.indexOf("長い資料"));
  assert.match(long, /…[^<]*<mark class="note-hit">逆質問<\/mark>/);
});

test("空查询：没有相关度选项，按最近更新并插入日期分组小标题，摘要是正文开头", async () => {
  const html = await render({});
  assert.doesNotMatch(html, /value="relevance"/);
  assert.match(html, /<option value="recent" selected="">最近更新<\/option>/);
  assert.match(html, /<h3 class="library-date-heading">今天<\/h3>/);
  assert.match(html, /<h3 class="library-date-heading">更早<\/h3>/);
  assert.ok(html.includes("面接で逆質問を三つ用意した。"));
  assert.doesNotMatch(html, /<mark/);
});

test("标签 facet 按出现次数列出，URL 里已选的标签参与筛选并显示为可移除的条件", async () => {
  const html = await render({}, { search: "?tags=%E5%A4%8D%E7%9B%98" });
  assert.match(html, /aria-pressed="true"[^>]*><span>#复盘<\/span><strong>1<\/strong>/);
  assert.match(html, /aria-label="移除标签筛选：复盘"/);
  assert.match(html, /<h2>1 篇资料<\/h2>/);
  assert.ok(html.indexOf("#面试") < html.indexOf("#日语"), "出现多的标签排在前面");
});

test("卡片 / 列表切换渲染两个按钮，服务端一律先出卡片", async () => {
  const html = await render({}, { locale: "ja" });
  assert.match(html, /role="group" aria-label="表示形式"/);
  assert.match(html, /aria-pressed="true"[^>]*>カード<\/button>/);
  assert.doesNotMatch(html, /note-grid--list/);
  assert.match(html, /<h3 class="library-date-heading">今日<\/h3>/);
});
