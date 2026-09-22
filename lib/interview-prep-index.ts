import type {
  InterviewPrepDoc,
  InterviewPrepSessionStatus,
  PrepExternalLink,
} from "./interview-prep-doc.ts";

export type InterviewPrepSeries = {
  key: string;
  company: string;
  caseLink: string;
  meetingLink: string;
  rounds: InterviewPrepDoc[];
};

export type InterviewPrepTemporalStatus =
  | InterviewPrepSessionStatus
  | "upcoming"
  | "past";

function prepDirectory(doc: InterviewPrepDoc) {
  return doc.note.path.split("/").slice(0, -1).join("/");
}

/**
 * 同公司多个职位或独立面谈不能混轮，系列按带类型的正本引用划分。
 * 旧笔记没有 case / meeting 时，保留原来的目录兜底。
 */
function interviewPrepSeriesKey(doc: InterviewPrepDoc) {
  if (doc.caseLink) return `case:${doc.caseLink}`;
  if (doc.meetingLink) return `meeting:${doc.meetingLink}`;
  const directory = prepDirectory(doc);
  if (directory) return `directory:${directory}`;
  return `company:${doc.company.normalize("NFKC").trim() || doc.note.path}`;
}

/** 表示用 round は自由文のまま保ち、順序だけを既知の名称から補う。 */
function inferredInterviewRoundOrder(round: string): number | null {
  const value = round.normalize("NFKC").toLocaleLowerCase();
  if (/最終|final|役員/.test(value)) return 90;
  if (/カジュアル|casual|面談/.test(value)) return 0;
  if (/一次|1次|first/.test(value)) return 10;
  if (/二次|2次|second/.test(value)) return 20;
  if (/三次|3次|third/.test(value)) return 30;
  if (/四次|4次|fourth/.test(value)) return 40;
  return null;
}

function interviewRoundOrder(doc: InterviewPrepDoc) {
  return doc.sessionOrder ?? inferredInterviewRoundOrder(doc.round);
}

/** 古いノートは date から従来どおり推定し、新しい未定日ノートだけ preparing を明示できる。 */
export function interviewPrepTemporalStatus(
  doc: InterviewPrepDoc,
  today: string,
): InterviewPrepTemporalStatus {
  if (doc.sessionStatus === "cancelled") return "cancelled";
  if (
    doc.sessionStatus === "preparing" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(doc.date)
  ) {
    return "preparing";
  }
  if (doc.sessionStatus === "completed") return "completed";
  if (doc.date >= today) return doc.sessionStatus || "upcoming";
  return "past";
}

function compareRounds(left: InterviewPrepDoc, right: InterviewPrepDoc) {
  const leftOrder = interviewRoundOrder(left);
  const rightOrder = interviewRoundOrder(right);
  if (leftOrder !== null || rightOrder !== null) {
    const order = (leftOrder ?? 50) - (rightOrder ?? 50);
    if (order !== 0) return order;
  }
  if (left.date !== right.date) {
    if (!left.date) return 1;
    if (!right.date) return -1;
    return left.date.localeCompare(right.date);
  }
  return left.note.path.localeCompare(right.note.path);
}

function hasMixedPrepVersions(docs: InterviewPrepDoc[]) {
  return docs.some((doc) => doc.prepVersion === 2) && docs.some((doc) => doc.prepVersion !== 2);
}

function orderedRounds(docs: InterviewPrepDoc[]) {
  if (!hasMixedPrepVersions(docs)) return [...docs].sort(compareRounds);
  // 显式接触序号与旧稿的 10/20/90 推断值不是同一尺度。分别排序再合并，
  // 保住各队列内部顺序，也避免按比较对象切换尺度造成不传递的 comparator。
  const explicit = docs.filter((doc) => doc.sessionOrder !== null).sort(compareRounds);
  const legacy = docs.filter((doc) => doc.sessionOrder === null).sort(compareRounds);
  const result: InterviewPrepDoc[] = [];
  while (explicit.length && legacy.length) {
    const left = legacy[0], right = explicit[0];
    const byRound = (inferredInterviewRoundOrder(left.round) ?? 50) - (inferredInterviewRoundOrder(right.round) ?? 50);
    const dateKey = (doc: InterviewPrepDoc) => /^\d{4}-\d{2}-\d{2}$/.test(doc.date) ? doc.date : "9999-99-99";
    const order = byRound || dateKey(left).localeCompare(dateKey(right)) || left.note.path.localeCompare(right.note.path);
    result.push((order <= 0 ? legacy : explicit).shift()!);
  }
  return [...result, ...legacy, ...explicit];
}

function latestInterviewPrepDate(series: InterviewPrepSeries) {
  // 轮次顺序不一定与日期一致；「未定」也不能参与日期字符串比较。
  return series.rounds.reduce(
    (latest, doc) => /^\d{4}-\d{2}-\d{2}$/.test(doc.date) && doc.date > latest
      ? doc.date
      : latest,
    "",
  );
}

