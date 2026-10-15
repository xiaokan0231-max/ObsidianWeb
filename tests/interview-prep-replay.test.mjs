import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { findInterviewPrepDocs, findInterviewPrepReplay, parseInterviewPrepDoc } from "../lib/interview-prep-doc.ts";
import { noteInVaultScope } from "../lib/vault-scope.ts";
import { resolveCalendarInterview } from "../lib/calendar-interview.ts";
import { buildCalendarEvents } from "../lib/memory-atlas-data.ts";
import { resolveInterviewOutcomes } from "../lib/interview-outcome.ts";
import { joinReviewNotes } from "../lib/review-join.ts";
import { loadAppModule } from "./helpers/render-tsx.mjs";

// 对照样稿：按面试前能拿到的信息重写某一轮，只供与原稿对照。独立 type，
// 所以日历、公司总览、面试结果等按 interview-prep 工作的地方看不到它；只有校验器与本场面试页认识它。

const PROMPT = "〇〇様は、御社で長く採用に携わってこられたと伺いました。中途で入社して早く現場で信頼された方には、どんな共通点がありましたか。";
const question = (no, type) => `### ${no}. ${no >= 4 ? "备用｜" : ""}〔${type}〕テーマ${no}

【あなた】${PROMPT}

**用到的信息**：对方＝当场自我介绍；本人＝无

**预想回答与接话**：

【面接官】現場との関係づくりを大事にしている方が多いですね。

【あなた】ありがとうございます。具体的には、どんな場面でしたか。

【面接官】最初の案件で、メンバーと方針をすり合わせた方です。

【あなた】その中で、中途で入った方は、最初にどの工程を担当されることが多いですか。

【あなた】ありがとうございます。最初の進め方がよく分かりました。

▷ 这一问还能帮你判断：新人如何融入团队。

`;
const REPLAY_BODY = `# 株式会社テスト · 一次面接 · 对照样稿

## 纵览与建议

按面试前能拿到的信息重写。

## 志望動機

### 20秒版（既定）

【あなた】御社のデータ基盤事業に興味を持ちました。私の開発経験で貢献したいです。

▷ 根拠: [公司直接页面](https://example.com/company)

## 逆質問

### 面接官研究

出席者未确认，现场用开场自我介绍接。

【あなた】先ほど〇〇とおっしゃっていましたが、もう少し伺ってもよろしいでしょうか。

${["面接官本人型", "经验连接型", "事业课题型", "活跃期待型", "确认型"].map((type, index) => question(index + 1, type)).join("")}## 研究资料

### ★ [公司直接页面](https://example.com/company)

读到了什么：数据基础设施业务。

## 临场备用

### 冒頭30秒

【あなた】本日はお時間をいただき、ありがとうございます。

自己紹介を求められたら：[[自己紹介_音読台本#30秒版]]

### 本場の懸念 TOP3 と先回り一言

#### 1. 定着

【あなた】腰を据えて長く取り組める環境を探しています。

### 締めの一言

【あなた】ぜひ選考に進ませていただきたいです。

#### 当日お礼メッセージ

本日はお時間をいただき、ありがとうございました。

## 对照：当时实际发生了什么／新稿会改变什么

当时只问了一题：[[2026-10-01_一次面接_整理稿#q11 期待されていること]]。
`;
const ORIGINAL_BODY = "# 株式会社テスト 面接准备\n\n## 纵览与建议\n\n当时的准备。\n\n## 志望動機\n\n### 20秒版（既定）\n\n【あなた】御社のデータ基盤事業に興味を持ちました。私の開発経験で貢献したいです。\n\n▷ 根拠: [公司直接页面](https://example.com/company)\n\n## 逆質問\n\n### 1. 主问题\n\n【あなた】最初に期待される成果を教えていただけますか。\n\n## 研究资料\n\n资料\n\n## 临场备用\n\n### 本场难题\n\n【あなた】簡潔に説明します。\n";

