import type { Note } from "../notes.ts";
import { getType } from "../notes.ts";
import {
  ADVISORY_STATE_PATH, INSIGHTS_FEEDBACK_PATH, INSIGHTS_PATH,
  advisoryFingerprint, advisoryValidationContext, buildAdvisoryInput, crossInterviewInput,
} from "../advisory-input.ts";
import {
  mergeAdvisoryIntoReview, normalizeInterviewAdvisory, normalizeInterviewInsights,
  parseInterviewInsights, mergeInterviewInsights,
} from "../interview-advisory.ts";
import { parseInterviewAnswerReview } from "../review-deep.ts";
import { parseReviewFeedback, uniqueReviewFeedback } from "../review-feedback.ts";
import { isReviewNotePath, reviewSiblingPath } from "../review-paths.ts";
import { createKeyedSerialQueue } from "./serial-queue.ts";
import { withReviewWrite } from "./review-write-queue.ts";

type Task = "review_interview_advisory" | "review_interview_insights";
type Dependencies = {
  readAll: () => Promise<Note[]>;
  read: (path: string) => Promise<Note | null>;
  write: (path: string, content: string) => Promise<unknown>;
  invoke: (task: Task, payload: Record<string, unknown>) => Promise<{ output: Record<string, unknown>; model: string }>;
};
type Failure = { fingerprint: string; message: string; attemptedAt: string };
type FailureState = Record<string, Failure>;
export type AdvisoryCoverage = {
  sourcePath: string; company: string; date: string; round: string;
  status: "ready" | "stale" | "missing" | "blocked";
  reason: string; fingerprint: string; stage?: string; lastError?: string;
};
const STATE_MARKER = "<!-- interview-advisory-state -->";

function failuresFrom(note: Note | null | undefined): FailureState {
  if (!note) return {};
  const raw = note.content.split(STATE_MARKER)[1]?.match(/```json\s*([\s\S]*?)```/)?.[1];
  if (!raw) return {};
  try { return JSON.parse(raw) as FailureState; } catch { return {}; }
}

