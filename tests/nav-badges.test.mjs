import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildCalendarEvents } from "../lib/memory-atlas-data.ts";
import {
  buildNavBadges,
  calendarBadgeReady,
  jobsBadgeReady,
  navBadgeLabel,
  quickDueBadgeCount,
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

test("训练中心角标＝快练待复习数：0、未知、课程未建立都不出；不依赖 vault scope", () => {
  assert.equal(quickDueBadgeCount(null), null);
  assert.equal(quickDueBadgeCount(undefined), null);
  assert.equal(quickDueBadgeCount({ ready: false, due: 5 }), null, "课程未建立时 due 没有意义");
  assert.equal(quickDueBadgeCount({ ready: true, due: 0 }), null);
  assert.equal(quickDueBadgeCount({ ready: true, due: Number.NaN }), null);
  assert.equal(quickDueBadgeCount({ ready: true }), null);
  assert.equal(quickDueBadgeCount({ ready: true, due: 7 }), 7);
  assert.equal(quickDueBadgeCount({ due: 3 }), 3, "旧汇总不带 ready 时照样认 due");

  // 快练汇总不来自 vault scope：scope 一个都没到手时也能出训练中心角标，日历与求职角标照旧不出。
  const badges = buildNavBadges({ events: [], notes: [], today: TODAY, readyScopes: [], locale: "zh-CN", quickDue: 7 });
  assert.deepEqual(badges, { training: { kind: "due", count: 7, label: "待复习 7 题" } });
  assert.deepEqual(buildNavBadges({ events: [], notes: [], today: TODAY, readyScopes: [], locale: "zh-CN", quickDue: 0 }), {});
  assert.deepEqual(buildNavBadges({ events: [], notes: [], today: TODAY, readyScopes: [], locale: "zh-CN", quickDue: null }), {});
  assert.deepEqual(buildNavBadges({ events: [], notes: [], today: TODAY, readyScopes: [], locale: "zh-CN" }), {}, "不传 quickDue 时与以前一样");
  assert.equal(buildNavBadges({ events: [], notes: [], today: TODAY, readyScopes: [], locale: "ja", quickDue: 2 }).training?.label, "復習待ち 2 問");
});

test("待复习角标的说法中日两份，不用首页禁词", () => {
  assert.equal(navBadgeLabel("due", 4, "zh-CN"), "待复习 4 题");
  assert.equal(navBadgeLabel("due", 4, "ja"), "復習待ち 4 問");
  for (const locale of ["zh-CN", "ja"]) {
    assert.doesNotMatch(navBadgeLabel("due", 1, locale), /近期安排|进行中案件|等待回复|行动清单|全部行动|件待办/);
  }
});

test("外壳接线（源码）：首次载入后用计时器取一次汇总、失败静默；训练页交来的汇总优先，不重复请求", async () => {
  const [atlas, shell, css] = await Promise.all([
    readFile(new URL("../app/memory-atlas.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/japanese-training.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/styles/shell.css", import.meta.url), "utf8"),
  ]);
  const hook = atlas.slice(atlas.indexOf("function useQuickDueBadge"), atlas.indexOf("function MemoryAtlas"));
  assert.match(hook, /window\.setTimeout\(/, "用计时器而不是 rAF：后台标签页不出帧");
  assert.match(hook, /fetch\("\/api\/language\/v2\/quick\/summary"/);
  assert.match(hook, /\.catch\(\(\) => undefined\)/, "失败静默");
  assert.match(hook, /requested\.current/, "只取一次");
  assert.match(hook, /viewRef\.current === "language"/, "已在训练页时由训练页交汇总，外壳不再请求");
  assert.match(hook, /current \?\? quickDueBadgeCount\(summary\)/, "训练页先交来的数不被晚到的外壳请求覆盖");
  assert.match(atlas, /<JapaneseTraining onVaultChanged=\{loadVault\} onQuickSummary=\{onQuickSummary\} \/>/);
  assert.match(atlas, /locale, quickDue,/);
  assert.match(shell, /onQuickSummary\?: \(summary: QuickSummary\) => void/);
  // 只用语义 token：成功色浅底，折叠态实心。
  assert.match(css, /\.side-nav a > \.nav-badge\[data-kind="due"\] \{\s*color: var\(--success\);\s*background: var\(--success-wash\);/);
  assert.match(css, /:root\[data-rail="collapsed"\] \.side-nav a > \.nav-badge\[data-kind="due"\] \{\s*background: var\(--success\);/);
});
