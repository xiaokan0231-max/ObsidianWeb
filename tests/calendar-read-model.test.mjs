import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { buildCalendarSnapshot } from "../lib/server/calendar-snapshot.ts";
import { createCalendarReadModel } from "../lib/server/calendar-read-model.ts";
import { buildCalendarPulseSummary, buildCalendarPulseSummaries } from "../lib/calendar-pulse-summary.ts";

function database(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  for (const file of readdirSync(new URL("../drizzle/", import.meta.url)).filter((name) => name.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8"));
  }
  const calls = [];
  let failure = null;
  const db = {
    prepare(sql) { return { sql, values: [], bind(...values) { return { sql, values }; } }; },
    async batch(statements) {
      calls.push(statements.map(({ sql, values }) => ({ sql, values })));
      sqlite.exec("BEGIN");
      try {
        const results = statements.map(({ sql, values }) => {
          if (failure && sql.includes(failure)) throw new Error("模拟数据库故障");
          const statement = sqlite.prepare(sql);
          if (statement.columns().length) return { success: true, results: statement.all(...values).map((row) => ({ ...row })) };
          statement.run(...values);
          return { success: true, results: [] };
        });
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { db, sqlite, calls, failOn: (text) => { failure = text; } };
}

function snapshot(count = 3, status = "応募済") {
  return buildCalendarSnapshot(Array.from({ length: count }, (_, index) => ({
    path: `20_求職/テスト/案件${index}.md`, tags: [], stat: { ctime: 1, mtime: index + 2, size: 20 },
    content: `# 株式会社テスト${index} — データ基盤`,
    frontmatter: { type: "job-case", company: `株式会社テスト${index}`, case_id: `test-${index}`, status,
      applied_on: "2026-10-01", application_actor: "ai", application_agent: "Codex",
      next_event_at: `2026-11-${String(index % 28 + 1).padStart(2, "0")} 10:00`, next_event_label: "一次面接" },
  })));
}

test("D1 投影导入后逐项还原顺序和 JSON，进程重建后仍按同一版本读取", async (t) => {
  const { db, sqlite } = database(t);
  const model = createCalendarReadModel(db);
  const source = snapshot();
  assert.equal(await model.read("revision-a"), null);
  assert.deepEqual(await model.ensure("revision-a", async () => source, "2026-10-29T00:00:00Z"), source);
  assert.deepEqual(await createCalendarReadModel(db).read("revision-a"), source);
  const published = sqlite.prepare("SELECT published_at FROM calendar_projection_revisions WHERE revision = ?").get("revision-a");
  assert.equal(published.published_at, "2026-10-29T00:00:00Z");
  await createCalendarReadModel(db).ensure("revision-a", async () => { throw new Error("已导入版本不应再次加载"); });
  const plan = (sql, values) => sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...values).map((row) => row.detail).join(" ");
  assert.match(plan("SELECT path FROM calendar_projection_notes WHERE revision=? AND type=? AND status=?", ["revision-a", "job-case", "応募済"]), /calendar_notes_revision_type_status/);
  assert.match(plan("SELECT id FROM calendar_projection_events WHERE revision=? AND event_date=?", ["revision-a", "2026-11-01"]), /calendar_events_revision_date/);
});

test("超过 50 行的投影仍用三条批量写入，不按行发查询；SQL 参数保留原始字符", async (t) => {
  const { db, sqlite, calls } = database(t);
  const revision = "revision'); DROP TABLE calendar_projection_notes; --";
  const source = snapshot(65);
  source.applicationNotes[0].path = "20_求職/テスト/引号'\"?案件.md";
  const stored = await createCalendarReadModel(db).ensure(revision, async () => source);
  assert.deepEqual(stored, source);
  const writes = calls.flat().filter(({ sql }) => sql.startsWith("INSERT"));
  assert.equal(writes.length, 3);
  assert.ok(writes.every(({ values }) => values.length <= 6));
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM calendar_projection_notes").get().n, 65);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM calendar_projection_events").get().n, 65);
});

test("不同发布版本隔离，旧版本不会混进新版本状态或新行", async (t) => {
  const { db } = database(t);
  const model = createCalendarReadModel(db);
  const first = snapshot(2);
  const second = snapshot(4, "不採用");
  await model.ensure("old", async () => first);
  await model.ensure("new", async () => second);
  assert.deepEqual(await model.read("old"), first);
  assert.deepEqual(await model.read("new"), second);
  assert.equal(await model.read("unpublished"), null);
});

test("并发 ensure 共享导入，跨实例竞争也只返回数据库中先提交的完整版本", async (t) => {
  const { db, sqlite } = database(t);
  const model = createCalendarReadModel(db);
  let loads = 0;
  const first = snapshot(2);
  const results = await Promise.all(Array.from({ length: 10 }, () => model.ensure("same", async () => { loads++; return first; })));
  assert.equal(loads, 1);
  assert.ok(results.every((result) => JSON.stringify(result) === JSON.stringify(first)));
  const race = await Promise.all([
    createCalendarReadModel(db).ensure("race", async () => snapshot(1)),
    createCalendarReadModel(db).ensure("race", async () => snapshot(5)),
  ]);
  assert.deepEqual(race[0], race[1]);
  assert.deepEqual(await model.read("race"), race[0]);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM calendar_projection_notes WHERE revision=?").get("race").n, race[0].applicationNotes.length);
});

test("合法空日历有完成标记，数据库错误和不完整行集不能冒充空日历", async (t) => {
  const { db, sqlite } = database(t);
  const model = createCalendarReadModel(db);
  const empty = { schemaVersion: 1, events: [], applicationNotes: [], selectionCount: 0 };
  assert.deepEqual(await model.ensure("empty", async () => empty), empty);
  assert.deepEqual(await model.read("empty"), empty);
  await model.ensure("broken", async () => snapshot());
  sqlite.prepare("DELETE FROM calendar_projection_notes WHERE revision=? AND ordinal=0").run("broken");
  await assert.rejects(model.read("broken"), /不完整|无效/);
  await assert.rejects(createCalendarReadModel(db).ensure("broken", async () => empty), /不完整|无效/);
  await assert.rejects(createCalendarReadModel({ ...db, batch: async () => [{ success: false, results: [] }] }).read("unknown"), /不完整|读取失败/);
});

test("批量导入失败整体回滚，失败后重试可成功且不会留下半个完成标记", async (t) => {
  const storage = database(t);
  const model = createCalendarReadModel(storage.db);
  storage.failOn("INSERT INTO calendar_projection_events");
  await assert.rejects(model.ensure("retry", async () => snapshot()), /数据库故障/);
  assert.equal(storage.sqlite.prepare("SELECT count(*) AS n FROM calendar_projection_notes").get().n, 0);
  assert.equal(storage.sqlite.prepare("SELECT count(*) AS n FROM calendar_projection_revisions").get().n, 0);
  storage.failOn(null);
  assert.deepEqual(await model.ensure("retry", async () => snapshot()), snapshot());
});

test("错误 JSON、错位序号或索引与投影身份冲突都要求调用方回退", async (t) => {
  const { db, sqlite } = database(t);
  const model = createCalendarReadModel(db);
  const corruptions = [
    "UPDATE calendar_projection_notes SET projection_json='{' WHERE revision=? AND ordinal=0",
    "UPDATE calendar_projection_events SET ordinal=99 WHERE revision=? AND ordinal=0",
    "UPDATE calendar_projection_notes SET case_id='other-case' WHERE revision=? AND ordinal=0",
    "UPDATE calendar_projection_events SET event_date='2020-01-01' WHERE revision=? AND ordinal=0",
    "DELETE FROM calendar_projection_revisions WHERE revision=?",
  ];
  for (const [index, sql] of corruptions.entries()) {
    const revision = `corrupt-${index}`;
    await model.ensure(revision, async () => snapshot());
    sqlite.prepare(sql).run(revision);
    await assert.rejects(model.read(revision));
  }
});

test("格式错误的输入和加载失败不写任何投影，失败任务不会阻止后续重试", async (t) => {
  const { db, sqlite } = database(t);
  const model = createCalendarReadModel(db);
  await assert.rejects(model.ensure("invalid", async () => ({ schemaVersion: 1, notes: [{ content: "正文" }] })), /不完整|无效/);
  await assert.rejects(model.ensure("retry-load", async () => { throw new Error("加载失败"); }), /加载失败/);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM calendar_projection_revisions").get().n, 0);
  assert.deepEqual(await model.ensure("retry-load", async () => snapshot()), snapshot());
});

test("同一不可变发布版本的热请求不再查询 D1，read 仍直接验证数据库", async (t) => {
  const { db, calls, sqlite } = database(t);
  const model = createCalendarReadModel(db);
  const first = await model.ensure("hot", async () => snapshot());
  const queried = calls.length;
  for (let index = 0; index < 10; index++) {
    assert.equal(await model.ensure("hot", async () => { throw new Error("热版本不应重新加载"); }), first);
  }
  assert.equal(calls.length, queried, "重复 ensure 没有 D1 往返");
  assert.deepEqual(await model.read("hot"), first);
  assert.equal(calls.length, queried + 1, "诊断 read 仍执行完整 SQL 校验");
  sqlite.prepare("DELETE FROM calendar_projection_events WHERE revision=?").run("hot");
  await assert.rejects(model.read("hot"), /不完整|无效/);
});

test("热版本缓存按版本隔离且最多保留四份，淘汰后从 D1 读取而不重新导入", async (t) => {
  const { db, calls } = database(t);
  const model = createCalendarReadModel(db);
  const variants = Array.from({ length: 5 }, (_, index) => snapshot(index + 1));
  for (let index = 0; index < 4; index++) await model.ensure(`version-${index}`, async () => variants[index]);
  const afterFour = calls.length;
  assert.deepEqual(await model.ensure("version-0", async () => { throw new Error("已导入"); }), variants[0]);
  assert.equal(calls.length, afterFour);
  await model.ensure("version-4", async () => variants[4]);
  const afterFive = calls.length;
  assert.deepEqual(await model.ensure("version-0", async () => { throw new Error("已导入"); }), variants[0]);
  assert.equal(calls.length, afterFive, "刚访问的首版本仍在热缓存");
  assert.deepEqual(await model.ensure("version-1", async () => { throw new Error("从 D1 恢复即可"); }), variants[1]);
  assert.equal(calls.length, afterFive + 1, "最久未访问的版本被淘汰后发生一次 SQL batch");
});

test("数据库读取失败不进入热缓存，修复后同一版本可重试并复用成功结果", async (t) => {
  const storage = database(t);
  await createCalendarReadModel(storage.db).ensure("recover", async () => snapshot());
  const model = createCalendarReadModel(storage.db);
  storage.failOn("SELECT path");
  await assert.rejects(model.ensure("recover", async () => { throw new Error("不应加载"); }), /数据库故障/);
  storage.failOn(null);
  const restored = await model.ensure("recover", async () => { throw new Error("应读取既有版本"); });
  const afterRecovery = storage.calls.length;
  assert.equal(await model.ensure("recover", async () => { throw new Error("不应重新加载"); }), restored);
  assert.equal(storage.calls.length, afterRecovery);
});

function summarySnapshot() {
  const data = snapshot(4);
  const applications = [
    { case_id: "same-case", company: "株式会社テスト", applied_on: "2026-10-01", status: "応募済" },
    { case_id: "second-case", company: "テスト", applied_on: "2026-10-02", status: "面接中" },
    { case_id: "closed-case", company: "株式会社ダミー", applied_on: "2026-10-02", status: "不採用" },
    { case_id: "same-case", company: "株式会社テスト", applied_on: "2026-10-03", status: "応募済" },
    { case_id: "future-case", company: "株式会社未来テスト", applied_on: "2026-10-04", status: "応募済" },
    { case_id: "earlier-case", company: "株式会社旧テスト", applied_on: "2026-09-30", status: "応募済" },
  ];
  data.applicationNotes = applications.map((fields, index) => ({ ...data.applicationNotes[0], path: `テスト/申請${index}.md`,
    frontmatter: { ...data.applicationNotes[0].frontmatter, ...fields } }));
  for (const [index, entry] of data.events.entries()) {
    entry.event.date = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-11-01"][index];
    if (index < 2) entry.past.progress = { ...entry.past.progress, tone: "waiting", code: "waiting-case", ownerKey: "case:shared-owner", occurred: true };
    if (index === 2) {
      const progress = { ...entry.upcoming.progress, tone: "neutral", code: "unrecorded", occurred: true };
      entry.upcoming.progress = progress;
      entry.past.progress = progress;
    }
  }
  return data;
}

test("预聚合沿用月度公司与案件去重、六桶优先级和等待历史口径", () => {
  const data = summarySnapshot();
  const summary = buildCalendarPulseSummary(data, "2026-10-03", "2026-10");
  assert.deepEqual(summary, {
    today: "2026-10-03", month: "2026-10",
    applications: { companyCount: 2, positionCount: 3,
      bucketCounts: { "needs-user": 0, progressing: 1, unknown: 0, waiting: 0, paused: 0, closed: 1 } },
    waitingCount: 1, historicalCount: 1, historicalTotal: 3,
  });
  const all = buildCalendarPulseSummaries(data, "2026-10-03");
  assert.deepEqual(all.map((item) => item.month), ["", "2026-09", "2026-10"]);
  for (const item of all) assert.deepEqual(item, buildCalendarPulseSummary(data, item.today, item.month));
});

test("汇总命中只做一次小 SELECT，跨进程或未知月份也不读取明细", async (t) => {
  const { db, calls, sqlite } = database(t);
  const model = createCalendarReadModel(db);
  const data = summarySnapshot();
  const revision = "summary'); DROP TABLE calendar_projection_summaries; --";
  assert.equal(await model.readSummary(revision, "2026-10-03", "2026-10"), null);
  assert.deepEqual(await model.ensureSummary(revision, "2026-10-03", "2026-10", async () => data),
    buildCalendarPulseSummary(data, "2026-10-03", "2026-10"));
  const fresh = createCalendarReadModel(db);
  const before = calls.length;
  assert.deepEqual(await fresh.ensureSummary(revision, "2026-10-03", "2026-10", async () => { throw new Error("汇总命中不应加载详情"); }),
    buildCalendarPulseSummary(data, "2026-10-03", "2026-10"));
  assert.equal(calls.length, before + 1);
  assert.equal(calls.at(-1).length, 1);
  assert.match(calls.at(-1)[0].sql, /^SELECT .*as_of_date/s);
  assert.doesNotMatch(calls.at(-1)[0].sql, /calendar_projection_notes|calendar_projection_events/);
  const absent = await fresh.ensureSummary(revision, "2026-10-03", "2030-12", async () => { throw new Error("未知月份只读取哨兵"); });
  assert.deepEqual(absent, buildCalendarPulseSummary(data, "2026-10-03", "2030-12"));
  assert.equal(absent.applications.companyCount, 0);
  assert.equal(absent.waitingCount, 1);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM calendar_projection_summaries WHERE revision=?").get(revision).n, 3);
});

test("跨 JST 午夜重建当天全部月汇总，前一天汇总与其他发布版本互不污染", async (t) => {
  const { db, sqlite } = database(t);
  const model = createCalendarReadModel(db);
  const data = summarySnapshot();
  const old = await model.ensureSummary("daily", "2026-10-03", "2026-10", async () => data);
  assert.equal(await model.readSummary("daily", "2026-10-04", "2026-10"), null);
  const next = await model.ensureSummary("daily", "2026-10-04", "2026-10", async () => { throw new Error("版本未变，可复用已验证快照"); });
  assert.deepEqual(next, buildCalendarPulseSummary(data, "2026-10-04", "2026-10"));
  assert.equal(old.applications.companyCount, 2);
  assert.equal(next.applications.companyCount, 3);
  assert.equal(next.applications.positionCount, 4);
  assert.deepEqual(await model.readSummary("daily", "2026-10-03", "2026-10"), old);
  assert.equal(await model.readSummary("another-version", "2026-10-04", "2026-10"), null);
  assert.equal(sqlite.prepare("SELECT count(DISTINCT as_of_date) AS n FROM calendar_projection_summaries").get().n, 2);
});

test("同日不同月份的并发汇总只导入一次，失败可重试且无半成品哨兵", async (t) => {
  const storage = database(t);
  const model = createCalendarReadModel(storage.db);
  const data = summarySnapshot();
  let loads = 0;
  await Promise.all(["2026-09", "2026-10", "2026-12"].map((month) =>
    model.ensureSummary("parallel", "2026-10-03", month, async () => { loads++; return data; })));
  assert.equal(loads, 1);
  assert.equal(storage.calls.flat().filter(({ sql }) => sql.startsWith("INSERT INTO calendar_projection_summaries")).length, 1);
  storage.failOn("INSERT INTO calendar_projection_summaries");
  await assert.rejects(model.ensureSummary("parallel", "2026-10-04", "2026-10", async () => data), /数据库故障/);
  assert.equal(await model.readSummary("parallel", "2026-10-04", "2026-10"), null);
  storage.failOn(null);
  assert.deepEqual(await model.ensureSummary("parallel", "2026-10-04", "2026-10", async () => data),
    buildCalendarPulseSummary(data, "2026-10-04", "2026-10"));
  await assert.rejects(model.readSummary("parallel", "2026-02-30", "2026-10"), /日期无效/);
  await assert.rejects(model.readSummary("parallel", "2026-10-04", "2026-13"), /日期无效/);
});

test("汇总缺完成哨兵、坏桶计数或全局数字冲突时拒绝返回假数字", async (t) => {
  const { db, sqlite } = database(t);
  const model = createCalendarReadModel(db);
  const changes = [
    "DELETE FROM calendar_projection_summaries WHERE revision=? AND month=''",
    "UPDATE calendar_projection_summaries SET bucket_counts_json='{}' WHERE revision=? AND month='2026-10'",
    "UPDATE calendar_projection_summaries SET waiting_count=99 WHERE revision=? AND month='2026-10'",
  ];
  for (const [index, sql] of changes.entries()) {
    const revision = `broken-summary-${index}`;
    await model.ensureSummary(revision, "2026-10-03", "2026-10", async () => summarySnapshot());
    sqlite.prepare(sql).run(revision);
    await assert.rejects(model.readSummary(revision, "2026-10-03", "2026-10"), /不完整|无效/);
  }
});
