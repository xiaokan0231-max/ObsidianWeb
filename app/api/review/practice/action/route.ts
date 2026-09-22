import { tokyoParts } from "@/lib/dojo/utils";
import { getString } from "@/lib/notes";
import {
  parseInterviewPractice,
  renderInterviewPracticeAction,
  type InterviewPracticeAction,
  type InterviewPracticeRating,
} from "@/lib/review-practice";
import { isReviewNotePath } from "@/lib/review-paths";
import { errorResponse, readJson } from "@/lib/server/api";
import { upsertAppendNote } from "@/lib/server/note-append";
import { createKeyedSerialQueue } from "@/lib/server/serial-queue";

type Body = {
  practicePath?: string;
  blockId?: string;
  action?: InterviewPracticeAction;
  rating?: InterviewPracticeRating;
};

const ACTIONS = new Set<InterviewPracticeAction>(["attempt", "complete", "snooze"]);
const RATINGS = new Set<InterviewPracticeRating>(["smooth", "stuck", "unknown"]);
const inPracticeActionQueue = createKeyedSerialQueue();

function actionAtInTokyo() {
  const { date, time } = tokyoParts();
  return `${date}T${time}+09:00`;
}

function tomorrowInTokyo() {
  const { date } = tokyoParts();
  const tomorrow = new Date(`${date}T00:00:00+09:00`);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(tomorrow);
}

export async function POST(request: Request) {
  try {
    const body = await readJson<Body>(request);
    const practicePath = (body.practicePath ?? "").trim();
    const blockId = (body.blockId ?? "").trim();
    const action = body.action;
    const rating = body.rating;
    if (!isReviewNotePath(practicePath, "practice")) throw new Error("practicePath 不是回答练习笔记。");
    if (!/^q\d+$/.test(blockId)) throw new Error("blockId 格式不对。");
    if (!action || !ACTIONS.has(action)) throw new Error("未知的练习动作。");
    if (action === "attempt" && (!rating || !RATINGS.has(rating))) throw new Error("练习尝试必须包含自评。");
    if (rating && !RATINGS.has(rating)) throw new Error("未知的自评值。");

    const at = actionAtInTokyo();
    const dueAt = action === "snooze" ? tomorrowInTokyo() : undefined;
    const outcome = await inPracticeActionQueue(practicePath, () =>
      upsertAppendNote<{ status: string }>({
        path: practicePath,
        plan: (existing) => {
          if (!existing || getString(existing.frontmatter.type) !== "interview-answer-practice") {
            throw new Error("回答练习笔记不存在。");
          }
          const entry = parseInterviewPractice(existing.content).find((item) => item.blockId === blockId);
          if (!entry) throw new Error("练习队列中找不到这个问题。");
          if (entry.status === "completed") return { duplicate: { status: entry.status } };
          const append = renderInterviewPracticeAction({ blockId, action, at, rating, dueAt });
          return { nextContent: `${existing.content}${append}`, value: { status: action === "complete" ? "completed" : action === "snooze" ? "snoozed" : "active" } };
        },
      }),
    );
    return Response.json({
      ok: true,
      path: practicePath,
      status: outcome.value.status,
      dueAt,
      deduplicated: outcome.deduplicated,
      note: outcome.note,
    });
  } catch (error) {
    return errorResponse(error, "记录回答练习失败");
  }
}
