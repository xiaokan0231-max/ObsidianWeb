import { parseInterviewAnswerReview } from "@/lib/review-deep";
import {
  parseInterviewPractice,
  renderInterviewPracticeEntry,
} from "@/lib/review-practice";
import {
  appendNote,
  noteExists,
  readNote,
  writeNote,
} from "@/lib/server/obsidian";

type Body = { notePath?: string; blockId?: string };

let practiceQueue = Promise.resolve();

async function inPracticeQueue<T>(operation: () => Promise<T>) {
  const previous = practiceQueue;
  let release = () => {};
  practiceQueue = new Promise<void>((resolve) => {
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

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const notePath = body.notePath ?? "";
  const blockId = body.blockId ?? "";
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

  const reviewPath = notePath.replace(/_整理稿\.md$/, "_回答品質復盤.md");
  const practicePath = notePath.replace(/_整理稿\.md$/, "_回答練習.md");

  try {
    const [source, reviewNote] = await Promise.all([readNote(notePath), readNote(reviewPath)]);
    if (text(source.frontmatter.type) !== "transcript-study") {
      throw new Error("目标笔记不是 transcript-study。");
    }
    if (text(reviewNote.frontmatter.type) !== "interview-answer-review") {
      throw new Error("回答质量复盘尚未生成。");
    }
    const review = parseInterviewAnswerReview(reviewNote.content);
    const block = review?.blocks.find((item) => item.blockId === blockId);
    if (!block) throw new Error("深度复盘中找不到这个问题。");
    if (!block.improvedAnswerJa) throw new Error("这个问题还没有可练习的改善回答。");

    const result = await inPracticeQueue(async () => {
      const exists = await noteExists(practicePath);
      if (exists) {
        const current = await readNote(practicePath);
        const duplicate = parseInterviewPractice(current.content).find(
          (entry) => entry.blockId === blockId && entry.status === "queued",
        );
        if (duplicate) return { deduplicated: true };
      }

      const entry = renderInterviewPracticeEntry({
        blockId,
        status: "queued",
        queuedAt: new Date().toISOString(),
        questionTitle: block.questionTitle,
        improvedAnswerJa: block.improvedAnswerJa,
        evidenceSentenceIds: block.evidenceSentenceIds,
      });
      if (exists) {
        await appendNote(practicePath, entry);
      } else {
        const company = text(source.frontmatter.company);
        const date = text(source.frontmatter.date);
        const round = text(source.frontmatter.round);
        await writeNote(
          practicePath,
          `---\ntype: interview-answer-practice\ncompany: ${yamlString(company)}\ndate: ${yamlString(date)}\nround: ${yamlString(round)}\nsource_note: ${yamlString(`[[${basename(notePath)}]]`)}\nreview_note: ${yamlString(`[[${basename(reviewPath)}]]`)}\nlayer: user-action\n---\n# ${date} ${company} 回答練習\n\n> 本人が「重练」に選んだ質問のキュー。改善回答は AI 草稿であり、本人の事実や確定台本ではない。\n\n## 重练キュー\n${entry}`,
        );
      }
      return { deduplicated: false };
    });

    return Response.json({ ok: true, path: practicePath, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "重练队列写入失败";
    const status = message.includes("returned 404") ? 404 : 502;
    return Response.json({ error: message }, { status });
  }
}
