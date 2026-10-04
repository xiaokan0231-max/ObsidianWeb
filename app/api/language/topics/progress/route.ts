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
import {
  parseScenarioAttempts,
  prepareScenarioAttempt,
  renderScenarioAttempt,
  ScenarioConflictError,
  ScenarioValidationError,
} from "@/lib/language-scenario";
import { badRequest, obsidianErrorResponse } from "@/lib/server/api";
import { assertSameOrigin, errorResponse } from "@/lib/server/api";
import { upsertAppendNote } from "@/lib/server/note-append";
import { readAllNotes } from "@/lib/server/obsidian";
import { createKeyedSerialQueue } from "@/lib/server/serial-queue";

type Body = {
  eventId?: string;
  courseId?: string;
  itemId?: string;
  exercise?: string;
  action?: string;
  payload?: unknown;
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
const inProgressQueue = createKeyedSerialQueue();

function supportsExercise(itemId: string, exercise: LanguageExpressionExercise) {
  const kind = itemId[0];
  if (exercise === "recall" || exercise === "collocation") return kind === "c";
  if (exercise === "substitution") return kind === "s";
  if (exercise === "improv") return kind === "r";
  return kind === "e" || kind === "n";
}

export async function POST(request: Request) {
  // 同源でない呼び出しは 403。
  try { assertSameOrigin(request); } catch (error) { return errorResponse(error, "拒绝请求"); }
  let body: Body;
  try {
    const source = await request.text();
    if (source.length > 160000) return badRequest("作答记录过长，请分次保存。");
    const parsed: unknown = JSON.parse(source);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return badRequest("请求体必须是 JSON 对象。");
    body = parsed as Body;
  } catch {
    return badRequest("请求体不是合法 JSON。");
  }

  const eventId = typeof body.eventId === "string" ? body.eventId.trim() : "";
  const courseId = typeof body.courseId === "string" ? body.courseId.trim() : "";
  const itemId = typeof body.itemId === "string" ? body.itemId.trim().toLowerCase() : "";
  const exercise = typeof body.exercise === "string" ? body.exercise.trim() : "";
  const action = typeof body.action === "string" ? body.action.trim() : "";

  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(eventId)) {
    return badRequest("eventId 格式不正确。");
  }
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(courseId)) {
    return badRequest("courseId 格式不正确。");
  }
  if (exercise !== "scenario") {
    if (!/^[csienr]\d+$/u.test(itemId)) return badRequest("itemId 格式不正确。");
    if (!EXERCISES.has(exercise as LanguageExpressionExercise)) return badRequest("exercise 不受支持。");
    if (!ACTIONS.has(action as LanguageExpressionProgressAction)) return badRequest("action 不受支持。");
    if (!supportsExercise(itemId, exercise as LanguageExpressionExercise)) return badRequest("练习方式与项目类型不匹配。");
  } else if (!["checkpoint", "completed"].includes(action)) {
    return badRequest("情境保存操作不受支持。");
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
    if (exercise === "scenario") {
      if (!course.scenario) return badRequest("指定课程不是情境课。");
      const lesson = course.scenario;
      const path = languageExpressionProgressPath(course);
      const outcome = await inProgressQueue(path, () =>
        upsertAppendNote({
          path,
          plan: (existing) => {
            const prepared = prepareScenarioAttempt({
              courseId, lesson, eventId, action, payload: body.payload,
              events: existing ? parseScenarioAttempts(existing.content) : [],
              at: new Date().toISOString(),
            });
            const value = { event: prepared.event, scenarioState: prepared.scenarioState };
            if (prepared.deduplicated) return { duplicate: value };
            return {
              nextContent: `${existing?.content ?? renderLanguageExpressionProgressNote(course)}${renderScenarioAttempt(prepared.event)}`,
              value,
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
      return Response.json({ ok: true, path, ...outcome.value, deduplicated: outcome.deduplicated, note: outcome.note });
    }
    if (course.scenario) return badRequest("情境课请使用分步作答保存。");
    if (!course.itemIds.includes(itemId)) {
      return badRequest("课程中不存在这个项目。");
    }

    const path = languageExpressionProgressPath(course);
    // 存在判定と本文読みは同じ1往復で足りる（feedback route の教訓）。このコピーだけ
    // noteExists + readNote + appendNote 内の再判定で同じノートに 3 回 GET を打っていた。
    const outcome = await inProgressQueue(path, () =>
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
            exercise: exercise as LanguageExpressionExercise,
            action: action as LanguageExpressionProgressAction,
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
    if (error instanceof ScenarioValidationError || error instanceof ScenarioConflictError) {
      return errorResponse(error, "情境练习保存失败。");
    }
    return obsidianErrorResponse(error, "专项训练进度写入失败。");
  }
}
