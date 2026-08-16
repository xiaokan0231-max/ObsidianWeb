import {
  parseReviewFeedback,
  type ReviewFeedbackKind,
} from "@/lib/review-feedback";
import { getString as text, noteBasename as basename } from "@/lib/notes";
import { parseInterviewAnswerReview } from "@/lib/review-deep";
import { isReviewNotePath, reviewSiblingPath } from "@/lib/review-paths";
import { badRequest, obsidianErrorResponse } from "@/lib/server/api";
import { appendNote, readNote, readNoteOrNull, writeNote } from "@/lib/server/obsidian";
import { createSerialQueue } from "@/lib/server/serial-queue";
import { tokyoParts, yamlScalar } from "@/lib/dojo/utils";

type Body = {
  notePath?: string;
  blockId?: string;
  kind?: ReviewFeedbackKind;
  text?: string;
};

const KINDS = new Set<ReviewFeedbackKind>(["agree", "disagree", "context"]);
const inFeedbackQueue = createSerialQueue();

function todayInTokyo() {
  return tokyoParts().date;
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return badRequest("请求体不是合法 JSON");
  }

  const notePath = body.notePath ?? "";
  const blockId = body.blockId ?? "";
  const kind = body.kind ?? "agree";
  // trim が先。逆にすると改行だけの入力が「；」になって非空判定を素通りし、
  // 「理由を書け」の門檻が空文字だけしか止められなくなる（批注 route と同じ穴）。
  const feedbackText = (body.text ?? "").trim().replace(/\s*\n\s*/g, "；");
  const storedText = feedbackText || "同意该项 AI 评价";
  if (!isReviewNotePath(notePath, "seirikou")) {
    return badRequest("notePath 不是面试整理稿");
  }
  if (!/^q\d+$/.test(blockId)) {
    return badRequest("blockId 格式不对");
  }
  if (!KINDS.has(kind)) {
    return badRequest("kind 必须是 agree/disagree/context");
  }
  if ((kind === "disagree" || kind === "context") && !feedbackText) {
    return badRequest("请说明不同意的理由或要补充的事实");
  }
  if (feedbackText.length > 2000) {
    return badRequest("反馈内容过长");
  }

  const reviewPath = reviewSiblingPath(notePath, "answerReview");
  const feedbackPath = reviewSiblingPath(notePath, "answerFeedback");

  try {
    // 復盤は「まだ無い」が正常な状態（面接直後は整理稿だけが在る）。readNote で読むと
    // Obsidian の英語 404 が本文ごと画面に出てしまうので、無い場合は自前の文言に寄せる。
    const [source, reviewNote] = await Promise.all([
      readNote(notePath),
      readNoteOrNull(reviewPath),
    ]);
    const review = reviewNote ? parseInterviewAnswerReview(reviewNote.content) : null;
    if (text(source.frontmatter.type) !== "transcript-study" || !review) {
      throw new Error("回答质量复盘尚未生成。");
    }
    if (!review.blocks.some((block) => block.blockId === blockId)) {
      throw new Error("深度复盘中找不到这个问题。");
    }

    const result = await inFeedbackQueue(async () => {
      // 存在判定と本文読みは同じ 1 往復で足りる。noteExists を挟むと同じ GET を 2 回打つ。
      const existing = await readNoteOrNull(feedbackPath);
      const current = existing?.content ?? "";
      if (existing) {
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
      if (existing) {
        await appendNote(feedbackPath, entry);
      } else {
        const company = text(source.frontmatter.company);
        const date = text(source.frontmatter.date);
        const round = text(source.frontmatter.round);
        await writeNote(
          feedbackPath,
          `---\ntype: interview-answer-feedback\ncompany: ${yamlScalar(company)}\ndate: ${yamlScalar(date)}\nround: ${yamlScalar(round)}\nsource_note: ${yamlScalar(`[[${basename(notePath)}]]`)}\nreview_note: ${yamlScalar(`[[${basename(reviewPath)}]]`)}\nlayer: human-feedback\n---\n# ${date} ${company} 回答品質批注\n\n> 本人对 AI 回答质量复盘的同意、反对与事实补充。追记のみ。再生成时作为约束输入。\n\n## フィードバック\n${entry}`,
        );
      }
      return { id, deduplicated: false };
    });
    return Response.json({ ok: true, path: feedbackPath, ...result });
  } catch (error) {
    return obsidianErrorResponse(error, "AI 评价反馈写入失败");
  }
}
