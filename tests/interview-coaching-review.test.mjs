import assert from "node:assert/strict";
import test from "node:test";
import { buildCalendarSnapshot } from "../lib/server/calendar-snapshot.ts";
import { calendarModelFromSnapshot } from "../lib/calendar-snapshot.ts";
import { buildConsultationCatalog } from "../lib/consultation-library.ts";
import { resolveInterviewOutcomes } from "../lib/interview-outcome.ts";
import { buildInterviewReadModelRecords, INTERVIEW_RECORDS } from "../lib/interview-read-model.ts";
import { buildInterviewTrends, reviewTrendEntry } from "../lib/interview-trends.mjs";
import { todayAppointmentCount } from "../lib/nav-badges.ts";
import { reviewDisplayScore, reviewScoreTimeline } from "../lib/review-visual.ts";
import { createAdvisoryEngine } from "../lib/server/advisory-engine.ts";

const note = (path, frontmatter, content = "# テスト\n本文") => ({ path, frontmatter, content, tags: [], stat: { ctime: 1, mtime: 2, size: content.length } });
const common = { company: "先生との練習", date: "2026-03-10", round: "模擬面談", session_kind: "interview-coaching" };
const raw = note("20_求職/_面談相談/練習_逐字稿.md", { ...common, type: "transcript" });
const study = note("20_求職/_面談相談/練習_整理稿.md", { ...common, type: "transcript-study", source_note: "[[20_求職/_面談相談/練習_逐字稿]]" }, `# 練習\n\n## q01 質問\n- 概:: 本人と先生の練習\n- **s001｜面**\n    - 正:: 自己紹介をお願いします。\n    - 訳:: 请自我介绍。\n- **s002｜私**\n    - 正:: エンジニアです。\n    - 訳:: 我是工程师。\n`);

test("老师的练习可由日历打开复盘，且不会成为企业选考或待说明的历史关联", () => {
  const notes = [raw, study];
  const snapshot = buildCalendarSnapshot(notes);
  assert.equal(snapshot.events.length, 1);
  const event = snapshot.events[0];
  assert.equal(event.event.label, "模拟面谈");
  assert.equal(event.event.time, "");
  assert.equal(event.event.note.frontmatter.session_kind, "interview-coaching");
  assert.equal(event.upcoming.progress.code, "coaching-completed");
  assert.equal(event.upcoming.progress.occurred, true);
  assert.equal(event.destinations.session, null);
  assert.equal(event.destinations.review?.path, study.path);
  assert.equal(resolveInterviewOutcomes(notes).get(study.path)?.kind, "not_applicable");
  assert.equal(buildConsultationCatalog(notes).companies.length, 0);
  const model = calendarModelFromSnapshot(snapshot, "2026-03-10");
  assert.equal(todayAppointmentCount(model.events, "2026-03-10"), 0);
  assert.equal(model.interviewTargets.get(event.event.id)?.path, study.path);
  const catalog = buildInterviewReadModelRecords(notes, { today: "2026-03-10" })
    .find(item => item.kind === INTERVIEW_RECORDS.catalog && item.key === "root").value;
  assert.ok(catalog.reviews.some(item => item.path === study.path));
});

test("练习报告不参与企业面试趋势，即使它携带可评片段", () => {
  const training = reviewTrendEntry("20_求職/_面談相談/練習_回答品質復盤.md", common, "");
  training.review = { overallScore: 80, dimensions: {}, blocks: [], priorityBlockIds: [], summaryZh: "" };
  const regular = { ...training, key: "20_求職/株式会社テスト/一次", company: "株式会社テスト", sessionKind: "" };
  const result = buildInterviewTrends([training, regular]);
  assert.equal(result.interviews.length, 1);
  assert.equal(result.interviews[0].key, regular.key);
  assert.equal(reviewDisplayScore(training).score, null);
  assert.deepEqual(reviewScoreTimeline([training]).map(item => item.key), []);
});

test("跨面试顾问更新不收录辅导，但单场复盘仍可读取状态", async () => {
  const engine = createAdvisoryEngine({ readAll: async () => [study], read: async () => null,
    write: async () => {}, invoke: async () => { throw new Error("unexpected invocation"); } });
  assert.equal((await engine.state()).coverage.length, 0);
  assert.equal((await engine.sourceState(study.path)).sourcePath, study.path);
});

test("未来的模拟辅导准备仍是待进行，不会被当成已经完成", () => {
  const prep = note("20_求職/_面談相談/未来_準備.md", { ...common, type: "interview-prep", date: "2026-03-12", session_status: "scheduled" });
  const entry = buildCalendarSnapshot([prep]).events[0];
  assert.equal(entry.upcoming.progress.code, "scheduled");
  assert.equal(entry.upcoming.progress.occurred, false);
  assert.ok(entry.destinations.session);
});

test("后来的老师练习即使关联同一案件，也不会制造企业下一轮通过", () => {
  const owner = note("20_求職/株式会社テスト/案件.md", { type: "job-case", company: "株式会社テスト", case_id: "test-case", status: "面接中" });
  const real = note("20_求職/株式会社テスト/面接_整理稿.md", { type: "transcript-study", company: "株式会社テスト", case_id: "test-case", date: "2026-03-08", round: "一次面接" });
  const practice = note("20_求職/株式会社テスト/練習_整理稿.md", { ...common, type: "transcript-study", company: "株式会社テスト", case_id: "test-case" });
  const outcomes = resolveInterviewOutcomes([owner, real, practice]);
  assert.equal(outcomes.get(real.path)?.kind, "no_response");
  assert.equal(outcomes.get(practice.path)?.kind, "not_applicable");
});
