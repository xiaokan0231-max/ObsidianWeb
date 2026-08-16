import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readAppCss } from "./css-source.mjs";

const [ui, atlas, timelineView, graphView, graph, stage, chrome, sceneLib, css] = await Promise.all([
  readFile("app/timeline-three.tsx", "utf8"),
  readFile("app/memory-atlas.tsx", "utf8"),
  readFile("app/timeline-view.tsx", "utf8"),
  readFile("app/graph-view.tsx", "utf8"),
  readFile("app/knowledge-graph-three.tsx", "utf8"),
  readFile("app/three-stage.ts", "utf8"),
  readFile("app/three-stage-chrome.tsx", "utf8"),
  readFile("lib/timeline-scene.ts", "utf8"),
  readAppCss(),
]);

test("时之航道接入时间线视图：lazy 加载、纯数据映射、双渲染切换与降级", () => {
  // 视图从 memory-atlas 拆出到 timeline-view.tsx，契约不变、落点变了。
  assert.ok(timelineView.includes('lazy(() => import("./timeline-three"))'), "航道必须走 lazy 边界");
  assert.ok(timelineView.includes("buildTimelineScene("), "场景数据在视图侧映射为纯数据");
  assert.ok(timelineView.includes('from "@/lib/timeline-scene"'));
  assert.ok(timelineView.includes("3D 航道"));
  assert.ok(timelineView.includes("简洁模式"));
  assert.ok(timelineView.includes('useState<"corridor" | "list">("corridor")'), "默认 3D，与关系图一致");
  assert.ok(timelineView.includes("<TimelineListView"), "2D 列表作为简洁模式保留");
  assert.ok(timelineView.includes("onFallback={fallBackToList}"), "WebGL 失败退回列表");
  assert.ok(atlas.includes('events={derived.calendarEvents}'), "日程事件要传进时间线");
  // 导航顺序保持：时间线在关系图之前。
  assert.ok(
    atlas.indexOf('id: "timeline"') < atlas.indexOf('id: "graph"'),
    "SECONDARY_NAVIGATION 顺序不应被改动",
  );
});

test("chunk 边界：three 及其共享层绝不能被视图外壳急加载", () => {
  // 拆分后规则覆盖外壳和两个 3D 视图文件：谁都不许急加载 three。
  for (const consumer of [atlas, timelineView, graphView]) {
    assert.equal(consumer.includes('from "three"'), false, "不许直接 import three");
    assert.equal(consumer.includes('from "./three-stage"'), false, "不许引用 three 工具层");
    assert.equal(consumer.includes("three-stage-chrome"), false, "不许引用舞台 chrome");
  }
  // 场景类型只能以 import type 穿过 lazy 边界。
  assert.match(graphView, /import type \{[^}]*KnowledgeGraphSceneNode/);
  assert.equal(sceneLib.includes('from "three"'), false, "timeline-scene 必须保持纯数据");
  assert.equal(sceneLib.includes('from "./notes"'), false, "timeline-scene 不依赖 Note 类型");
});

test("共享层抽取落实：星图与航道消费同一套 three-stage / chrome，不再各持副本", () => {
  for (const consumer of [graph, ui]) {
    assert.ok(consumer.includes('from "./three-stage"'));
    assert.ok(consumer.includes('from "./three-stage-chrome"'));
    assert.ok(consumer.includes("createStageRenderer"));
    assert.ok(consumer.includes("createFlightController"));
    assert.ok(consumer.includes("createFocusArtifact"));
    assert.ok(consumer.includes("createStarfield"));
    assert.ok(consumer.includes("StageSearchRadar"));
    assert.ok(consumer.includes("StageControls"));
    assert.ok(consumer.includes("StageShortcuts"));
    assert.ok(consumer.includes("StagePortal"));
    assert.ok(consumer.includes("useStageSearch"));
    assert.ok(consumer.includes("webglcontextlost"));
    assert.equal(consumer.includes("function seeded("), false, "seeded 只能有一份定义");
    assert.equal(consumer.includes("NODE_VERTEX_SHADER = `"), false, "shader 只能定义在 three-stage");
  }
  assert.ok(stage.includes("export function seeded("));
  assert.ok(stage.includes("export const NODE_VERTEX_SHADER"));
  assert.ok(chrome.includes("export function useStageSearch"));
});

