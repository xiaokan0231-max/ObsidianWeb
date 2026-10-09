import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAppModule } from "./helpers/render-tsx.mjs";

const originalTitle = "原文の資料タイトル";
const originalBody = "这段资料正文保留原文，不因界面语言而改变。";
const note = {
  path: "20_求職/テスト/資料.md", frontmatter: { type: "material", title: originalTitle },
  content: `# ${originalTitle}\n\n${originalBody}`, tags: [], stat: { ctime: 1, mtime: 1, size: 1 },
};
const event = {
  id: "test-meeting", note, kind: "event", date: "2026-08-10", time: "10:00", endTime: "10:30",
  company: "株式会社テスト", label: "カジュアル面談（原文）", phase: "upcoming", caseId: "", prepPath: "",
};

async function renderView(path, props, search = "") {
  const component = await loadAppModule(path, {
    stubs: { "./ui-locale": { useUiLocale: () => ({ locale: "ja", setLocale() {} }) } },
    globals: { window: { location: { search }, localStorage: { getItem: () => null } } },
  });
  return renderToStaticMarkup(createElement(component.default, props));
}

test("日本語のカレンダーメニューでも原文の予定と JST の時刻を維持する", async () => {
  const html = await renderView("app/calendar-view.tsx", {
    today: "2026-08-10", events: [event], notes: [note],
    interviewTargets: new Map([[event.id, { view: "session", path: note.path }]]), onOpen() {}, onInterview() {},
  }, "?month=2026-08");
  assert.match(html, /aria-label="前の月"/);
  assert.match(html, /日本時間（JST）/);
  assert.match(html, /今後 7 日間/);
  assert.match(html, /予定を見る/);
  assert.match(html, /元の記録を見る/);
  assert.match(html, /カジュアル面談（原文）/);
  assert.match(html, /dateTime="2026-08-10T10:00\+09:00">10:00–10:30/);
});

test("日本語の資料庫は検索・用途・並び替えを翻訳し、タイトルと本文を保持する", async () => {
  const html = await renderView("app/library-view.tsx", {
    notes: [note], filter: "career", query: "", onFilter() {}, onQuery() {}, onOpen() {},
  });
  assert.match(html, /placeholder="タイトルと本文を検索…"/);
  assert.match(html, /応募案件・行動/);
  assert.match(html, /value="connections">関連の多い順/);
  assert.match(html, /条件をリセット/);
  assert.match(html, /就職活動/);
  assert.ok(html.includes(originalTitle));
  assert.ok(html.includes(originalBody));
});

test("日本語の関係図メニューも元のモード値とノードタイトルを維持する", async () => {
  const html = await renderView("app/graph-view.tsx", { notes: [note], filter: "all", onFilter() {}, onOpen() {} }, "?mode=all");
  assert.match(html, /aria-label="関係の範囲"/);
  assert.match(html, /aria-pressed="true"[^>]*>すべての関係/);
  assert.match(html, /探索モード · 3D/);
  assert.match(html, /関係マップ/);
  assert.match(html, /カテゴリで絞り込み/);
  assert.ok(html.includes(originalTitle));
});

test("日本語の時間線フィルタは正本の URL 値と原文の記録を維持する", async () => {
  const html = await renderView("app/timeline-view.tsx", {
    today: "2026-08-10", items: [{ note, date: "2026-08-10" }], events: [event], onOpen() {},
  }, "?month=all&kind=note");
  assert.match(html, /タイムラインの表示方法/);
  assert.match(html, /時系列リスト/);
  assert.match(html, /placeholder="記録・予定・本文を検索…"/);
  assert.match(html, /aria-label="カテゴリで絞り込み"/);
  assert.match(html, /value="career">就職活動/);
  assert.match(html, /aria-pressed="true"[^>]*>ノート/);
  assert.match(html, /ノートを読む/);
  assert.ok(html.includes(originalTitle));
  assert.ok(html.includes(originalBody));
});
