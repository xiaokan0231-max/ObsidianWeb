import { tokyoParts, yamlScalar } from "@/lib/dojo/utils";
import { getString as text, noteBasename as basename } from "@/lib/notes";
import { parseInterviewAnswerReview } from "@/lib/review-deep";
import {
  parseInterviewPractice,
  renderInterviewPracticeEntry,
} from "@/lib/review-practice";
import { isReviewNotePath, reviewSiblingPath } from "@/lib/review-paths";
import { badRequest, obsidianErrorResponse } from "@/lib/server/api";
import { appendNote, readNote, readNoteOrNull, writeNote } from "@/lib/server/obsidian";
import { createSerialQueue } from "@/lib/server/serial-queue";

type Body = { notePath?: string; blockId?: string };

const inPracticeQueue = createSerialQueue();

// 追記の暦日は東京で揃える。UTC の瞬間をそのまま書くと JST 00:00–09:00 の操作だけ
// 前日の日付になり、同じ晩に押した「重练」と批注・フィードバックが別の日に記録される。
// 時刻は「本人がいつ選んだか」という行為の記録なので落とさない。日本に DST は無く +09:00 は固定。
function queuedAtInTokyo() {
  const { date, time } = tokyoParts();
  return `${date}T${time}+09:00`;
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
  if (!isReviewNotePath(notePath, "seirikou")) {
    return badRequest("notePath 不是面试整理稿");
  }
  if (!/^q\d+$/.test(blockId)) {
    return badRequest("blockId 格式不对");
  }

  const reviewPath = reviewSiblingPath(notePath, "answerReview");
  const practicePath = reviewSiblingPath(notePath, "practice");

  try {
    // 復盤は「まだ無い」が正常な状態（面接直後は整理稿だけが在る）。readNote で読むと
    // Obsidian の英語 404 が本文ごと画面に出てしまうので、無い場合は自前の文言に寄せる。
    const [source, reviewNote] = await Promise.all([
      readNote(notePath),
      readNoteOrNull(reviewPath),
    ]);
    if (text(source.frontmatter.type) !== "transcript-study") {
      throw new Error("目标笔记不是 transcript-study。");
    }
    if (!reviewNote || text(reviewNote.frontmatter.type) !== "interview-answer-review") {
      throw new Error("回答质量复盘尚未生成。");
    }
    const review = parseInterviewAnswerReview(reviewNote.content);
    const block = review?.blocks.find((item) => item.blockId === blockId);
    if (!block) throw new Error("深度复盘中找不到这个问题。");
    if (!block.improvedAnswerJa) throw new Error("这个问题还没有可练习的改善回答。");

    const result = await inPracticeQueue(async () => {
      // 存在判定と本文読みは同じ 1 往復で足りる。noteExists を挟むと同じ GET を 2 回打つ。
      const existing = await readNoteOrNull(practicePath);
      if (existing) {
        const duplicate = parseInterviewPractice(existing.content).find(
          (entry) => entry.blockId === blockId && entry.status === "queued",
        );
        if (duplicate) return { deduplicated: true };
      }

      const entry = renderInterviewPracticeEntry({
        blockId,
        status: "queued",
        queuedAt: queuedAtInTokyo(),
        questionTitle: block.questionTitle,
        improvedAnswerJa: block.improvedAnswerJa,
        evidenceSentenceIds: block.evidenceSentenceIds,
      });
      if (existing) {
        await appendNote(practicePath, entry);
      } else {
        const company = text(source.frontmatter.company);
        const date = text(source.frontmatter.date);
        const round = text(source.frontmatter.round);
        await writeNote(
          practicePath,
          `---\ntype: interview-answer-practice\ncompany: ${yamlScalar(company)}\ndate: ${yamlScalar(date)}\nround: ${yamlScalar(round)}\nsource_note: ${yamlScalar(`[[${basename(notePath)}]]`)}\nreview_note: ${yamlScalar(`[[${basename(reviewPath)}]]`)}\nlayer: user-action\n---\n# ${date} ${company} 回答練習\n\n> 本人が「重练」に選んだ質問のキュー。改善回答は AI 草稿であり、本人の事実や確定台本ではない。\n\n## 重练キュー\n${entry}`,
        );
      }
      return { deduplicated: false };
    });

    return Response.json({ ok: true, path: practicePath, ...result });
  } catch (error) {
    return obsidianErrorResponse(error, "重练队列写入失败");
  }
}
