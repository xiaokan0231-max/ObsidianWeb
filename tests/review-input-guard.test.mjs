import assert from "node:assert/strict";
import test from "node:test";
import { commitReviewWithFreshInputs } from "../lib/server/review-input-guard.ts";

const source = "20_求職/テスト/2026-01-01_一次面接_整理稿.md";
const annotation = source.replace("_整理稿", "_批注");
const feedback = source.replace("_整理稿", "_回答品質批注");

test("旧模型输入对应的原文、裁定或本人反馈变化时，拒绝提交且保留旧稿", async (t) => {
  for (const path of [source, annotation, feedback]) {
    await t.test(path.split("/").at(-1), async () => {
      const notes = new Map([[source, "旧原话"], [annotation, "既有裁定"]]);
      const snapshot = [source, annotation, feedback].map((path) => ({ path, content: notes.get(path) ?? null }));
      let saved = "原报告及已有顾问评论";
      let finishModel;
      const model = new Promise((resolve) => { finishModel = resolve; });
      const work = (async () => {
        const result = await model;
        return commitReviewWithFreshInputs(snapshot,
          async (path) => notes.has(path) ? { content: notes.get(path) } : null,
          async () => { saved = result; });
      })();
      notes.set(path, "模型生成期间新增的本人事实");
      finishModel("按旧输入生成的结果");
      await assert.rejects(work, /原文或本人补充已更新/);
      assert.equal(saved, "原报告及已有顾问评论");
    });
  }
});

test("依据未变化允许提交，空批注与不存在的批注保持各自语义", async () => {
  const snapshot = [{ path: source, content: "同一原话" }, { path: annotation, content: "" }, { path: feedback, content: null }];
  const notes = new Map([[source, "同一原话"], [annotation, ""]]);
  const reads = [];
  let writes = 0;
  const result = await commitReviewWithFreshInputs(snapshot, async (path) => {
    reads.push(path);
    return notes.has(path) ? { content: notes.get(path) } : null;
  }, async () => { writes += 1; return "提交后的结果"; });
  assert.equal(result, "提交后的结果");
  assert.equal(writes, 1);
  assert.deepEqual(new Set(reads), new Set([source, annotation, feedback]));
});

test("依据被删除或回读失败不能被当作允许覆盖", async () => {
  let writes = 0;
  const snapshot = [{ path: source, content: "已有原话" }];
  const commit = async () => { writes += 1; };
  await assert.rejects(commitReviewWithFreshInputs(snapshot, async () => null, commit), /原文或本人补充已更新/);
  await assert.rejects(commitReviewWithFreshInputs(snapshot, async () => { throw new Error("读取失败"); }, commit), /读取失败/);
  assert.equal(writes, 0);
});
