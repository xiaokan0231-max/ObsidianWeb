import assert from "node:assert/strict";
import test from "node:test";
import {
  buildContextPickerGroups,
  filterContextPickerGroups,
  findContextPickerItem,
  formatContextPickerEvent,
  pinCurrentContextPickerGroup,
} from "../lib/context-picker.ts";

const TODAY = "2026-09-23";

function note(path, frontmatter = {}) {
  return { path, frontmatter, content: "" };
}
function caseContext(company, title, frontmatter = {}, extra = {}) {
  const path = `20_求職/${company}/${company}_${title}.md`;
  return { key: `case:${path}`, kind: "case", note: note(path, { type: "job-case", ...frontmatter }), company, title, caseId: `${company}_${title}`, dossier: null, profile: null, assessment: null, profileStatus: "missing", assessmentStatus: "missing", issues: [], ...extra };
}
function meetingContext(company, title, frontmatter = {}) {
  const path = `20_求職/_TODO/${company}_${title}.md`;
  return { key: `meeting:${path}`, kind: "meeting", note: note(path, { type: "todo", company, ...frontmatter }), company, title, caseId: "", dossier: null, profile: null, assessment: null, profileStatus: "missing", assessmentStatus: "missing", issues: [] };
}
function prepDoc(path, date, sessionStatus = "", round = "一次面接") {
  return { note: note(path), date, sessionStatus, round, company: "", title: round, prepVersion: 2, sessionOrder: null, format: "", interviewers: "", caseLink: "", meetingLink: "", sections: [], embeds: [], externalLinks: [] };
}
function series(key, company, rounds, caseLink = "") {
  return { key, company, caseLink, meetingLink: "", rounds };
}
const ids = (group) => group.items.map((item) => item.id);

test("按此刻关心程度分组：即将面谈 → 进行中 → 待判断 → 已结束折叠 → 历史准备稿", () => {
  const scheduled = caseContext("株式会社テスト", "データエンジニア", { status: "面接中（2026-09-10 一次通過）", status_updated: "2026-09-10" });
  const interviewing = caseContext("株式会社サンプル", "SRE", { status: "面接中", status_updated: "2026-09-01" });
  const applied = caseContext("株式会社サンプル", "PM", { status: "応募済（2026-09-20・Green）", status_updated: "2026-09-20" });
  const passed = caseContext("株式会社ダミー", "SE", { status: "書類通過", status_updated: "2026-09-15" });
  const hold = caseContext("株式会社ホールド", "DE", { status: "保留（本人見送り）", status_updated: "2026-08-01" });
  const pending = caseContext("株式会社ペンディング", "DE", { status: "未応募" });
  const rejected = caseContext("株式会社リジェクト", "DE", { status: "不採用（2026-09-12・書類選考）", status_updated: "2026-09-12" });
  const rejectedOld = caseContext("株式会社古い", "DE", { status: "不採用", status_updated: "2026-07-01" });
  const docs = [prepDoc("prep/テスト_s02.md", "2026-09-25", "scheduled"), prepDoc("prep/テスト_s01.md", "2026-09-10", "completed"), prepDoc("prep/孤児.md", "2026-06-01", "completed", "カジュアル面談")];
  const docContexts = new Map([["prep/テスト_s02.md", scheduled], ["prep/テスト_s01.md", scheduled], ["prep/孤児.md", null]]);
  const groups = buildContextPickerGroups({
    contexts: [rejectedOld, hold, applied, rejected, pending, passed, interviewing, scheduled],
    series: [series("directory:prep-old", "旧社", [docs[2]]), series(`case:${scheduled.caseId}`, "株式会社テスト", docs.slice(0, 2), scheduled.caseId)],
    docs, docContexts, today: TODAY,
  });
  assert.deepEqual(groups.map((group) => group.id), ["upcoming", "active", "undecided", "hold", "closed", "legacy"]);
  const [upcoming, active, undecided, holdGroup, closed, legacy] = groups;
  assert.deepEqual(ids(upcoming), [`context:${scheduled.note.path}`]);
  assert.equal(upcoming.items[0].eventAt, "2026-09-25", "即将面谈取最早的未来轮次日期");
  assert.equal(upcoming.items[0].rounds, 2, "轮数按关联到该正本的准备稿计");
  assert.deepEqual(ids(active), [interviewing, passed, applied].map((item) => `context:${item.note.path}`), "面接中 → 書類通過 → 応募済");
  assert.deepEqual(ids(undecided), [`context:${pending.note.path}`]);
  assert.deepEqual(ids(holdGroup), [`context:${hold.note.path}`]);
  assert.equal(holdGroup.collapsible, true, "保留默认折叠");
  assert.equal(upcoming.items[0].detail, "面接中（2026-09-10 一次通過）", "括号补充只进 detail");
  assert.equal(closed.collapsible, true, "已结束默认折叠");
  assert.deepEqual(ids(closed), [rejected, rejectedOld].map((item) => `context:${item.note.path}`), "已结束按最近变化在前");
  assert.deepEqual(ids(legacy), ["series:directory:prep-old"], "有正本的系列不重复列出");
  assert.equal(legacy.items[0].rounds, 1);
  assert.ok(groups.every((group) => group.id === "closed" || group.id === "hold" || !group.collapsible));
});

