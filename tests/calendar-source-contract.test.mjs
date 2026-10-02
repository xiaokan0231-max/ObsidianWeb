import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCalendarEvents } from '../lib/memory-atlas-data.ts';
import { calendarRoundBadge, interviewRound } from '../lib/interview-round.ts';
import { noteInVaultScope } from '../lib/vault-scope.ts';

const now = new Date('2026-09-29T12:00:00+09:00');
const note = (path, type, fields = {}, body = '') => ({
  path, frontmatter: { type, company: '株式会社テスト', ...fields }, content: body,
  tags: [], stat: { ctime: 0, mtime: 0, size: 0 },
});
const project = (notes) => buildCalendarEvents(notes, now).map(({ date, time, label, caseId, prepPath }) =>
  ({ date, time, label, caseId, prepPath }));

test('返信・確约通知・职位说明的日期不能制造第二场终面', () => {
  const owner = note('案件.md', 'job-case', {
    case_id: 'test-case', next_event_at: '2026-08-13 13:30', next_event_label: '最終面接',
    next_action: '2026-08-07 13:26 最終面接への返信済み',
  }, [
    '# 2026-08-07 最終面接の日程確定',
    'スレッド最終発言は 2026-08-07 13:26 の本人返信のまま＝面接後の新規連絡なし。',
    '2026-08-08 確認：二次面接の形式は媒体で違う。',
  ].join('\n'));
  const events = buildCalendarEvents([owner], now);
  assert.deepEqual(events.map(({ date, time, label }) => ({ date, time, label })), [
    { date: '2026-08-13', time: '13:30', label: '最终面试' },
  ]);
  const todo = note('面談返信.md', 'todo', { next_action: '2026-08-07 13:26 面談への返信済み' });
  assert.deepEqual(buildCalendarEvents([todo], now), []);
});

test('review邮件审阅与跟进结果不构成场次，真实面谈复盘保留', () => {
  const notes = [
    note('审阅.md', 'review', { date: '2026-07-21' }, '# 宿題メール検証結果'),
    note('跟进.md', 'review', { date: '2026-07-22' }, '# フォローアップ結果\n昨日の面談後にメールを受信。'),
    note('复盘.md', 'review', { date: '2026-07-21', round: 'エージェント面談' }),
  ];
  assert.deepEqual(buildCalendarEvents(notes, now).map(e => [e.date, e.label]), [['2026-07-21', '猎头面谈']]);
});

test('未知阶段保持未知，后续行动改变不能把旧场次改成终面', () => {
  for (const next_action of ['一次面接の復盤', '最終面接の準備', '三次面接の返信']) {
    const prep = note('准备.md', 'interview-prep', { date: '2026-08-01', round: '面談', next_action });
    assert.equal(buildCalendarEvents([prep], now)[0].label, '面谈');
  }
  assert.equal(interviewRound('一次面接（案内名：カジュアル面談）'), 'round-1');
  assert.equal(interviewRound('三次面接（最終）'), 'final');
});

test('同一案件同日不同时间的真实轮次均保留，缺时间资料不随意并入', () => {
  const owner = note('案件.md', 'job-case', { case_id: 'test-case' });
  const first = note('一面.md', 'interview-prep', { case_id: 'test-case', date: '2026-08-01', time: '10:00', round: '一次面接' });
  const second = note('二面.md', 'interview-prep', { case_id: 'test-case', date: '2026-08-01', time: '15:00', round: '二次面接' });
  const review = note('一面复盘.md', 'review', { case_id: 'test-case', date: '2026-08-01', round: '一次面接' });
  const expected = project([owner, first, second, review]);
  for (const notes of [[review, second, first, owner], [second, owner, review, first]]) assert.deepEqual(project(notes), expected);
  assert.deepEqual(expected.map(e => [e.time, e.label]), [['10:00', '第一次面试'], ['15:00', '第二次面试']]);
  const unknown = note('未知面谈.md', 'review', { case_id: 'test-case', date: '2026-08-01', round: '面談' });
  assert.equal(buildCalendarEvents([owner, first, second, unknown], now).length, 3);
});

test('明确同一案件允许公司别名，不能把其他案件合并', () => {
  const owner = note('案件.md', 'job-case', { case_id: 'test-case' });
  const prep = note('准备.md', 'interview-prep', { case: '[[案件]]', company: '株式会社テストグループ／サンプル', date: '2026-08-01', time: '10:00', round: '一次面接' });
  const transcript = note('原稿.md', 'transcript', { case: '[[案件]]', company: 'サンプル', date: '2026-08-01', time: '10:00', round: '一次面接' });
  const events = buildCalendarEvents([owner, prep, transcript], now);
  assert.equal(events.length, 1);
  assert.equal(events[0].prepPath, prep.path);
  const other = note('另一职位.md', 'interview-prep', { ...prep.frontmatter, case: '', case_id: 'other-case' });
  assert.equal(buildCalendarEvents([owner, prep, transcript, other], now).length, 2);
});

test('独立面谈多版准备与无关联旧稿属于同一场，冷启动和完整加载相同', () => {
  const owner = note('面談.md', 'todo', { status: '完了' });
  const first = note('准备v1.md', 'interview-prep', { meeting: '[[面談]]', date: '2026-08-01', round: 'カジュアル面談' });
  const second = note('准备v2.md', 'interview-prep', { ...first.frontmatter, time: '10:00' });
  const transcript = note('原稿.md', 'transcript', { date: '2026-08-01', round: 'カジュアル面談' });
  const legacyReview = note('旧轮次.md', 'review', { date: '2026-07-01', round: '一次面接' });
  const unrelated = note('材料.md', 'material');
  const notes = [owner, first, second, transcript, legacyReview, unrelated];
  const all = project(notes);
  for (const scope of ['actions', 'overview', 'all']) assert.deepEqual(project(notes.filter(n => noteInVaultScope(n, scope))), all);
  assert.deepEqual(project([...notes].reverse()), all);
  assert.equal(all.length, 2);
  assert.equal(all[1].time, '10:00');
});

test('结构化无效日期、日期后无效时间不能默默变成日程', () => {
  for (const value of ['2026-02-30', '2026-13-01', '2026-08-01 25:00', '2026-08-01 10:99', '返信2026-08-01 10:00']) {
    assert.deepEqual(buildCalendarEvents([note('案件.md', 'job-case', { next_event_at: value })], now), [], value);
  }
  for (const type of ['review', 'transcript', 'interview-prep']) {
    assert.deepEqual(buildCalendarEvents([note('面接.md', type, { date: '2026-02-30', round: '一次面接' })], now), []);
  }
  const [event] = buildCalendarEvents([note('案件.md', 'job-case', { next_event_at: '2026-08-01 9:00', next_event_label: '一次面接' })], now);
  assert.equal(event.time, '09:00');
  assert.equal(calendarRoundBadge(event.label)?.mark, '1');
});
