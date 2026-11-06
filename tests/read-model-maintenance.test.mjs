import assert from "node:assert/strict";
import test from "node:test";
import { database } from "./read-model-db.mjs";
import { buildReadModelArtifact, createReadModel } from "../lib/server/read-model.ts";
import { handleReadModelMaintenance } from "../lib/server/read-model-maintenance.ts";

const secret = "test-maintenance-secret-with-at-least-32-characters";
const origin = "https://test.example";
function note(name, body = "虚构测试正文") {
  return { path: `30_資料/${name}.md`, content: `# ${name}\n\n${body}`, frontmatter: { type: "material" }, tags: [], stat: { ctime: 1, mtime: 1, size: body.length } };
}
function changes(storage) { return storage.sqlite.prepare("SELECT total_changes() count").get().count; }
function count(storage, table, revision) {
  return storage.sqlite.prepare(`SELECT COUNT(*) count FROM ${table}${revision ? " WHERE revision=?" : ""}`).get(...(revision ? [revision] : [])).count;
}
async function fixture(t, { large = false } = {}) {
  const storage = database(t), model = createReadModel(storage.db, { retention: false });
  const artifacts = new Map();
  async function add(revision, notes, time, building = false) {
    const artifact = await buildReadModelArtifact(notes, { revision });
    if (building) {
      await model.begin(artifact.manifest);
      for (const [ordinal, batch] of artifact.batches.entries()) await model.importBatch(revision, batch, ordinal);
    } else await model.importArtifact(revision, artifact);
    storage.sqlite.prepare("UPDATE read_model_revisions SET created_at=? WHERE revision=?").run(time, revision);
    artifacts.set(revision, artifact);
  }
  const shared = note("共享正文", "三个版本共同引用的正文");
  await add("old-a", large ? [shared, ...Array.from({ length: 1105 }, (_, i) => note(`旧资料${i}`, `撤回的唯一正文${i}`))] : [shared, note("撤回正文", "只属于旧版的正文")], 10);
  await add("old-b", [note("另一旧稿")], 15);
  await add("allowed", [shared, note("获准旧稿")], 20);
  await add("current", [shared, note("当前正文")], 30);
  await add("future", [shared, note("后续部署")], 40, true);
  const policy = { revision: "current", digest: "test-manifest-digest", allowed: ["allowed", "current"] };
  const env = { DB: storage.db, SITE_MAINTENANCE_SECRET: secret };
  async function call(input = { dryRun: true }, options = {}) {
    const method = options.method ?? "POST";
    const headers = new Headers({ Authorization: `Bearer ${secret}`, "Content-Type": "application/json", ...options.headers });
    const response = await handleReadModelMaintenance(new Request(`${origin}/api/read-model/maintenance/prune`, {
      method, headers, body: method === "GET" ? undefined : options.rawBody ?? JSON.stringify(input),
    }), options.env ?? env, options.readPolicy ?? (async () => structuredClone(policy)));
    return { response, status: response.status, body: await response.json() };
  }
  const commit = (revisions = ["old-a", "old-b"]) => ({ dryRun: false, expectedRevision: policy.revision, manifestDigest: policy.digest, revisions });
  return { storage, model, artifacts, policy, env, call, commit, add };
}

test("维护预检只读；原请求重复执行可依次撤回旧版，保留获准版、后续导入和共享正文", async t => {
  const f = await fixture(t), before = changes(f.storage);
  const preview = await f.call();
  assert.equal(preview.status, 200);
  assert.deepEqual(preview.body.revisions, ["old-a", "old-b"]);
  assert.equal(changes(f.storage), before);
  assert.match(preview.response.headers.get("Cache-Control"), /private, no-store/);
  const sharedHash = f.artifacts.get("current").batches.flatMap(batch => batch.catalog ?? []).find(row => row.path.endsWith("共享正文.md")).hash;
  const oldHash = f.artifacts.get("old-a").batches.flatMap(batch => batch.catalog ?? []).find(row => row.path.endsWith("撤回正文.md")).hash;
  const original = f.commit(preview.body.revisions);
  const first = await f.call(original);
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.remaining, ["old-b"]);
  assert.equal(first.body.complete, false);
  const second = await f.call(original);
  assert.equal(second.status, 200);
  assert.equal(second.body.complete, true);
  assert.deepEqual(second.body.remaining, []);
  assert.equal((await f.call(original)).body.complete, true);
  for (const revision of ["current", "allowed", "future"]) assert.ok(await f.model.status(revision));
  assert.equal((await f.model.status("future")).state, "building");
  assert.ok(f.storage.sqlite.prepare("SELECT COUNT(*) count FROM read_model_chunks WHERE hash=?").get(sharedHash).count > 0);
  assert.equal(f.storage.sqlite.prepare("SELECT COUNT(*) count FROM read_model_chunks WHERE hash=?").get(oldHash).count, 0);
  assert.equal((await f.model.library("current")).total, 2);
  for (const table of ["read_model_catalog", "read_model_aliases", "read_model_links", "read_model_records", "read_model_batches", "read_model_content_refs", "calendar_projection_summaries"]) assert.equal(count(f.storage, table, "old-a"), 0);
});

