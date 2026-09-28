import assert from "node:assert/strict";
import test from "node:test";
import { buildCompanyHero, isJapaneseName, splitCompanyName } from "../lib/company-hero.ts";

const TODAY = "2026-09-26";
const makeNote = (path, frontmatter, content = "# 株式会社テスト — データエンジニア") => ({ path, frontmatter, content, tags: [], stat: { ctime: 0, mtime: 0, size: 0 } });
const context = (note, overrides = {}) => ({ key: `case:${note.path}`, kind: "case", note, company: "株式会社テスト", title: "データエンジニア", caseId: "test", dossier: null, profile: null, assessment: null, profileStatus: "missing", assessmentStatus: "missing", issues: [], ...overrides });
const prep = (date, sessionStatus = "") => ({ note: makeNote(`20_求職/テスト/準備_${date}.md`, {}), company: "株式会社テスト", date, round: "一次面接", sessionStatus, sections: [] });
const byId = (facts, id) => facts.find((fact) => fact.id === id);

test("社名只拆显示层级：法人格前后缀与原文分隔符分开，拼回去逐字等于原社名；只有日文社名才标 lang", () => {
  const joined = (parts) => `${parts.prefix}${parts.prefix ? parts.separator : ""}${parts.core}${parts.suffix ? parts.separator : ""}${parts.suffix}`;
  const cases = [
    ["株式会社テスト", { prefix: "株式会社", separator: "", core: "テスト", suffix: "" }],
    ["株式会社 テスト", { prefix: "株式会社", separator: " ", core: "テスト", suffix: "" }],
    ["テストホールディングス株式会社", { prefix: "", core: "テストホールディングス", separator: "", suffix: "株式会社" }],
    ["テスト 株式会社", { prefix: "", core: "テスト", separator: " ", suffix: "株式会社" }],
    ["Test Co., Ltd.", { prefix: "", core: "Test", separator: " ", suffix: "Co., Ltd." }],
    ["Example, Inc.", { prefix: "", core: "Example", separator: ", ", suffix: "Inc." }],
    ["株式会社", { prefix: "", core: "株式会社", suffix: "", separator: "" }],
    ["テスト", { prefix: "", core: "テスト", suffix: "", separator: "" }],
  ];
  for (const [name, expected] of cases) {
    const parts = splitCompanyName(name);
    assert.deepEqual(parts, expected, name);
    assert.equal(joined(parts), name, `${name}：复制与页内搜索要拿到完整社名`);
  }
  assert.equal(isJapaneseName("株式会社テスト"), true);
  assert.equal(isJapaneseName("Sample Inc."), false);
});

