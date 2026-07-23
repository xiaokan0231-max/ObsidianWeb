import {
  parseReviewFeedback,
  type ReviewFeedbackKind,
} from "@/lib/review-feedback";
import { parseInterviewAnswerReview } from "@/lib/review-deep";
import { appendNote, noteExists, readNote, writeNote } from "@/lib/server/obsidian";

type Body = {
  notePath?: string;
  blockId?: string;
  kind?: ReviewFeedbackKind;
  text?: string;
};

const KINDS = new Set<ReviewFeedbackKind>(["agree", "disagree", "context"]);
let feedbackQueue = Promise.resolve();

async function inFeedbackQueue<T>(operation: () => Promise<T>) {
  const previous = feedbackQueue;
  let release = () => {};
  feedbackQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function basename(path: string) {
  return path.split("/").pop()?.replace(/\.md$/i, "") ?? path;
}

function yamlString(value: string) {
  return JSON.stringify(value);
}

function todayInTokyo() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const notePath = body.notePath ?? "";
  const blockId = body.blockId ?? "";
  const kind = body.kind ?? "agree";
  const feedbackText = (body.text ?? "").replace(/\s*\n\s*/g, "；").trim();
  const storedText = feedbackText || "同意该项 AI 评价";
  if (
    !notePath.startsWith("20_求職/") ||
    !notePath.endsWith("_整理稿.md") ||
    notePath.includes("..")
  ) {
    return Response.json({ error: "notePath 不是面试整理稿" }, { status: 400 });
  }
  if (!/^q\d+$/.test(blockId)) {
    return Response.json({ error: "blockId 格式不对" }, { status: 400 });
  }
  if (!KINDS.has(kind)) {
    return Response.json({ error: "kind 必须是 agree/disagree/context" }, { status: 400 });
  }
  if ((kind === "disagree" || kind === "context") && !feedbackText) {
    return Response.json({ error: "请说明不同意的理由或要补充的事实" }, { status: 400 });
  }
  if (feedbackText.length > 2000) {
    return Response.json({ error: "反馈内容过长" }, { status: 400 });
  }

  const reviewPath = notePath.replace(/_整理稿\.md$/, "_回答品質復盤.md");
  const feedbackPath = notePath.replace(/_整理稿\.md$/, "_回答品質批注.md");

  try {
    const [source, reviewNote] = await Promise.all([readNote(notePath), readNote(reviewPath)]);
    const review = parseInterviewAnswerReview(reviewNote.content);
    if (text(source.frontmatter.type) !== "transcript-study" || !review) {
      throw new Error("回答质量复盘尚未生成。");
    }
    if (!review.blocks.some((block) => block.blockId === blockId)) {
      throw new Error("深度复盘中找不到这个问题。");
    }

    const result = await inFeedbackQueue(async () => {
      const exists = await noteExists(feedbackPath);
      let current = "";
      if (exists) {
        current = (await readNote(feedbackPath)).content;
        const duplicate = parseReviewFeedback(current).find(
          (entry) => entry.blockId === blockId && entry.kind === kind && entry.text === storedText,
        );
        if (duplicate) return { id: duplicate.id, deduplicated: true };
      }
      let maxId = 0;
      for (const match of current.matchAll(/\*\*f(\d+)｜/g)) {
        maxId = Math.max(maxId, Number(match[1]));
      }
      const id = `f${String(maxId + 1).padStart(3, "0")}`;
      const entry = `\n- **${id}｜${blockId}｜${kind}｜${todayInTokyo()}**\n    - 我:: ${storedText}\n`;
      if (exists) {
        await appendNote(feedbackPath, entry);
      } else {
        const company = text(source.frontmatter.company);
        const date = text(source.frontmatter.date);
        const round = text(source.frontmatter.round);
        await writeNote(
          feedbackPath,
          `---\ntype: interview-answer-feedback\ncompany: ${yamlString(company)}\ndate: ${yamlString(date)}\nround: ${yamlString(round)}\nsource_note: ${yamlString(`[[${basename(notePath)}]]`)}\nreview_note: ${yamlString(`[[${basename(reviewPath)}]]`)}\nlayer: human-feedback\n---\n# ${date} ${company} 回答品質批注\n\n> 本人对 AI 回答质量复盘的同意、反对与事实补充。追记のみ。再生成时作为约束输入。\n\n## フィードバック\n${entry}`,
        );
      }
      return { id, deduplicated: false };
    });
    return Response.json({ ok: true, path: feedbackPath, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI 评价反馈写入失败";
    const status = message.includes("returned 404") ? 404 : 502;
    return Response.json({ error: message }, { status });
  }
}
