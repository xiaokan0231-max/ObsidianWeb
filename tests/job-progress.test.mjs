import assert from "node:assert/strict";
import test from "node:test";
import {
  explicitNextEventDate,
  explicitNextEventTime,
} from "../lib/job-progress.ts";

function note(frontmatter) {
  return {
    path: "case.md",
    stat: { ctime: 0, mtime: 0, size: 0 },
    tags: [],
    frontmatter,
    content: "# Case\n",
  };
}

test("progress schedule only trusts next_event_at", () => {
  const waiting = note({
    status: "面接中（2026-07-29 更新）",
    status_updated: "2026-07-29",
    next_action: "2026-07-29 に候補日を返信済み。企業の指定待ち。",
  });

  assert.equal(explicitNextEventDate(waiting), "");
  assert.equal(explicitNextEventTime(waiting), "");
});

test("progress schedule reads an explicit date and time", () => {
  const scheduled = note({
    next_event_at: "2026-08-04 14:30",
    status_updated: "2026-07-29",
  });

  assert.equal(explicitNextEventDate(scheduled), "2026-08-04");
  assert.equal(explicitNextEventTime(scheduled), "14:30");
});
