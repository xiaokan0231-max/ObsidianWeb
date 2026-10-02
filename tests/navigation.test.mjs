import assert from "node:assert/strict";
import test from "node:test";
import { APP_VIEWS } from "../app/app-route.ts";
import {
  DEFAULT_PAGE_COMMAND_VIEWS,
  MOBILE_PRIMARY_NAV_IDS,
  NAVIGATION,
  PAGE_COMMANDS,
  SECONDARY_NAVIGATION,
  TOP_BAR_SECTION_IDS,
} from "../app/navigation.ts";

// 新增一页时只改了 app-route 而忘了导航表或 ⌘K，这页就只能靠手敲 URL 进去。

test("⌘K 页面命令对每个视图恰好一条", () => {
  const views = PAGE_COMMANDS.map((command) => command.view);
  assert.equal(new Set(views).size, views.length, "没有重复的视图");
  assert.deepEqual([...views].sort(), [...APP_VIEWS].sort());
});

test("日历是导航首项，没有总览或待办入口，默认命令围绕日程和本场面试", () => {
  const calendar = NAVIGATION.find((item) => item.target === "calendar");
  assert.ok(calendar);
  assert.equal(NAVIGATION[0], calendar);
  assert.equal(calendar.label, "日历");
  assert.deepEqual(calendar.views, ["calendar"]);
  assert.deepEqual(SECONDARY_NAVIGATION[calendar.id] ?? [], []);
  assert.equal(TOP_BAR_SECTION_IDS.has(calendar.id), false);
  assert.deepEqual(DEFAULT_PAGE_COMMAND_VIEWS, ["calendar", "session", "jobs"]);
  assert.equal(APP_VIEWS.includes("todo"), false);
  assert.equal(APP_VIEWS.includes("overview"), false);
  assert.equal(MOBILE_PRIMARY_NAV_IDS.has("overview"), false);
  assert.ok(NAVIGATION.every((item) => item.label !== "总览"));
  assert.ok(PAGE_COMMANDS.every((command) => !["行动清单", "总览"].includes(command.label)));
});

test("每个视图都有一个真正能点到的入口", () => {
  // 侧栏只画两种链接：一级项（去 target）和二级项（SECONDARY_NAVIGATION）。
  // item.views 只用来判断「当前在哪个分区」，本身不产生链接——所以不能拿它当「可达」。
  const linked = new Set();
  for (const item of NAVIGATION) {
    const secondary = SECONDARY_NAVIGATION[item.id] ?? [];
    if (secondary.length === 0) linked.add(item.target);
    for (const sub of secondary) linked.add(sub.id);
  }
  for (const view of APP_VIEWS) assert.ok(linked.has(view), `${view} 在侧栏里没有链接，只能手敲 URL 进去`);
  for (const item of NAVIGATION) {
    assert.ok(item.views.includes(item.target), `${item.id} 的 target 属于自己的分区`);
    const secondary = SECONDARY_NAVIGATION[item.id] ?? [];
    // 有二级项的分区：views 里每一页都要有自己的二级项，否则它在侧栏没有入口、⌘K 里还会顶着分区名出现第二次。
    if (secondary.length > 0) {
      for (const view of item.views) assert.ok(secondary.some((sub) => sub.id === view), `${item.id} 分区的 ${view} 没有二级导航项`);
    }
  }
});

test("二级导航的每一项都是真实视图，且归属自己的一级分区", () => {
  const known = new Set(APP_VIEWS);
  for (const item of NAVIGATION) {
    for (const sub of SECONDARY_NAVIGATION[item.id] ?? []) {
      assert.ok(known.has(sub.id), `${sub.id} 不是 AppView`);
      assert.ok(item.views.includes(sub.id), `${sub.id} 应列在 ${item.id}.views 里`);
    }
  }
});

test("命令与导航的文字都不为空，命令名取自导航表", () => {
  const navLabels = new Set([
    ...NAVIGATION.map((item) => item.label),
    ...Object.values(SECONDARY_NAVIGATION).flat().map((item) => item.label),
  ]);
  for (const item of NAVIGATION) {
    assert.ok(item.label.trim() && item.mobileLabel.trim(), `${item.id} 缺名字`);
  }
  const labels = PAGE_COMMANDS.map((command) => command.label);
  assert.equal(new Set(labels).size, labels.length, "两条命令同名＝有一页借用了分区名");
  for (const command of PAGE_COMMANDS) {
    assert.ok(command.label.trim(), `${command.view} 缺 label`);
    assert.ok(command.description.trim(), `${command.view} 缺说明`);
    assert.ok(command.keywords.trim(), `${command.view} 缺检索词`);
    assert.ok(navLabels.has(command.label), `${command.view} 的名字「${command.label}」与导航不一致`);
  }
  for (const view of DEFAULT_PAGE_COMMAND_VIEWS) {
    assert.ok(PAGE_COMMANDS.some((command) => command.view === view), `默认命令 ${view} 必须存在`);
  }
});
