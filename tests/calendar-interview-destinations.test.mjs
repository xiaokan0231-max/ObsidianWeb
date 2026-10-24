import assert from "node:assert/strict";
import test from "node:test";
import { resolveCalendarInterview, resolveCalendarInterviewDestinations, resolveCalendarInterviewRequest } from "../lib/calendar-interview.ts";

function note(path, type, frontmatter = {}) {
  return { path, frontmatter: { type, ...frontmatter }, content: "", tags: [], stat: { ctime: 0, mtime: 0, size: 0 } };
}

const source = note("20_求職/テスト/案件.md", "job-case", { case_id: "sample-case", company: "株式会社テスト" });
function event(overrides = {}) {
  return {
    id: "sample-event", kind: "event", note: source, company: "株式会社テスト", date: "2026-09-14",
    time: "09:00", label: "第一次面试", phase: "past", caseId: "sample-case", prepPath: "", ...overrides,
  };
}

function material(path, type, frontmatter = {}) {
  return note(path, type, { company: "テスト", date: "2026-09-14", round: "一次面接", time: "09:00", case_id: "sample-case", ...frontmatter });
}

test("过去场次同时保留准备和复盘的精确入口，默认入口仍是复盘", () => {
  const prep = material("准备.md", "interview-prep");
  const review = material("整理稿.md", "transcript-study");
  const notes = [source, prep, review];
  const result = resolveCalendarInterviewDestinations(event(), notes);
  assert.equal(result.session.view, "session");
  assert.equal(result.session.path, prep.path);
  assert.equal(result.review.view, "review");
  assert.equal(result.review.path, review.path);
  assert.deepEqual({ ...result.session, view: "review", path: review.path }, result.review);
  assert.deepEqual(resolveCalendarInterview(event(), notes), result.review);
});

test("未开始场次也能显式打开缺少资料的复盘页，默认入口仍是准备", () => {
  const prep = material("准备.md", "interview-prep");
  const upcoming = event({ phase: "upcoming" });
  const result = resolveCalendarInterviewDestinations(upcoming, [source, prep]);
  assert.deepEqual(resolveCalendarInterview(upcoming, [source, prep]), result.session);
  assert.equal(result.review.path, null);
  assert.equal(result.review.sourcePath, source.path);
  assert.equal(result.review.time, "09:00");
});

test("两种资料都缺失时保留相同场次上下文，不借用另一日期的准备或复盘", () => {
  const otherDate = ["interview-prep", "transcript-study"].map((type) => material(`${type}.md`, type, { date: "2026-09-15" }));
  const result = resolveCalendarInterviewDestinations(event(), [source, ...otherDate]);
  for (const [view, target] of Object.entries(result)) {
    assert.equal(target.view, view);
    assert.equal(target.path, null);
    assert.equal(target.company, "株式会社テスト");
    assert.equal(target.date, "2026-09-14");
    assert.equal(target.label, "第一次面试");
    assert.equal(target.caseId, "sample-case");
  }
});

test("准备与复盘共同按案件、轮次和时间匹配，不串入同社的其他场次", () => {
  const wantedPrep = material("本轮准备.md", "interview-prep");
  const wantedReview = material("本轮整理.md", "transcript-study");
  const wrong = [
    ...["interview-prep", "transcript-study"].flatMap((type) => [
      material(`${type}-另一案件.md`, type, { case_id: "other-case" }),
      material(`${type}-二次.md`, type, { round: "二次面接" }),
      material(`${type}-下午.md`, type, { time: "15:00" }),
    ]),
  ];
  const result = resolveCalendarInterviewDestinations(event(), [source, ...wrong, wantedPrep, wantedReview]);
  assert.equal(result.session.path, wantedPrep.path);
  assert.equal(result.review.path, wantedReview.path);
});

test("泛称场次的跨资料冲突必须共同消歧，不能只因复盘唯一就猜本轮", () => {
  const firstPrep = material("一次准备.md", "interview-prep");
  const secondPrep = material("二次准备.md", "interview-prep", { round: "二次面接" });
  const firstReview = material("一次整理.md", "transcript-study");
  const result = resolveCalendarInterviewDestinations(event({ label: "面试" }), [source, firstPrep, secondPrep, firstReview]);
  assert.equal(result.session.path, null);
  assert.equal(result.review.path, null);
});