test("面谈 todo：未来日期进即将面谈并带时刻，过期或完了进已结束，其余算进行中", () => {
  const future = meetingContext("株式会社テスト", "カジュアル面談", { next_event_at: "2026-09-24 13:00", status: "未着手" });
  const done = meetingContext("株式会社サンプル", "ユーザーサクセス面談", { next_event_at: "2026-08-24 17:00", status: "完了" });
  const open = meetingContext("株式会社ダミー", "日程調整中", { status: "進行中" });
  const stale = meetingContext("株式会社古い", "面談", { next_event_at: "2026-09-01", status: "未着手" });
  const groups = buildContextPickerGroups({ contexts: [done, open, stale, future], series: [], docs: [], docContexts: new Map(), today: TODAY });
  const byId = Object.fromEntries(groups.map((group) => [group.id, group]));
  assert.deepEqual(ids(byId.upcoming), [`context:${future.note.path}`]);
  assert.equal(byId.upcoming.items[0].eventAt, "2026-09-24 13:00");
  assert.equal(byId.upcoming.items[0].tone, "meeting");
  assert.deepEqual(ids(byId.active), [`context:${open.note.path}`]);
  assert.deepEqual(ids(byId.closed), [`context:${done.note.path}`, `context:${stale.note.path}`]);
  assert.equal(byId.undecided, undefined);
});

test("准备任务的 due 不是面谈日：已完了的 todo 不冒充一场面谈，也不和案件行重复", () => {
  // 实际形状：案件正本写着 9/24 17:00 的面接，同公司另有一条「准备问题」的 todo
  // 只有 due: 2026-09-24 且已完了。拿 due 当面谈日会让同一场在即将面谈里出现两次。
  const job = caseContext("株式会社テスト", "データエンジニア", { status: "面接中", next_event_at: "2026-09-24 17:00" });
  const doneTask = meetingContext("株式会社テスト", "カジュアル面談準備", { due: "2026-09-24", status: "完了" });
  const openTask = meetingContext("株式会社サンプル", "面談準備", { due: "2026-09-25", status: "未着手" });
  const groups = buildContextPickerGroups({ contexts: [job, doneTask, openTask], series: [], docs: [], docContexts: new Map(), today: TODAY });
  const byId = Object.fromEntries(groups.map((group) => [group.id, group]));
  assert.deepEqual(ids(byId.upcoming), [`context:${job.note.path}`], "即将面谈只剩案件那一条");
  assert.deepEqual(ids(byId.closed), [`context:${doneTask.note.path}`], "完了的准备任务归已结束");
  assert.deepEqual(ids(byId.active), [`context:${openTask.note.path}`], "未完了但没有面谈时刻的留在进行中");
  assert.equal(byId.active.items[0].eventAt, "", "due 不当作面谈时刻显示");
});

test("状态带括号补充时按前缀归类；保留单独折叠；枚举外的状态保留原文、归到待判断且用中性色", () => {
  const custom = caseContext("株式会社テスト", "DE", { status: "辞退" });
  const offer = caseContext("株式会社サンプル", "DE", { status: "内定（2026-09-20）" });
  const pending = caseContext("株式会社ダミー", "DE", { status: "未応募" });
  const hold = caseContext("株式会社ホールド", "DE", { status: "保留" });
  const groups = buildContextPickerGroups({ contexts: [custom, hold, pending, offer], series: [], docs: [], docContexts: new Map(), today: TODAY });
  const byId = Object.fromEntries(groups.map((group) => [group.id, group]));
  assert.deepEqual(ids(byId.active), [`context:${offer.note.path}`]);
  assert.equal(byId.active.items[0].status, "内定");
  assert.equal(byId.active.items[0].tone, "offer");
  assert.deepEqual(ids(byId.undecided), [pending, custom].map((item) => `context:${item.note.path}`), "未応募 → 自定义");
  assert.deepEqual(ids(byId.hold), [`context:${hold.note.path}`]);
  assert.equal(byId.undecided.items[1].status, "辞退");
  assert.equal(byId.undecided.items[1].tone, "neutral");
});