test("案件：状态与色条同源，进度行按 経路・更新・注记 排，条件行四格固定、未取得照实降级，链接组只放正文没有入口的", () => {
  const note = makeNote("20_求職/テスト/データエンジニア.md", {
    type: "job-case", case_id: "test", origin: "scout", company: "株式会社テスト",
    status: "書類通過（2026-09-22・Green／企業がカジュアル面談を打診）", status_updated: "2026-09-22", channel: "Green", source: "Green",
    next_action: "予約URLでカジュアル面談の日時を確定する", salary: "800万円 ～ 1999万円（スカウト通知メールの欄）", employment: "不明（求人原文未取得）", location: "不明（求人原文未取得）", date: "2026-09-23",
    url: "https://example.com/job", waiting_for: "self",
  });
  const hero = buildCompanyHero(context(note, { dossier: makeNote("20_求職/テスト/_テスト.md", { type: "company" }) }), { today: TODAY });
  assert.equal(hero.kind, "case");
  assert.equal(hero.kicker, "案件");
  assert.equal(hero.kickerTitle, "入库 2026-09-23 · Scout", "入库日与起票来历只进悬停，不上屏；起票来历用看板同一套词");
  assert.equal(hero.title, "データエンジニア");
  assert.deepEqual(hero.status, { label: "書類通過", tone: "progress", note: "2026-09-22・Green／企業がカジュアル面談を打診" });
  assert.equal(hero.tone, "progress");
  assert.deepEqual(hero.progress, [
    { id: "channel", label: "経路", value: "Green" },
    { id: "updated", label: "更新", value: "9/22 · 4日前", title: "2026-09-22" },
    { id: "note", label: "", value: "2026-09-22・Green／企業がカジュアル面談を打診", title: "2026-09-22・Green／企業がカジュアル面談を打診" },
  ], "来源与渠道相同就不重复；有更新日就不用入库日兜底");
  assert.deepEqual(hero.facts, [
    { id: "salary", label: "年収", value: "800〜1999万", title: "800万円 ～ 1999万円（スカウト通知メールの欄）", tone: "salary" },
    { id: "location", label: "勤務地", value: "不明", title: "不明（求人原文未取得）", muted: true },
    { id: "employment", label: "雇用形態", value: "不明", title: "不明（求人原文未取得）", muted: true },
    { id: "rating", label: "応募优先度", value: "未採点", muted: true, title: "未採点（求人原文を読んでいない）" },
  ]);
  assert.deepEqual(hero.links, [
    { id: "posting", label: "求人原文", url: "https://example.com/job", badge: "未核对", badgeTone: "quiet" },
    { id: "record", label: "案件记录" },
  ], "没有公式応募页就没有那条；公司卷宗不进头部（01 节头已有）");
  assert.deepEqual(hero.now, { action: "予約URLでカジュアル面談の日時を確定する", waiting: "", followUp: null, event: null, placeholder: "" }, "waiting_for=self 且已有下一步时不再写「待本人行动」");
});

test("案件：応募日只从応募済推出、与更新日同日只出一次；来源≠渠道进 title 不并列；等待与跟进合成此刻行", () => {
  const note = makeNote("20_求職/テスト/SRE.md", {
    type: "job-case", case_id: "sre", origin: "ai-reco", company: "株式会社テスト", position: "SRE",
    status: "応募済（2026-09-20・Green経由）", status_updated: "2026-09-20", channel: "Green", source: "公式採用（HRMOS）",
    rating: 8, salary: "月給 50万〜60万円", location: "東京都・リモート可", stack: ["Python", "Spark"],
    waiting_for: "agent", waiting_label: "書類選考結果", follow_up_at: "2026-10-01", follow_up_action: "反応が無ければ直投を検討する",
    official_apply_url: "https://example.com/careers", official_apply_status: "exact", official_apply_note: "同一求人番号を確認",
  }, "# 株式会社テスト — SRE\n\n## ✅ 原文確認済\n\n読んだ");
  const hero = buildCompanyHero(context(note, { title: "SRE" }), { today: TODAY });
  assert.deepEqual(hero.progress.map((fact) => [fact.id, fact.value, fact.title ?? ""]), [
    ["channel", "Green", "求人票来源：公式採用（HRMOS）"],
    ["applied", "9/20 · 6日経過", "2026-09-20"],
    ["note", "2026-09-20・Green経由", "2026-09-20・Green経由"],
  ]);
  assert.deepEqual(byId(hero.facts, "salary"), { id: "salary", label: "年収", value: "600〜720万（月給換算）", title: "月給 50万〜60万円", tone: "salary" });
  assert.deepEqual(byId(hero.facts, "location"), { id: "location", label: "勤務地", value: "東京都・リモート可" }, "リモート可否は原文が言っている、別枠にしない");
  assert.deepEqual(byId(hero.facts, "employment"), { id: "employment", label: "雇用形態", value: "未記録", muted: true });
  assert.deepEqual(byId(hero.facts, "rating"), { id: "rating", label: "応募优先度", value: "8 / 10", tone: "rate-good" });
  assert.deepEqual(hero.stack, ["Python", "Spark"]);
  assert.deepEqual(hero.links, [
    { id: "posting", label: "原文未取得", muted: true },
    { id: "official", label: "公式応募", url: "https://example.com/careers", title: "同职位官网直投 · 同一求人番号を確認" },
    { id: "record", label: "案件记录" },
  ]);
  assert.deepEqual(hero.now, { action: "", waiting: "等待中介 · 書類選考結果", followUp: { label: "跟进 10/1（5天后） · 反応が無ければ直投を検討する", overdue: false }, event: null, placeholder: "" }, "等待方用看板同一套词");
  const overdue = buildCompanyHero(context(makeNote("o.md", { ...note.frontmatter, follow_up_at: "2026-09-07", follow_up_action: "" }, note.content), { title: "SRE" }), { today: TODAY });
  assert.deepEqual(overdue.now.followUp, { label: "跟进 9/7 · 已过 19 天", overdue: true }, "跟进日已过要标出来，不能混在灰字里");
  const unknownOfficial = buildCompanyHero(context(makeNote("u.md", { ...note.frontmatter, official_apply_status: "" }, note.content), { title: "SRE" }), { today: TODAY });
  assert.deepEqual(byId(unknownOfficial.links, "official"), { id: "official", label: "採用ページ", url: "https://example.com/careers", title: "official_apply_status 未记录 · 同一求人番号を確認" }, "与看板同口径：有 URL 就给链接");
});

