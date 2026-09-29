// 回答品質復盤に対する本人フィードバック。
// AI レポートとは別ノートで追記し、再生成時の制約として読み戻す。

export type ReviewFeedbackKind = "agree" | "disagree" | "context";

export type ReviewFeedbackTarget = {
  type: "advisory" | "insight";
  id: string;
  revision: string;
  snapshot: string;
};

export type ReviewFeedbackEntry = {
  id: string;
  blockId: string;
  kind: ReviewFeedbackKind;
  date: string;
  text: string;
  target?: ReviewFeedbackTarget;
};

const HEAD = /^-\s+\*\*(f\d+)｜(q\d+|(?:advisory|insight):[a-zA-Z0-9_-]+)｜(agree|disagree|context)｜(\d{4}-\d{2}-\d{2})\*\*\s*$/;
const MINE = /^\s+-\s+我::\s?(.*)$/;
const TARGET = /^\s+-\s+対象::\s?(.*)$/;

export function isReviewFeedbackTarget(value: unknown): value is ReviewFeedbackTarget {
  if (!value || typeof value !== "object") return false;
  const target = value as Partial<ReviewFeedbackTarget>;
  return (target.type === "advisory" || target.type === "insight")
    && typeof target.id === "string" && /^[a-zA-Z0-9_-]+$/.test(target.id)
    && typeof target.revision === "string" && Boolean(target.revision.trim())
    && typeof target.snapshot === "string" && Boolean(target.snapshot.trim());
}

export function resolveReviewFeedbackTarget(
  requested: ReviewFeedbackTarget,
  current: { generatedAt: string; opinions: Array<{ id: string }> },
): ReviewFeedbackTarget {
  if (requested.revision !== current.generatedAt) {
    throw new Error("分析已更新，请刷新后再反馈。");
  }
  const opinion = current.opinions.find((item) => item.id === requested.id);
  if (!opinion) throw new Error("当前分析中找不到这个观点。");
  return { type: requested.type, id: requested.id, revision: current.generatedAt, snapshot: JSON.stringify(opinion) };
}

// 重新生成后同一 ID 可能代表不同判断，不能把旧同意套到新版本。
export function reviewFeedbackIdentity(entry: Pick<ReviewFeedbackEntry, "blockId" | "kind" | "text" | "target">) {
  const target = entry.target;
  return JSON.stringify([target ? [target.type, target.id, target.revision, target.snapshot] : entry.blockId, entry.kind, entry.text]);
}

export function renderReviewFeedbackEntry(entry: ReviewFeedbackEntry) {
  const anchor = entry.target ? `${entry.target.type}:${entry.target.id}` : entry.blockId;
  const target = entry.target ? `    - 対象:: ${JSON.stringify(entry.target)}\n` : "";
  return `\n- **${entry.id}｜${anchor}｜${entry.kind}｜${entry.date}**\n${target}    - 我:: ${entry.text}\n`;
}

export function parseReviewFeedback(content: string): ReviewFeedbackEntry[] {
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, "");
  const entries: ReviewFeedbackEntry[] = [];
  let entry: ReviewFeedbackEntry | null = null;
  let anchor = "";
  for (const line of body.split("\n")) {
    const head = line.match(HEAD);
    if (head) {
      anchor = head[2];
      entry = {
        id: head[1],
        blockId: /^q\d+$/.test(head[2]) ? head[2] : "",
        kind: head[3] as ReviewFeedbackKind,
        date: head[4],
        text: "",
      };
      entries.push(entry);
      continue;
    }
    if (/^-\s+\*\*f\d+｜/.test(line)) {
      entry = null;
      anchor = "";
      continue;
    }
    if (!entry) continue;
    const mine = line.match(MINE);
    if (mine) entry.text = mine[1].trim();
    const target = line.match(TARGET);
    if (target) {
      try {
        const parsed: unknown = JSON.parse(target[1]);
        if (isReviewFeedbackTarget(parsed) && anchor === `${parsed.type}:${parsed.id}`) entry.target = parsed;
      } catch { /* 格式损坏的人工追记不能被默默关联到另一项评价。 */ }
    }
  }
  return entries.filter((item) => item.blockId || item.target);
}

export function uniqueReviewFeedback(entries: ReviewFeedbackEntry[]) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = reviewFeedbackIdentity(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
