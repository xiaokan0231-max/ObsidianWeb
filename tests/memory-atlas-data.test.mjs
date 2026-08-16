import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCalendarEvents,
  buildDerivedData,
  calendarCompanyIdentity,
  extractLinks,
  careerStatus,
  getLatestNoteDate,
  libraryScopeMatches,
  mergePendingWrites,
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

test("日历：job-case の next_event_at は面接などの語を含まなくても予定になる", () => {
  const events = buildCalendarEvents([
    note("20_求職/Acme/Acme_Data.md", "job-case", {
      company: "Acme",
      next_event_at: "2026-08-10 14:30",
    }, "- 2026-08-10 一次面接の話が出ている"),
  ], NOW);
  // job-inbox-sync が指示する書式は純粋な日時。語を要求すると書いた予定が黙って消える。
  assert.deepEqual(dates(events), ["2026-08-10 14:30"]);
  assert.equal(events[0].phase, "upcoming");
});

test("日历：next_event_at で確定した予定でも種別は next_action から復元する", () => {
  const events = buildCalendarEvents([
    note("20_求職/Acme/Acme_Data.md", "job-case", {
      company: "Acme",
      next_event_at: "2026-08-05 17:30",
      next_action: "一次面接（オンライン・Microsoft Teams）",
    }),
  ], NOW);
  // next_event_at は priority 4 で next_action(3) を上書きするが、書式が純粋な日時なので
  // 種別語を持たない。ラベルまで勝った出所だけで決めると「面谈」へ退化し、
  // 規約どおり構造化したノートほど日历の表示が悪くなる（2026-08-04 実証）。
  assert.deepEqual(dates(events), ["2026-08-05 17:30"]);
  assert.equal(events[0].label, "第一次面试");
});

