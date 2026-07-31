import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const graph = await readFile("app/knowledge-graph-three.tsx", "utf8");

test("星图 3D 观感机制：错层分区、侧角常驻机位、一次性开场运镜", () => {
  // 分区中心必须在 z 轴错层——五区同深就会退化回平面散点图。
  const centers = graph.match(/GROUP_CENTERS[^;]+;/s)?.[0] ?? "";
  const depths = [...centers.matchAll(/\[\s*[-\d.]+\s*,\s*[-\d.]+\s*,\s*([-\d.]+)\s*\]/g)]
    .map((matched) => Number(matched[1]));
  assert.equal(depths.length, 5, "五个分区中心都要有 z 值");
  assert.ok(
    Math.max(...depths) - Math.min(...depths) >= 3,
    "分区中心的 z 层距不足，纵深会读不出来",
  );
  // 常驻机位不许回到正对 z 轴（无视差）的位置。
  assert.ok(graph.includes("HOME_DIRECTION"), "常驻机位需要 3/4 侧角方向");
  assert.equal(
    graph.includes("new THREE.Vector3(0, 0, fitHomeDistance"),
    false,
    "还残留正对 z 轴的机位计算",
  );
  // 开场运镜：只播一次、减弱动态时跳过。
  assert.ok(graph.includes("ENTRY_DIRECTION"));
  assert.ok(graph.includes("entryPlayedRef"), "开场运镜必须有只播一次的闸");
  const entryBlock = graph.slice(graph.indexOf("if (!entryPlayedRef.current)"));
  assert.ok(
    entryBlock.slice(0, 600).includes("!reducedMotion"),
    "开场运镜要尊重 prefers-reduced-motion",
  );
});