test("案件：経路缺失按 job-status 契约分档——未応募・保留退回来源，応募済以降标为必须回填；没写 status 不冒充未応募；入库日归一化", () => {
  const base = { type: "job-case", case_id: "x", origin: "manual", company: "株式会社テスト", salary: "", location: "", employment: "" };
  const unapplied = buildCompanyHero(context(makeNote("a.md", { ...base, status: "未応募", source: "Green（スカウト）", date: "2026-9-5" })), { today: TODAY });
  assert.deepEqual(unapplied.progress, [{ id: "source", label: "来源", value: "Green", title: "Green（スカウト）" }, { id: "intake", label: "入库", value: "9/5", title: "2026-09-05" }], "未补零的入库日先归一化再缩写");
  assert.equal(unapplied.kickerTitle, "入库 2026-09-05 · 本人录入");
  assert.equal(unapplied.now, null, "未応募四段全空：整行不渲染");
  assert.deepEqual(byId(unapplied.facts, "salary"), { id: "salary", label: "年収", value: "未記録", muted: true });
  const held = buildCompanyHero(context(makeNote("h.md", { ...base, status: "保留（2026-09-10・条件面で見送り）", source: "Green", date: "2026-09-01" })), { today: TODAY });
  assert.deepEqual(held.progress[0], { id: "source", label: "来源", value: "Green", title: "Green" }, "保留不要求 channel（同 vault:check），不能染橙催回填");
  assert.equal(held.status.label, "保留");
  const applied = buildCompanyHero(context(makeNote("b.md", { ...base, status: "応募済", source: "Green" })), { today: TODAY });
  assert.deepEqual(applied.progress[0], { id: "channel", label: "経路", value: "未記録", tone: "warn", title: "応募済以降は台帳が経路別に集計するため channel が必要" });
  assert.deepEqual(applied.progress[1], { id: "intake", label: "入库", value: "未記録", muted: true });
  assert.deepEqual(applied.now, { action: "", waiting: "", followUp: null, event: null, placeholder: "未記録" }, "选考进行中却没有下一步，是要补的缺口");
  const rejected = buildCompanyHero(context(makeNote("c.md", { ...base, status: "不採用（2026-09-01・書類選考）", status_updated: "2026-09-01", channel: "Green" })), { today: TODAY });
  assert.equal(rejected.now, null);
  assert.equal(rejected.tone, "reject");
  const blank = buildCompanyHero(context(makeNote("e.md", { ...base, source: "Green" })), { today: TODAY });
  assert.deepEqual(blank.status, { label: "未記録", tone: "neutral", note: "" }, "没写 status 的笔记不能借 toJobCard 的默认值冒充未応募");
  assert.equal(blank.tone, "neutral");
  assert.equal(blank.kickerTitle, "入库 未記録 · 本人录入");
  assert.equal(buildCompanyHero(context(makeNote("n.md", { ...base, origin: "", status: "未応募", date: "2026-09-23" })), { today: TODAY }).kickerTitle, "入库 2026-09-23", "没有 origin 时不留悬空的分隔点");
  // 七态之外的自定义状态：胶囊放主值，括号里的日期・理由进注记（胶囊 14ch 会截断，不能让它们消失）。
  const custom = buildCompanyHero(context(makeNote("x.md", { ...base, status: "選考辞退（2026-09-20・本人都合により辞退）", channel: "Green" })), { today: TODAY });
  assert.deepEqual(custom.status, { label: "選考辞退", tone: "neutral", note: "選考辞退（2026-09-20・本人都合により辞退）" });
  assert.deepEqual(custom.progress.at(-1), { id: "note", label: "", value: "選考辞退（2026-09-20・本人都合により辞退）", title: "選考辞退（2026-09-20・本人都合により辞退）" });
  const salaryText = buildCompanyHero(context(makeNote("d.md", { ...base, status: "未応募", salary: "応相談（経験・能力を考慮）" })), { today: TODAY });
  assert.deepEqual(byId(salaryText.facts, "salary"), { id: "salary", label: "年収", value: "応相談（経験・能力を考慮）", tone: "is-text", title: "応相談（経験・能力を考慮）" }, "解析不出区间的原文照实显示，不猜数字");
});

