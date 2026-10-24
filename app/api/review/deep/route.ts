import { errorResponse, readJson } from "@/lib/server/api";
import { invokeCodex } from "@/lib/server/codex-bridge";
import { readNote, readNoteOrNull, writeNote } from "@/lib/server/obsidian";
import {
  carryOverSections,
  normalizeInterviewAnswerReview,
  parseInterviewAnswerReview,
  renderInterviewAnswerReview,
} from "@/lib/review-deep";
import {
  parseAnnotations,
  parseSeirikou,
  reviewDecisionTasks,
  uniqueAnnotations,
} from "@/lib/review";
import { getString as text, noteBasename as basename } from "@/lib/notes";
import { parseReviewFeedback, uniqueReviewFeedback } from "@/lib/review-feedback";
import { isReviewNotePath, reviewSiblingPath } from "@/lib/review-paths";
import { interviewAdvisory } from "@/lib/server/interview-advisory";
import { withReviewWrite } from "@/lib/server/review-write-queue";
import { commitReviewWithFreshInputs } from "@/lib/server/review-input-guard";

type Body = { notePath?: string };

export async function POST(request: Request) {
  try {
    const body = await readJson<Body>(request);
    const notePath = body.notePath ?? "";
    if (!isReviewNotePath(notePath, "seirikou")) {
      throw new Error("notePath 不是面试整理稿。");
    }

    const annotationPath = reviewSiblingPath(notePath, "annotation");
    const existingReviewPath = reviewSiblingPath(notePath, "review");
    const feedbackPath = reviewSiblingPath(notePath, "answerFeedback");
    const outputPath = reviewSiblingPath(notePath, "answerReview");
    // 批注ファイルは任意。裁定が必要な文が一つも無い回（あるいは compact で
    // 畳まれた回）には存在しない。Web 側は既に無い前提で描いているので、
    // ここで 404 を投げると再生成ボタンだけが理由なく死ぬ。門檻は下の
    // unresolved で見ており、批注が無ければ「裁定ゼロ」として素通りするのが正しい。
    const annotationContent = (await readNoteOrNull(annotationPath))?.content ?? null;
    const source = await readNote(notePath);
    if (text(source.frontmatter.type) !== "transcript-study") {
      throw new Error("目标笔记不是 transcript-study。");
    }

    const parsed = parseSeirikou(source.content);
    const annotations = uniqueAnnotations(parseAnnotations(annotationContent ?? ""));
    const tasks = reviewDecisionTasks(parsed.sentences, annotations);
    const unresolved = tasks.filter((task) => !task.resolvedBy);
    if (unresolved.length > 0) {
      throw new Error(`请先完成第一阶段批注，目前还剩 ${unresolved.length} 项待裁定。`);
    }

    const existingReview = (await readNoteOrNull(existingReviewPath))?.content ?? "";

    const feedbackNote = await readNoteOrNull(feedbackPath);
    const feedbackExists = feedbackNote !== null;
    const humanFeedback = feedbackNote
      ? uniqueReviewFeedback(parseReviewFeedback(feedbackNote.content))
      : ([] as ReturnType<typeof parseReviewFeedback>);

    const bySentence = new Map<string, typeof annotations>();
    for (const item of annotations) {
      const list = bySentence.get(item.sentenceId) ?? [];
      list.push(item);
      bySentence.set(item.sentenceId, list);
    }
    const result = await invokeCodex<Record<string, unknown>>("review_interview_answers", {
      company: text(source.frontmatter.company),
      date: text(source.frontmatter.date),
      round: text(source.frontmatter.round),
      blocks: parsed.blocks.map((block) => ({
        id: block.id,
        title: block.title,
        summary: block.summary ?? "",
        sentences: block.sentences.map((sentence) => ({
          id: sentence.id,
          speaker: sentence.speaker,
          text: sentence.sei,
          original: sentence.gen ?? "",
          translationZh: sentence.yaku ?? "",
          notes: sentence.notes,
          annotations: bySentence.get(sentence.id) ?? [],
        })),
      })),
      existingReview,
      humanFeedback,
      analysisBoundary: {
        exclude: "逐句语法评分、转录质量评分",
        include: "问题理解、子问覆盖、相关性、完整性、面试策略风险、改善回答",
      },
    });
    const generatedAt = new Date().toISOString();
    // 写入前核对原始输出，不能让规范化静默过滤掉模型漏答或跨题引用。
    const rawBlocks = Array.isArray(result.output.blocks) ? result.output.blocks as Record<string, unknown>[] : [];
    const byBlock = new Map(parsed.blocks.map((block) => [block.id, new Set(block.sentences.map((sentence) => sentence.id))]));
    if (rawBlocks.length !== parsed.blocks.length || new Set(rawBlocks.map((block) => block.blockId)).size !== parsed.blocks.length ||
      rawBlocks.some((block) => !byBlock.has(String(block.blockId)) ||
        !Array.isArray(block.evidenceSentenceIds) || block.evidenceSentenceIds.some((id) => !byBlock.get(String(block.blockId))!.has(String(id))))) {
      throw new Error("回答质量复盘的问题覆盖或证据归属无效，原报告已保留。");
    }
    const deepReview = normalizeInterviewAnswerReview(
      result.output,
      { generatedAt, model: result.model },
      new Map(
        parsed.blocks.map((block) => [
          block.id,
          new Set(block.sentences.map((sentence) => sentence.id)),
        ]),
      ),
    );
    if (!deepReview.blocks.length) {
      throw new Error("Codex 没有返回可用的问题块；Vault 未写入，请重试。");
    }

    await withReviewWrite(outputPath, async () => {
      await commitReviewWithFreshInputs([
        { path: notePath, content: source.content },
        { path: annotationPath, content: annotationContent },
        { path: feedbackPath, content: feedbackNote?.content ?? null },
      ], readNoteOrNull, async () => {
        // 模型运行期间可能已有新的顾问评论或人工章节，保留最新版本而非调用前快照。
        const previousOutput = (await readNoteOrNull(outputPath))?.content ?? "";
        await writeNote(outputPath, renderInterviewAnswerReview(deepReview, {
          company: text(source.frontmatter.company),
          date: text(source.frontmatter.date),
          round: text(source.frontmatter.round),
          sourceName: basename(notePath),
          annotationName: annotationContent === null ? null : basename(annotationPath),
          feedbackName: feedbackExists ? basename(feedbackPath) : null,
          carriedSections: carryOverSections(previousOutput),
          preservedAdvisory: parseInterviewAnswerReview(previousOutput)?.advisory,
        }));
      });
    });
    // 评分先独立保存。顾问生成失败也不能把已完成的回答复盘报成保存失败。
    try {
      const advisory = await interviewAdvisory.generateSource(notePath);
      return Response.json({ ok: true, path: outputPath, review: deepReview, advisory: advisory.report });
    } catch (error) {
      return Response.json({ ok: true, path: outputPath, review: deepReview,
        advisoryError: error instanceof Error ? error.message : "顾问分析待重试。" });
    }
  } catch (error) {
    return errorResponse(error, "生成回答质量复盘失败");
  }
}
