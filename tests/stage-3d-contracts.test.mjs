import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [graph, corridor, stage, graphView, controls, stageCss, timelineCss] = await Promise.all([
  readFile("app/knowledge-graph-three.tsx", "utf8"),
  readFile("app/timeline-three.tsx", "utf8"),
  readFile("app/three-stage.ts", "utf8"),
  readFile("app/graph-view.tsx", "utf8"),
  readFile("app/graph-hand-controls.tsx", "utf8"),
  readFile("app/styles/stage-3d.css", "utf8"),
  readFile("app/styles/timeline.css", "utf8"),
]);

test("HUD 字号基线：舞台 chrome 与手势 UI 没有低于 11px 的字", () => {
  const sizes = [...stageCss.matchAll(/font-size:\s*(?:calc\()?([\d.]+)px/g)].map((match) => Number(match[1]));
  assert.ok(sizes.length > 50);
  const tooSmall = sizes.filter((size) => size < 11);
  assert.deepEqual(tooSmall, [], "桌面上 6–9px 的字读不了");
  // 航道曾用 [data-view="corridor"] 单独放大；提升为共用基线后，重复的覆盖要删掉。
  assert.doesNotMatch(timelineCss, /\[data-view="corridor"\] \.space-graph-brand/);
  assert.doesNotMatch(timelineCss, /\[data-view="corridor"\] \.space-graph-controls button/);
  assert.doesNotMatch(timelineCss, /\[data-view="corridor"\] \.space-graph-search-field input/);
  // 悬停速览卡是舞台里的深色玻璃，不能吃页面主题的 --ink（暗色主题下浅底浅字）。
  const peek = stageCss.slice(stageCss.indexOf("\n.space-graph-node-card {"), stageCss.indexOf("\n.space-graph-node-peek {"));
  assert.equal(peek.includes("var(--ink)"), false);
  assert.equal(peek.includes("var(--muted)"), false);
});

test("搜索薄壳：两个视图共用 three-stage 的 rim shader 与命中阈值", () => {
  assert.ok(stage.includes("export const SEARCH_SHELL_VERTEX_SHADER"));
  assert.ok(stage.includes("export function createSearchShellMaterial"));
  assert.ok(stage.includes("export const SEARCH_SHELL_LIMIT = 10"));
  for (const view of [graph, corridor]) {
    assert.ok(view.includes("createSearchShellMaterial()"));
    assert.ok(view.includes("matches.size <= SEARCH_SHELL_LIMIT"), "命中多时不画壳，只放大星点");
    assert.equal(view.includes("SEARCH_SHELL_VERTEX_SHADER = "), false, "shader 只定义一份");
  }
  assert.equal(corridor.includes("MeshStandardMaterial"), false, "航道不再用实心发光球");
});

test("抗锯齿：bloom 离屏靶自带 MSAA，按节点规模开关，不接 OutputPass", () => {
  assert.ok(stage.includes("samples: Math.max(0, options?.samples ?? 0)"));
  assert.ok(stage.includes("new EffectComposer(renderer, target)"));
  assert.doesNotMatch(stage, /import[^;]*OutputPass/, "接 OutputPass 会改整套配色，不和抗锯齿混在一起");
  // 传自建靶时 composer 把像素尺寸当 CSS 尺寸再乘 DPR；建好后要立刻按 CSS 尺寸归一。
  const bloomBody = stage.slice(stage.indexOf("export function createStageBloom"));
  assert.ok(
    bloomBody.indexOf("composer.setSize(Math.max(1, size.x), Math.max(1, size.y))")
      > bloomBody.indexOf("composer.addPass(kneePass)"),
  );
  assert.ok(graph.includes("samples: nodes.length < 1200 ? 4 : 0"));
  assert.ok(corridor.includes("samples: scene.notes.length < 1500 ? 4 : 0"));
});

test("连线流光与焦点渐变：沿线参数 + uTime，明暗按目标逐帧趋近", () => {
  assert.ok(graph.includes('setAttribute("aT"'));
  assert.ok(graph.includes("fract(vT - uTime"), "移动的亮带");
  assert.ok(graph.includes("uFlow"), "暂停／减弱动态时收掉流光");
  assert.ok(graph.includes("writeStageFogUniforms(linkMaterial.uniforms"));
  assert.ok(graph.includes("ribbonLinks.has(link)"), "只有飘带上的脉冲走曲线");
  assert.ok(graph.includes("pulsePoint.lerpVectors("), "全景脉冲沿可见直线");
  for (const view of [graph, corridor]) {
    assert.ok(view.includes("approachValues(nodeFocusCurrent, nodeFocus"));
    assert.ok(view.includes("reducedMotion ? 1 :"), "减弱动态时一步到位");
    assert.ok(view.includes("focusArtifact.reveal()"));
  }
  assert.ok(stage.includes("reveal(): void;"));
  assert.ok(
    graph.includes("pointerEffects.motion.burst(projected.x, projected.y, 0.6)"),
    "选中涟漪用节点的屏幕坐标，不用指针坐标",
  );
});

test("假景深与星云：着色器内低成本实现，语义节点不形变", () => {
  assert.ok(stage.includes("uniform float uFocusDistance;"));
  assert.ok(stage.includes("mix(34.0, 8.0, vBlur)"));
  assert.doesNotMatch(stage, /(float|vec[234])\s+sample\b/, "GLSL 里变量不能叫 sample");
  assert.equal(graph.includes("BokehPass"), false);
  assert.ok(graph.includes("createStageInteractionUniforms(0)"), "语义节点 uDeform 必须为 0");
  assert.ok(graph.includes("nebulaPerArm"), "旋臂星云");
  assert.ok(graph.includes("Math.floor(16 / armGroups.length)"), "星云总数封顶 16 张");
});

test("星图标签池：固定数量的 DOM，选中绑邻居、否则绑注视点附近的高连接节点", () => {
  assert.ok(graph.includes("const NODE_LABEL_POOL = 14"));
  assert.ok(graph.includes("pickConstellationLabels("));
  assert.ok(graph.includes("staggerRow"), "按屏幕 y 错开");
  assert.ok(stage.includes("staggerLabels(staggerSlots"));
});

test("按需渲染（保守版）与逐帧分配清理", () => {
  for (const view of [graph, corridor]) {
    assert.ok(view.includes("createRenderGate()"));
    assert.ok(view.includes("renderGate.shouldRender(active)"));
    assert.ok(view.includes("const active = moving"), "未暂停时永远在画");
    assert.ok(view.includes("pointerEffects.motion.active"));
    assert.ok(view.includes("if (hoverPending) resolveHover();"), "悬停射线检测合并到每帧一次");
  }
  assert.equal(graph.includes("gesturePan.clone()"), false);
  assert.equal(graph.includes("pulseColor.set("), false, "脉冲颜色构建时解析一次");
  assert.ok(stage.includes("const labelScratch = new THREE.Vector3()"));
});

test("航道进场运镜与滚轮速度感", () => {
  assert.ok(corridor.includes("entryPlayedRef"));
  const entryBlock = corridor.slice(corridor.indexOf("if (!entryPlayedRef.current)"));
  assert.ok(entryBlock.slice(0, 400).includes("!reducedMotion"));
  assert.ok(corridor.includes("speedFeel(travelVelocity, SPEED_FEEL_FULL)"));
  // 飞行控制器飞行中逐帧写 fov、结束时写回基准；速度感只在不飞的时候写。
  const speedBlock = corridor.slice(corridor.indexOf("滚轮就是时间机器"));
  assert.ok(speedBlock.indexOf("if (flightController.active)") < speedBlock.indexOf("camera.fov = BASE_FOV"));
  // 起飞不再把速度感抬高的 fov 瞬间写回基准：控制器记下起飞值，按进度淡回。
  assert.ok(stage.includes("fromFov: options.camera.fov"));
  assert.ok(stage.includes("flightCarry(flight.fromFov, baseFov, progress) + thrust * fovKick"));
  const flyingBlock = speedBlock.slice(speedBlock.indexOf("if (flightController.active)"), speedBlock.indexOf("} else if (flying)"));
  assert.doesNotMatch(flyingBlock, /^\s+speedFeelCurrent = 0;$/m, "飞行途中速度感衰减，不瞬间清零");
});

test("航道滚轮打断飞行：fov 与星场交给速度感渐变收回，星图的 cancel 逐位不变", () => {
  // 默认的 cancel 照旧写回基准；只有显式 keepLens 才跳过。
  assert.match(stage, /if \(!cancelOptions\?\.keepLens\) restore\(\);/);
  assert.ok(corridor.includes("flightController.cancel({ keepLens: true });"));
  assert.ok(corridor.includes("lensHandoff(camera.fov, BASE_FOV + speedFeelCurrent * 4)"));
  assert.ok(corridor.includes("lensCarryWeight = settleHandoff(lensCarryWeight, dt);"));
  assert.ok(corridor.includes("|| lensCarryWeight > 0"), "交接没收完时不能停帧");
  // 减弱动态时照旧一步写回基准。
  const wheel = corridor.slice(corridor.indexOf("const onWheel"), corridor.indexOf("const onKeyDown"));
  assert.ok(wheel.includes("flightController.active && !reducedMotion"));
  // 星图从不带参数调用：起飞时 fov 本来等于基准，写回与改动前完全相同。
  assert.doesNotMatch(graph, /flightController\.cancel\(\{/);
});

test("3D 选中节点进 URL：可选 props，外壳用 ?focus= 接上", () => {
  assert.ok(graph.includes("initialFocusId?: string | null;"));
  assert.ok(graph.includes("onFocusChange?: (id: string | null) => void;"));
  assert.ok(graphView.includes("initialFocusId={focusId}"));
  assert.ok(graphView.includes("onFocusChange={setFocusId}"));
  assert.ok(graph.includes("pendingFocusId && !flightController.active"), "进场运镜结束后再飞");
  // URL 被外部清空后，再点同一颗星也要回写 URL。
  const focusEffect = graph.slice(graph.indexOf("initialFocusRef.current = initialFocusId;"));
  assert.ok(focusEffect.slice(0, 500).includes("reportedFocusRef.current = null;"));
  // 飞行途中标签池只认键变化，不按注视点位移逐段换人。
  assert.ok(graph.includes("rebindNodeLabels(cameraDistance, flightController.active)"));
});

test("手势 UI：高频量直写 DOM，只有离散状态变化才 setState", () => {
  assert.ok(controls.includes("handUiFrameKey(frame, MIN_DUAL_SEPARATION)"));
  assert.ok(controls.includes("if (uiKey !== publishedUiKey)"));
  assert.ok(controls.includes("writeLiveFrame(frame)"));
  assert.ok(controls.includes("framePhase !== publishedFramePhase"));
  assert.ok(controls.includes("node.nodeValue = text"), "改 React 自己的文本节点，不能换掉它");
});