test("案件：面談优先读正本的将来 next_event_at；过期或缺失时借用已关联准备稿并记下借自谁；什么都没有才标已过・待更新", () => {
  const base = { type: "job-case", case_id: "x", origin: "manual", company: "株式会社テスト", status: "面接中", status_updated: "2026-09-25", channel: "Green" };
  const explicit = buildCompanyHero(context(makeNote("a.md", { ...base, next_event_at: "2026-09-27 13:00" })), { today: TODAY, rounds: [prep("2026-10-05", "scheduled")] });
  assert.deepEqual(explicit.now.event, { label: "明天 13:00", past: false, borrowedFrom: "" });
  assert.equal(explicit.tone, "interview");
  const stale = buildCompanyHero(context(makeNote("b.md", { ...base, next_event_at: "2026-09-10 10:00" })), { today: TODAY });
  assert.deepEqual(stale.now.event, { label: "9/10 10:00 · 已过・待更新", past: true, borrowedFrom: "" });
  const rounds = [prep("2026-09-01", "completed"), prep("2026-10-05", "scheduled")];
  const borrowed = buildCompanyHero(context(makeNote("c.md", base)), { today: TODAY, rounds });
  assert.deepEqual(borrowed.now.event, { label: "10/5", past: false, borrowedFrom: "20_求職/テスト/準備_2026-10-05.md" });
  const staleWithPrep = buildCompanyHero(context(makeNote("d.md", { ...base, next_event_at: "2026-09-10 10:00" })), { today: TODAY, rounds });
  assert.deepEqual(staleWithPrep.now.event, { label: "10/5", past: false, borrowedFrom: "20_求職/テスト/準備_2026-10-05.md" }, "与切换面板同口径：过期的正本日期不压过准备稿的将来日期");
});

test("案件：已终结（不採用・保留）的残留等待・跟进・准备稿日期不再当待办，只保留明确写下的下一步", () => {
  const base = { type: "job-case", case_id: "x", origin: "manual", company: "株式会社テスト", channel: "Green", status_updated: "2026-09-15",
    waiting_for: "company", waiting_label: "結果連絡", follow_up_at: "2026-09-07", next_event_at: "2026-09-10 10:00" };
  const rounds = [prep("2026-10-05", "scheduled")];
  const rejected = buildCompanyHero(context(makeNote("r.md", { ...base, status: "不採用（2026-09-15・一次面接）" })), { today: TODAY, rounds });
  assert.equal(rejected.now, null, "拒信之后没有跟进、没有约定");
  const rejectedWithAction = buildCompanyHero(context(makeNote("s.md", { ...base, status: "不採用（2026-09-15・一次面接）", next_action: "復盤を書く" })), { today: TODAY, rounds });
  assert.deepEqual(rejectedWithAction.now, { action: "復盤を書く", waiting: "", followUp: null, event: null, placeholder: "" });
  const held = buildCompanyHero(context(makeNote("h.md", { ...base, status: "保留" })), { today: TODAY, rounds });
  assert.equal(held.now, null);
});