test("当前版即使遗漏于allowed仍不能删，获准版及晚于当前的导入均拒绝", async t => {
  const f = await fixture(t);
  for (const revision of ["current", "allowed", "future"]) {
    const before = changes(f.storage);
    const result = await f.call(f.commit([revision]));
    assert.equal(result.status, 409, revision);
    assert.equal(changes(f.storage), before);
  }
  const omitted = { ...f.policy, allowed: ["allowed"] };
  assert.ok(!(await f.call({ dryRun: true }, { readPolicy: async () => omitted })).body.revisions.includes("current"));
  assert.equal((await f.call(f.commit(["current"]), { readPolicy: async () => omitted })).status, 409);
});

test("请求的清单哈希过期或二次读取策略变化均409且没有写入", async t => {
  const f = await fixture(t);
  for (const input of [{ ...f.commit(), manifestDigest: "old-digest" }, { ...f.commit(), expectedRevision: "old-a" }]) {
    const before = changes(f.storage);
    assert.equal((await f.call(input)).status, 409);
    assert.equal(changes(f.storage), before);
  }
  for (const changed of [{ ...f.policy, digest: "new-digest" }, { ...f.policy, revision: "future" }, { ...f.policy, allowed: [...f.policy.allowed, "old-a"] }]) {
    let reads = 0;
    const before = changes(f.storage);
    const result = await f.call(f.commit(), { readPolicy: async () => ++reads === 1 ? f.policy : changed });
    assert.equal(reads, 2);
    assert.equal(result.status, 409);
    assert.equal(changes(f.storage), before);
  }
});

test("维护密钥独立于留言owner凭据，来源、方法、请求体和缺失配置均先拒绝", async t => {
  const f = await fixture(t);
  let reads = 0;
  const options = { readPolicy: async () => { reads++; return f.policy; } };
  for (const headers of [{ Authorization: "" }, { Authorization: "Bearer wrong" }, { Authorization: "Bearer test-feedback-owner-secret-with-at-least-32-characters" }, { Origin: "https://other.example" }, { "Sec-Fetch-Site": "cross-site" }]) {
    assert.equal((await f.call(f.commit(), { ...options, headers })).status, 403);
  }
  assert.equal((await f.call(f.commit(), { ...options, method: "GET" })).status, 405);
  for (const env of [{}, { ...f.env, SITE_MAINTENANCE_SECRET: "short" }, { SITE_MAINTENANCE_SECRET: secret }]) assert.equal((await f.call(f.commit(), { ...options, env })).status, 503);
  assert.equal((await f.call(f.commit(), { ...options, headers: { "Content-Type": "text/plain" } })).status, 415);
  assert.equal((await f.call(f.commit(), { ...options, rawBody: "{" })).status, 400);
  assert.equal((await f.call(f.commit(), { ...options, rawBody: "x".repeat(16385) })).status, 413);
  assert.equal(reads, 0);
  f.storage.sqlite.prepare("UPDATE read_model_revisions SET state='building' WHERE revision='current'").run();
  assert.equal((await f.call(f.commit())).status, 409);
});

