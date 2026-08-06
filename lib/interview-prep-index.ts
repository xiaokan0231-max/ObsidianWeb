import type {
  InterviewPrepDoc,
  InterviewPrepSessionStatus,
  PrepExternalLink,
} from "./interview-prep-doc.ts";

export type InterviewPrepSeries = {
  key: string;
  company: string;
  caseLink: string;
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
 * 同じ会社に複数求人があっても混ぜないため、面接シリーズの正本は company 表記ではなく case。
 * 古いノートに case が無い場合だけ同じ会社ディレクトリへ退避する。
 */
function interviewPrepSeriesKey(doc: InterviewPrepDoc) {
  if (doc.caseLink) return `case:${doc.caseLink}`;
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
      rounds: [doc],
    });
  }
  return [...bySeries.values()]
    .map((series) => ({ ...series, rounds: [...series.rounds].sort(compareRounds) }))
    .sort((left, right) =>
      (left.company || left.caseLink).localeCompare(
        right.company || right.caseLink,
        "ja",
      ),
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
        (interviewRoundOrder(left) ?? 50) - (interviewRoundOrder(right) ?? 50) ||
        left.note.path.localeCompare(right.note.path),
    )[0];
  }

  const preparing = docs.filter(
    (doc) => interviewPrepTemporalStatus(doc, today) === "preparing",
  );
  if (preparing.length > 0) {
    return [...preparing].sort(
      (left, right) =>
        (interviewRoundOrder(right) ?? 50) - (interviewRoundOrder(left) ?? 50) ||
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
      (interviewRoundOrder(right) ?? 50) - (interviewRoundOrder(left) ?? 50) ||
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
  return [selected, ...rounds.slice(0, -1).reverse()];
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
