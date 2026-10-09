import assert from "node:assert/strict";
import test from "node:test";
import { loadAppModule } from "./helpers/render-tsx.mjs";

const walk = (value) => !value || typeof value !== "object" ? [] : Array.isArray(value)
  ? value.flatMap(walk) : [value, ...walk(value.props?.children)];

test("模块加载失败保留错误和整页恢复，普通重试仍只清除边界状态", async () => {
  let reloads = 0;
  const { default: Boundary } = await loadAppModule("app/view-error-boundary.tsx", {
    globals: { window: { location: { reload: () => { reloads += 1; } } } },
  });
  const boundary = new Boundary({ label: "topics", children: "page-content" });
  assert.equal(boundary.render(), "page-content");
  boundary.state = Boundary.getDerivedStateFromError(new Error("Failed to fetch dynamically imported module"));
  const tree = walk(boundary.render());
  assert.equal(tree.find((node) => node.type === "code").props.children, boundary.state.error.message);
  const buttons = tree.filter((node) => node.type === "button");
  buttons.find((node) => node.props.children === "重新载入页面").props.onClick();
  assert.equal(reloads, 1);
  assert.ok(boundary.state.error, "重新载入交给浏览器，不伪装为模块已经恢复");
  boundary.setState = (next) => { boundary.state = { ...boundary.state, ...next }; };
  buttons.find((node) => Array.isArray(node.props.children)).props.onClick();
  assert.equal(boundary.render(), "page-content");
  assert.equal(reloads, 1);
});