test("搜索：全角半角与大小写不计，多个词都要命中，折叠组里的项也能被搜到", () => {
  const rejected = caseContext("ＴＥＳＴＦＬＡＲＥ株式会社", "Scala エンジニア（SES）", { status: "不採用" });
  const applied = caseContext("TESTFLARE株式会社", "データエンジニア", { status: "応募済" });
  const other = caseContext("株式会社テスト", "データエンジニア", { status: "応募済", assessment: null });
  const groups = buildContextPickerGroups({ contexts: [rejected, applied, other], series: [], docs: [], docContexts: new Map(), today: TODAY });
  assert.equal(filterContextPickerGroups(groups, "  "), groups, "空查询原样返回");
  const scala = filterContextPickerGroups(groups, "testflare scala");
  assert.deepEqual(scala.map((group) => group.id), ["closed"]);
  assert.deepEqual(ids(scala[0]), [`context:${rejected.note.path}`]);
  const flare = filterContextPickerGroups(groups, "ｆｌａｒｅ");
  assert.deepEqual(flare.flatMap(ids).sort(), [`context:${applied.note.path}`, `context:${rejected.note.path}`].sort());
  assert.deepEqual(filterContextPickerGroups(groups, "不採用").flatMap(ids), [`context:${rejected.note.path}`], "状态词也能搜");
  assert.deepEqual(filterContextPickerGroups(groups, "存在しない"), []);
  assert.equal(findContextPickerItem(groups, `context:${other.note.path}`)?.company, "株式会社テスト");
  assert.equal(findContextPickerItem(groups, "context:missing"), null);
});

test("短日期：今天／明天直说，同年只给月日，跨年带年，有时刻则附上", () => {
  assert.equal(formatContextPickerEvent("2026-09-23 13:00", TODAY), "今天 13:00");
  assert.equal(formatContextPickerEvent("2026-09-24", TODAY), "明天");
  assert.equal(formatContextPickerEvent("2026-10-05 9:30", TODAY), "10/5 09:30");
  assert.equal(formatContextPickerEvent("2027-01-05", TODAY), "2027/1/5");
  assert.equal(formatContextPickerEvent("", TODAY), "");
  assert.equal(formatContextPickerEvent("未定", TODAY), "");
});

test("钉住当前项：从原组拿掉、放到最上面；搜索或未选择时不钉", () => {
  const rejected = caseContext("株式会社リジェクト", "DE", { status: "不採用", status_updated: "2026-09-12" });
  const applied = caseContext("株式会社テスト", "DE", { status: "応募済" });
  const groups = buildContextPickerGroups({ contexts: [rejected, applied], series: [], docs: [], docContexts: new Map(), today: TODAY });
  const pinned = pinCurrentContextPickerGroup(groups, `context:${rejected.note.path}`);
  assert.deepEqual(pinned.map((group) => group.id), ["current", "active"], "已结束只剩当前项时整组消失");
  assert.equal(pinned[0].label, "当前");
  assert.deepEqual(ids(pinned[0]), [`context:${rejected.note.path}`]);
  assert.equal(pinCurrentContextPickerGroup(groups, ""), groups);
  assert.equal(pinCurrentContextPickerGroup(groups, "context:missing"), groups);
});

test("案件正本自己的 next_event_at 优先于准备稿日期，且带时刻；过期的不算", () => {
  const explicit = caseContext("株式会社テスト", "DE", { status: "面接中", next_event_at: "2026-09-26 10:00" });
  const stale = caseContext("株式会社サンプル", "DE", { status: "面接中", next_event_at: "2026-09-01 10:00" });
  const docs = [prepDoc("prep/テスト_s02.md", "2026-09-28", "scheduled")];
  const groups = buildContextPickerGroups({ contexts: [explicit, stale], series: [], docs, docContexts: new Map([["prep/テスト_s02.md", explicit]]), today: TODAY });
  const byId = Object.fromEntries(groups.map((group) => [group.id, group]));
  assert.equal(byId.upcoming.items[0].eventAt, "2026-09-26 10:00");
  assert.deepEqual(ids(byId.active), [`context:${stale.note.path}`]);
  assert.equal(byId.active.items[0].eventAt, "");
});

test("面谈 todo 自己没写日時时借同 case_id 案件的 next_event_at，归进「即将面谈」并显示时刻", () => {
  const linked = caseContext("株式会社テスト", "データエンジニア", { status: "面接中", next_event_at: "2026-09-24 10:00" });
  const meeting = { ...meetingContext("株式会社テスト", "電話面談の確認と準備", { status: "進行中", category: "面接準備" }), caseId: linked.caseId };
  const groups = buildContextPickerGroups({ contexts: [linked, meeting], series: [], docs: [], docContexts: new Map(), today: TODAY });
  const upcoming = groups.find((group) => group.id === "upcoming");
  const item = upcoming?.items.find((entry) => entry.id === `context:${meeting.note.path}`);
  assert.ok(item, "面谈进了即将面谈组");
  assert.equal(item.eventAt, "2026-09-24 10:00");
  const orphan = { ...meetingContext("株式会社サンプル", "面談準備", { status: "進行中" }), caseId: "missing" };
  const alone = buildContextPickerGroups({ contexts: [orphan], series: [], docs: [], docContexts: new Map(), today: TODAY });
  assert.equal(alone.find((group) => group.id === "upcoming"), undefined, "没有案件可借就还是进行中");
});