/** 依赖注入让失败、并发、来源变化的验收用真实状态机，不必启动模型或真实Vault。 */
export function createAdvisoryEngine(deps: Dependencies) {
  const sourceQueue = createKeyedSerialQueue(1000);
  const stateQueue = createKeyedSerialQueue(1000);
  const active = new Map<string, { stage: "advisory" | "insights"; sourcePath: string }>();
  const flights = new Map<string, Promise<unknown>>();

  async function recordFailure(key: string, failure: Failure | null) {
    await stateQueue(ADVISORY_STATE_PATH, async () => {
      const current = failuresFrom(await deps.read(ADVISORY_STATE_PATH));
      if (failure) current[key] = failure;
      else delete current[key];
      const content = `---\ntype: interview-advisory-state\nlayer: machine-state\n---\n# 面试顾问分析更新状态\n\n> 仅记录失败与重试依据；正文分析始终保存在各自报告中。\n\n${STATE_MARKER}\n\`\`\`json\n${JSON.stringify(current, null, 2)}\n\`\`\`\n`;
      await deps.write(ADVISORY_STATE_PATH, content);
    });
  }

  async function collect() {
    const notes = await deps.readAll();
    const failures = failuresFrom(notes.find((note) => note.path === ADVISORY_STATE_PATH));
    const sources = notes.filter((note) => getType(note) === "transcript-study" && isReviewNotePath(note.path, "seirikou"))
      .sort((a, b) => String(b.frontmatter.date).localeCompare(String(a.frontmatter.date)) || a.path.localeCompare(b.path));
    const inputs = sources.map((source) => buildAdvisoryInput(notes, source.path));
    const coverage: AdvisoryCoverage[] = await Promise.all(inputs.map(async (input) => {
      const fingerprint = await advisoryFingerprint(input.payload);
      const advisory = input.review?.advisory;
      const status = input.reason ? "blocked" : !advisory ? "missing" : advisory.sourceFingerprint === fingerprint ? "ready" : "stale";
      const failure = failures[input.source.path];
      return {
        sourcePath: input.source.path, company: input.payload.company, date: input.payload.date, round: input.payload.round,
        fingerprint, status,
        reason: input.reason || (status === "stale" ? "原话、本人补充或背景资料已更新。" : status === "missing" ? "尚未补充顾问分析。" : ""),
        ...(advisory ? { stage: advisory.stage } : {}),
        ...(failure?.fingerprint === fingerprint && status !== "ready" ? { lastError: failure.message } : {}),
      };
    }));
    const ready = inputs.filter((input) => coverage.find((entry) => entry.sourcePath === input.source.path)?.status === "ready");
    const usedContextPaths = new Set(ready.flatMap((input) => {
      const advisory = input.review!.advisory!;
      return [...advisory.contextPaths, ...advisory.observations.flatMap((item) => item.contextPaths),
        ...advisory.answerOptions.flatMap((item) => item.contextPaths), ...advisory.nextSteps.flatMap((item) => item.contextPaths)];
    }));
    const contextNotes = [...new Map(ready.flatMap((input) => input.contextNotes
      .filter((note) => usedContextPaths.has(note.path)).map((note) => [note.path, note] as const))).values()];
    const feedback = notes.find((note) => note.path === INSIGHTS_FEEDBACK_PATH);
    const payload = {
      inputVersion: 1,
      interviews: ready.map((input) => crossInterviewInput(input, input.review!.advisory!)),
      contextNotes,
      humanFeedback: uniqueReviewFeedback(parseReviewFeedback(feedback?.content ?? "")),
      coverage: coverage.map(({ sourcePath, company, date, round, status, reason }) => ({ sourcePath, company, date, round, status, reason })),
      computed: {
        includedInterviews: ready.length,
        includedCompanies: new Set(ready.map((input) => input.payload.company)).size,
        availableInterviews: coverage.length,
      },
    };
    const fingerprint = await advisoryFingerprint(payload);
    const reportNote = notes.find((note) => note.path === INSIGHTS_PATH);
    const report = reportNote ? parseInterviewInsights(reportNote.content) : null;
    const insightsStatus = ready.length < 2 ? "blocked" : !report ? "missing" : report.sourceFingerprint === fingerprint ? "ready" : "stale";
    const failure = failures[INSIGHTS_PATH];
    const error = failure?.fingerprint === fingerprint && insightsStatus !== "ready" ? failure.message : null;
    const pending = coverage.some((entry) => ["missing", "stale"].includes(entry.status) && !entry.lastError) ||
      (["missing", "stale"].includes(insightsStatus) && !error);
    return { notes, inputs, ready, coverage, payload, fingerprint, report, insightsStatus, pending, error };
  }

  async function state() {
    const current = await collect();
    return {
      report: current.report, coverage: current.coverage, pending: current.pending,
      insightsStatus: current.insightsStatus, error: current.error,
      active: [...active.values()][0] ?? null,
    };
  }

  async function sourceState(sourcePath: string) {
    const current = await collect();
    const entry = current.coverage.find((item) => item.sourcePath === sourcePath);
    if (!entry) throw new Error("面试整理稿不存在。");
    return { ...entry, report: current.inputs.find((input) => input.source.path === sourcePath)?.review?.advisory ?? null,
      pending: ["missing", "stale"].includes(entry.status) && !entry.lastError,
      active: active.get(sourcePath) ?? null };
  }

  async function generateSource(sourcePath: string, force = false) {
    if (!isReviewNotePath(sourcePath, "seirikou")) throw new Error("notePath 不是面试整理稿。");
    const existing = flights.get(sourcePath);
    if (existing) return existing as ReturnType<typeof generateSourceWork>;
    const work = generateSourceWork(sourcePath, force);
    flights.set(sourcePath, work);
    try { return await work; } finally { flights.delete(sourcePath); }
  }

  async function generateSourceWork(sourcePath: string, force: boolean) {
    return sourceQueue(sourcePath, async () => {
      const current = await collect();
      const input = current.inputs.find((item) => item.source.path === sourcePath);
      const entry = current.coverage.find((item) => item.sourcePath === sourcePath);
      if (!input || !entry) throw new Error("面试整理稿不存在。");
      if (input.reason) throw new Error(input.reason);
      if (entry.status === "ready" && !force) return { ok: true, skipped: true, report: input.review!.advisory!, path: reviewSiblingPath(sourcePath, "answerReview") };
      if (entry.lastError && !force) throw new Error(`${entry.lastError} 请点击重试。`);
      active.set(sourcePath, { stage: "advisory", sourcePath });
      try {
        const result = await deps.invoke("review_interview_advisory", {
          ...input.payload,
          previousAdvisory: input.review?.advisory ?? null,
        });
        const advisory = normalizeInterviewAdvisory(result.output, {
          generatedAt: new Date().toISOString(), model: result.model, sourceFingerprint: entry.fingerprint,
        }, advisoryValidationContext([input]));
        // 长任务期间本人可能补充了事实；过时的判断绝不能覆盖刚更新的材料。
        const fresh = buildAdvisoryInput(await deps.readAll(), sourcePath);
        if (fresh.reason || await advisoryFingerprint(fresh.payload) !== entry.fingerprint) {
          throw new Error("生成期间依据已更新，请按最新材料重新分析；旧报告已保留。");
        }
        const outputPath = reviewSiblingPath(sourcePath, "answerReview");
        await withReviewWrite(outputPath, async () => {
          const latest = await deps.read(outputPath);
          if (!latest || !parseInterviewAnswerReview(latest.content)) throw new Error("回答质量复盘不存在，未写入顾问分析。");
          if (JSON.stringify(parseInterviewAnswerReview(latest.content)?.advisory) !== JSON.stringify(input.review?.advisory)) {
            throw new Error("顾问分析已由其他操作更新，保留最新版本。");
          }
          await deps.write(outputPath, mergeAdvisoryIntoReview(latest.content, advisory));
        });
        const saved = await deps.read(outputPath);
        if (JSON.stringify(parseInterviewAnswerReview(saved?.content ?? "")?.advisory) !== JSON.stringify(advisory)) {
          throw new Error("顾问分析保存后回读不一致，请重试。");
        }
        await recordFailure(sourcePath, null);
        return { ok: true, skipped: false, report: advisory, path: outputPath };
      } catch (error) {
        const message = error instanceof Error ? error.message : "顾问分析生成失败。";
        await recordFailure(sourcePath, { fingerprint: entry.fingerprint, message, attemptedAt: new Date().toISOString() });
        throw error;
      } finally { active.delete(sourcePath); }
    });
  }

  async function generateInsights(options: { force?: boolean; refreshSources?: boolean } = {}) {
    const existing = flights.get(INSIGHTS_PATH);
    if (existing) return existing as ReturnType<typeof generateInsightsWork>;
    const work = generateInsightsWork(options);
    flights.set(INSIGHTS_PATH, work);
    try { return await work; } finally { flights.delete(INSIGHTS_PATH); }
  }

  async function generateInsightsWork(options: { force?: boolean; refreshSources?: boolean }) {
    const current = await collect();
    if (options.refreshSources) {
      if (options.force) {
        // 一次明确重试解除本批次的失败冻结，不需要用户逐场点击。
        for (const entry of current.coverage.filter((item) => item.lastError && item.status !== "blocked")) {
          await recordFailure(entry.sourcePath, null);
        }
        await recordFailure(INSIGHTS_PATH, null);
      }
      const next = current.coverage.find((entry) => ["missing", "stale"].includes(entry.status) && (!entry.lastError || options.force));
      if (next) {
        try {
          await generateSource(next.sourcePath, Boolean(options.force));
          return { ok: true, done: false, processedPath: next.sourcePath, ...await state() };
        } catch (error) {
          // 一场失败不阻塞其余历史；失败依据已记录，同输入不会被自动无限重试。
          return { ok: true, done: false, processedPath: next.sourcePath,
            sourceError: error instanceof Error ? error.message : "本场顾问分析失败。", ...await state() };
        }
      }
    }
    if (current.ready.length < 2) return { ok: true, done: true, ...await state() };
    if (current.insightsStatus === "ready" && !options.force) return { ok: true, done: true, skipped: true, ...await state() };
    if (current.error && !options.force) throw new Error(`${current.error} 请点击重试。`);
    active.set(INSIGHTS_PATH, { stage: "insights", sourcePath: INSIGHTS_PATH });
    try {
      const result = await deps.invoke("review_interview_insights", current.payload);
      const report = normalizeInterviewInsights(result.output, {
        generatedAt: new Date().toISOString(), model: result.model, sourceFingerprint: current.fingerprint,
      }, {
        // 引用必须来自模型实际见过的问答，不能凭ID猜中未提供的原句就算证据成立。
        sources: new Map(current.payload.interviews.map((input) => [input.sourcePath,
          new Map(input.blocks.map((block) => [block.id, new Set(block.sentences.map((sentence) => sentence.id))])),
        ])),
        contextPaths: new Set(current.payload.contextNotes.map((note) => note.path)),
      });
      const fresh = await collect();
      if (fresh.fingerprint !== current.fingerprint) throw new Error("生成期间横向分析的依据已更新，请重试；旧报告已保留。");
      const latestReport = await deps.read(INSIGHTS_PATH);
      if (JSON.stringify(parseInterviewInsights(latestReport?.content ?? "")) !== JSON.stringify(current.report)) {
        throw new Error("横向分析已由其他操作更新，保留最新版本。");
      }
      await deps.write(INSIGHTS_PATH, mergeInterviewInsights(latestReport?.content ?? null, report));
      const saved = await deps.read(INSIGHTS_PATH);
      if (JSON.stringify(parseInterviewInsights(saved?.content ?? "")) !== JSON.stringify(report)) throw new Error("横向分析保存后回读不一致，请重试。");
      await recordFailure(INSIGHTS_PATH, null);
      return { ok: true, done: true, path: INSIGHTS_PATH, ...await state() };
    } catch (error) {
      await recordFailure(INSIGHTS_PATH, { fingerprint: current.fingerprint,
        message: error instanceof Error ? error.message : "横向分析生成失败。", attemptedAt: new Date().toISOString() });
      throw error;
    } finally { active.delete(INSIGHTS_PATH); }
  }

  return { state, sourceState, generateSource, generateInsights };
}