test("航道核心交互：滚轮行进、磁吸泊站、键盘时间导航、reduced-motion", () => {
  assert.ok(ui.includes('addEventListener("wheel"'), "滚轮必须自行接管");
  assert.ok(ui.includes("passive: false"), "wheel 需要 preventDefault，必须非 passive");
  assert.ok(ui.includes("enableZoom = false"), "OrbitControls 不许抢滚轮");
  assert.ok(ui.includes("enablePan = false"));
  assert.ok(ui.includes('event.key === "Home"'));
  assert.ok(ui.includes('event.key === "End"'));
  assert.ok(ui.includes('event.key === "PageUp" || event.key === "["'));
  assert.ok(ui.includes('event.key === "PageDown" || event.key === "]"'));
  assert.ok(ui.includes("prefers-reduced-motion"));
  assert.ok(ui.includes("磁吸泊站"), "泊站行为是设计承诺，注释里要讲明");
  assert.ok(ui.includes("时之航道，共"), "canvas 需要完整的 aria-label");
  assert.ok(ui.includes('data-view="corridor"'));
});

test("视角系统：默认俯瞰全线、V 键与按钮切巡航、每日活动光柱", () => {
  assert.ok(
    ui.includes('useState<ViewMode>("overview")'),
    "默认必须是俯瞰——总览感是这个视图存在的理由",
  );
  assert.ok(ui.includes("巡航视角"));
  assert.ok(ui.includes("俯瞰全线"));
  assert.ok(ui.includes('key === "v"'), "V 键切换视角");
  assert.ok(ui.includes("CylinderGeometry"), "站点活动光柱（沿河柱状图）");
  assert.ok(ui.includes("noteIds.length + station.eventIds.length"), "柱高 = 笔记 + 日程");
  assert.ok(ui.includes("FOG_DENSITY"), "两种视角的雾密度分离");
  assert.ok(ui.includes("applyModeConstraints"), "姿态钳位随视角换挡");
});

test("航道 HTML 覆盖层：档案卡同日块、日程旗、密度 scrubber、列表兜底", () => {
  assert.ok(ui.includes("同日的记忆"));
  assert.ok(ui.includes("当日安排"));
  assert.ok(ui.includes("time-corridor-scrubber"));
  assert.ok(ui.includes("--corridor-progress"));
  assert.ok(ui.includes("--bucket-scale"));
  assert.ok(ui.includes("time-corridor-date-label"));
  assert.ok(ui.includes("time-corridor-month-label"));
  assert.ok(ui.includes("time-corridor-event-flag"));
  assert.ok(ui.includes("用列表访问全部记忆"), "无障碍列表兜底不可少");
  assert.ok(ui.includes("回到当下"));
});

test("性能红线：不复制星图已知的逐帧分配瑕疵，标签走固定池", () => {
  assert.equal(ui.includes("QuadraticBezierCurve3"), false, "禁止逐帧分配曲线对象");
  assert.equal(ui.includes("GROUP_CENTERS"), false, "航道没有分区中心概念");
  assert.ok(ui.includes("DATE_LABEL_POOL"), "站牌必须池化，不许一站一个 DOM");
});

test("globals.css：航道专属类齐备，共享 chrome 标注了双视图契约", () => {
  for (const selector of [
    ".time-corridor-layout",
    ".time-corridor-scrubber",
    ".time-corridor-scrubber-progress",
    ".time-corridor-date-label",
    ".time-corridor-month-label",
    ".time-corridor-event-flag",
  ]) {
    assert.ok(css.includes(selector), `globals.css 缺少 ${selector}`);
  }
  assert.ok(css.includes("时之航道"), "共享 chrome 需要注明同时服务两个 3D 视图");
  assert.ok(css.includes("--corridor-progress"));
});
