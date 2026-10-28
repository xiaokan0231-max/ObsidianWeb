import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadAppModule } from './helpers/render-tsx.mjs';

async function renderWorkspace(identity = null) {
  const feedback = await loadAppModule('app/feedback-ui.tsx');
  const { default: FeedbackView } = await loadAppModule('app/feedback/feedback-view.tsx', { stubs: {
    '../feedback-ui': {
      ...feedback,
      FeedbackHelp() { throw new Error('帮助只能在老师主动打开时呈现'); },
      useFeedback: () => ({ session: { identity, configured: true }, threads: [], loading: false, error: '', refresh: async () => {}, replaceThread() {} }),
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

test('进入交流后保留新话题、列表与详情的聚焦引导目标', async () => {
  const html = await renderWorkspace({ id: 'teacher-test', name: 'テスト先生', role: 'teacher' });
  for (const target of ['help-entry', 'new-question', 'discussion-list', 'discussion-detail']) {
    assert.ok(html.includes(`data-tour="${target}"`), target);
  }
  assert.match(html, /相談の一覧/);
  assert.match(html, /新しい相談を書く/);
  assert.doesNotMatch(html, /アクセスコードの管理|feedback-welcome/);
});
