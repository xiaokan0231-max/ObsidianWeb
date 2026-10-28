import assert from "node:assert/strict";
import test from "node:test";
import { selectionNoticesForSession } from "../lib/selection-notice.ts";
import { noteInVaultScope } from "../lib/vault-scope.ts";

const root = "20_求職/株式会社テスト";
const note = (path, frontmatter, content = "") => ({ path, frontmatter, content, tags: [], stat: { ctime: 0, mtime: 0, size: content.length } });
const job = (id) => note(`${root}/${id}.md`, { type: "job-case", company: "株式会社テスト", case_id: id, status: "不採用" });
const session = (extra = {}) => note(`${root}/面接_整理稿.md`, { type: "transcript-study", company: "株式会社テスト", date: "2026-09-20", round: "一次面接", case_id: "role-a", ...extra });
const original = "慎重に検討いたしました結果、\n今回は採用を見送らせていただくこととなりました。";
const wrap = (text) => `# 選考通知\n<!-- selection-notice:original -->\n${text}\n<!-- /selection-notice:original -->\n本文外のメモ`;
const notice = (id, extra = {}, content = wrap(original)) => note(`${root}/${id}.md`, {
  type: "selection-notice", company: "株式会社テスト", date: "2026-09-22", time: "14:03", stage: "一次面接後", outcome: "rejected", channel: "求人サービス",
  source_verified: true, reason_status: "not-stated", capture: "full", case_id: "role-a", ...extra,
}, content);

test("明确案件关联的已核对通知保留原文、元数据与稳定 ID，不把外围笔记当作通知", () => {
  const current = session();
  const captured = notice("result", { source_url: "https://example.com/message/1" });
  const notes = [job("role-a"), current, captured];
  const projected = selectionNoticesForSession(current, notes);
  assert.equal(projected.length, 1);
  assert.deepEqual(projected[0], {
    id: projected[0].id, date: "2026-09-22", time: "14:03", stage: "一次面接後", outcome: "rejected", channel: "求人サービス",
    sourceUrl: "https://example.com/message/1", sourcePath: captured.path, reasonStatus: "not-stated", capture: "full", original,
  });
  assert.match(projected[0].id, /^selection-notice-[a-z0-9]+$/);
  assert.deepEqual(selectionNoticesForSession(current, [...notes].reverse()), projected);
  assert.equal(noteInVaultScope(captured, "interview"), true);
  assert.equal(noteInVaultScope(notice("link-only", { case_id: "", case: "[[role-a]]" }), "jobs"), true);
});

test("同公司另一岗位、断链、冲突与没有明确关联的通知均不挂入本场", () => {
  const current = session();
  const notes = [job("role-a"), job("role-b"), current,
    notice("different", { case_id: "role-b" }),
    notice("unlinked", { case_id: "" }),
    notice("broken", { case_id: "", case: "[[missing]]" }),
    notice("conflicting", { case: "[[role-b]]" }),
    notice("two-owners", { case: "[[role-a]]", meeting: "[[meeting]]" }),
  ];
  assert.deepEqual(selectionNoticesForSession(current, notes), []);
  assert.deepEqual(selectionNoticesForSession(session({ case_id: "" }), notes), []);
});

test("旧整理稿可通过唯一当轮准备稿关联，通知本身不可通过公司和日期猜关联", () => {
  const current = session({ case_id: "" });
  const prep = note(`${root}/面接準備.md`, { type: "interview-prep", company: "株式会社テスト", date: "2026-09-20", round: "一次面接", case_id: "role-a" });
  const notes = [job("role-a"), current, prep, notice("linked"), notice("unlinked", { case_id: "" })];
  assert.deepEqual(selectionNoticesForSession(current, notes).map(item => item.sourcePath), [`${root}/linked.md`]);
});

test("独立面谈通知只读取明确 meeting 归属，同名公司不跨面谈", () => {
  const meeting = note("20_求職/_TODO/面談.md", { type: "todo", company: "株式会社テスト", selection_status: "closed" });
  const other = note("20_求職/_TODO/別面談.md", { type: "todo", company: "株式会社テスト", selection_status: "closed" });
  const current = session({ case_id: "", meeting: "[[面談]]" });
  const notes = [meeting, other, current, notice("linked", { case_id: "", meeting: "[[面談]]" }), notice("other", { case_id: "", meeting: "[[別面談]]" })];
  assert.deepEqual(selectionNoticesForSession(current, notes).map(item => item.sourcePath), [`${root}/linked.md`]);
});

test("案件与面谈正本自身也能读取通知，不用发现日过滤书类落选原文", () => {
  const owner = { ...job("role-a"), frontmatter: { ...job("role-a").frontmatter, date: "2026-10-01" } };
  const meeting = note("20_求職/_TODO/面談.md", { type: "todo", company: "株式会社テスト", date: "2026-10-01" });
  const captured = notice("documents", { stage: "書類選考" });
  const meetingNotice = notice("meeting", { case_id: "", meeting: "[[面談]]" });
  const notes = [owner, meeting, captured, meetingNotice];
  assert.deepEqual(selectionNoticesForSession(owner, notes).map(item => item.sourcePath), [captured.path]);
  assert.deepEqual(selectionNoticesForSession(meeting, notes).map(item => item.sourcePath), [meetingNotice.path]);
});

test("日期和已知时刻早于本场的通知不显示，后轮及不同时刻的通知保留并按新到旧排列", () => {
  const current = session({ time: "10:00" });
  const notes = [job("role-a"), current, notice("before", { date: "2026-09-19" }), notice("early", { date: "2026-09-20", time: "09:30" }),
    notice("same-day", { date: "2026-09-20", time: "12:00" }), notice("late-a", { stage: "最終面接後", time: "14:00" }), notice("late-b", { stage: "最終面接後", time: "15:00" })];
  const projected = selectionNoticesForSession(current, notes);
  assert.deepEqual(projected.map(item => [item.date, item.time, item.stage]), [["2026-09-22", "15:00", "最終面接後"], ["2026-09-22", "14:00", "最終面接後"], ["2026-09-20", "12:00", "一次面接後"]]);
  assert.deepEqual(selectionNoticesForSession(session({ date: "" }), notes), []);
});

test("未核对、缺正文、重复标记、无效日期或覆盖范围不显示为原文", () => {
  const current = session();
  const invalid = [notice("unverified", { source_verified: false }), notice("string-verified", { source_verified: "true" }), notice("missing", {}, "只有状态摘要"),
    notice("empty", {}, wrap(" \n")), notice("duplicate", {}, `${wrap(original)}\n${wrap(original)}`), notice("open", {}, "<!-- selection-notice:original -->没有结束"),
    notice("invalid-date", { date: "2026-02-30" }), notice("invalid-outcome", { outcome: "不採用" }), notice("unknown-coverage", { capture: "" }),
    { ...notice("archive"), path: "90_归档/notice.md" }];
  assert.deepEqual(selectionNoticesForSession(current, [job("role-a"), current, ...invalid]), []);
});

test("片段保留空行和空白，原因缺失为未知，不从套话推断真实原因，非法链接不生成入口", () => {
  const current = session();
  const text = "  お世話になっております。\n\n誠に恐縮ですが、今回は見送ります。  ";
  const captured = notice("excerpt", { capture: "excerpt", reason_status: "", source_url: "javascript:alert(1)" }, wrap(text));
  const [projected] = selectionNoticesForSession(current, [job("role-a"), current, captured]);
  assert.equal(projected.original, text);
  assert.equal(projected.reasonStatus, "unknown");
  assert.equal(projected.capture, "excerpt");
  assert.equal(projected.sourceUrl, undefined);
});
