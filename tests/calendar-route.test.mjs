import assert from "node:assert/strict";
import test from "node:test";
import { buildCalendarSnapshot } from "../lib/server/calendar-snapshot.ts";
import { loadAppModule } from "./helpers/render-tsx.mjs";

const note = () => ({ path: "案件.md", content: "# 株式会社テスト", tags: [], stat: { ctime: 1, mtime: 2, size: 10 },
  frontmatter: { type: "job-case", case_id: "test", company: "株式会社テスト", status: "面接中", next_event_at: "2026-12-10 10:00" } });
const request = (search = "", headers = {}) => new Request(`http://localhost/api/calendar${search}`, { headers });

async function fixture({ db, ensure } = {}) {
  let notes = [note()], builds = 0;
  const reads = [];
  const route = await loadAppModule("app/api/calendar/route.ts", { stubs: {
    "@/lib/server/obsidian": { readAllNotes: async (options) => { reads.push(options); return [...notes]; } },
    "@/lib/server/calendar-snapshot": { buildCalendarSnapshot: (source) => { builds++; return buildCalendarSnapshot(source); } },
    "@/lib/server/calendar-read-model": { createCalendarReadModel: () => ({ ensure }) },
    "cloudflare:workers": { env: { DB: db } },
  } });
  return { ...route, reads, builds: () => builds, replace: (next) => { notes = next; } };
}

test("日历每次校验 Obsidian，但未变资料不重算；ETag 省去正文，强制重读绕过验证器", async () => {
  const f = await fixture();
  const first = await f.GET(request());
  assert.equal(first.status, 200);
  const etag = first.headers.get("ETag");
  assert.ok(etag);
  const second = await f.GET(request("", { "If-None-Match": etag }));
  assert.equal(second.status, 304);
  assert.equal(await second.text(), "");
  assert.equal(f.builds(), 1);
  assert.equal(f.reads.length, 2, "不能以缓存为由停止校验外部改动");
  const fresh = await f.GET(request("?refresh=1", { "If-None-Match": etag }));
  assert.equal(fresh.status, 200);
  assert.equal(f.builds(), 2);
  assert.equal(f.reads.at(-1).force, true);
});

test("写后同一 mtime 的新 metadata 对象会更新投影和验证器", async () => {
  const f = await fixture();
  const first = await f.GET(request());
  const updated = note();
  updated.frontmatter.status = "不採用";
  f.replace([updated]);
  const second = await f.GET(request("", { "If-None-Match": first.headers.get("ETag") }));
  assert.equal(second.status, 200);
  assert.notEqual(second.headers.get("ETag"), first.headers.get("ETag"));
  assert.equal((await second.json()).calendar.applicationNotes[0].frontmatter.status, "不採用");
});

test("本地 D1 迁移未就绪时仍返回正本日历，不把数据库错误变成空数据", async () => {
  const f = await fixture({ db: {}, ensure: async () => { throw new Error("missing table"); } });
  const response = await f.GET(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Obsidian-Read-Model"), "live-fallback");
  assert.equal((await response.json()).calendar.events.length, 1);
});
