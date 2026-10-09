import assert from "node:assert/strict";
import test from "node:test";
import { patchFrontmatterScalars } from "../lib/server/frontmatter-patch.ts";

test("whitelist patch changes only requested frontmatter scalars", () => {
  const before = `---\ntype: todo\nstatus: 未着手\npriority: high\n---\n# 本文\n\n- [ ] 原样保留\n`;
  const after = patchFrontmatterScalars(before, { status: "進行中" });
  assert.equal(after, `---\ntype: todo\nstatus: 進行中\npriority: high\n---\n# 本文\n\n- [ ] 原样保留\n`);
});

test("whitelist patch can add and remove fields without touching the body", () => {
  const before = `---\ntype: job-case\nwaiting_for: company\nfollow_up_at: 2026-08-20\n---\n# 株式会社テスト\n本文: のコロンも維持\n`;
  const after = patchFrontmatterScalars(before, {
    waiting_for: null,
    follow_up_at: null,
    next_event_at: "2026-08-22 14:00",
  });
  assert.equal(after, `---\ntype: job-case\nnext_event_at: 2026-08-22 14:00\n---\n# 株式会社テスト\n本文: のコロンも維持\n`);
});

test("whitelist patch preserves CRLF notes", () => {
  const before = "---\r\ntype: job-case\r\nstatus: 未応募\r\n---\r\n# 株式会社テスト\r\n本文\r\n";
  const after = patchFrontmatterScalars(before, {
    status: "応募済",
    status_updated: "2026-08-22",
  });
  assert.equal(
    after,
    "---\r\ntype: job-case\r\nstatus: 応募済\r\nstatus_updated: 2026-08-22\r\n---\r\n# 株式会社テスト\r\n本文\r\n",
  );
});

test("whitelist patch refuses duplicate scalar keys", () => {
  const before = `---\ntype: job-case\nstatus: 未応募\nstatus: 応募済\n---\n# 株式会社テスト\n`;
  assert.throws(
    () => patchFrontmatterScalars(before, { status: "保留" }),
    /frontmatter 中存在重复字段：status/,
  );
});
