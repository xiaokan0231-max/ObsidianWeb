import assert from "node:assert/strict";
import test from "node:test";

import {
  BASE_STEP,
  GAP_EXTRA_MAX,
  GATE_LEAD,
  TAIL_PAD,
  buildTimelineScene,
} from "../lib/timeline-scene.ts";

function note(id, date, extra = {}) {
  return {
    id,
    title: `标题 ${id}`,
    group: "career",
    groupLabel: "求职",
    color: "#2f6b59",
    path: id.replace(/\.md$/, ""),
    kindLabel: "案件",
    updatedLabel: "2026年7月30日",
    excerpt: `正文 ${id}`,
    date,
    ...extra,
  };
}

function event(id, date, extra = {}) {
  return {
    id,
    noteId: `20_求職/${id}.md`,
    date,
    time: "10:00",
    company: "Sharing Innovations",
    label: "一次面接",
    phase: "upcoming",
    ...extra,
  };
}

test("按日分组：站点新→旧，dayIndex/slot 交叉引用一致，slot 保持输入顺序", () => {
  const scene = buildTimelineScene(
    [note("b.md", "2026-07-30"), note("a.md", "2026-07-31"), note("c.md", "2026-07-30")],
    [],
  );
  assert.equal(scene.stations.length, 2);
  assert.deepEqual(scene.stations.map((station) => station.date), ["2026-07-31", "2026-07-30"]);
  assert.deepEqual(scene.notes.map((item) => item.id), ["a.md", "b.md", "c.md"]);
  assert.deepEqual(scene.notes.map((item) => [item.dayIndex, item.slot]), [[0, 0], [1, 0], [1, 1]]);
  assert.deepEqual(scene.stations[1].noteIds, ["b.md", "c.md"]);
});

test("间距：相邻日恰为 BASE_STEP，空窗对数放大，超长空窗触顶，z 单调递增", () => {
  const scene = buildTimelineScene(
    [
      note("a.md", "2026-07-31"),
      note("b.md", "2026-07-30"),
      note("c.md", "2026-07-23"),
      note("d.md", "2026-06-23"),
      note("e.md", "2026-03-25"),
    ],
    [],
  );
  const [s0, s1, s2, s3, s4] = scene.stations;
  assert.equal(s0.z, 0);
  assert.equal(s0.gapDays, 0);
  assert.ok(Math.abs(s1.z - s0.z - BASE_STEP) < 1e-9, "相邻日一步应恰为 BASE_STEP");
  assert.equal(s2.gapDays, 7);
  const weekStep = s2.z - s1.z;
  assert.ok(weekStep > BASE_STEP, "一周空窗应大于基础步长");
  assert.ok(weekStep < BASE_STEP + GAP_EXTRA_MAX, "一周空窗不应触顶");
  const monthStep = s3.z - s2.z;
  const quarterStep = s4.z - s3.z;
  assert.ok(Math.abs(monthStep - (BASE_STEP + GAP_EXTRA_MAX)) < 1e-9, "30 天空窗应触顶");
  assert.ok(Math.abs(quarterStep - (BASE_STEP + GAP_EXTRA_MAX)) < 1e-9, "90 天空窗与 30 天同为封顶值");
  scene.stations.forEach((station, index) => {
    if (index === 0) return;
    assert.ok(station.z > scene.stations[index - 1].z, "z 必须严格单调");
  });
  assert.ok(Math.abs(scene.totalDepth - (s4.z + TAIL_PAD)) < 1e-9);
});