export function groupInterviewPrepDocs(docs: InterviewPrepDoc[]): InterviewPrepSeries[] {
  const bySeries = new Map<string, InterviewPrepSeries>();
  for (const doc of docs) {
    const key = interviewPrepSeriesKey(doc);
    const existing = bySeries.get(key);
    if (existing) {
      existing.rounds.push(doc);
      continue;
    }
    bySeries.set(key, {
      key,
      company: doc.company || doc.title,
      caseLink: doc.caseLink,
      meetingLink: doc.meetingLink,
      rounds: [doc],
    });
  }
  return [...bySeries.values()]
    .map((series) => ({ ...series, rounds: orderedRounds(series.rounds) }))
    .sort((left, right) =>
      latestInterviewPrepDate(right).localeCompare(latestInterviewPrepDate(left)) ||
      (left.company || left.caseLink || left.meetingLink).localeCompare(
        right.company || right.caseLink || right.meetingLink,
        "ja",
      ) || left.key.localeCompare(right.key),
    );
}

/**
 * 最初に開く回：直近の確定予定 → 日程調整中の最新ラウンド → 直近の終了回。
 * cancelled は他に何も無い時だけ履歴として開く。
 */
export function selectRelevantInterviewPrepDoc(
  docs: InterviewPrepDoc[],
  today: string,
): InterviewPrepDoc | null {
  const mixed = hasMixedPrepVersions(docs);
  const rank = new Map(orderedRounds(docs).map((doc, index) => [doc.note.path, index]));
  const compareOrder = (left: InterviewPrepDoc, right: InterviewPrepDoc) => mixed
    ? rank.get(left.note.path)! - rank.get(right.note.path)!
    : (interviewRoundOrder(left) ?? 50) - (interviewRoundOrder(right) ?? 50);
  const active = docs.filter((doc) => {
    const status = interviewPrepTemporalStatus(doc, today);
    return (
      (status === "scheduled" || status === "upcoming") &&
      Boolean(doc.date) &&
      doc.date >= today
    );
  });
  if (active.length > 0) {
    return [...active].sort(
      (left, right) =>
        left.date.localeCompare(right.date) ||
        compareOrder(left, right) ||
        left.note.path.localeCompare(right.note.path),
    )[0];
  }

  const preparing = docs.filter(
    (doc) => interviewPrepTemporalStatus(doc, today) === "preparing",
  );
  if (preparing.length > 0) {
    return [...preparing].sort(
      (left, right) =>
        compareOrder(right, left) ||
        right.note.path.localeCompare(left.note.path),
    )[0];
  }

  const history = docs.filter(
    (doc) => interviewPrepTemporalStatus(doc, today) !== "cancelled",
  );
  const source = history.length > 0 ? history : docs;
  return [...source].sort(
    (left, right) =>
      (right.date || "").localeCompare(left.date || "") ||
      compareOrder(right, left) ||
      right.note.path.localeCompare(left.note.path),
  )[0] ?? null;
}

export function interviewPrepSeriesForDoc(
  series: InterviewPrepSeries[],
  doc: InterviewPrepDoc,
) {
  const key = interviewPrepSeriesKey(doc);
  return series.find((candidate) => candidate.key === key) ?? null;
}

/**
 * 過去回を開いた時に未来で知った情報を混ぜない。
 * 選択回までに存在した各回の §11 だけを、選択回優先で案件共有リンクへ畳む。
 */
export function prepDocsThroughRound(
  series: InterviewPrepSeries,
  selected: InterviewPrepDoc,
) {
  const index = series.rounds.findIndex(
    (doc) => doc.note.path === selected.note.path,
  );
  const rounds = index < 0 ? [selected] : series.rounds.slice(0, index + 1);
  const prior = rounds.slice(0, -1).reverse();
  if (!hasMixedPrepVersions(series.rounds) || !/^\d{4}-\d{2}-\d{2}$/.test(selected.date)) return [selected, ...prior];
  // 混合历史的显示位置不能单独证明当时已经知道某条资料。
  return [selected, ...prior.filter((doc) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(doc.date) || doc.date > selected.date) return false;
    if (doc.date < selected.date) return true;
    if (doc.sessionOrder !== null && selected.sessionOrder !== null) return doc.sessionOrder < selected.sessionOrder;
    const before = inferredInterviewRoundOrder(doc.round), after = inferredInterviewRoundOrder(selected.round);
    return before !== null && after !== null && before < after;
  })];
}

export function mergePrepExternalLinks(
  docs: InterviewPrepDoc[],
): PrepExternalLink[] {
  const links: PrepExternalLink[] = [];
  const indexByHref = new Map<string, number>();
  for (const doc of docs) {
    for (const link of doc.externalLinks) {
      const existingIndex = indexByHref.get(link.href);
      if (existingIndex === undefined) {
        indexByHref.set(link.href, links.length);
        links.push({ ...link });
        continue;
      }
      if (link.starred && !links[existingIndex].starred) {
        links[existingIndex] = { ...links[existingIndex], starred: true };
      }
    }
  }
  return links;
}
