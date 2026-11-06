import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadAppModule } from './helpers/render-tsx.mjs';

async function renderWorkspace(identity = null, items = []) {
  const feedback = await loadAppModule('app/feedback-ui.tsx');
  const { default: FeedbackView } = await loadAppModule('app/feedback/feedback-view.tsx', { stubs: {
    '../feedback-ui': {
      ...feedback,
      FeedbackHelp() { throw new Error('帮助只能在老师主动打开时呈现'); },
      useFeedback: () => ({ session: { identity, configured: true }, error: '', refresh: async () => {}, refreshSession: async () => {} }),
      useFeedbackSummaries: () => ({ page: { items, total: items.length, nextCursor: items.length ? 'next-page' : null } }),
    },
  } });
  return renderToStaticMarkup(React.createElement(FeedbackView));
}

test('匿名老师入口保持紧凑，帮助不占正文，资料阅读入口与登录表单仍可发现', async () => {
  const html = await renderWorkspace();
  assert.match(html, /class="feedback-workspace" lang="ja"/);
  assert.match(html, /data-tour="help-entry"/);
  assert.match(html, /class="feedback-welcome-story"/);
  assert.match(html, /お名前（コメントに表示されます）/);
  assert.match(html, /共有されたアクセスコード/);
  assert.match(html, /href="\/consultation"/);
  assert.doesNotMatch(html, /feedback-help|feedback-practice|<ol/);
});

test('列表只需要服务端摘要，完整详情等到选择具体话题才出现', async () => {
  const identity = { id: 'teacher-test', name: 'テスト先生', role: 'teacher' };
  const html = await renderWorkspace(identity, [{ id: 'thread-test', context: { pagePath: '/consultation', title: '資料', quote: '原文抜粋' }, unread: true,
    preview: 'コメントの要約', lastAuthor: identity, messageCount: 8, state: 'open' }]);
  assert.match(html, /コメントの要約/);
  assert.match(html, /原文抜粋/);
  assert.match(html, /8 件/);
  assert.match(html, /さらに見る/);
  assert.doesNotMatch(html, /feedback-messages/);
});

test('进入交流后保留新话题、列表与详情的聚焦引导目标', async () => {
  const html = await renderWorkspace({ id: 'teacher-test', name: 'テスト先生', role: 'teacher' });
  for (const target of ['help-entry', 'new-question', 'discussion-list', 'discussion-detail']) {
    assert.ok(html.includes(`data-tour="${target}"`), target);
  }
  assert.match(html, /相談の一覧/);
  assert.match(html, /新しい相談を書く/);
  assert.doesNotMatch(html, /アクセスコードの管理|feedback-welcome/);
});
