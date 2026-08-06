// 回答品質復盤から本人が選んだ「重练キュー」を読むための小さな形式。
// AI の改善回答そのものではなく、それを練習対象に選んだという本人の行為を保存する。

type InterviewPracticeEntry = {
  blockId: string;
  status: "queued";
  queuedAt: string;
  questionTitle: string;
  improvedAnswerJa: string;
  evidenceSentenceIds: string[];
};

const ENTRY_HEAD = /^-\s+\*\*(q\d+)｜(queued)｜([^*]+)\*\*\s*$/;
const ENTRY_FIELD = /^\s+-\s+(質問|改善回答|証拠)::\s?(.*)$/;

export function parseInterviewPractice(content: string): InterviewPracticeEntry[] {
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, "");
  const entries: InterviewPracticeEntry[] = [];
  let entry: InterviewPracticeEntry | null = null;

  for (const line of body.split("\n")) {
    const head = line.match(ENTRY_HEAD);
    if (head) {
      entry = {
        blockId: head[1],
        status: "queued",
        queuedAt: head[3].trim(),
        questionTitle: "",
        improvedAnswerJa: "",
        evidenceSentenceIds: [],
      };
      entries.push(entry);
      continue;
    }
    if (!entry) continue;
    const field = line.match(ENTRY_FIELD);
    if (!field) continue;
    if (field[1] === "質問") entry.questionTitle = field[2].trim();
    else if (field[1] === "改善回答") entry.improvedAnswerJa = field[2].trim();
    else {
      entry.evidenceSentenceIds = field[2]
        .split("·")
        .map((id) => id.trim())
        .filter((id) => /^s\d+[a-z]?$/.test(id));
    }
  }

  return entries;
}

function oneLine(value: string) {
  return value.replace(/\s*\n\s*/g, " ").trim();
}

export function renderInterviewPracticeEntry(entry: InterviewPracticeEntry) {
  const evidence = entry.evidenceSentenceIds.join(" · ") || "なし";
  return `\n- **${entry.blockId}｜queued｜${entry.queuedAt}**\n    - 質問:: ${oneLine(entry.questionTitle)}\n    - 改善回答:: ${oneLine(entry.improvedAnswerJa)}\n    - 証拠:: ${evidence}\n`;
}
