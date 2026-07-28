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
  appendNote,
  noteExists,
  readAllNotes,
  readNote,
  writeNote,
} from "@/lib/server/obsidian";

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
let progressQueue = Promise.resolve();

async function inProgressQueue<T>(operation: () => Promise<T>): Promise<T> {
  const previous = progressQueue;
  let release = () => {};
  progressQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

function supportsExercise(itemId: string, exercise: LanguageExpressionExercise) {
  const kind = itemId[0];
  if (exercise === "recall" || exercise === "collocation") return kind === "c";
  if (exercise === "substitution") return kind === "s";
  if (exercise === "improv") return kind === "r";
  return kind === "e" || kind === "n";
}

function invalid(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return invalid("请求体不是合法 JSON。");
  }

  const eventId = body.eventId?.trim() ?? "";
  const courseId = body.courseId?.trim() ?? "";
  const itemId = body.itemId?.trim().toLowerCase() ?? "";
  const exercise = body.exercise?.trim() as LanguageExpressionExercise;
  const action = body.action?.trim() as LanguageExpressionProgressAction;

  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(eventId)) {
    return invalid("eventId 格式不正确。");
  }
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(courseId)) {
    return invalid("courseId 格式不正确。");
  }
  if (!/^[csienr]\d+$/u.test(itemId)) {
    return invalid("itemId 格式不正确。");
  }
  if (!EXERCISES.has(exercise)) return invalid("exercise 不受支持。");
  if (!ACTIONS.has(action)) return invalid("action 不受支持。");
  if (!supportsExercise(itemId, exercise)) {
    return invalid("练习方式与项目类型不匹配。");
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
      return invalid("课程中不存在这个项目。");
    }

    const result = await inProgressQueue(async () => {
      const path = languageExpressionProgressPath(course);
      const exists = await noteExists(path);
      const current = exists ? await readNote(path) : undefined;
      const events = current
        ? parseLanguageExpressionProgress(current.content).filter(
            (event) => event.courseId === course.courseId,
          )
        : [];
      const duplicate = events.find((event) => event.eventId === eventId);
      if (duplicate) {
        return {
          deduplicated: true,
          event: duplicate,
          state: deriveLanguageExpressionProgress(events),
          path,
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
      if (exists) {
        await appendNote(path, renderLanguageExpressionProgressEvent(event));
      } else {
        await writeNote(path, renderLanguageExpressionProgressNote(course, event));
      }
      return {
        deduplicated: false,
        event,
        state: deriveLanguageExpressionProgress([...events, event]),
        path,
      };
    });

    return Response.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "专项训练进度写入失败。";
    const status = message.includes("returned 404") ? 404 : 502;
    return Response.json({ error: message }, { status });
  }
}
