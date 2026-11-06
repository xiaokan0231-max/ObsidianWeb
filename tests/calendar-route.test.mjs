import assert from "node:assert/strict";
import test from "node:test";
import { buildCalendarSnapshot } from "../lib/server/calendar-snapshot.ts";
import { loadAppModule } from "./helpers/render-tsx.mjs";

const note = () => ({ path: "案件.md", content: "# 株式会社テスト", tags: [], stat: { ctime: 1, mtime: 2, size: 10 },
  frontmatter: { type: "job-case", case_id: "test", company: "株式会社テスト", status: "面接中", next_event_at: "2026-12-10 10:00" } });
const request = (search = "", headers = {}, method = "GET") => new Request(`http://localhost/api/calendar${search}`, { headers, method });

async function fixture({ failure = false } = {}) {
  let revision = "test-first", snapshot = buildCalendarSnapshot([note()]);
  const reads = [];
  const runtime = {
    async readModelRuntime(pinned) {
      if (failure) throw Object.assign(new Error("资料索引正在同步"), { status: 503 });
      assert.ok(!pinned || pinned === revision);
      return { revision, model: { async readRecord(key, kind, id) {
        reads.push({ revision: key, kind, id });
        return snapshot;
      } } };
    },
    readModelFailure(error) {
      return Response.json({ error: error.message }, { status: error.status ?? 503, headers: { "Retry-After": "1" } });
    },
  };
  const route = await loadAppModule("app/api/calendar/route.ts", { stubs: {
    "./read-model-server": runtime,
    "../../read-model-server": runtime,
  } });
  return { ...route, reads, replace: (nextRevision, next) => { revision = nextRevision; snapshot = buildCalendarSnapshot([next]); } };
}

test("兼容接口沿用同一索引，验证器及 HEAD 不读取全量快照", async () => {
  const f = await fixture();
  const first = await f.GET(request());
  assert.equal(first.status, 200);
  const etag = first.headers.get("ETag");
  assert.equal(etag, 'W/"test-first"');
  assert.equal(first.headers.get("X-Obsidian-Read-Model"), "d1");
  const second = await f.GET(request("", { "If-None-Match": etag }));
  assert.equal(second.status, 304);
  assert.equal(await second.text(), "");
  const head = await f.HEAD(request("", { "Accept-Encoding": "gzip" }, "HEAD"));
  assert.equal(head.headers.get("Content-Encoding"), "gzip");
  assert.equal(await head.text(), "");
  assert.equal(f.reads.length, 1);
  const fresh = await f.GET(request("?refresh=1", { "If-None-Match": etag, "Accept-Encoding": "gzip" }));
  assert.equal(fresh.status, 200);
  assert.equal(fresh.headers.get("Content-Encoding"), "gzip");
  const data = await new Response(fresh.body.pipeThrough(new DecompressionStream("gzip"))).json();
  assert.equal(data.calendar.events.length, 1);
  assert.deepEqual(f.reads, Array.from({ length: 2 }, () => ({ revision: "test-first", kind: "calendar-source", id: "root" })));
});

test("索引版本更新后，兼容接口返回新验证器和同版快照", async () => {
  const f = await fixture();
  const first = await f.GET(request());
  const updated = note();
  updated.frontmatter.status = "不採用";
  f.replace("test-next", updated);
  const second = await f.GET(request("", { "If-None-Match": first.headers.get("ETag") }));
  assert.equal(second.status, 200);
  assert.equal(second.headers.get("ETag"), 'W/"test-next"');
  assert.equal((await second.json()).calendar.applicationNotes[0].frontmatter.status, "不採用");
});

test("未有完整索引时保持可重试故障，不返回假空日历", async () => {
  const f = await fixture({ failure: true });
  const response = await f.GET(request());
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Retry-After"), "1");
  assert.equal((await response.json()).connected, false);
  assert.equal(f.reads.length, 0);
});
