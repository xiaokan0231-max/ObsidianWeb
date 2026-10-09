import assert from "node:assert/strict";
import test from "node:test";
import { loadAppModule } from "./helpers/render-tsx.mjs";

// 岗位机会的 URL 读写拆进 app/jobs-url-state.ts 后，两边成对放在一处：
// 写出去的参数必须原样读得回来，否则刷新或前进后退时筛选会悄悄变。
const location = { search: "", pathname: "/jobs" };
const { readJobsUrlState, jobsUrlParams, DEFAULT_OPPORTUNITY_FILTERS } = await loadAppModule("app/jobs-url-state.ts", {
  globals: { window: { location } },
});
const read = (search) => {
  location.search = search;
  return readJobsUrlState();
};

test("没有参数时是默认机会视图，写回也不留任何参数", () => {
  const state = read("");
  assert.deepEqual(state.filters, DEFAULT_OPPORTUNITY_FILTERS);
  assert.equal(state.viewMode, "decision");
  assert.equal(state.sort, "rating");
  assert.equal(jobsUrlParams(state).toString(), "");
});

test("写出的参数读回来是同一个状态", () => {
  const searches = [
    "?q=python&status=all&mode=card",
    "?status=%E6%9C%AA%E5%BF%9C%E5%8B%9F&touch=untouched,awaiting&intake=today&salary=700&remote=1",
    "?status=all&gate=hold,none&band=B&access=direct&sort=fit&mode=kanban",
    "?status=all&waiting=1&mode=weekly&week=-2&case=20_%E6%B1%82%E8%81%B7%2Fx.md",
  ];
  for (const search of searches) {
    const state = read(search);
    const again = read(`?${jobsUrlParams(state).toString()}`);
    assert.deepEqual(again, state, search);
  }
});

test("取值域以外的值读的时候就丢掉", () => {
  const state = read("?gate=pass,bogus&band=Z&mode=nope&week=99&salary=650&sort=x");
  assert.deepEqual(state.filters.gates, ["pass"]);
  assert.deepEqual(state.filters.bands, []);
  assert.equal(state.filters.minSalary, 0);
  assert.equal(state.viewMode, "decision");
  assert.equal(state.weekOffset, 0);
  assert.equal(state.sort, "rating");
});

test("周偏移只在周复盘视图里写进 URL", () => {
  assert.equal(jobsUrlParams({ ...read("?mode=card"), weekOffset: 3 }).get("week"), null);
  assert.equal(jobsUrlParams({ ...read("?mode=weekly"), weekOffset: 3 }).get("week"), "3");
});
