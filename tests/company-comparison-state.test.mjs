import assert from "node:assert/strict";
import test from "node:test";
import { buildCompanyOverviews } from "../lib/company-overview.ts";
import { resolveCompanyComparisonSelection, updateCompanyComparisonSearch } from "../app/company-comparison-state.ts";

const today = "2026-10-25";
const note = (path, frontmatter) => ({ path, frontmatter, content: "", tags: [], stat: { ctime: 0, mtime: 0, size: 0 } });
function fixture(key, { future = "", past = "", score = null, profile = true, path = `20_求職/${key}/案件.md` } = {}) {
  const company = `株式会社テスト${key}`;
  const dossier = note(`20_求職/${key}/_会社.md`, { type: "company", company,
    ...(profile ? { company_profile: { version: 1, updated_on: today, facts: [], reviews: score == null ? [] : [{
      platform: "OpenWork", status: "available", score, scale: 5, sample_count: 12, sample_unit: "名回答者",
      read_on: today, url: "https://example.com/reviews", coverage: "全社", comment_period: "2026年", limitations: "個別体験", positive: [], negative: [],
    }] } } : {}) });
  const owner = note(path, { type: "job-case", company, case_id: `test-${key}`, position: `数据工程${key}`,
    status: "面接中", company_dossier: `[[20_求職/${key}/_会社]]`,
    ...(future ? { next_event_at: future, next_event_label: "一次面接" } : {}) });
  const prep = past ? note(`20_求職/${key}/準備.md`, { type: "interview-prep", company, date: past,
    session_status: "completed", case: `[[${path.replace(/\.md$/, "")}]]`, round: "一次面接", time: "13:00" }) : null;
  return { path, notes: [dossier, owner, ...(prep ? [prep] : [])] };
}
function setup(...items) {
  const notes = items.flatMap((item) => item.notes);
  const contexts = buildCompanyOverviews(notes);
  return (search = "") => resolveCompanyComparisonSelection(contexts, notes, today, search);
}

test("显式路径保留顺序并过滤非法、重复和多余项，不用显示名合并岗位", () => {
  const items = Array.from({ length: 10 }, (_, index) => fixture(`case${index}`));
  const params = new URLSearchParams();
  params.append("compare", "不存在.md");
  params.append("compare", items[1].path);
  params.append("compare", items[1].path);
  for (const item of items) params.append("compare", item.path);
  assert.deepEqual(setup(...items)(params.toString()), [items[1].path, items[0].path, ...items.slice(2, 8).map((item) => item.path)]);
});

test("从准备页只带一家就只选一家，空选择和失效链接不套用默认组", () => {
  const first = fixture("a", { future: "2026-10-28 13:00" });
  const second = fixture("b", { future: "2026-10-29 13:00" });
  const resolve = setup(first, second);
  assert.deepEqual(resolve(new URLSearchParams({ compare: first.path }).toString()), [first.path]);
  assert.deepEqual(resolve("?compare="), []);
  assert.deepEqual(resolve("?compare=&compare=不存在.md"), []);
  assert.equal(resolve("").length, 2);
});

test("没有显式选择时优先已确认的未来日程，最多快捷选四家", () => {
  const future = Array.from({ length: 5 }, (_, index) => fixture(`future${index}`, { future: `2026-10-${String(27 + index).padStart(2, "0")} 13:00` }));
  const recent = fixture("recent", { past: "2026-10-23", score: 4.9 });
  assert.deepEqual(setup(recent, ...[...future].reverse())(), future.slice(0, 4).map((item) => item.path));
});

test("未来不足两家时按最近面谈选组，研究更新日期不充当面谈日", () => {
  const future = fixture("future", { future: "2026-10-28 13:00" });
  const old = fixture("old", { past: "2026-10-20" });
  const recent = fixture("recent", { past: "2026-10-23" });
  const researched = fixture("researched", { score: 4.8 });
  assert.deepEqual(setup(future, old, researched, recent)(), [recent.path, old.path]);
});

test("没有足够日程时按OpenWork原分选组，仍不足则只用相关资料前两项", () => {
  const high = fixture("high", { score: 4.6 });
  const low = fixture("low", { score: 3.1 });
  const info = fixture("info");
  const empty = fixture("empty", { profile: false });
  assert.deepEqual(setup(low, info, high, empty)(), [high.path, low.path]);
  assert.deepEqual(setup(info, empty)(), [info.path]);
  assert.deepEqual(setup(empty)(), []);
});

test("链接写回保留抽屉等其他参数和特殊路径，清空后仍能刷新恢复为空", () => {
  const special = fixture("special", { path: "20_求職/テスト Ａ＆Ｂ/案件 #1 + 100%?.md" });
  const other = fixture("other");
  const params = updateCompanyComparisonSearch("?note=原笔记.md&section=范围&compare=旧选择.md&filter=recent", [special.path, "", special.path, other.path]);
  assert.deepEqual(params.getAll("compare"), [special.path, other.path]);
  assert.equal(params.get("note"), "原笔记.md");
  assert.equal(params.get("section"), "范围");
  assert.equal(params.get("filter"), "recent");
  assert.deepEqual(setup(special, other)(`?${params}`), [special.path, other.path]);
  const cleared = updateCompanyComparisonSearch(params.toString(), []);
  assert.equal(cleared.has("compare"), true);
  assert.deepEqual(cleared.getAll("compare"), [""]);
  assert.deepEqual(setup(special, other)(cleared.toString()), []);
});

test("写回上限为八个不重复路径，不修改调用方数组", () => {
  const paths = Array.from({ length: 10 }, (_, index) => `20_求職/テスト${index}/案件.md`);
  const original = [...paths];
  assert.deepEqual(updateCompanyComparisonSearch("", paths).getAll("compare"), paths.slice(0, 8));
  assert.deepEqual(paths, original);
});