test("面谈：不走七枚举，胶囊用面谈色、关闭后按 todo 状态换成已完了／已搁置／已中止；日時／期限／类别来自 todo 字段，没有条件行", () => {
  const note = makeNote("20_求職/_TODO/テスト_カジュアル面談.md", { type: "todo", status: "進行中", category: "面接準備", priority: "high", company: "株式会社テスト", next_event_at: "2026-09-26 15:00", due: "2026-09-26", action: "逆質問を3つ用意する", updated: "2026-09-24" }, "# 株式会社テスト カジュアル面談");
  const meeting = (overrides, path = "m.md") => buildCompanyHero(context(makeNote(path, { ...note.frontmatter, ...overrides }, note.content), { kind: "meeting", key: `meeting:${path}`, title: "カジュアル面談" }), { today: TODAY });
  const hero = meeting({});
  assert.equal(hero.kicker, "面谈");
  assert.deepEqual(hero.status, { label: "面谈", tone: "meeting", note: "進行中" });
  assert.equal(hero.tone, "meeting");
  assert.deepEqual(hero.progress, [
    { id: "next", label: "日時", value: "今天 15:00", title: "2026-09-26 15:00" },
    { id: "due", label: "期限", value: "9/26", title: "2026-09-26" },
    { id: "category", label: "", value: "面接準備" },
    { id: "priority", label: "優先度", value: "high" },
  ]);
  assert.deepEqual(hero.facts, [], "面谈天生没有年収・経路・评分，不是空态");
  assert.deepEqual(hero.links, [{ id: "record", label: "面谈记录" }]);
  assert.deepEqual(hero.now, { action: "逆質問を3つ用意する", waiting: "", followUp: null, event: null, placeholder: "" });
  const done = meeting({ status: "完了", next_event_at: "2026-09-20 15:00" });
  assert.deepEqual(done.status, { label: "已完了", tone: "neutral", note: "完了" });
  assert.equal(done.progress[0].value, "9/20 15:00 · 已过");
  assert.equal(done.now, null, "已完了的面谈没有下一步");
  // todo 的「保留」与案件 7 枚举同字：关闭后的胶囊不能把它原样上屏。
  const shelved = meeting({ status: "保留", next_event_at: "", due: "2026-09-20" });
  assert.deepEqual(shelved.status, { label: "已搁置", tone: "neutral", note: "保留" });
  assert.equal(shelved.now, null, "搁置的准备任务不催期限");
  // 只有 due（准备任务期限）过了、状态仍开着：面谈还没结束，要标期限逾期，不能灰掉藏起来。
  const overdueTask = meeting({ status: "進行中", next_event_at: "", due: "2026-09-20" });
  assert.deepEqual(overdueTask.status, { label: "面谈", tone: "meeting", note: "進行中" });
  assert.equal(overdueTask.tone, "meeting");
  assert.deepEqual(overdueTask.progress.find((fact) => fact.id === "due"), { id: "due", label: "期限", value: "9/20", title: "2026-09-20", tone: "warn" });
  assert.deepEqual(overdueTask.now, { action: "逆質問を3つ用意する", waiting: "", followUp: { label: "期限已过 6 天", overdue: true }, event: null, placeholder: "" });
  assert.deepEqual(meeting({ status: "中止", next_event_at: "2026-09-20 15:00" }).status, { label: "已中止", tone: "neutral", note: "中止" });
  assert.deepEqual(meeting({ status: "進行中", next_event_at: "2026-09-20 15:00", due: "" }).status, { label: "已结束", tone: "neutral", note: "進行中" }, "日期过了但状态没更新：只说结束，不编状态");
  // 面谈日在未来、准备期限已过：面谈还开着，期限逾期要在此刻行标橙。
  const late = meeting({ next_event_at: "2026-09-28 15:00", due: "2026-09-20", action: "" });
  assert.deepEqual(late.progress[0], { id: "next", label: "日時", value: "9/28 15:00", title: "2026-09-28 15:00" });
  assert.deepEqual(late.now, { action: "", waiting: "", followUp: { label: "期限已过 6 天", overdue: true }, event: null, placeholder: "" });
  // 什么日期都没有的面谈：日時未定，下一步未記録（还开着，所以不能整行藏掉）。
  const undated = meeting({ next_event_at: "", due: "", action: "" });
  assert.deepEqual(undated.progress[0], { id: "next", label: "日時", value: "未定", muted: true });
  assert.deepEqual(undated.now, { action: "", waiting: "", followUp: null, event: null, placeholder: "未記録" });
  // 正本没写面谈时刻、但已关联准备稿有将来日期：与切换面板同口径借来，并写明借自谁。
  const borrowedNote = makeNote("b.md", { ...note.frontmatter, next_event_at: "", due: "" }, note.content);
  const borrowed = buildCompanyHero(context(borrowedNote, { kind: "meeting", key: "meeting:b.md", title: "カジュアル面談" }), { today: TODAY, rounds: [prep("2026-10-05", "scheduled")] });
  assert.deepEqual(borrowed.progress[0], { id: "next", label: "日時", value: "10/5", title: "借自准备稿 20_求職/テスト/準備_2026-10-05.md" });
  for (const status of ["未応募", "応募済", "書類通過", "面接中", "内定", "保留", "不採用"]) {
    for (const item of [hero, done, shelved, undated]) assert.notEqual(item.status.label, status, `面谈胶囊不得出现案件状态词 ${status}`);
  }
});