test("日历：種別が読める出所が勝った時は next_action で上書きしない", () => {
  const events = buildCalendarEvents([
    note("20_求職/Acme/Acme_Data.md", "job-case", {
      company: "Acme",
      next_event_at: "2026-08-06 10:00 最終面接",
      next_action: "一次面接の振り返りをまとめる",
    }),
  ], NOW);
  // next_action は「次にやること」であって予定の種別とは限らない。
  // source 側から読めるなら、そちらが正。
  assert.equal(events[0].label, "最终面试");
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

test("日历：本文の叙述を予定として拾わない（約束していない面談を出さない）", () => {
  // 2026-08-08 実測の誤検出3型。いずれも「予定」ではなく叙述・引用・履歴なのに、
  // 会社名つきで日历に出ていた＝相手と約束していない面談が画面に現れる。
  const events = buildCalendarEvents([
    note("20_求職/Acme/Acme_Data.md", "job-case", { company: "Acme" }, [
      "経緯は [[ワークポート面談対応]] の 2026-08-10 追記に集約した。",
      "| 2026-08-11 | ワークポート面談実施 → 「企業提出可」の整理 |",
      "| 2026-08-12 | GEEKLY | 面談の前に謝絶、企業紹介ゼロ |",
    ].join("\n")),
  ], NOW);
  assert.deepEqual(events, [], "ノート名・表の履歴行・「面談の前に」は予定ではない");
});

test("日历：本文の兜底は生かす（素の面接行は拾う）", () => {
  // 上の絞り込みで、取りこぼし兜底そのものを殺していないことを確認する。
  const events = buildCalendarEvents([
    note("20_求職/Acme/Acme_Data.md", "job-case", { company: "Acme" },
      "- 2026-08-12 一次面接（Teams）"),
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

test("日历：法人格・空白・下線だけが違う会社名は同じ予定として束ねる", () => {
  assert.equal(
    calendarCompanyIdentity("株式会社Sharing Innovations"),
    calendarCompanyIdentity("Sharing_Innovations"),
  );
  const events = buildCalendarEvents([
    note("20_求職/Sharing/2026-08-13_最終面接.md", "review", {
      company: "Sharing_Innovations",
      date: "2026-08-13",
    }),
    note("20_求職/Sharing/Sharing_Data.md", "job-case", {
      company: "株式会社Sharing Innovations",
      next_event_at: "2026-08-13 13:30",
      next_action: "最終面接（対面）",
    }),
  ], NOW);
  assert.equal(events.length, 1);
  assert.equal(events[0].company, "株式会社Sharing Innovations");
  assert.equal(events[0].time, "13:30");
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

test("値の | は OR、空白区切りの token 同士は AND", () => {
  const applied = note("20_求職/A社/_A社.md", "job-case", { status: "応募済" });
  const rejected = note("20_求職/B社/_B社.md", "job-case", { status: "不採用（2026-07-21）" });

  // 「進行中の選考」＝ 7 つの enum のうち 3 つ。OR がないと 1 本のクエリで書けない。
  assert.equal(noteMatches(applied, "status:応募済|書類通過|面接中"), true);
  assert.equal(noteMatches(rejected, "status:応募済|書類通過|面接中"), false);
  assert.equal(noteMatches(rejected, "status:不採用|保留"), true);
  assert.equal(noteMatches(applied, "type:job-case|todo"), true);
  assert.equal(noteMatches(applied, "folder:20_求職|30_日本語学習"), true);

  // token をまたぐと従来どおり AND のまま。
  assert.equal(noteMatches(applied, "type:job-case status:応募済|面接中"), true);
  assert.equal(noteMatches(applied, "type:todo status:応募済|面接中"), false);
});

// 🔴 単条差し替え（patchNote）に変えた後の穴。全量取得は在途中に発行されたものが
// 後から着地し得るので、素直に採用すると書いたばかりの内容が写前の値で黙って消える。
test("在途の全量スナップショットは、まだ追いついていない書き込みを上書きしない", () => {
  const written = note("20_求職/A/A_Data.md", "job-case", { status: "不採用" }, "書いた後の本文");
  const staleSnapshot = [
    note("20_求職/A/A_Data.md", "job-case", { status: "応募済" }, "書く前の本文"),
    note("99_系统/_索引.md", "moc", {}, "索引"),
  ];
  const pending = new Map([[written.path, written]]);

  const { notes, settled } = mergePendingWrites(staleSnapshot, pending);
  const merged = notes.find((item) => item.path === written.path);
  assert.match(merged.content, /書いた後の本文/, "写前スナップショットに潰されない");
  assert.equal(merged.frontmatter.status, "不採用");
  assert.deepEqual(settled, [], "サーバがまだ追いついていないので台帳に残す");
  assert.equal(notes.length, 2, "他のノートはスナップショット側をそのまま使う");
});

test("サーバが追いついたら台帳から落とす（永久に貼り付かない）", () => {
  const written = note("20_求職/A/A_Data.md", "job-case", { status: "不採用" }, "書いた後の本文");
  const freshSnapshot = [note("20_求職/A/A_Data.md", "job-case", { status: "不採用" }, "書いた後の本文")];

  const { settled } = mergePendingWrites(freshSnapshot, new Map([[written.path, written]]));
  assert.deepEqual(settled, [written.path]);
});

test("台帳が空なら受け取った配列をそのまま返す（余計なコピーも並べ替えもしない）", () => {
  const snapshot = [note("a.md", "moc", {}, "a")];
  const { notes, settled } = mergePendingWrites(snapshot, new Map());
  assert.equal(notes, snapshot);
  assert.deepEqual(settled, []);
});

// 🔴 リンクの数え方は「本文からは例示コードを除く・frontmatter の構造化関係は数える」。
// 片方に寄せると首页の孤立統計と知識図譜が割れる（実測：孤点 16 → 22 に膨らんだ）。
test("リンク抽出：frontmatter の構造化関係は数え、コードフェンス内の例示は数えない", () => {
  const content = [
    "---",
    "type: language-expression-course-progress",
    'source_note: "[[AI活用推進_語彙]]"',
    "---",
    "# 進捗",
    "",
    "本文からは [[本物のリンク]] を拾う。",
    "",
    "```markdown",
    "例示なので数えない: [[コード内のリンク]]",
    "```",
    "",
    "`[[行内コードのリンク]]` も数えない。",
    "<!-- [[コメント内のリンク]] も数えない -->",
  ].join("\n");

  const links = extractLinks(content);
  assert.deepEqual(links.sort(), ["AI活用推進_語彙", "本物のリンク"]);
});

test("リンク抽出：frontmatter からしか繋がっていないノートは孤立ではない", () => {
  // 進捗ノート・批注ノートの実際の形。ここを孤立と数えると、図譜では連結して見えるのに
  // 首页の健康度だけが下がる——同じ問いに二つの答えがある状態に戻る。
  const progress = note("30_日本語学習/専門コースログ/x_進捗.md", "language-expression-course-progress");
  const withLink = {
    ...progress,
    content: `---\ntype: language-expression-course-progress\nsource_note: "[[素材ノート]]"\n---\n# 進捗\n`,
  };
  assert.deepEqual(extractLinks(withLink.content), ["素材ノート"]);
});
