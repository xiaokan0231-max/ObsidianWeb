import { errorResponse, readJson } from "@/lib/server/api";
import { invokeCodex } from "@/lib/server/codex-bridge";
import { readNote, writeNote } from "@/lib/server/obsidian";
import {
  normalizeInterviewAnswerReview,
  renderInterviewAnswerReview,
} from "@/lib/review-deep";
import {
  parseAnnotations,
  parseSeirikou,
  reviewDecisionTasks,
  uniqueAnnotations,
} from "@/lib/review";
import { parseReviewFeedback, uniqueReviewFeedback } from "@/lib/review-feedback";

type Body = { notePath?: string };

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function basename(path: string) {
  return path.split("/").pop()?.replace(/\.md$/, "") ?? path;
}

export async function POST(request: Request) {
  try {
    const body = await readJson<Body>(request);
    const notePath = body.notePath ?? "";
    if (
      !notePath.startsWith("20_求職/") ||
      !notePath.endsWith("_整理稿.md") ||
      notePath.includes("..")
    ) {
      throw new Error("notePath 不是面试整理稿。");
    }

    const annotationPath = notePath.replace(/_整理稿\.md$/, "_批注.md");
    const existingReviewPath = notePath.replace(/_整理稿\.md$/, "_復盤.md");
    const feedbackPath = notePath.replace(/_整理稿\.md$/, "_回答品質批注.md");
    const outputPath = notePath.replace(/_整理稿\.md$/, "_回答品質復盤.md");
    const [source, annotation] = await Promise.all([
      readNote(notePath),
      readNote(annotationPath),
    ]);
    if (text(source.frontmatter.type) !== "transcript-study") {
      throw new Error("目标笔记不是 transcript-study。");
    }

    const parsed = parseSeirikou(source.content);
    const annotations = uniqueAnnotations(parseAnnotations(annotation.content));
    const tasks = reviewDecisionTasks(parsed.sentences, annotations);
    const unresolved = tasks.filter((task) => !task.resolvedBy);
    if (unresolved.length > 0) {
      throw new Error(`请先完成第一阶段批注，目前还剩 ${unresolved.length} 项待裁定。`);
    }

    let existingReview = "";
    try {
      existingReview = (await readNote(existingReviewPath)).content;
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("returned 404")) throw error;
    }

    let humanFeedback = [] as ReturnType<typeof parseReviewFeedback>;
    try {
      humanFeedback = uniqueReviewFeedback(
        parseReviewFeedback((await readNote(feedbackPath)).content),
      );
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("returned 404")) throw error;
    }

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
      new Set(parsed.blocks.map((block) => block.id)),
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
        annotationName: basename(annotationPath),
      }),
    );
    return Response.json({ ok: true, path: outputPath, review: deepReview });
  } catch (error) {
    return errorResponse(error, "生成回答质量复盘失败");
  }
}
