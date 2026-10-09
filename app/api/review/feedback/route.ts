import {
  isReviewFeedbackTarget,
  parseReviewFeedback,
  renderReviewFeedbackEntry,
  resolveReviewFeedbackTarget,
  reviewFeedbackIdentity,
  type ReviewFeedbackTarget,
  type ReviewFeedbackKind,
} from "@/lib/review-feedback";
import { getString as text, noteBasename as basename } from "@/lib/notes";
import { assertSameOrigin, errorResponse } from "@/lib/server/api";
import { parseInterviewInsights } from "@/lib/interview-advisory";
import { parseInterviewAnswerReview } from "@/lib/review-deep";
import { isReviewNotePath, reviewSiblingPath } from "@/lib/review-paths";
import { badRequest, obsidianErrorResponse } from "@/lib/server/api";
import { upsertAppendNote } from "@/lib/server/note-append";
import { readNote, readNoteOrNull } from "@/lib/server/obsidian";
import { createKeyedSerialQueue } from "@/lib/server/serial-queue";
import { tokyoParts, yamlScalar } from "@/lib/dojo/utils";

type Body = {
  notePath?: string;
  blockId?: string;
  kind?: ReviewFeedbackKind;
  text?: string;
  target?: ReviewFeedbackTarget;
};

const INSIGHTS_PATH = "20_求職/_素材/面接横断_顧問分析.md";
const INSIGHTS_FEEDBACK_PATH = "20_求職/_素材/面接横断_顧問批注.md";

const KINDS = new Set<ReviewFeedbackKind>(["agree", "disagree", "context"]);
const inFeedbackQueue = createKeyedSerialQueue();

function todayInTokyo() {
  return tokyoParts().date;
}

