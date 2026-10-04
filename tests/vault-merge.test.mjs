import assert from "node:assert/strict";
import test from "node:test";
import { mergeScopedNotes, vaultEtag, vaultSnapshotFingerprint } from "../lib/vault-merge.ts";

const note = (path, type, mtime = 1) => ({ path, frontmatter: { type }, content: "", tags: [], stat: { ctime: 0, mtime, size: 0 } });

test("按 scope 合并：本 scope 里消失的笔记被删掉，别的 scope 的笔记不动，同路径以新来的为准", () => {
  const current = [note("a.md", "job-case", 1), note("b.md", "job-case", 2), note("t.md", "todo", 3), note("s.md", "study", 4)];
  const incoming = [note("a.md", "job-case", 9)];
  const merged = mergeScopedNotes(current, incoming, "jobs", ["a.md"]);
  assert.deepEqual(merged.map((item) => item.path), ["a.md", "s.md", "t.md"], "b.md 属于 jobs 且不在现存路径里 → 删除；todo/study 不属于 jobs → 保留；按 mtime 新到旧");
  assert.equal(merged.find((item) => item.path === "a.md").stat.mtime, 9);
  assert.deepEqual(mergeScopedNotes(current, incoming, "jobs").map((item) => item.path), ["a.md", "s.md", "t.md", "b.md"], "没有路径清单（旧服务端）就只覆盖不删除");
  assert.deepEqual(mergeScopedNotes([], incoming, "jobs", ["a.md"]), incoming, "手里是空的就照单全收");
  assert.deepEqual(mergeScopedNotes(current, incoming, "all"), incoming, "all 就是全量替换");
});

test("ETag 随每条路径的 mtime 变化，删除或改名后不再命中", () => {
  const notes = [note("a.md", "job-case", 1), note("b.md", "job-case", 5)];
  const tag = vaultEtag("jobs", notes);
  assert.match(tag, /^W\/"[0-9a-z]+-[0-9a-z]+"$/);
  assert.equal(vaultEtag("jobs", [note("a.md", "job-case", 1), note("b.md", "job-case", 5)]), tag, "同样的内容得到同样的 ETag");
  assert.notEqual(vaultEtag("jobs", [note("a.md", "job-case", 1)]), tag, "删了一篇");
  assert.notEqual(vaultEtag("jobs", [note("a.md", "job-case", 1), note("c.md", "job-case", 5)]), tag, "改名");
  assert.notEqual(vaultEtag("jobs", [note("a.md", "job-case", 1), note("b.md", "job-case", 7)]), tag, "改了内容（mtime）");
  assert.notEqual(vaultEtag("actions", notes), tag, "不同 scope 不同 ETag");
});

test("快照指纹检查旧文件的修改和时间回退，但不把返回顺序当成修改", () => {
  const before = [note("a.md", "job-case", 1), note("b.md", "job-case", 100)];
  const changed = [note("a.md", "job-case", 2), note("b.md", "job-case", 100)];
  assert.notEqual(vaultSnapshotFingerprint(before), vaultSnapshotFingerprint(changed));
  assert.notEqual(vaultEtag("jobs", before), vaultEtag("jobs", changed), "最大 mtime 没变也不能返回 304");
  assert.notEqual(vaultSnapshotFingerprint(changed), vaultSnapshotFingerprint(before), "同步回旧时间戳仍是变更");
  assert.equal(vaultSnapshotFingerprint(before), vaultSnapshotFingerprint([...before].reverse()));
  assert.equal(vaultEtag("jobs", before), vaultEtag("jobs", [...before].reverse()));
  assert.equal(vaultSnapshotFingerprint([]), vaultSnapshotFingerprint([]));
});
