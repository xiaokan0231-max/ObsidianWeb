import { errorResponse, readJson } from "@/lib/server/api";
import { invokeCodex } from "@/lib/server/codex-bridge";
import { readNote, readNoteOrNull, writeNote } from "@/lib/server/obsidian";
import {
  carryOverSections,
  normalizeInterviewAnswerReview,
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

    // 前回の回答品質復盤。上書きする前に、レンダラが再現できない節を回収しておく。
    const previousOutput = (await readNoteOrNull(outputPath))?.content ?? "";

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

    await writeNote(
      outputPath,
      renderInterviewAnswerReview(deepReview, {
        company: text(source.frontmatter.company),
        date: text(source.frontmatter.date),
        round: text(source.frontmatter.round),
        sourceName: basename(notePath),
        annotationName: annotationContent === null ? null : basename(annotationPath),
        feedbackName: feedbackExists ? basename(feedbackPath) : null,
        carriedSections: carryOverSections(previousOutput),
      }),
    );
    return Response.json({ ok: true, path: outputPath, review: deepReview });
  } catch (error) {
    return errorResponse(error, "生成回答质量复盘失败");
  }
}
