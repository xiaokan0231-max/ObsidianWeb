import assert from "node:assert/strict";
import test from "node:test";
import { buildInterviewReadModelRecords, INTERVIEW_RECORDS } from "../lib/interview-read-model.ts";
import { loadAppModule } from "./helpers/render-tsx.mjs";

const today = "2026-10-29";
const slug = "test-first-round";
const canonical = {
  path: "20_求職/株式会社テスト/一次面接.md", stat: { ctime: 0, mtime: 1, size: 10 }, tags: [],
  frontmatter: { type: "interview-prep", prep_version: 2, date: today, company: "株式会社テスト", share_slug: slug },
  content: "# 一次面接の準備",
};
const variant = (path, fields) => ({ ...canonical, path, frontmatter: { ...canonical.frontmatter, ...fields } });
const shares = (notes) => buildInterviewReadModelRecords(notes, { today }).filter(({ kind }) => kind === INTERVIEW_RECORDS.share);

test("面试短链按明确原稿路径建立，译稿、对照稿与重复别名不能改写跳转", () => {
  const notes = [canonical,
    variant("译稿.md", { type: "interview-page-translation", language: "ja" }),
    variant("对照稿.md", { type: "interview-prep-replay", replay_of: `[[${canonical.path}]]` }),
    variant("下一轮.md", { share_slug: "../malformed" }),
    variant("无效换行别名.md", { share_slug: "bad-slug\n" }),
  ];
  assert.deepEqual(shares(notes), [{ kind: INTERVIEW_RECORDS.share, key: slug, value: { prepPath: canonical.path } }]);
  assert.deepEqual(shares([...notes, variant("另一份原稿.md", {}), variant("第三份原稿.md", {})]), []);
});

test("面试短链只读当前版本的明确别名，未同步完成时重试，并且不能指定外站目标", async () => {
  const records = shares([canonical]);
  const reads = [];
  let syncState = "ready";
  class ReadModelError extends Error {
    constructor(message, status, building) { super(message); Object.assign(this, { status, building }); }
  }
  const { GET } = await loadAppModule("app/i/[slug]/route.ts", { stubs: {
    "../../read-model-server": {
      ReadModelError,
      readModelFailure(error) { return Response.json({ error: error.message, building: error.building }, { status: error.status, headers: { "Retry-After": "1" } }); },
      async readModelRuntime() {
        return { revision: "current", syncState, model: { async readRecord(revision, kind, key) {
          reads.push({ revision, kind, key }); return records.find((item) => item.kind === kind && item.key === key)?.value ?? null;
        } } };
      },
    },
  } });
  const get = (desiredSlug, query = "?next=https://example.net") => GET(new Request(`https://example.test/i/test-first-round${query}`), { params: Promise.resolve({ slug: desiredSlug }) });
  const authorized = await get(slug);
  assert.equal(authorized.status, 307);
  assert.equal(authorized.headers.get("Cache-Control"), "private, no-store");
  const location = new URL(authorized.headers.get("Location"), "https://example.test");
  assert.equal(location.origin, "https://example.test");
  assert.equal(location.pathname, "/interview");
  assert.deepEqual([...location.searchParams], [["prep", canonical.path]]);
  assert.deepEqual(reads, [{ revision: "current", kind: INTERVIEW_RECORDS.share, key: slug }]);

  const badSlug = await get("../malformed");
  assert.equal(badSlug.status, 404);
  assert.equal(badSlug.headers.get("Location"), null);
  assert.equal(reads.length, 1);
  const unknown = await get("unknown-round");
  assert.equal(unknown.status, 404);
  assert.equal(unknown.headers.get("Location"), null);
  assert.equal(reads.length, 2);

  syncState = "building";
  const building = await get(slug);
  assert.equal(building.status, 503);
  assert.equal(building.headers.get("Retry-After"), "1");
  assert.equal(building.headers.get("Location"), null);
  assert.equal(reads.length, 2);

  syncState = "ready";
  const questions = await get(slug, "?kitSection=anticipated&prepTab=backup&prep=other.md&next=https://example.net");
  assert.equal(questions.status, 307);
  const questionsLocation = new URL(questions.headers.get("Location"), "https://example.test");
  assert.equal(questionsLocation.pathname, "/interview");
  assert.deepEqual([...questionsLocation.searchParams], [["prep", canonical.path], ["prepTab", "kit"], ["kitSection", "anticipated"]]);

  const unrecognized = await get(slug, "?kitSection=resources");
  assert.equal(unrecognized.headers.get("Location"), authorized.headers.get("Location"));
});
