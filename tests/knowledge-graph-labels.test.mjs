import assert from "node:assert/strict";
import test from "node:test";
import { pickConstellationLabels } from "../lib/knowledge-graph.ts";

const candidates = [
  { id: "hub", degree: 30, group: "career", x: 0, y: 0, z: 0 },
  { id: "near-small", degree: 1, group: "career", x: 0.5, y: 0, z: 0 },
  { id: "far-big", degree: 40, group: "study", x: 20, y: 0, z: 0 },
  { id: "mid", degree: 8, group: "self", x: 2, y: 0, z: 0 },
  { id: "career-2", degree: 12, group: "career", x: 1, y: 0, z: 0 },
  { id: "career-3", degree: 10, group: "career", x: 1.2, y: 0, z: 0 },
];

test("有选中：选中星在前，邻居按被引用数排", () => {
  const ids = pickConstellationLabels({
    candidates,
    focus: { x: 0, y: 0, z: 0 },
    radius: 1,
    limit: 3,
    selectedId: "mid",
    neighborIds: ["near-small", "far-big", "hub", "missing", "mid"],
  });
  assert.deepEqual(ids, ["mid", "far-big", "hub"], "不认识的 id 和选中自己都不重复出现，按上限截断");
});

test("无选中：近处的高连接星优先，半径越大越接近按 degree 选全图", () => {
  const close = pickConstellationLabels({
    candidates,
    focus: { x: 0, y: 0, z: 0 },
    radius: 1,
    limit: 2,
  });
  assert.deepEqual(close, ["hub", "career-2"], "拉近时远处的大星不该抢走名字");
  const wide = pickConstellationLabels({
    candidates,
    focus: { x: 0, y: 0, z: 0 },
    radius: 1000,
    limit: 2,
  });
  assert.deepEqual(wide, ["far-big", "hub"]);
});

test("每个分区有上限，名字不会全挤在最大的那条旋臂上", () => {
  const ids = pickConstellationLabels({
    candidates,
    focus: { x: 0, y: 0, z: 0 },
    radius: 1000,
    limit: 5,
    perGroupLimit: 2,
  });
  assert.equal(ids.filter((id) => candidates.find((item) => item.id === id).group === "career").length, 2);
  assert.ok(ids.includes("mid"));
  assert.ok(ids.includes("far-big"));
});

test("同一输入永远得到同一批，标签不会来回换人", () => {
  const options = { candidates, focus: { x: 0.3, y: 0, z: 0 }, radius: 4, limit: 4 };
  assert.deepEqual(pickConstellationLabels(options), pickConstellationLabels(options));
  assert.deepEqual(pickConstellationLabels({ ...options, limit: 0 }), []);
});
