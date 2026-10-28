import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAppModule } from "./helpers/render-tsx.mjs";

const author = { id: "teacher-test", name: "<script>先生</script>", role: "teacher" };
const thread = {
  id: "thread-test", context: { pagePath: "/consultation?session=session-test&view=raw", title: "株式会社テスト", sessionId: "session-test", blockId: "raw-2", quote: "<img src=x onerror=alert(1)>" },
  createdAt: "2026-10-01T01:00:00Z", updatedAt: "2026-10-01T01:00:00Z", createdBy: author,
  state: "open", hidden: false, unread: true,
  messages: [{ id: "message-test", threadId: "thread-test", author, text: "<script>alert('test')</script>\nこの部分への質問です。", createdAt: "2026-10-01T01:00:00Z" }],
};

test("老师显示名、引用和留言始终作为文字显示，不能执行HTML", async () => {
  const { FeedbackThreadDetail } = await loadAppModule("app/feedback-ui.tsx");
  const html = renderToStaticMarkup(React.createElement(FeedbackThreadDetail, { thread, locale: "ja" }));
  assert.match(html, /&lt;script&gt;先生&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;script&gt;alert/);
  assert.doesNotMatch(html, /<script>|<img src=x/);
  assert.match(html, /先生方と本人に共有されます/);
});

test("从批注回原文保留所选场次和显示形式，并带话题与段落定位", async () => {
  const { feedbackSourceHref } = await loadAppModule("app/feedback-ui.tsx");
  assert.equal(feedbackSourceHref(thread), "/consultation?session=session-test&view=raw&feedbackThread=thread-test#transcript-block-raw-2");
  const general = { ...thread, context: { pagePath: "/feedback", title: "全体への相談" } };
  assert.equal(feedbackSourceHref(general), "/feedback");
});

test("新手说明直接展示段落按钮和练习保密提示，不要求先选中文字", async () => {
  const { FeedbackHelp } = await loadAppModule("app/feedback-ui.tsx");
  const html = renderToStaticMarkup(React.createElement(FeedbackHelp, { locale: "ja" }));
  assert.match(html, /原稿を開く/);
  assert.match(html, /この部分にコメント/);
  assert.match(html, /練習用です。相手には送信されません。/);
  assert.match(html, /コメント・返信/);
  assert.doesNotMatch(html, /スレッド|コンテキスト|アンカー|<iframe/);
});
