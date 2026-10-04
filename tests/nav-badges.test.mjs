import assert from "node:assert/strict";
import test from "node:test";
import { buildCalendarEvents } from "../lib/memory-atlas-data.ts";
import {
  buildNavBadges,
  calendarBadgeReady,
  jobsBadgeReady,
  navBadgeLabel,
  selectionCaseCount,
  todayAppointmentCount,
} from "../lib/nav-badges.ts";

// 外壳的 calendarToday 是 JST 日期串；日历用同一个日期造 Date 作「今天」。
const TODAY = "2026-10-04";
const now = new Date(`${TODAY}T00:00:00`);

const note = (path, type, fields = {}, body = "") => ({
  path, frontmatter: { type, company: "株式会社テスト", ...fields }, content: body,
  tags: [], stat: { ctime: 0, mtime: 0, size: 0 },
});

test("日历角标只数今天已约定的场次：明天、准备任务、等待和跟进都不算", () => {
  const notes = [
    note("案件A.md", "job-case", { case_id: "case-a", status: "書類通過", next_event_at: `${TODAY} 10:00`, next_event_label: "一次面接" }),
    note("案件B.md", "job-case", { case_id: "case-b", status: "面接中", next_event_at: `${TODAY} 15:30`, next_event_label: "二次面接" }),
    note("案件C.md", "job-case", { case_id: "case-c", status: "面接中", next_event_at: "2026-10-05 11:00", next_event_label: "最終面接" }),
    // 准备任务、等待回复、跟进日期：日历不显示，角标也不能算。
    note("准备.md", "todo", { due: TODAY, next_action: `${TODAY} 面接準備` }),
    note("案件D.md", "job-case", { case_id: "case-d", status: "応募済", waiting_for: "company", follow_up_on: TODAY }),
  ];
  const events = buildCalendarEvents(notes, now);
  assert.equal(todayAppointmentCount(events, TODAY), 2);
  assert.equal(todayAppointmentCount(events, "2026-10-05"), 1);
  // 场次表之外混进来的待办型条目也不算（防御：只认 kind=event）。
  const action = { ...events[0], kind: "action" };
  assert.equal(todayAppointmentCount([...events, action], TODAY), 2);
});

test("已记录不採用的案件残留的今天预约不算", () => {
  const notes = [
    note("案件A.md", "job-case", { case_id: "case-a", status: "面接中", next_event_at: `${TODAY} 10:00`, next_event_label: "一次面接" }),
    note("案件B.md", "job-case", { case_id: "case-b", status: "不採用（2026-10-03・書類選考）", next_event_at: `${TODAY} 13:00`, next_event_label: "二次面接" }),
  ];
  const events = buildCalendarEvents(notes, now);
  assert.equal(events.filter((event) => event.date === TODAY).length, 2, "日历格子里两场都在");
  const badges = buildNavBadges({ events, notes, today: TODAY, readyScopes: ["actions"], locale: "zh-CN" });
  assert.equal(badges.actions?.count, 1);
});

test("求职角标只数書類通過・面接中，口径走 normalizeJobStatus", () => {
  const notes = [
    note("a.md", "job-case", { status: "書類通過" }),
    note("b.md", "job-case", { status: "面接中（2026-10-01・二次）" }),
    note("c.md", "job-case", { status: "内定" }),
    note("d.md", "job-case", { status: "応募済" }),
    note("e.md", "job-case", { status: "不採用" }),
    note("f.md", "job-case", { status: "選考中" }),
    note("g.md", "job-case", {}),
    // 不是案件的笔记写了同样的字也不算。
    note("h.md", "todo", { status: "面接中" }),
  ];
  assert.equal(selectionCaseCount(notes), 2);
});

test("数据未就绪或数为 0 时不出角标，不先闪 0", () => {
  const notes = [
    note("案件A.md", "job-case", { case_id: "case-a", status: "面接中", next_event_at: `${TODAY} 10:00`, next_event_label: "一次面接" }),
  ];
  const events = buildCalendarEvents(notes, now);
  assert.deepEqual(buildNavBadges({ events, notes, today: TODAY, readyScopes: [], locale: "zh-CN" }), {});
  assert.deepEqual(buildNavBadges({ events, notes, today: TODAY, readyScopes: ["training"], locale: "zh-CN" }), {});
  // jobs scope 不含 todo，场次不完整：只给求职角标。
  assert.deepEqual(Object.keys(buildNavBadges({ events, notes, today: TODAY, readyScopes: ["jobs"], locale: "zh-CN" })), ["career"]);
  assert.deepEqual(Object.keys(buildNavBadges({ events, notes, today: TODAY, readyScopes: ["actions"], locale: "zh-CN" })).sort(), ["actions", "career"]);
  assert.deepEqual(buildNavBadges({ events, notes, today: "2026-10-06", readyScopes: ["all"], locale: "zh-CN" }).actions, undefined);
  assert.deepEqual(buildNavBadges({ events: [], notes: [], today: TODAY, readyScopes: ["all"], locale: "zh-CN" }), {});
  assert.equal(calendarBadgeReady(["jobs"]), false);
  assert.equal(calendarBadgeReady(["interview"]), true);
  assert.equal(jobsBadgeReady(["jobs"]), true);
  assert.equal(jobsBadgeReady(["training"]), false);
});

test("角标说法中日两份，不用首页禁词", () => {
  assert.equal(navBadgeLabel("today", 2, "zh-CN"), "今天 2 场面试");
  assert.equal(navBadgeLabel("selection", 3, "zh-CN"), "选考中 3 件");
  assert.equal(navBadgeLabel("today", 2, "ja"), "今日の面接 2 件");
  assert.equal(navBadgeLabel("selection", 3, "ja"), "選考中 3 件");
  for (const locale of ["zh-CN", "ja"]) {
    for (const kind of ["today", "selection"]) {
      assert.doesNotMatch(navBadgeLabel(kind, 1, locale), /近期安排|进行中案件|等待回复|行动清单|全部行动|件待办/);
    }
  }
});
