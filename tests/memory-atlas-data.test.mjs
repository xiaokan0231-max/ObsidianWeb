import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCalendarEvents,
  buildDerivedData,
  careerStatus,
  getLatestNoteDate,
  libraryScopeMatches,
  noteMatches,
  trustLayer,
  typeLabel,
} from "../lib/memory-atlas-data.ts";

const MTIME = Date.parse("2026-07-01T00:00:00Z");
const NOW = new Date("2026-08-03T00:00:00+09:00");

function note(path, type, frontmatter = {}, body = "", mtime = MTIME) {
  const name = path.split("/").pop().replace(/\.md$/u, "");
  return {
    path,
    stat: { ctime: 0, mtime, size: body.length },
    tags: [],
    frontmatter: { type, ...frontmatter },
    content: `---\ntype: ${type}\n---\n# ${name}\n\n${body}\n`,
  };
}

const dates = (events) => events.map((event) => `${event.date} ${event.time}`.trim());

test("日历：todo の next_event_at は単一案件に紐づかない予定の正本", () => {
  const events = buildCalendarEvents([
    note("20_求職/_TODO/ワークポート面談.md", "todo", {
      company: "ワークポート",
      next_event_at: "2026-08-10 14:30",
    }),
    note("20_求職/_TODO/完了した面談.md", "todo", {
      company: "旧エージェント",
      status: "完了",
      next_event_at: "2026-08-11 10:00",
    }),
  ], NOW);
  // 2026-07-24 ワークポート面談が job-case 側に無く日历から漏れた実証への回帰テスト。
  assert.deepEqual(dates(events), ["2026-08-10 14:30"]);
  assert.equal(events[0].company, "ワークポート");
  assert.equal(events[0].phase, "upcoming");
});

test("日历：本文は面接行だけ拾い、お礼・通知・準備の行は予定にしない", () => {
  const events = buildCalendarEvents([
    note("20_求職/Acme/Acme_Data.md", "job-case", { company: "Acme" }, [
      "- 2026-08-12 一次面接（Teams）",
      "- 2026-08-20 面接のお礼メールを送る",
      "- 2026-08-25 二次面接の準備をする",
    ].join("\n")),
  ], NOW);
  assert.deepEqual(dates(events), ["2026-08-12"]);
  assert.equal(events[0].label, "第一次面试");
});

test("日历：同じ会社・同じ日は信頼度が高い出所だけを残す", () => {
  const events = buildCalendarEvents([
    note("20_求職/Acme/2026-07-20_一次面接.md", "review", {
      company: "Acme",
      date: "2026-07-20",
    }),
    note("20_求職/Acme/Acme_Data.md", "job-case", { company: "Acme" }, "- 2026-07-20 一次面接あり"),
  ], NOW);
  assert.equal(events.length, 1, "同じ面接が証拠と案件で二重表示されてはいけない");
  assert.match(events[0].note.path, /2026-07-20_一次面接\.md$/u);
  assert.equal(events[0].phase, "past");
});

test("首页の派生数字：孤立・案件順・証拠の完全度", () => {
  const derived = buildDerivedData([
    note("99_系统/_索引.md", "moc"),
    note("99_系统/誰からも引かれない.md", "material"),
    note("99_系统/引かれる側.md", "material"),
    note("10_关于我/自己.md", "self", {}, "[[引かれる側]] を見る。"),
    note("20_求職/Acme/Acme_Data.md", "job-case", { status_updated: "2026-07-20" }),
    note("20_求職/Beta/Beta_Data.md", "job-case", { status_updated: "2026-07-25" }),
    note("20_求職/Acme/_Acme.md", "company", { company: "Acme" }),
    note("20_求職/Acme/2026-07-20_面接.md", "review", {
      company: "Acme",
      date: "2026-07-20",
      result: "通過",
    }),
    note("20_求職/Acme/逐字稿.md", "transcript", { company: "Acme", date: "2026-07-20" }),
    note("99_系统/模板/review.md", "review", { company: "見本" }),
  ], NOW);

  // 孤立＝出リンクが無く、名前でも引かれていないノート。moc（目次）は数えない。
  // この fixture で外れるのは _索引(moc)・自己(出リンクあり)・引かれる側(被リンク) の3本だけ。
  assert.equal(derived.orphanCount, 7);
  assert.deepEqual(derived.cases.map((item) => item.path.split("/").pop()), ["Beta_Data.md", "Acme_Data.md"]);
  assert.equal(derived.reviews.length, 1, "模板は証拠に数えない");
  assert.equal(derived.evidenceCount, 3);
  // 逐字稿だけ reviewed が無いので 2/3。
  assert.equal(Math.round(derived.evidenceCompleteness), 67);
  assert.equal(derived.links, 1);
});

test("图书馆の絞り込みは type と分区の両方から決まる", () => {
  const analysis = note("80_AI分析/観点.md", "ai-report");
  const todo = note("20_求職/_TODO/返信.md", "todo");
  const study = note("30_日本語学習/誤用辞典.md", "study");
  const self = note("10_关于我/自己.md", "self");

  assert.equal(libraryScopeMatches(self, "evidence"), true);
  assert.equal(libraryScopeMatches(analysis, "evidence"), false);
  assert.equal(libraryScopeMatches(todo, "action"), true);
  assert.equal(libraryScopeMatches(study, "language"), true);
  assert.equal(libraryScopeMatches(analysis, "analysis"), true);
  assert.equal(libraryScopeMatches(todo, "analysis"), false);
  assert.equal(libraryScopeMatches(todo, "all"), true);
});

test("信頼層と応募状態のラベル付け", () => {
  assert.equal(trustLayer(note("10_关于我/自己.md", "self")).className, "trust-authority");
  assert.equal(trustLayer(note("20_求職/Acme/Acme_Data.md", "job-case")).className, "trust-evidence");
  assert.equal(trustLayer(note("80_AI分析/観点.md", "ai-report")).className, "trust-analysis");
  assert.equal(trustLayer(note("99_系统/索引.md", "moc")).className, "trust-reference");

  assert.equal(careerStatus("面接中").tone, "active");
  assert.equal(careerStatus("不採用（2026-07-21・書類選考）").tone, "rejected");
  assert.equal(careerStatus("").label, "未分類");
  assert.equal(typeLabel("job-case"), "应募案件");
  assert.equal(typeLabel("未知の型"), "未知の型");
});

test("最終更新日は frontmatter と本文の日付から一番新しいものを取る", () => {
  assert.equal(
    getLatestNoteDate(note("20_求職/記録.md", "material", { updated: "2026-07-01" }, "2026-07-15 に進展。")),
    "2026-07-15",
  );
  assert.equal(
    getLatestNoteDate(note("20_求職/日付なし.md", "material", {}, "日付は書いていない。")),
    new Date(MTIME).toISOString().slice(0, 10),
  );
});

test("検索の type: / status: / folder: 前置詞", () => {
  const todo = note("20_求職/_TODO/返信.md", "todo", { status: "未着手" });
  assert.equal(noteMatches(todo, "type:todo"), true);
  assert.equal(noteMatches(todo, "type:review"), false);
  assert.equal(noteMatches(todo, "status:未着手"), true);
  assert.equal(noteMatches(todo, "folder:_TODO"), true);
  assert.equal(noteMatches(todo, "folder:30_"), false);
  assert.equal(noteMatches(todo, "返信"), true);
  assert.equal(noteMatches(todo, ""), true);
});
