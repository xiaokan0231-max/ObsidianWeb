import assert from "node:assert/strict";
import test from "node:test";
import { reviewCompanyMatch, reviewCompanyHref, REVIEW_COMPANY_PARAM } from "../lib/review-company.ts";

const note = (path, frontmatter, content = "# 株式会社テスト") => ({ path, frontmatter, content, tags: [], stat: { ctime: 0, mtime: 0, size: content.length } });
const dossier = note("会社/テスト.md", { type: "company", company: "株式会社テスト" });
const job = (path, extra = {}) => note(path, { type: "job-case", company: "株式会社テスト", company_dossier: "[[会社/テスト]]", case_id: "test-case", ...extra });
const source = (extra = {}) => note("面接/整理稿.md", { type: "interview-transcript", company: "株式会社テスト", ...extra });

test("explicit full path selects its exact case even with other jobs at the same company", () => {
  const first = job("案件/第一.md");
  const second = job("案件/第二.md", { case_id: "second" });
  const result = reviewCompanyMatch([dossier, first, second], source({ case: "[[案件/第二]]" }), "テスト");
  assert.equal(result.status, "ready");
  assert.equal(result.context.note.path, second.path);
});

test("broken, plain-text, ambiguous short-path and conflicting explicit links never fall back to the name", () => {
  const notes = [dossier, job("A/案件.md"), job("B/案件.md")];
  for (const extra of [{ case: "[[存在しない]]" }, { case: "A/案件" }, { case: "[[案件]]" }, { case: "[[A/案件]]", meeting: "[[B/案件]]" }]) {
    const result = reviewCompanyMatch(notes, source(extra), "株式会社テスト");
    assert.notEqual(result.status, "ready");
    assert.equal(result.context, null);
  }
});

test("legacy unique company association works across legal name forms, but multiple positions remain ambiguous", () => {
  const first = job("案件/第一.md");
  assert.equal(reviewCompanyMatch([dossier, first], source(), "テスト").status, "ready");
  assert.equal(reviewCompanyMatch([dossier, first, job("案件/第二.md")], source(), "テスト").status, "ambiguous");
  assert.equal(reviewCompanyMatch([dossier, first], source(), "テスト別社").status, "missing");
});

test("stable case id identifies one case; duplicate ids and stale ids cannot silently select a company", () => {
  const first = job("案件/第一.md");
  assert.equal(reviewCompanyMatch([dossier, first], source({ case_id: "test-case" }), "テスト").status, "ready");
  assert.equal(reviewCompanyMatch([dossier, first], source({ case_id: "stale" }), "テスト").status, "invalid");
  assert.equal(reviewCompanyMatch([dossier, first, job("案件/第二.md")], source({ case_id: "test-case" }), "テスト").status, "ambiguous");
});

test("a matched case without research offers no broken analysis target", () => {
  const first = job("案件/第一.md", { company_dossier: "[[未作成]]" });
  assert.deepEqual(reviewCompanyMatch([first], source({ case: "[[案件/第一]]" }), "テスト"), { status: "missing", context: null });
});

test("analysis URLs preserve the exact round, filters, evidence and hash through open and close", () => {
  const original = "/interview/review?review=%E6%95%B4%E7%90%86%E7%A8%BF.md&filter=questions&panel=source&block=q09#s080";
  const opened = reviewCompanyHref(original, "案件/第一.md");
  const url = new URL(opened, "http://localhost:3000");
  assert.equal(url.searchParams.get(REVIEW_COMPANY_PARAM), "案件/第一.md");
  assert.equal(url.searchParams.get("review"), "整理稿.md");
  assert.equal(url.searchParams.get("block"), "q09");
  assert.equal(url.hash, "#s080");
  assert.equal(reviewCompanyHref(opened, null), original);
});

test("modified-click links use the current filters even before URL replace effects notify subscribers", () => {
  const href = reviewCompanyHref("/interview/review?review=整理稿.md&filter=pending&pattern=旧筛选", "案件/第一.md", { filter: "err", pattern: "助詞" });
  const url = new URL(href, "http://localhost");
  assert.equal(url.searchParams.get("filter"), "err");
  assert.equal(url.searchParams.get("pattern"), "助詞");
  const reset = new URL(reviewCompanyHref(href, "案件/第一.md", { filter: "all", pattern: null }), "http://localhost");
  assert.equal(reset.searchParams.has("filter"), false);
  assert.equal(reset.searchParams.has("pattern"), false);
});
