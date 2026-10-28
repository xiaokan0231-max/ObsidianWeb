import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAppModule } from "./helpers/render-tsx.mjs";
import { feedbackRevision } from "../lib/feedback.ts";
import { consultationBlockText, consultationContextIsCurrent, consultationFeedbackContext, feedbackQuoteRange } from "../lib/feedback-annotations.ts";

const transcript = {
  id: "session-test", companyId: "company-test", company: "株式会社テスト", date: "2026-10-01", round: "一次面接",
  outcome: "進行中", outcomeKind: "waiting", hasRaw: true, hasReadable: true,
  blocks: [{ id: "q01", title: "仕事について", turns: [
    { id: "s01", speaker: "interviewer", text: "どのような経験がありますか。", uncertain: false },
    { id: "s02", speaker: "self", text: "開発を担当しました。開発を担当しました。", uncertain: false },
  ] }], raw: "質問の原文\n回答の原文", notice: "原音は未確認です。",
};
const teacher = { id: "teacher-test", name: "テスト先生", role: "teacher" };
function thread(context, id = "thread-test") {
  return { id, context, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", createdBy: teacher,
    state: "open", hidden: false, unread: true, messages: [{ id: "message-test", threadId: id, author: teacher, text: "もう少し具体的に教えてください。", createdAt: "2026-10-01T00:00:00.000Z" }] };
}
const turn = transcript.blocks[0].turns[1];

test("重复句子的批注按原始偏移定位，无偏移的歧义引用不猜位置", () => {
  const quote = "開発を担当しました。";
  const start = turn.text.lastIndexOf(quote);
  const context = consultationFeedbackContext(transcript, "readable", { blockId: "q01", turnId: "s02", text: turn.text, start, end: start + quote.length });
  assert.deepEqual(feedbackQuoteRange(turn.text, context), { start, end: turn.text.length });
  assert.equal(feedbackQuoteRange(turn.text, { ...context, quoteStart: undefined, quoteEnd: undefined }), null);
  assert.equal(feedbackQuoteRange(turn.text, { ...context, quoteEnd: start + 1 }), null);
  assert.equal(consultationContextIsCurrent(transcript, context), true);
});

test("修改原文、换场次或发言后不把旧评论高亮到新内容", () => {
  const context = consultationFeedbackContext(transcript, "readable", { blockId: "q01", turnId: "s01", text: transcript.blocks[0].turns[0].text });
  const updated = structuredClone(transcript);
  updated.blocks[0].turns[0].text = "最近の仕事について教えてください。";
  assert.equal(consultationContextIsCurrent(updated, context), false);
  assert.equal(consultationContextIsCurrent(transcript, { ...context, sessionId: "another-session" }), false);
  assert.equal(consultationContextIsCurrent(transcript, { ...context, turnId: "missing" }), false);
  assert.equal(context.quote, transcript.blocks[0].turns[0].text);
});

test("整段引用保留规范换行与版本，原文链接只使用投影的场次 ID", () => {
  const text = consultationBlockText(transcript.blocks[0]);
  const context = consultationFeedbackContext(transcript, "readable", { blockId: "q01", text });
  assert.equal(context.quote, "どのような経験がありますか。\n開発を担当しました。開発を担当しました。");
  assert.equal(context.revision, feedbackRevision(text));
  assert.equal(consultationContextIsCurrent(transcript, context), true);
  assert.equal(context.pagePath, "/consultation?session=session-test&view=readable");
  assert.doesNotMatch(context.pagePath, /20_求職|\.md|\/Users\//);
});

test("原始稿行引用和跨行选句能判断版本，空或无效目标不强行定位", () => {
  const context = consultationFeedbackContext(transcript, "raw", { blockId: "raw-line-1", text: "回答の原文" });
  assert.equal(consultationContextIsCurrent(transcript, context), true);
  assert.equal(consultationContextIsCurrent(transcript, { ...context, blockId: "raw-line-9" }), false);
  assert.equal(consultationContextIsCurrent(transcript, consultationFeedbackContext(transcript, "raw", { blockId: "raw", text: transcript.raw })), true);
});

test("未登录也能发现每段的评论按钮和首次引导，但不出现私密批注", async () => {
  const { ConsultationTranscriptReader, ConsultationLibrary } = await loadAppModule("app/consultation/consultation-view.tsx");
  const html = renderToStaticMarkup(React.createElement(ConsultationTranscriptReader, { initial: transcript }));
  assert.match(html, /この部分にコメント/);
  assert.match(html, /data-tour="paragraph-comment"/);
  assert.doesNotMatch(html, /consultation-comment-hint/);
  assert.match(html, /この面接にコメント/);
  assert.doesNotMatch(html, /consultation-comment-highlight|テスト先生|コメント 1件/);
  const catalog = { companies: [], sessions: [], updatedAt: "2026-10-01" };
  const library = renderToStaticMarkup(React.createElement(ConsultationLibrary, { initial: catalog }));
  assert.match(library, /使い方/);
  assert.match(library, /コメント・返信/);
  assert.match(library, /次の一歩へ。/);
  assert.match(library, /data-tour="help-entry"/);
  assert.match(library, /data-tour="feedback-entry"/);
  assert.match(library, /data-tour="materials"/);
  assert.doesNotMatch(library, /consultation-guide|consultation-feedback-help/);
  assert.doesNotMatch(library, /閲覧専用|必要なら Word で保存/);
});

test("登录后显示段落评论数量，并且仅高亮版本匹配的指定重复句", async () => {
  const quote = "開発を担当しました。";
  const context = consultationFeedbackContext(transcript, "readable", { blockId: "q01", turnId: "s02", text: turn.text, start: quote.length, end: turn.text.length });
  const feedback = await loadAppModule("app/feedback-ui.tsx");
  const { ConsultationTranscriptReader } = await loadAppModule("app/consultation/consultation-view.tsx", { stubs: {
    "../feedback-ui": { ...feedback, useFeedback: () => ({ threads: [thread(context), thread({ ...context, revision: "outdated" }, "stale-thread")] }) },
  } });
  const html = renderToStaticMarkup(React.createElement(ConsultationTranscriptReader, { initial: transcript }));
  assert.match(html, /コメント 2件/);
  assert.equal((html.match(/<mark /g) ?? []).length, 1);
  assert.match(html, /data-feedback-threads="thread-test"/);
  assert.match(html, /開発を担当しました。<\/span><mark[^>]*>開発を担当しました。<\/mark>/);
});

test("批注深链接随场次和视图往返，不因筛选变化遗失", async () => {
  const { parseConsultationLibraryRoute, consultationLibraryHref } = await loadAppModule("app/consultation/consultation-view.tsx");
  const route = parseConsultationLibraryRoute("?session=session-test&view=raw&feedbackThread=thread-test&tab=sessions");
  assert.equal(route.feedbackThread, "thread-test");
  assert.deepEqual(parseConsultationLibraryRoute(consultationLibraryHref(route).split("?")[1]), route);
});