test("数据库事务中断回滚整轮，重试继续完成同一撤回集合", async t => {
  const f = await fixture(t);
  const before = ["read_model_catalog", "read_model_aliases", "read_model_content_refs", "read_model_chunks"].map(table => count(f.storage, table));
  f.storage.failOn("DELETE FROM read_model_content_refs");
  const failed = await f.call(f.commit());
  assert.equal(failed.status, 503);
  assert.equal(failed.response.headers.get("Retry-After"), "1");
  assert.deepEqual(["read_model_catalog", "read_model_aliases", "read_model_content_refs", "read_model_chunks"].map(table => count(f.storage, table)), before);
  f.storage.failOn(null);
  assert.equal((await f.call(f.commit())).status, 200);
  assert.equal((await f.call(f.commit())).body.complete, true);
});

test("超过1000行的目录、日历汇总和孤块分轮删除，中断位置可复用原请求推进", async t => {
  const f = await fixture(t, { large: true });
  const insert = f.storage.sqlite.prepare("INSERT INTO calendar_projection_summaries (revision,as_of_date,month,company_count,position_count,bucket_counts_json,waiting_count,historical_count,historical_total) VALUES (?,?,?,0,0,'{}',0,0,0)");
  for (let i = 0; i < 1105; i++) insert.run("old-a", `test-day-${i}`, "");
  const monitored = ["read_model_catalog", "read_model_aliases", "read_model_content_refs", "calendar_projection_summaries"];
  const input = f.commit();
  let complete = false, rounds = 0;
  while (!complete && rounds++ < 20) {
    const before = monitored.map(table => count(f.storage, table, "old-a"));
    const beforeChunks = count(f.storage, "read_model_chunks");
    const result = await f.call(input);
    assert.equal(result.status, 200);
    monitored.forEach((table, i) => assert.ok(before[i] - count(f.storage, table, "old-a") <= 1000, table));
    assert.ok(beforeChunks - count(f.storage, "read_model_chunks") <= 1000);
    if (rounds === 1) {
      assert.equal(count(f.storage, "calendar_projection_summaries", "old-a"), 105);
      assert.ok(await f.model.status("old-a"), "日历汇总未清完时保留版本，以便下轮继续");
      assert.equal(result.body.complete, false);
    }
    complete = result.body.complete;
  }
  assert.ok(rounds > 2);
  assert.equal(complete, true);
  assert.equal(count(f.storage, "calendar_projection_summaries", "old-a"), 0);
  assert.equal(await f.model.status("old-a"), null);
  assert.equal(await f.model.status("old-b"), null);
  assert.equal((await f.model.library("current")).total, 2);
});

test("空版本集合仍可有界回收孤块，并保护所有仍有引用的正文", async t => {
  const f = await fixture(t);
  const insert = f.storage.sqlite.prepare("INSERT INTO read_model_chunks (id,hash,channel,ordinal,prefix,text) VALUES (?,?,'body',0,0,'虚构孤块')");
  for (let i = 0; i < 1105; i++) insert.run(`orphan-${i}`, `orphan-hash-${i}`);
  const before = count(f.storage, "read_model_chunks");
  const first = await f.call(f.commit([]));
  assert.equal(first.status, 200);
  assert.equal(first.body.orphanChunks, 105);
  assert.equal(first.body.complete, false);
  assert.equal(before - count(f.storage, "read_model_chunks"), 1000);
  assert.equal((await f.call(f.commit([]))).body.complete, true);
  for (const revision of ["old-a", "old-b", "allowed", "current", "future"]) assert.ok(await f.model.status(revision));
});

test("预检后同名版本若被后续部署重建，事务再次检查创建时间而不删除它", async t => {
  const f = await fixture(t);
  const before = count(f.storage, "read_model_catalog", "old-a");
  let reads = 0;
  const result = await f.call(f.commit(["old-a"]), { readPolicy: async () => {
    if (++reads === 2) f.storage.sqlite.prepare("UPDATE read_model_revisions SET created_at=50 WHERE revision='old-a'").run();
    return f.policy;
  } });
  assert.equal(result.status, 200);
  assert.equal(result.body.complete, false);
  assert.deepEqual(result.body.remaining, ["old-a"]);
  assert.equal(count(f.storage, "read_model_catalog", "old-a"), before);
  assert.equal((await f.call(f.commit(["old-a"]))).status, 409);
});