export async function POST(request: Request) {
  // 同源でない呼び出しは 403。
  try { assertSameOrigin(request); } catch (error) { return errorResponse(error, "拒绝请求"); }
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return badRequest("请求体不是合法 JSON");
  }

  if (!body || typeof body !== "object" || (body.notePath !== undefined && typeof body.notePath !== "string")
    || (body.blockId !== undefined && typeof body.blockId !== "string")
    || (body.text !== undefined && typeof body.text !== "string")) {
    return badRequest("反馈字段格式不对");
  }
  if (body.target !== undefined && !isReviewFeedbackTarget(body.target)) {
    return badRequest("target 必须包含观点类型、ID、版本和快照");
  }
  const requestedTarget = body.target;
  const isInsights = requestedTarget?.type === "insight";
  const notePath = body.notePath ?? "";
  const blockId = body.blockId ?? "";
  const kind = body.kind ?? "agree";
  // trim が先。逆にすると改行だけの入力が「；」になって非空判定を素通りし、
  // 「理由を書け」の門檻が空文字だけしか止められなくなる（批注 route と同じ穴）。
  const feedbackText = (body.text ?? "").trim().replace(/\s*\n\s*/g, "；");
  const storedText = feedbackText || "同意该项 AI 评价";
  if (isInsights ? notePath !== INSIGHTS_PATH : !isReviewNotePath(notePath, "seirikou")) {
    return badRequest(isInsights ? "notePath 不是横向分析报告" : "notePath 不是面试整理稿");
  }
  if (!requestedTarget && !/^q\d+$/.test(blockId)) {
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

  const reviewPath = isInsights ? INSIGHTS_PATH : reviewSiblingPath(notePath, "answerReview");
  const feedbackPath = isInsights ? INSIGHTS_FEEDBACK_PATH : reviewSiblingPath(notePath, "answerFeedback");

  try {
    // 復盤は「まだ無い」が正常な状態（面接直後は整理稿だけが在る）。readNote で読むと
    // Obsidian の英語 404 が本文ごと画面に出てしまうので、無い場合は自前の文言に寄せる。
    const [source, reviewNote] = await Promise.all([
      readNote(notePath),
      readNoteOrNull(reviewPath),
    ]);
    let target: ReviewFeedbackTarget | undefined;
    if (requestedTarget) {
      const insights = isInsights && reviewNote ? parseInterviewInsights(reviewNote.content) : null;
      const advisory = !isInsights && reviewNote ? parseInterviewAnswerReview(reviewNote.content)?.advisory : null;
      const analysis = insights ?? advisory;
      if (!analysis || text(source.frontmatter.type) !== (isInsights ? "interview-insights" : "transcript-study")) {
        return badRequest("顾问分析尚未生成。");
      }
      try {
        target = resolveReviewFeedbackTarget(requestedTarget, {
          generatedAt: analysis.generatedAt,
          opinions: insights
            ? insights.modules.flatMap((module) => module.findings)
            : [...advisory!.observations, ...advisory!.answerOptions, ...advisory!.nextSteps],
        });
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "观点版本不匹配" }, { status: 409 });
      }
    } else {
      const review = reviewNote ? parseInterviewAnswerReview(reviewNote.content) : null;
      if (text(source.frontmatter.type) !== "transcript-study" || !review) {
        throw new Error("回答质量复盘尚未生成。");
      }
      if (!review.blocks.some((block) => block.blockId === blockId)) {
        throw new Error("深度复盘中找不到这个问题。");
      }
    }
    const feedbackIdentity = reviewFeedbackIdentity({ blockId: target ? "" : blockId, kind, text: storedText, target });

    const outcome = await inFeedbackQueue(feedbackPath, () =>
      upsertAppendNote({
        path: feedbackPath,
        plan: (existing) => {
          const current = existing?.content ?? "";
          if (existing) {
            const duplicate = parseReviewFeedback(current).find(
              (entry) => reviewFeedbackIdentity(entry) === feedbackIdentity,
            );
            if (duplicate) return { duplicate: { id: duplicate.id } };
          }
          let maxId = 0;
          for (const match of current.matchAll(/\*\*f(\d+)｜/g)) {
            maxId = Math.max(maxId, Number(match[1]));
          }
          const id = `f${String(maxId + 1).padStart(3, "0")}`;
          const entry = renderReviewFeedbackEntry({ id, blockId: target ? "" : blockId, kind, date: todayInTokyo(), text: storedText, ...(target ? { target } : {}) });
          if (existing) {
            return { nextContent: `${current}${entry}`, value: { id } };
          }
          const company = text(source.frontmatter.company);
          const date = text(source.frontmatter.date);
          const round = text(source.frontmatter.round);
          const feedbackType = isInsights ? "interview-insights-feedback" : "interview-answer-feedback";
          const title = isInsights ? "面接横断 顧問批注" : `${date} ${company} 回答品質批注`;
          return {
            nextContent: `---\ntype: ${feedbackType}\ncompany: ${yamlScalar(company)}\ndate: ${yamlScalar(date)}\nround: ${yamlScalar(round)}\nsource_note: ${yamlScalar(`[[${basename(notePath)}]]`)}\nreview_note: ${yamlScalar(`[[${basename(reviewPath)}]]`)}\nlayer: human-feedback\n---\n# ${title}\n\n> 本人对 AI 回答质量与顾问分析的同意、反对与事实补充。追记のみ。対象记录原观点版本和快照，再生成时重新核对。\n\n## フィードバック\n${entry}`,
            value: { id },
            frontmatterForNew: {
              type: feedbackType,
              company,
              date,
              round,
              source_note: `[[${basename(notePath)}]]`,
              review_note: `[[${basename(reviewPath)}]]`,
              layer: "human-feedback",
            },
          };
        },
      }),
    );
    return Response.json({
      ok: true,
      path: feedbackPath,
      ...outcome.value,
      deduplicated: outcome.deduplicated,
      note: outcome.note,
    });
  } catch (error) {
    return obsidianErrorResponse(error, "AI 评价反馈写入失败");
  }
}