const makeNote = (path, frontmatter, content) => ({ path, frontmatter, content, tags: [], stat: { ctime: 0, mtime: 0, size: 0 } });
const job = makeNote("20_求職/测试/数据工程.md", { type: "job-case", company: "株式会社テスト", case_id: "test-data" }, "# 数据工程");
const original = makeNote("20_求職/测试/面接準備_测试_s01_一次面接.md", { type: "interview-prep", prep_version: 2, company: "株式会社テスト", case: "[[数据工程]]", round: "一次面接", format: "オンライン", interviewers: "採用担当", session_id: "数据工程-s01", session_order: 1, session_status: "completed", date: "2026-10-01" }, ORIGINAL_BODY);
const replay = makeNote("80_AI分析/面试对照样稿/2026-10-01_测试_一次面接_对照样稿.md", { type: "interview-prep-replay", prep_version: 2, replay_of: "[[面接準備_测试_s01_一次面接]]", replay_as_of: "2026-09-30", company: "株式会社テスト", case: "[[数据工程]]", round: "一次面接", format: "オンライン", interviewers: "採用担当", date: "2026-10-01" }, REPLAY_BODY);

test("对照样稿不算一轮面试：找准备稿时排除，按 replay_of 挂回原稿", () => {
  const notes = [job, original, replay];
  const docs = findInterviewPrepDocs(notes);
  assert.deepEqual(docs.map((doc) => doc.note.path), [original.path]);
  const found = findInterviewPrepReplay(notes, docs[0]);
  assert.equal(found.note.path, replay.path);
  assert.equal(found.replayOf, "面接準備_测试_s01_一次面接");
  assert.equal(found.prepVersion, 2);
  // replay_of 写成完整路径也能对上。
  const byPath = { ...replay, frontmatter: { ...replay.frontmatter, replay_of: "[[20_求職/测试/面接準備_测试_s01_一次面接]]" } };
  assert.equal(findInterviewPrepReplay([job, original, byPath], docs[0])?.note.path, replay.path);
  assert.equal(parseInterviewPrepDoc(original, notes).replayOf, "");
  // 本场面试页（interview 范围）读得到样稿；日历与首页用的范围读不到，自然不会生成场次。
  assert.equal(noteInVaultScope(replay, "interview"), true);
  assert.equal(noteInVaultScope(replay, "actions"), false);
  assert.equal(noteInVaultScope(replay, "overview"), false);
});

test("样稿不进日历场次与 exact prep 匹配，也不改变面接傾向的按场结果和复盘列表", () => {
  // 第二份样稿故意写成更晚的日期：若被当成准备稿，前一轮会被算成「有下一轮＝通过」，日历也会多出一场。
  const later = { ...replay, path: "80_AI分析/面试对照样稿/2026-10-20_测试_二次面接_对照样稿.md", frontmatter: { ...replay.frontmatter, date: "2026-10-20", replay_as_of: "2026-10-19", round: "二次面接" } };
  const study = makeNote("20_求職/测试/2026-10-01_一次面接_整理稿.md", { type: "transcript-study", company: "株式会社テスト", date: "2026-10-01", round: "一次面接", case: "[[数据工程]]" }, "# 整理稿\n");
  const rejected = { ...job, frontmatter: { ...job.frontmatter, status: "不採用" } };
  const base = [rejected, original, study];
  const withReplay = [...base, replay, later];
  const now = new Date("2026-10-15T00:00:00+09:00");
  const events = buildCalendarEvents(base, now);
  assert.ok(events.length > 0, "原稿本身会生成场次");
  assert.deepEqual(buildCalendarEvents(withReplay, now), events);
  assert.ok(buildCalendarEvents(withReplay, now).every((item) => !item.note.path.startsWith("80_AI分析/") && !item.prepPath.startsWith("80_AI分析/")));
  // exact prep：同案件、同日期的场次仍定位原稿。
  const scheduled = { ...original, frontmatter: { ...original.frontmatter, session_status: "scheduled", date: "2026-10-20" } };
  const event = { id: "e", kind: "event", note: rejected, company: "株式会社テスト", date: "2026-10-20", time: "", label: "一次面接", phase: "upcoming", caseId: "test-data", prepPath: "" };
  assert.equal(resolveCalendarInterview(event, [rejected, scheduled, later]).path, scheduled.path);
  assert.deepEqual(resolveCalendarInterview(event, [rejected, scheduled, later]), resolveCalendarInterview(event, [rejected, scheduled]));
  // 面接傾向_横断的按场结果（vault:stats 生成区的上游）与没有样稿时相同。
  assert.deepEqual([...resolveInterviewOutcomes(withReplay)], [...resolveInterviewOutcomes(base)]);
  // 复盘列表只按整理稿列，样稿不出现。
  assert.deepEqual(joinReviewNotes(withReplay).map((item) => item.key), [study.path]);
});

