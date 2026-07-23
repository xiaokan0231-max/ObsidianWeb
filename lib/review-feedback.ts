// 回答品質復盤に対する本人フィードバック。
// AI レポートとは別ノートで追記し、再生成時の制約として読み戻す。

export type ReviewFeedbackKind = "agree" | "disagree" | "context";

export type ReviewFeedbackEntry = {
  id: string;
  blockId: string;
  kind: ReviewFeedbackKind;
  date: string;
  text: string;
};

const HEAD = /^-\s+\*\*(f\d+)｜(q\d+)｜(agree|disagree|context)｜(\d{4}-\d{2}-\d{2})\*\*\s*$/;
const MINE = /^\s+-\s+我::\s?(.*)$/;

export function parseReviewFeedback(content: string): ReviewFeedbackEntry[] {
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, "");
  const entries: ReviewFeedbackEntry[] = [];
  let entry: ReviewFeedbackEntry | null = null;
  for (const line of body.split("\n")) {
    const head = line.match(HEAD);
    if (head) {
      entry = {
        id: head[1],
        blockId: head[2],
        kind: head[3] as ReviewFeedbackKind,
        date: head[4],
        text: "",
      };
      entries.push(entry);
      continue;
    }
    if (!entry) continue;
    const mine = line.match(MINE);
    if (mine) entry.text = mine[1].trim();
  }
  return entries;
}

export function uniqueReviewFeedback(entries: ReviewFeedbackEntry[]) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = [entry.blockId, entry.kind, entry.text].join("\u0000");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
