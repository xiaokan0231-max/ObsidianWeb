import {
  deriveLanguageExpressionProgress,
  isLanguageExpressionCourseNote,
  languageExpressionProgressPath,
  parseLanguageExpressionCourse,
  parseLanguageExpressionProgress,
  renderLanguageExpressionProgressEvent,
  renderLanguageExpressionProgressNote,
  type LanguageExpressionExercise,
  type LanguageExpressionProgressAction,
  type LanguageExpressionProgressEvent,
} from "@/lib/language-expression-course";
import { badRequest, obsidianErrorResponse } from "@/lib/server/api";
import { upsertAppendNote } from "@/lib/server/note-append";
import { readAllNotes } from "@/lib/server/obsidian";
import { createSerialQueue } from "@/lib/server/serial-queue";

type Body = {
  eventId?: string;
  courseId?: string;
  itemId?: string;
  exercise?: string;
  action?: string;
};

const EXERCISES = new Set<LanguageExpressionExercise>([
  "recall",
  "collocation",
  "substitution",
  "improv",
  "rewrite",
]);
const ACTIONS = new Set<LanguageExpressionProgressAction>(["completed", "reopened"]);

// 「同じ eventId が既にあるか読む→追記する」を一本化し、連打時にも二重計上させない。
const inProgressQueue = createSerialQueue();

function supportsExercise(itemId: string, exercise: LanguageExpressionExercise) {
  const kind = itemId[0];
  if (exercise === "recall" || exercise === "collocation") return kind === "c";
  if (exercise === "substitution") return kind === "s";
  if (exercise === "improv") return kind === "r";
  return kind === "e" || kind === "n";
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return badRequest("请求体不是合法 JSON。");
  }

  const eventId = body.eventId?.trim() ?? "";
  const courseId = body.courseId?.trim() ?? "";
  const itemId = body.itemId?.trim().toLowerCase() ?? "";
  const exercise = body.exercise?.trim() as LanguageExpressionExercise;
  const action = body.action?.trim() as LanguageExpressionProgressAction;

  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(eventId)) {
    return badRequest("eventId 格式不正确。");
  }
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(courseId)) {
    return badRequest("courseId 格式不正确。");
  }
  if (!/^[csienr]\d+$/u.test(itemId)) {
    return badRequest("itemId 格式不正确。");
  }
  if (!EXERCISES.has(exercise)) return badRequest("exercise 不受支持。");
  if (!ACTIONS.has(action)) return badRequest("action 不受支持。");
  if (!supportsExercise(itemId, exercise)) {
    return badRequest("练习方式与项目类型不匹配。");
  }

  try {
    const notes = await readAllNotes();
    const source = notes.find(
      (note) =>
        isLanguageExpressionCourseNote(note) &&
        String(note.frontmatter.course_id ?? "").trim() === courseId,
    );
    if (!source) {
      return Response.json({ error: "找不到指定专项课程。" }, { status: 404 });
    }
    const course = parseLanguageExpressionCourse(source);
    if (!course) {
      return Response.json({ error: "指定笔记不是专项课程。" }, { status: 404 });
    }
    if (!course.itemIds.includes(itemId)) {
      return badRequest("课程中不存在这个项目。");
    }

    const path = languageExpressionProgressPath(course);
    // 存在判定と本文読みは同じ1往復で足りる（feedback route の教訓）。このコピーだけ
    // noteExists + readNote + appendNote 内の再判定で同じノートに 3 回 GET を打っていた。
    const outcome = await inProgressQueue(() =>
      upsertAppendNote({
        path,
        plan: (existing) => {
          const events = existing
            ? parseLanguageExpressionProgress(existing.content).filter(
                (event) => event.courseId === course.courseId,
              )
            : [];
          const duplicate = events.find((event) => event.eventId === eventId);
          if (duplicate) {
            return {
              duplicate: {
                event: duplicate,
                state: deriveLanguageExpressionProgress(events),
              },
            };
          }

          const event: LanguageExpressionProgressEvent = {
            eventId,
            courseId,
            itemId,
            exercise,
            action,
            at: new Date().toISOString(),
          };
          return {
            nextContent: existing
              ? `${existing.content}${renderLanguageExpressionProgressEvent(event)}`
              : renderLanguageExpressionProgressNote(course, event),
            value: {
              event,
              state: deriveLanguageExpressionProgress([...events, event]),
            },
            frontmatterForNew: {
              type: "language-expression-course-progress",
              course_id: course.courseId,
              topic: course.topic,
              source_note: `[[${course.notePath.replace(/\.md$/iu, "")}]]`,
              layer: "user-action",
            },
          };
        },
      }),
    );

    return Response.json({
      ok: true,
      path,
      ...outcome.value,
      deduplicated: outcome.deduplicated,
      note: outcome.note,
    });
  } catch (error) {
    return obsidianErrorResponse(error, "专项训练进度写入失败。");
  }
}
