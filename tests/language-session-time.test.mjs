import assert from "node:assert/strict";
import test from "node:test";
import { activeSessionMinutes } from "../lib/language/session-time.ts";

test("training time starts when the workspace opens, not when the batch was created", () => {
  const openedAt = Date.parse("2026-07-30T01:00:00Z");
  assert.equal(
    activeSessionMinutes(openedAt, Date.parse("2026-07-30T01:04:59Z")),
    4,
  );
});

test("training time cannot become negative when clocks move backwards", () => {
  assert.equal(activeSessionMinutes(10_000, 9_000), 0);
});