test("面谈：todo 自己没写日時时借同 case_id 案件的 next_event_at，并注明借自谁；案件的日期过了也如实标已过", () => {
  const todo = makeNote("20_求職/_TODO/テスト_面談準備.md", { type: "todo", status: "進行中", category: "面接準備", company: "株式会社テスト", case_id: "test", action: "質問を用意する" }, "# 株式会社テスト 面談準備");
  const linkedCase = makeNote("20_求職/テスト/データエンジニア.md", { type: "job-case", case_id: "test", company: "株式会社テスト", status: "面接中", next_event_at: "2026-09-29 10:00" });
  const meetingContext = context(todo, { kind: "meeting", key: `meeting:${todo.path}`, title: "面談準備" });
  const borrowed = buildCompanyHero(meetingContext, { today: TODAY, linkedCase });
  assert.deepEqual(borrowed.progress[0], { id: "next", label: "日時", value: "9/29 10:00", title: "借自案件 20_求職/テスト/データエンジニア.md" });
  assert.equal(borrowed.status.label, "面谈");
  const own = buildCompanyHero(context(makeNote("o.md", { ...todo.frontmatter, next_event_at: "2026-09-30 15:00" }, todo.content), { kind: "meeting", title: "面談準備" }), { today: TODAY, linkedCase });
  assert.deepEqual(own.progress[0], { id: "next", label: "日時", value: "9/30 15:00", title: "2026-09-30 15:00" }, "自己写了就用自己的，不借");
  const stale = buildCompanyHero(meetingContext, { today: TODAY, linkedCase: makeNote("c.md", { ...linkedCase.frontmatter, next_event_at: "2026-09-10 10:00" }) });
  assert.deepEqual(stale.progress[0], { id: "next", label: "日時", value: "9/10 10:00 · 已过", title: "借自案件 c.md", muted: true });
  assert.deepEqual(buildCompanyHero(meetingContext, { today: TODAY }).progress[0], { id: "next", label: "日時", value: "未定", muted: true }, "没有案件可借才是未定");
});