test("vault:check 按新版契约整篇检查样稿，不登记轮次身份，并核对 replay_of", async () => {
  const vault = await mkdtemp(join(tmpdir(), "prep-replay-vault-"));
  try {
    const caseDir = join(vault, "20_求職", "测试");
    const replayDir = join(vault, "80_AI分析", "面试对照样稿");
    await mkdir(caseDir, { recursive: true });
    await mkdir(replayDir, { recursive: true });
    const frontmatter = (fields) => `---\n${Object.entries(fields).map(([key, value]) => `${key}: ${value}`).join("\n")}\n---\n`;
    const replayFields = { type: "interview-prep-replay", prep_version: 2, replay_of: "\"[[面接準備_测试_s01_一次面接]]\"", replay_as_of: "'2026-09-30'", company: "株式会社テスト", case: "\"[[数据工程]]\"", round: "一次面接", format: "オンライン", interviewers: "採用担当", date: "2026-10-01" };
    const replayPath = join(replayDir, "2026-10-01_测试_一次面接_对照样稿.md");
    await Promise.all([
      writeFile(join(caseDir, "数据工程.md"), "---\ntype: job-case\ncase_id: test-data\ncompany: 株式会社テスト\nstatus: 未応募\norigin: manual\n---\n# 数据工程\n"),
      writeFile(join(caseDir, "面接準備_测试_s01_一次面接.md"), frontmatter({ ...original.frontmatter, case: "\"[[数据工程]]\"" }) + ORIGINAL_BODY),
      writeFile(join(caseDir, "自己紹介_音読台本.md"), "# 自己紹介\n\n## 30秒版\n\n【あなた】テストと申します。\n"),
      writeFile(join(caseDir, "2026-10-01_一次面接_整理稿.md"), "# 整理稿\n\n## q11 期待されていること\n\n当日の問答。\n"),
      writeFile(replayPath, frontmatter(replayFields) + REPLAY_BODY),
    ]);
    const check = () => spawnSync(process.execPath, ["scripts/vault-check.mjs"], {
      cwd: process.cwd(), env: { ...process.env, OBSIDIAN_VAULT_PATH: vault }, encoding: "utf8",
    });
    let result = check();
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /面接準備ノート 1 件（対照稿 1 件/);
    // 样稿和原稿同 case、同日期，也不会撞轮次身份；但不能自带 session 字段。
    await writeFile(replayPath, frontmatter({ ...replayFields, session_id: "数据工程-s01", session_order: 1, session_status: "completed" }) + REPLAY_BODY);
    result = check();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /对照样稿不写 session_id/);
    assert.doesNotMatch(result.stderr, /session_id.*重複|同じ session/);
    for (const [fields, message] of [
      [{ ...replayFields, replay_of: "\"[[不存在的原稿]]\"" }, /replay_of の参照先が無い/],
      [{ ...replayFields, replay_of: "\"[[数据工程]]\"" }, /type: interview-prep ではない/],
      [{ ...replayFields, case: "\"[[其他案件]]\"" }, /case の参照先が無い|同一 case \/ meeting/],
      [{ ...replayFields, prep_version: 1 }, /只支持 prep_version: 2/],
      [{ ...replayFields, replay_as_of: "''" }, /replay_as_of/],
      [{ ...replayFields, replay_as_of: "'2026-10-02'" }, /replay_as_of.*不晚于 date/],
    ]) {
      await writeFile(replayPath, frontmatter(fields) + REPLAY_BODY);
      result = check();
      assert.equal(result.status, 1, JSON.stringify(fields));
      assert.match(result.stderr, message);
    }
    // 样稿一律按新契约检查，不看日期：缺临场三块或旧格式逆質問都会被拦下。
    await writeFile(replayPath, frontmatter(replayFields) + REPLAY_BODY.replace(/### 締めの一言[\s\S]*?(?=## 对照)/, ""));
    result = check();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /締めの一言/);
    // 文末对照节必须有，且要引用整理稿的具体问答。
    await writeFile(replayPath, frontmatter(replayFields) + REPLAY_BODY.replace(/## 对照[\s\S]*$/, ""));
    result = check();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /文末 `## 对照：当时实际发生了什么／新稿会改变什么`/);
    await writeFile(replayPath, frontmatter(replayFields) + REPLAY_BODY.replace(/\[\[2026-10-01_一次面接_整理稿#q11[^\]]*\]\]/, "整理稿"));
    result = check();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /#qNN/);
  } finally {
    await rm(vault, { recursive: true, force: true });
  }
});

const ui = { "./ui-locale": { useUiLocale: () => ({ locale: "zh-CN", setLocale() {} }) } };
const session = await loadAppModule("app/interview-session.tsx", { stubs: (specifier) => {
  if (specifier === "./ui-locale") return ui["./ui-locale"];
  if (specifier === "./interview-session-v2") return { default: ({ doc, companyAction }) => createElement("div", { "data-shown-prep": doc.note.path, "data-replay-of": doc.replayOf }, companyAction) };
  if (specifier === "./company-overview") return { default: () => null, COMPANY_COMPARE_LIMIT: 3, CompanyCompare: () => null, CompanyCompareButton: () => null, CompanyCompareSelector: () => null, CompanyCompareTray: () => null, toggleCompanyComparison: (list) => list };
  if (specifier.startsWith("./")) return { Blocks() {}, Inlines() {}, default() {}, PrepSearchBox() {}, useSlashFocus() {}, copySelectionWithoutRuby() {} };
  return undefined;
} });
const sessionProps = { notes: [job, original, replay], today: "2026-10-15", onOpen() {}, onOpenWiki() {}, onOpenCard() {}, onOpenAsset() {} };
const renderSession = (props) => renderToStaticMarkup(createElement(session.default, { ...sessionProps, ...props }));

test("本场面试页：原稿那一轮给「对照样稿」切换；?prep= 指向样稿时直接显示样稿", () => {
  const plain = renderSession({ initialPath: original.path });
  assert.match(plain, new RegExp(`data-shown-prep="${original.path}"`));
  assert.match(plain, /class="co-replay-entry" aria-pressed="false">对照样稿</);
  const deep = renderSession({ initialPath: replay.path });
  assert.match(deep, new RegExp(`data-shown-prep="${replay.path}"`));
  assert.match(deep, /data-replay-of="面接準備_测试_s01_一次面接"/);
  assert.match(deep, /class="co-replay-entry" aria-pressed="true">回到原稿</);
  // 没有样稿的轮次不出切换。
  const bare = renderToStaticMarkup(createElement(session.default, { ...sessionProps, notes: [job, original], initialPath: original.path }));
  assert.doesNotMatch(bare, /co-replay-entry/);
});

test("对照样稿页头标明不是当时的准备稿，倒计时让位", async () => {
  const { default: SessionV2 } = await loadAppModule("app/interview-session-v2.tsx", {
    stubs: { ...ui, "./prep-material-reader": { default: () => null } },
  });
  const doc = parseInterviewPrepDoc(replay, [replay]);
  const html = renderToStaticMarkup(createElement(SessionV2, {
    doc, series: [], selectedSeries: null, sources: [], today: "2026-10-15",
    onSelect() {}, onOpen() {}, onOpenWiki() {}, onOpenCard() {}, onOpenAsset() {},
    companyOverview: null, contextPicker: null, companyAction: null,
  }));
  assert.match(html, /class="v2-replay-badge">对照样稿<\/b><span class="v2-replay-asof">信息截至 2026-09-30<\/span>/);
  assert.match(html, /class="v2-replay-note">对照样稿：按 2026-09-30 以前能拿到的信息重写/);
  assert.doesNotMatch(html, /v2-countdown/);
  // 样稿落在面谈纵览，对照节在最上面；五章里不混入面试后的事实。
  assert.match(html, /id="v2-tab-overview"[^>]*aria-selected="true"/);
  assert.match(html, /class="v2-replay-comparison"[^>]*><h2 id="v2-replay-comparison-title">对照：当时实际发生了什么／新稿会改变什么<\/h2>/);
  assert.ok(html.indexOf("v2-replay-comparison") < html.indexOf("按面试前能拿到的信息重写。"), "对照节在纵览正文之前");
});