test("同场多份准备稿未声明替代关系时仍保留歧义，不能按文件顺序猜最新版本", () => {
  const prepA = material("准备A.md", "interview-prep", { prep_version: 2 });
  const prepB = material("准备B.md", "interview-prep", { prep_version: 2 });
  const review = material("整理稿.md", "transcript-study");
  for (const notes of [[source, prepA, prepB, review], [source, prepB, prepA, review]]) {
    const result = resolveCalendarInterviewDestinations(event(), notes);
    assert.equal(result.session.path, null);
    assert.equal(result.review.path, review.path);
  }
});

test("独立猎头面谈两种入口沿用 meeting 关联，与同社求职案件分开", () => {
  const meeting = note("20_求職/テスト/面谈.md", "todo", { company: "テスト" });
  const prep = material("猎头准备.md", "interview-prep", { case_id: "", meeting: "[[面谈]]", round: "エージェント面談" });
  const review = material("猎头整理.md", "transcript-study", { case_id: "", meeting: "[[面谈]]", round: "エージェント面談" });
  const unrelated = material("案件整理.md", "transcript-study", { round: "エージェント面談" });
  const result = resolveCalendarInterviewDestinations(event({ note: meeting, caseId: "", label: "猎头面谈" }), [source, meeting, prep, review, unrelated]);
  assert.equal(result.session.path, prep.path);
  assert.equal(result.review.path, review.path);
  assert.equal(result.session.caseId, "");
});

test("非面试日程、说明会和准备任务均没有准备或复盘入口", () => {
  for (const overrides of [{ label: "招聘说明会" }, { label: "オンラインセミナー" }, { kind: "action", label: "面试准备" }, { kind: "follow-up", label: "面谈后跟进" }]) {
    assert.deepEqual(resolveCalendarInterviewDestinations(event(overrides), []), { session: null, review: null });
  }
});

test("过去场次的准备 URL 在完整资料补载后仍进入准备，实际逐字稿不会改成复盘", () => {
  const prep = material("准备.md", "interview-prep", { session_status: "completed" });
  const review = material("整理稿.md", "transcript-study");
  const raw = material("逐字稿.md", "transcript");
  const requested = resolveCalendarInterviewDestinations(event(), [source]).session;
  assert.equal(requested.path, null);
  const resolved = resolveCalendarInterviewRequest(requested, [source, prep, review, raw], [event()], "2026-09-20");
  assert.equal(resolved.view, "session");
  assert.equal(resolved.path, prep.path);
  assert.equal(resolved.sourcePath, source.path);
});

test("显式复盘 URL 在未来场次或局部加载时仍是复盘，补载后只补本场整理稿", () => {
  const prep = material("准备.md", "interview-prep");
  const review = material("整理稿.md", "transcript-study");
  const requested = resolveCalendarInterviewDestinations(event({ phase: "upcoming" }), [source]).review;
  const partial = resolveCalendarInterviewRequest(requested, [source, prep], [event()], "2026-09-13");
  assert.equal(partial.view, "review");
  assert.equal(partial.path, null);
  const loaded = resolveCalendarInterviewRequest(requested, [source, prep, review], [event()], "2026-09-13");
  assert.equal(loaded.view, "review");
  assert.equal(loaded.path, review.path);
});

test("来源缺失时保留明确视图与场次，清空旧路径，不借用公司相同的准备或复盘", () => {
  const prep = material("准备.md", "interview-prep");
  const review = material("整理稿.md", "transcript-study");
  const targets = resolveCalendarInterviewDestinations(event(), [source, prep, review]);
  for (const requested of Object.values(targets)) {
    const resolved = resolveCalendarInterviewRequest(requested, [prep, review], [event()], "2026-09-20");
    assert.deepEqual(resolved, { ...requested, path: null });
  }
});

test("请求中已知的时刻优先于源笔记的另一场日程，场次未投影到日历时也能按上下文补载", () => {
  const prep = material("准备.md", "interview-prep");
  const afternoonPrep = material("下午准备.md", "interview-prep", { time: "15:00" });
  const requested = resolveCalendarInterviewDestinations(event(), [source]).session;
  for (const events of [[], [event({ time: "15:00" })]]) {
    const resolved = resolveCalendarInterviewRequest(requested, [source, prep, afternoonPrep], events, "2026-09-20");
    assert.equal(resolved.path, prep.path);
    assert.equal(resolved.time, "09:00");
    assert.equal(resolved.view, "session");
  }
});
