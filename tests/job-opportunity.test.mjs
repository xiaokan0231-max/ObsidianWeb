import assert from "node:assert/strict";
import test from "node:test";
import { opportunityAppliedOn } from "../lib/job-opportunity.ts";

test("an unapplied posting never inherits another posting's ledger date", () => {
  assert.equal(
    opportunityAppliedOn("未応募", "", "2026-07-20"),
    "",
  );
});

test("an applied posting prefers the durable ledger date", () => {
  assert.equal(
    opportunityAppliedOn("応募済", "2026-07-23", "2026-07-20"),
    "2026-07-20",
  );
});

