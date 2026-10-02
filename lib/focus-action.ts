import { WAITING_FOR_LABEL, jobStatus, monthDay, waitsOnCounterpart } from "./jobs.ts";
import { getString, getType, stripMarkdown, type Note } from "./notes.ts";

export type WaitingItem = {
  note: Note;
  company: string;
  label: string;
  waitingFor: string;
  followUpAt: string;
  /** 跟进日已过，需要在等待区提示。 */
  overdue: boolean;
};

function dateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value
    ? ""
    : value;
}

function compactText(value: string, limit = 72) {
  const plain = stripMarkdown(value).replace(/^⭐\s*/, "").trim();
  const characters = Array.from(plain);
  return characters.length > limit
    ? `${characters.slice(0, limit - 1).join("")}…`
    : plain;
}

function waitingItem(note: Note, today: string): WaitingItem | null {
  if (getType(note) !== "job-case") return null;
  // 看板（toJobCard）と同じ jobStatus で読む：status 欠落を片方は「無し」、片方は「未応募」と読むと
  // 「等待回复 · 全部 N 项」と「只看等对方」の件数がずれる。
  const status = jobStatus(note);
  if (!waitsOnCounterpart(status, getString(note.frontmatter.waiting_for))) return null;

  const waitingFor = getString(note.frontmatter.waiting_for);
  const company = getString(note.frontmatter.company);
  const followUpAt = validDate(getString(note.frontmatter.follow_up_at));
  return {
    note,
    company,
    label:
      compactText(getString(note.frontmatter.waiting_label) || getString(note.frontmatter.next_action), 72) ||
      `${WAITING_FOR_LABEL[waitingFor] || waitingFor}の対応待ち`,
    waitingFor: WAITING_FOR_LABEL[waitingFor] || waitingFor,
    followUpAt,
    overdue: Boolean(followUpAt) && followUpAt < today,
  };
}


/** 首页与看板共用等待判定，未応募的企业回复和内定条件回复也纳入等待区。 */
export function buildWaitingItems(notes: Note[], today = dateKey()): WaitingItem[] {
  return notes
    .map((note) => waitingItem(note, today))
    .filter((item): item is WaitingItem => Boolean(item))
    .sort(
      (left, right) =>
        (left.followUpAt || "9999-12-31").localeCompare(right.followUpAt || "9999-12-31") ||
        left.company.localeCompare(right.company, "ja"),
    );
}

export function focusDateLabel(value: string) {
  return value ? monthDay(value) : "";
}