test("月门：按月聚合、首站标记、门位提前 GATE_LEAD、计数正确", () => {
  const scene = buildTimelineScene(
    [
      note("a.md", "2026-07-31"),
      note("b.md", "2026-07-02"),
      note("c.md", "2026-06-28"),
    ],
    [event("ev1", "2026-06-28")],
  );
  assert.deepEqual(scene.months.map((month) => month.key), ["2026-07", "2026-06"]);
  assert.deepEqual(scene.months.map((month) => month.label), ["2026年7月", "2026年6月"]);
  assert.deepEqual(scene.months.map((month) => month.noteCount), [2, 1]);
  assert.deepEqual(scene.months.map((month) => month.eventCount), [0, 1]);
  assert.equal(scene.months[0].firstDayIndex, 0);
  assert.equal(scene.months[1].firstDayIndex, 2);
  assert.deepEqual(scene.stations.map((station) => station.isMonthStart), [true, false, true]);
  const june = scene.months[1];
  const juneFirstStation = scene.stations[june.firstDayIndex];
  assert.ok(Math.abs(june.zStart - (juneFirstStation.z - GATE_LEAD)) < 1e-9);
  assert.equal(scene.months[0].zStart, 0, "最新月的门位钳制到 0");
});

test("仅有面接、没有笔记的日子也成站；同日事件共享 dayIndex；phase 透传", () => {
  const scene = buildTimelineScene(
    [note("a.md", "2026-07-31")],
    [
      event("ev-lonely", "2026-08-02"),
      event("ev-shared", "2026-07-31", { phase: "past" }),
    ],
  );
  assert.deepEqual(scene.stations.map((station) => station.date), ["2026-08-02", "2026-07-31"]);
  const lonely = scene.stations[0];
  assert.deepEqual(lonely.noteIds, []);
  assert.deepEqual(lonely.eventIds, ["ev-lonely"]);
  const shared = scene.events.find((item) => item.id === "ev-shared");
  assert.equal(shared.dayIndex, 1);
  assert.equal(shared.phase, "past");
  assert.equal(scene.notes[0].dayIndex, 1, "笔记的 dayIndex 要跟着并集后的站序走");
});

test("标签：星期按 UTC 计算，首站与跨年站带年份，其余不带", () => {
  const scene = buildTimelineScene(
    [
      note("a.md", "2026-01-02"),
      note("b.md", "2026-01-01"),
      note("c.md", "2025-12-30"),
    ],
    [],
  );
  const [s0, s1, s2] = scene.stations;
  assert.equal(s0.dateLabel, "2026年1月2日");
  assert.equal(s1.dateLabel, "1月1日");
  assert.equal(s1.weekdayLabel, "周四");
  assert.equal(s2.dateLabel, "2025年12月30日", "跨年后的第一站要重新带上年份");
});

test("解析不出 ISO 日期的输入被剔除，带注记的日期取其中的 ISO 部分", () => {
  const scene = buildTimelineScene(
    [note("a.md", "2026-07-21・書類選考"), note("junk.md", "来週のどこか")],
    [],
  );
  assert.equal(scene.stations.length, 1);
  assert.equal(scene.stations[0].date, "2026-07-21");
  assert.deepEqual(scene.notes.map((item) => item.id), ["a.md"]);
});

test("空输入返回全空结构", () => {
  assert.deepEqual(buildTimelineScene([], []), {
    notes: [],
    stations: [],
    months: [],
    events: [],
    totalDepth: 0,
  });
});

test("确定性：同输入两次结果逐字节一致", () => {
  const notes = [note("a.md", "2026-07-31"), note("b.md", "2026-07-01")];
  const events = [event("ev1", "2026-07-15")];
  assert.deepEqual(buildTimelineScene(notes, events), buildTimelineScene(notes, events));
});

test("规模上界：500 个逐日笔记 → 500 站，纵深受步长上限约束", () => {
  const notes = [];
  const start = Date.UTC(2026, 6, 31);
  for (let index = 0; index < 500; index += 1) {
    const day = new Date(start - index * 86_400_000);
    const iso = day.toISOString().slice(0, 10);
    notes.push(note(`note-${index}.md`, iso));
  }
  const scene = buildTimelineScene(notes, []);
  assert.equal(scene.stations.length, 500);
  assert.ok(scene.totalDepth < 500 * (BASE_STEP + GAP_EXTRA_MAX));
  assert.equal(scene.notes.length, 500);
});
