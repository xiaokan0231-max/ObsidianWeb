import assert from "node:assert/strict";
import test from "node:test";
import yaml from "js-yaml";
import { loadAppModule } from "./helpers/render-tsx.mjs";
import { KNOWN_CHANNELS } from "../lib/job-status.ts";
import { WAITING_FOR_VALUES } from "../lib/job-case-schema.ts";
import { parseInterviewPractice, renderInterviewPracticeEntry } from "../lib/review-practice.ts";

// 运行真实 route 和读改写逻辑，仅替换外部 I/O；闸门精确重现跨路由交错，不访问本人 Vault。
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function request(body = {}) {
  return new Request("http://localhost:3000/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" },
    body: JSON.stringify(body),
  });
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

function memoryVault(initial = []) {
  const notes = new Map(initial.map((note) => [note.path, structuredClone(note)]));
  const reads = [];
  const writes = [];
  let clock = Math.max(100, ...initial.map((note) => note.stat.mtime));
  let readGate = null;
  let allGate = null;
  let writeError = null;
  function pause(kind, path) {
    const gate = { path, entered: deferred(), released: deferred() };
    if (kind === "all") allGate = gate;
    else readGate = gate;
    return gate;
  }
  const io = {
    async readNoteOrNull(path) {
      reads.push(path);
      const snapshot = structuredClone(notes.get(path) ?? null);
      if (readGate?.path === path) {
        const gate = readGate;
        readGate = null;
        gate.entered.resolve();
        await gate.released.promise;
      }
      return snapshot;
    },
    async readNote(path) {
      const note = await io.readNoteOrNull(path);
      if (!note) throw new Error("Obsidian returned 404");
      return note;
    },
    async readAllNotes() {
      const snapshot = structuredClone([...notes.values()]);
      if (allGate) {
        const gate = allGate;
        allGate = null;
        gate.entered.resolve();
        await gate.released.promise;
      }
      return snapshot;
    },
    async writeNote(path, content) {
      if (writeError) {
        const error = writeError;
        writeError = null;
        throw error;
      }
      const previous = notes.get(path);
      const frontmatter = yaml.load(content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "", { schema: yaml.JSON_SCHEMA }) ?? {};
      const note = { path, content, frontmatter, tags: [], stat: {
        ctime: previous?.stat.ctime ?? ++clock, mtime: ++clock, size: Buffer.byteLength(content),
      } };
      notes.set(path, note);
      writes.push(structuredClone(note));
    },
    async uniquePath(path) {
      if (!notes.has(path)) return path;
      for (let index = 2; ; index += 1) {
        const candidate = path.replace(/\.md$/, `_${index}.md`);
        if (!notes.has(candidate)) return candidate;
      }
    },
  };
  return { io, notes, reads, writes, pauseRead: (path) => pause("note", path), pauseAll: () => pause("all"),
    failNextWrite: () => { writeError = new Error("test write failure"); } };
}

function note(path, content, mtime = 100) {
  const frontmatter = yaml.load(content.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "", { schema: yaml.JSON_SCHEMA }) ?? {};
  return { path, content, frontmatter, tags: [], stat: { ctime: mtime, mtime, size: content.length } };
}

const JOB_PATH = "20_求職/株式会社テスト/案件.md";
function job(path = JOB_PATH) {
  return note(path, `---\ntype: job-case\nstatus: 応募済\nchannel: ${KNOWN_CHANNELS[0]}\nwaiting_for: ${WAITING_FOR_VALUES[0]}\n---\n# 株式会社テスト\n`);
}

async function jobRoutes(vault) {
  const options = { stubs: { "@/lib/server/obsidian": vault.io } };
  return {
    status: (await loadAppModule("app/api/jobs/status/route.ts", options)).POST,
    follow: (await loadAppModule("app/api/jobs/follow-up/route.ts", options)).POST,
  };
}

for (const withVersion of [true, false]) {
  test(`状态与跟进跨路由串行：${withVersion ? "过期版本返回409" : "未传版本也保留两处修改"}`, { timeout: 5000 }, async () => {
    const vault = memoryVault([job()]);
    const routes = await jobRoutes(vault);
    const gate = vault.pauseRead(JOB_PATH);
    const version = withVersion ? { expectedMtime: 100 } : {};
    const first = routes.status(request({ path: JOB_PATH, status: "面接中", ...version }));
    await gate.entered.promise;
    const second = routes.follow(request({ path: JOB_PATH, nextEventAt: "2026-01-09 10:00", ...version }));
    try {
      await tick();
      assert.equal(vault.reads.length, 1, "同一资源的第二个请求必须等待读锁释放");
    } finally { gate.released.resolve(); }
    const responses = await Promise.all([first, second]);
    assert.deepEqual(responses.map((response) => response.status), withVersion ? [200, 409] : [200, 200]);
    assert.equal(vault.notes.get(JOB_PATH).frontmatter.status, "面接中");
    assert.equal(vault.notes.get(JOB_PATH).frontmatter.next_event_at, withVersion ? undefined : "2026-01-09 10:00");
  });
}

test("撤销与跟进也共享写锁；不同案件独立写入", { timeout: 5000 }, async () => {
  const otherPath = "20_求職/株式会社サンプル/案件.md";
  const vault = memoryVault([job(), job(otherPath)]);
  const routes = await jobRoutes(vault);
  const changed = await (await routes.status(request({ path: JOB_PATH, status: "面接中", expectedMtime: 100 }))).json();
  const gate = vault.pauseRead(JOB_PATH);
  const restore = routes.status(request({ path: JOB_PATH, restore: changed.undo, expectedMtime: changed.note.stat.mtime }));
  await gate.entered.promise;
  const follow = routes.follow(request({ path: JOB_PATH, nextEventAt: "2026-01-09", expectedMtime: changed.note.stat.mtime }));
  try {
    const independent = await routes.follow(request({ path: otherPath, nextEventAt: "2026-01-10" }));
    assert.equal(independent.status, 200);
  } finally { gate.released.resolve(); }
  assert.deepEqual((await Promise.all([restore, follow])).map((response) => response.status), [200, 409]);
  assert.equal(vault.notes.get(JOB_PATH).frontmatter.status, "応募済");
});

test("撤销拒绝缺版本、越权字段及混合请求；成功写入返回真实版本供后续跟进使用", async () => {
  const vault = memoryVault([job()]);
  const routes = await jobRoutes(vault);
  for (const body of [
    { restore: { status: "応募済" } },
    { restore: { rating: "9" }, expectedMtime: 100 },
    { restore: { status: "応募済" }, status: "面接中", expectedMtime: 100 },
  ]) {
    assert.equal((await routes.status(request({ path: JOB_PATH, ...body }))).status, 400);
  }
  assert.equal(vault.reads.length, 0);
  assert.equal(vault.writes.length, 0);
  const changed = await (await routes.status(request({ path: JOB_PATH, status: "面接中", expectedMtime: 100 }))).json();
  assert.equal(changed.note.stat.mtime, vault.notes.get(JOB_PATH).stat.mtime);
  const stale = await routes.follow(request({ path: JOB_PATH, nextEventAt: "2026-01-09", expectedMtime: 100 }));
  assert.equal(stale.status, 409);
  const restoredResponse = await routes.status(request({ path: JOB_PATH, restore: changed.undo, expectedMtime: changed.note.stat.mtime }));
  assert.equal(restoredResponse.status, 200);
  const restored = await restoredResponse.json();
  assert.equal(restored.note.stat.mtime, vault.notes.get(JOB_PATH).stat.mtime);
  assert.equal((await routes.follow(request({ path: JOB_PATH, nextEventAt: "2026-01-09", expectedMtime: restored.note.stat.mtime }))).status, 200);
});

test("案件写入失败释放跨路由队列，后续跟进仍能保存", { timeout: 5000 }, async () => {
  const vault = memoryVault([job()]);
  const routes = await jobRoutes(vault);
  vault.failNextWrite();
  assert.equal((await routes.status(request({ path: JOB_PATH, status: "面接中" }))).status, 500);
  assert.equal((await routes.follow(request({ path: JOB_PATH, nextEventAt: "2026-01-09" }))).status, 200);
});

test("练习入队与练习动作跨路由并发时均保留", { timeout: 5000 }, async () => {
  const sourcePath = "20_求職/株式会社テスト/2026-01-01_一次面接_整理稿.md";
  const reviewPath = sourcePath.replace("整理稿", "回答品質復盤");
  const practicePath = sourcePath.replace("整理稿", "回答練習");
  const entry = renderInterviewPracticeEntry({ blockId: "q1", queuedAt: "2026-01-01T10:00:00+09:00",
    questionTitle: "質問", improvedAnswerJa: "テストです。", evidenceSentenceIds: ["s001"], attempts: [], status: "queued" });
  const review = { generatedAt: "2026-01-01T00:00:00Z", blocks: [{ blockId: "q2", questionTitle: "質問2",
    improvedAnswerJa: "改善回答です。", evidenceSentenceIds: ["s002"] }] };
  const vault = memoryVault([
    note(sourcePath, "---\ntype: transcript-study\ncompany: 株式会社テスト\ndate: 2026-01-01\nround: 一次面接\n---\n"),
    note(reviewPath, `---\ntype: interview-answer-review\n---\n<!-- interview-answer-review-data -->\n\`\`\`json\n${JSON.stringify(review)}\n\`\`\``),
    note(practicePath, `---\ntype: interview-answer-practice\n---\n${entry}`),
  ]);
  const append = await loadAppModule("lib/server/note-append.ts", { stubs: { "./obsidian.ts": vault.io } });
  const options = { stubs: { "@/lib/server/obsidian": vault.io, "@/lib/server/note-append": append } };
  const enqueue = (await loadAppModule("app/api/review/practice/route.ts", options)).POST;
  const action = (await loadAppModule("app/api/review/practice/action/route.ts", options)).POST;
  const gate = vault.pauseRead(practicePath);
  const first = action(request({ practicePath, blockId: "q1", action: "attempt", rating: "smooth" }));
  await gate.entered.promise;
  const second = enqueue(request({ notePath: sourcePath, blockId: "q2" }));
  try {
    await tick();
    assert.equal(vault.reads.filter((path) => path === practicePath).length, 1);
  } finally { gate.released.resolve(); }
  assert.deepEqual((await Promise.all([first, second])).map((response) => response.status), [200, 200]);
  const entries = parseInterviewPractice(vault.notes.get(practicePath).content);
  assert.equal(entries.find((value) => value.blockId === "q1").attempts.length, 1);
  assert.equal(entries.find((value) => value.blockId === "q2").status, "queued");
});

function curriculum(fingerprint = "course-one") {
  return { version: 2, generatedAt: fingerprint === "course-one" ? "2026-01-01T00:00:00Z" : "2026-01-02T00:00:00Z",
    contentFingerprint: fingerprint, sourceFingerprint: fingerprint, sourceCount: 1, summaryZh: "测试课程",
    profile: { interviewCount: 1, learnerErrorCount: 0, reviewedBlockCount: 0, listeningGapCount: 0, staleReviewPaths: [], topIssues: [] },
    items: Array.from({ length: 100 }, (_, index) => ({ id: `item-${index}`, kind: index === 0 ? "answer_strategy" : "active_chunk",
      targetJa: `回答${index}`, correctedJa: "", meaningZh: `含义${index}`, promptZh: `问题${index}`, basePriority: 100 - index,
      evidence: [], pattern: "" })),
  };
}

async function trainingRoutes({ phase, invoke, nextCurriculum } = {}) {
  const vault = memoryVault();
  const engine = await loadAppModule("lib/server/language-v2.ts", {
    stubs: { "./obsidian": vault.io, "./language-store": { loadLanguageState: async () => ({ units: [] }) } },
    globals: { process: { env: { LANGUAGE_BATCH_SIGNING_KEY: "isolated-test-signing-key" } } },
  });
  const course = curriculum();
  await vault.io.writeNote("80_AI分析/日本語訓練/test-course.md", engine.renderLanguageCurriculum(course));
  let batch;
  if (phase) {
    batch = await engine.createLanguageBatch(await engine.loadLanguageV2State(), 100);
    batch = { ...batch, phase, compileItemIds: phase === "scan" ? [] : ["item-0", "item-1"],
      stressItemIds: phase === "stress" ? ["item-0", "item-1"] : [] };
    await vault.io.writeNote(engine.batchVaultPath(batch), engine.renderLanguageBatch(batch));
  }
  const artifact = await loadAppModule("lib/server/generated-artifact.ts", { stubs: { "./obsidian": vault.io } });
  const options = { stubs: {
    "@/lib/server/obsidian": vault.io,
    "@/lib/server/language-v2": nextCurriculum ? { ...engine, buildLanguageCurriculum: () => nextCurriculum } : engine,
    "@/lib/server/generated-artifact": artifact,
    "@/lib/server/codex-bridge": { invokeCodex: invoke ?? (async () => { throw new Error("test offline"); }) },
  } };
  const routes = {};
  for (const name of ["start", "checkpoint", "complete"]) {
    routes[name] = (await loadAppModule(`app/api/language/v2/batch/${name}/route.ts`, options)).POST;
  }
  routes.rebuild = (await loadAppModule("app/api/language/v2/rebuild/route.ts", options)).POST;
  return { vault, engine, course, batch, ...routes };
}

function scanAction(id = "item-1") {
  return { actionId: `action-${id}`, itemId: id, phase: "scan", judgment: "unknown", at: "2026-01-03T00:00:00Z" };
}

test("并发开始只创建一个批次，继续已有批次不写回", { timeout: 5000 }, async () => {
  const fixture = await trainingRoutes();
  const { start, vault } = fixture;
  const results = await Promise.all([start(request({ size: 100 })), start(request({ size: 150 }))]);
  assert.deepEqual(results.map((response) => response.status), [200, 200]);
  const bodies = await Promise.all(results.map((response) => response.json()));
  assert.equal(bodies[0].batch.id, bodies[1].batch.id);
  assert.equal(vault.writes.filter((value) => value.frontmatter.type === "language-batch-log").length, 1);
  const before = vault.writes.length;
  assert.equal((await start(request({ size: 200 }))).status, 200);
  assert.equal(vault.writes.length, before);
});

test("开始与自动保存交错不会回滚答案及光标", { timeout: 5000 }, async () => {
  const { start, checkpoint, batch, vault, engine } = await trainingRoutes({ phase: "scan" });
  const gate = vault.pauseAll();
  const first = start(request({ size: 100 }));
  await gate.entered.promise;
  const second = checkpoint(request({ batchId: batch.id, actions: [scanAction()], cursor: 1 }));
  gate.released.resolve();
  assert.deepEqual((await Promise.all([first, second])).map((response) => response.status), [200, 200]);
  const saved = engine.languageBatchById(await vault.io.readAllNotes(), batch.id);
  assert.equal(saved.actions.length, 1);
  assert.equal(saved.cursor, 1);
});

for (const rebuildFirst of [true, false]) {
  test(`课程迁移与自动保存交错保留动作：${rebuildFirst ? "先重建" : "先保存"}`, { timeout: 5000 }, async () => {
    const { rebuild, checkpoint, batch, vault, engine } = await trainingRoutes({ phase: "scan", nextCurriculum: curriculum("course-two") });
    const gate = vault.pauseAll();
    const save = () => checkpoint(request({ batchId: batch.id, actions: [scanAction()], cursor: 1 }));
    const first = rebuildFirst ? rebuild(request()) : save();
    await gate.entered.promise;
    const second = rebuildFirst ? save() : rebuild(request());
    gate.released.resolve();
    assert.deepEqual((await Promise.all([first, second])).map((response) => response.status), [200, 200]);
    const saved = engine.languageBatchById(await vault.io.readAllNotes(), batch.id);
    assert.equal(saved.curriculumFingerprint, "course-two");
    assert.equal(saved.actions.length, 1);
  });
}

test("已经进入编译的批次不被课程重建迁回扫描", { timeout: 5000 }, async () => {
  const { rebuild, checkpoint, batch, vault, engine } = await trainingRoutes({ phase: "scan", nextCurriculum: curriculum("course-two") });
  const gate = vault.pauseAll();
  const first = checkpoint(request({ batchId: batch.id, actions: [scanAction()], nextPhase: "compile", cursor: 0 }));
  await gate.entered.promise;
  const second = rebuild(request());
  gate.released.resolve();
  assert.deepEqual((await Promise.all([first, second])).map((response) => response.status), [200, 200]);
  const saved = engine.languageBatchById(await vault.io.readAllNotes(), batch.id);
  assert.equal(saved.phase, "compile");
  assert.equal(saved.curriculumFingerprint, "course-one");
  assert.equal(saved.actions.length, 1);
});

function openAction(answer = "旧回答です。", at = "2026-01-03T00:00:00Z") {
  return { actionId: "open-answer", itemId: "item-0", phase: "stress", answer, at };
}

function gradingGates() {
  const calls = [];
  const entered = [deferred(), deferred()];
  const release = [deferred(), deferred()];
  return { calls, entered, release, async invoke(_task, payload) {
    const index = calls.length;
    calls.push(payload);
    entered[index].resolve();
    await release[index].promise;
    return { output: { grades: [{ questionId: "open-answer", dimensions: { coverage: 5 }, criticalError: false }] } };
  } };
}

test("外部评分不持锁，期间修改的答案保留且不使用旧评分", { timeout: 5000 }, async () => {
  const grading = gradingGates();
  const { complete, checkpoint, batch, vault, engine } = await trainingRoutes({ phase: "stress", invoke: grading.invoke });
  const pending = complete(request({ batchId: batch.id, actions: [openAction()] }));
  await grading.entered[0].promise;
  try {
    const saved = await checkpoint(request({ batchId: batch.id, actions: [openAction("修改后的回答。", "2026-01-03T00:01:00Z")], cursor: 1 }));
    assert.equal(saved.status, 200, "评分未返回时自动保存必须完成");
  } finally { grading.release[0].resolve(); }
  assert.equal((await pending).status, 200);
  const finished = engine.languageBatchById(await vault.io.readAllNotes(), batch.id);
  assert.equal(finished.phase, "completed");
  assert.equal(finished.actions[0].answer, "修改后的回答。");
  assert.equal(finished.actions[0].passed, false);
});

test("同一答案版本接收评分，模型离线也保留答案并完成", { timeout: 5000 }, async () => {
  for (const offline of [false, true]) {
    const fixture = await trainingRoutes({ phase: "stress", invoke: async () => {
      if (offline) throw new Error("test offline");
      return { output: { grades: [{ questionId: "open-answer", dimensions: { coverage: 5 }, criticalError: false }] } };
    } });
    const response = await fixture.complete(request({ batchId: fixture.batch.id, actions: [openAction()] }));
    assert.equal(response.status, 200);
    const saved = fixture.engine.languageBatchById(await fixture.vault.io.readAllNotes(), fixture.batch.id);
    assert.equal(saved.phase, "completed");
    assert.equal(saved.actions[0].passed, !offline);
  }
});

test("重复完成晚返回时不覆盖已完成记录，也不影响新批次", { timeout: 5000 }, async () => {
  const grading = gradingGates();
  const { complete, start, batch, vault, engine } = await trainingRoutes({ phase: "stress", invoke: grading.invoke });
  const first = complete(request({ batchId: batch.id, actions: [openAction()] }));
  await grading.entered[0].promise;
  const second = complete(request({ batchId: batch.id, actions: [openAction()] }));
  await grading.entered[1].promise;
  grading.release[0].resolve();
  assert.equal((await first).status, 200);
  const finished = structuredClone(vault.notes.get(engine.batchVaultPath(batch)));
  const newBatch = await (await start(request({ size: 100 }))).json();
  assert.notEqual(newBatch.batch.id, batch.id);
  const before = vault.writes.length;
  grading.release[1].resolve();
  assert.equal((await second).status, 200);
  assert.equal(vault.writes.length, before);
  assert.deepEqual(vault.notes.get(engine.batchVaultPath(batch)), finished);
  const state = await engine.loadLanguageV2State();
  assert.equal(state.currentBatch.id, newBatch.batch.id);
  assert.equal((await complete(request({ batchId: batch.id }))).status, 200);
  assert.equal(grading.calls.length, 2);
});

for (const mutation of ["deleted", "curriculum-changed"]) {
  test(`评分后批次${mutation}返回409，不恢复旧快照`, { timeout: 5000 }, async () => {
    const grading = gradingGates();
    const { complete, batch, vault, engine } = await trainingRoutes({ phase: "stress", invoke: grading.invoke });
    const pending = complete(request({ batchId: batch.id, actions: [openAction()] }));
    await grading.entered[0].promise;
    const path = engine.batchVaultPath(batch);
    if (mutation === "deleted") vault.notes.delete(path);
    else {
      const current = engine.languageBatchById(await vault.io.readAllNotes(), batch.id);
      await vault.io.writeNote(path, engine.renderLanguageBatch({ ...current, curriculumFingerprint: "external-course" }));
    }
    const before = vault.writes.length;
    grading.release[0].resolve();
    assert.equal((await pending).status, 409);
    assert.equal(vault.writes.length, before);
    if (mutation === "deleted") assert.equal(vault.notes.has(path), false);
  });
}

test("训练状态缓存识别最大mtime未变的单笔记更新", { timeout: 5000 }, async () => {
  const { engine, batch, vault } = await trainingRoutes({ phase: "scan" });
  const anchor = note("unrelated.md", "其他笔记", 999999);
  const original = [...await vault.io.readAllNotes(), anchor];
  const before = await engine.loadLanguageV2State(original);
  const path = engine.batchVaultPath(batch);
  const afterNotes = original.map((value) => value.path === path
    ? note(path, engine.renderLanguageBatch({ ...batch, phase: "completed", completedAt: "2026-01-03T00:01:00Z" }), value.stat.mtime + 1)
    : value);
  const after = await engine.loadLanguageV2State(afterNotes);
  assert.notEqual(after, before);
  assert.equal(after.currentBatch, undefined);
  assert.equal(after.history[0].completedAt, "2026-01-03T00:01:00Z");
});

// ── 快练作答：全库 eventId 去重、服务端判分、与课程重建同一条写入车道 ────────────

const QUICK_LOG_PREFIX = "30_日本語学習/快練ログ/";
// 虚构的通用寒暄短语：只为凑够四选一的干扰项，不含任何个人事实。
const QUICK_PHRASES = [
  ["なるほど", "原来如此"], ["かしこまりました", "明白了"], ["おっしゃる通りです", "您说得对"],
  ["差し支えなければ", "如果方便的话"], ["恐れ入りますが", "不好意思"], ["念のため", "以防万一"],
];

function quickCurriculum(fingerprint = "quick-one") {
  const items = QUICK_PHRASES.map(([ja, zh], index) => ({ id: `phrase-${index}`, kind: "interviewer_phrase",
    targetJa: ja, correctedJa: "", originalJa: "", reading: "", meaningZh: zh, promptZh: "", basePriority: 50,
    evidence: [], pattern: "" }));
  items.push({ id: "chunk-0", kind: "active_chunk", targetJa: "〜という点が強みです", correctedJa: "",
    meaningZh: "……这一点是优势", promptZh: "", basePriority: 40, evidence: [], pattern: "" });
  return { version: 2, generatedAt: fingerprint === "quick-one" ? "2026-01-01T00:00:00Z" : "2026-01-02T00:00:00Z",
    contentFingerprint: fingerprint, sourceFingerprint: fingerprint, sourceCount: 1, summaryZh: "快练测试课程",
    profile: { interviewCount: 1, learnerErrorCount: 0, reviewedBlockCount: 0, listeningGapCount: 0, staleReviewPaths: [], topIssues: [] },
    items };
}

async function quickRoutes({ withCurriculum = true, nextCurriculum, notes = [] } = {}) {
  const vault = memoryVault(notes);
  const engine = await loadAppModule("lib/server/language-v2.ts", {
    stubs: { "./obsidian": vault.io, "./language-store": { loadLanguageState: async () => ({ units: [] }) } },
  });
  if (withCurriculum) {
    await vault.io.writeNote("80_AI分析/日本語訓練/quick-course.md", engine.renderLanguageCurriculum(quickCurriculum()));
  }
  // language-quick 与路由必须共用同一个 engine：写入队列是同一个对象，重建与作答才真的排在一条车道上。
  const quick = await loadAppModule("lib/server/language-quick.ts", { stubs: { "./language-v2.ts": engine } });
  const append = await loadAppModule("lib/server/note-append.ts", { stubs: { "./obsidian.ts": vault.io } });
  const artifact = await loadAppModule("lib/server/generated-artifact.ts", { stubs: { "./obsidian": vault.io } });
  const options = { stubs: {
    "@/lib/server/obsidian": vault.io,
    "@/lib/server/language-v2": nextCurriculum ? { ...engine, buildLanguageCurriculum: () => nextCurriculum } : engine,
    "@/lib/server/language-quick": quick,
    "@/lib/server/note-append": append,
    "@/lib/server/generated-artifact": artifact,
  } };
  return {
    vault,
    engine,
    answer: (await loadAppModule("app/api/language/v2/quick/answer/route.ts", options)).POST,
    set: (await loadAppModule("app/api/language/v2/quick/set/route.ts", options)).GET,
    summary: (await loadAppModule("app/api/language/v2/quick/summary/route.ts", options)).GET,
    rebuild: (await loadAppModule("app/api/language/v2/rebuild/route.ts", options)).POST,
  };
}

const { parseQuickEvents, renderQuickEvent, renderQuickLogNote } = await import("../lib/language/quick-log.ts");

function quickLogEvents(vault) {
  return [...vault.notes.values()]
    .filter((value) => value.path.startsWith(QUICK_LOG_PREFIX))
    .flatMap((value) => parseQuickEvents(value.content));
}

function quickLogWrites(vault) {
  return vault.writes.filter((value) => value.path.startsWith(QUICK_LOG_PREFIX)).length;
}

function quickAnswer(overrides = {}) {
  return { eventId: "qa-1", itemId: "phrase-0", type: "meaning_choice", response: "原来如此", ...overrides };
}

function quickBody(answers, setId = "q20260105-20-test") {
  return { setId, answers };
}

const getRequest = (path) => new Request(`http://localhost:3000${path}`);

test("快练：并发提交同一个 eventId 只落盘一条，另一条报 duplicate", { timeout: 5000 }, async () => {
  const { answer, vault } = await quickRoutes();
  const responses = await Promise.all([answer(request(quickBody([quickAnswer()]))), answer(request(quickBody([quickAnswer()])))]);
  assert.deepEqual(responses.map((response) => response.status), [200, 200]);
  const bodies = await Promise.all(responses.map((response) => response.json()));
  assert.deepEqual(bodies.map((body) => body.results[0].status).sort(), ["duplicate", "recorded"]);
  assert.equal(quickLogEvents(vault).length, 1);
  assert.equal(quickLogWrites(vault), 1, "重复的那条不能再 PUT 一次");
});

test("快练：并发提交不同 eventId 都落盘，同月追加到同一份日志", { timeout: 5000 }, async () => {
  const { answer, vault } = await quickRoutes();
  const responses = await Promise.all([
    answer(request(quickBody([quickAnswer({ eventId: "qa-1" })]))),
    answer(request(quickBody([quickAnswer({ eventId: "qa-2", itemId: "phrase-1", response: "明白了" })]))),
  ]);
  assert.deepEqual(responses.map((response) => response.status), [200, 200]);
  const events = quickLogEvents(vault);
  assert.deepEqual(events.map((event) => event.eventId).sort(), ["qa-1", "qa-2"]);
  const logs = [...vault.notes.values()].filter((value) => value.path.startsWith(QUICK_LOG_PREFIX));
  assert.equal(logs.length, 1);
  assert.equal(logs[0].frontmatter.type, "language-quick-log");
  assert.equal(logs[0].frontmatter.layer, "user-action");
});

test("快练：判分只用题库重算，客户端传的 passed 被忽略；首答答对升到 correctable", { timeout: 5000 }, async () => {
  const { answer, vault } = await quickRoutes();
  const response = await answer(request(quickBody([
    { ...quickAnswer({ eventId: "qa-wrong", response: "以防万一" }), passed: true },
    { ...quickAnswer({ eventId: "qa-right", itemId: "phrase-1", response: "明白了" }), passed: false },
  ])));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.results.map((result) => [result.status, result.passed, result.first]),
    [["recorded", false, true], ["recorded", true, true]]);
  assert.deepEqual(body.results.map((result) => [result.stageBefore, result.stageAfter]),
    [["unseen", "unseen"], ["unseen", "correctable"]]);
  assert.ok(body.results.every((result) => result.nextDueAt), "判分题作答后都有下次到期日");
  const events = quickLogEvents(vault);
  assert.deepEqual(events.map((event) => event.passed), [false, true]);
  assert.ok(events.every((event) => typeof event.at === "string" && event.setSize === 20));
  assert.equal(body.summary.answeredToday, 2);
});

test("快练：同一请求里组内重出不算首答", { timeout: 5000 }, async () => {
  const { answer } = await quickRoutes();
  const body = await (await answer(request(quickBody([
    quickAnswer({ eventId: "qa-1", response: "以防万一" }),
    quickAnswer({ eventId: "qa-2" }),
  ])))).json();
  assert.deepEqual(body.results.map((result) => [result.passed, result.first]), [[false, true], [true, false]]);
  assert.equal(body.results[1].stageAfter, "unseen", "答错后当天再答对拿不到成功日");
});

test("快练：题型不在该条目的可用题型里返回 400，请求里的其他作答也不写", { timeout: 5000 }, async () => {
  const { answer, vault } = await quickRoutes();
  for (const answers of [
    [quickAnswer({ type: "bogus" })],
    [quickAnswer({ eventId: "qa-ok" }), quickAnswer({ eventId: "qa-bad", itemId: "chunk-0", type: "meaning_choice" })],
    [quickAnswer({ itemId: "chunk-0", type: "flip", response: undefined })],
  ]) {
    assert.equal((await answer(request(quickBody(answers)))).status, 400, JSON.stringify(answers));
  }
  for (const body of [{ answers: [quickAnswer()] }, quickBody([]), quickBody([quickAnswer({ eventId: "-bad" })]),
    quickBody([quickAnswer({ response: "あ".repeat(65) })]), quickBody(Array.from({ length: 31 }, (_, index) => quickAnswer({ eventId: `qa-${index}` })))]) {
    assert.equal((await answer(request(body))).status, 400);
  }
  assert.equal(quickLogWrites(vault), 0);
});

test("快练：条目不在题库时报 stale 且不写", { timeout: 5000 }, async () => {
  const { answer, vault } = await quickRoutes();
  const response = await answer(request(quickBody([quickAnswer({ itemId: "missing-item" })])));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.results[0].status, "stale");
  assert.equal(body.results[0].passed, undefined);
  assert.equal(quickLogWrites(vault), 0);
});

test("快练：没有训练课程时作答返回 409，取题返回 ready:false", { timeout: 5000 }, async () => {
  const { answer, set, summary, vault } = await quickRoutes({ withCurriculum: false });
  const response = await answer(request(quickBody([quickAnswer()])));
  assert.equal(response.status, 409);
  assert.equal(vault.writes.length, 0);
  assert.deepEqual(await (await set(getRequest("/api/language/v2/quick/set"))).json(), { ready: false });
  assert.equal((await (await summary(getRequest("/api/language/v2/quick/summary"))).json()).ready, false);
});

test("快练：写入失败不留半条，重发同一批全部落盘", { timeout: 5000 }, async () => {
  const { answer, vault } = await quickRoutes();
  const answers = [quickAnswer({ eventId: "qa-1" }), quickAnswer({ eventId: "qa-2", itemId: "phrase-1", response: "明白了" })];
  vault.failNextWrite();
  const failed = await answer(request(quickBody(answers)));
  assert.equal(failed.status, 502);
  assert.equal(quickLogEvents(vault).length, 0);
  const retried = await answer(request(quickBody(answers)));
  assert.equal(retried.status, 200, "失败必须释放写入队列");
  assert.deepEqual((await retried.json()).results.map((result) => result.status), ["recorded", "recorded"]);
  assert.equal(quickLogEvents(vault).length, 2);
});

for (const rebuildFirst of [true, false]) {
  test(`快练：作答与课程重建交错不丢：${rebuildFirst ? "先重建" : "先作答"}`, { timeout: 5000 }, async () => {
    const { answer, rebuild, vault, engine } = await quickRoutes({ nextCurriculum: quickCurriculum("quick-two") });
    const gate = vault.pauseAll();
    const save = () => answer(request(quickBody([quickAnswer()])));
    const first = rebuildFirst ? rebuild(request()) : save();
    await gate.entered.promise;
    const second = rebuildFirst ? save() : rebuild(request());
    gate.released.resolve();
    assert.deepEqual((await Promise.all([first, second])).map((response) => response.status), [200, 200]);
    assert.deepEqual(quickLogEvents(vault).map((event) => event.eventId), ["qa-1"]);
    const notes = await vault.io.readAllNotes();
    assert.equal(engine.latestLanguageCurriculumEntry(notes).curriculum.contentFingerprint, "quick-two");
    // 训练状态（能力画像、阶段分布）也要看到快练结果，而且只返回课程条目的进度。
    const state = await engine.loadLanguageV2State(notes);
    assert.equal(state.progress.find((value) => value.itemId === "phrase-0").stage, "correctable");
    assert.equal(state.progress.length, quickCurriculum().items.length);
  });
}

test("快练：eventId 在别的月份的日志里已有，也按 duplicate 处理不写", { timeout: 5000 }, async () => {
  const old = { eventId: "qa-old", setId: "q20250131-20-old", setSize: 20, itemId: "phrase-0", type: "meaning_choice",
    action: "answer", response: "原来如此", passed: true, first: true, at: "2025-01-31T10:00:00.000Z" };
  const path = `${QUICK_LOG_PREFIX}2025-01_快練ログ.md`;
  const { answer, vault } = await quickRoutes({ notes: [note(path, `${renderQuickLogNote("2025-01")}${renderQuickEvent(old)}\n`)] });
  const response = await answer(request(quickBody([quickAnswer({ eventId: "qa-old", response: "以防万一" })])));
  assert.equal(response.status, 200);
  const result = (await response.json()).results[0];
  assert.deepEqual([result.status, result.passed], ["duplicate", true], "报的是已落盘那条的判分");
  assert.equal(quickLogWrites(vault), 0);
});

test("快练：取题无副作用，同一份数据两次取到同一组；非法参数 400", { timeout: 5000 }, async () => {
  const { set, summary, vault } = await quickRoutes();
  const before = vault.writes.length;
  const responses = [await set(getRequest("/api/language/v2/quick/set?size=10&typing=0")),
    await set(getRequest("/api/language/v2/quick/set?size=10&typing=0"))];
  assert.deepEqual(responses.map((response) => response.status), [200, 200]);
  assert.equal(responses[0].headers.get("Cache-Control"), "no-store");
  const [first, second] = await Promise.all(responses.map((response) => response.json()));
  assert.deepEqual(first, second);
  assert.equal(first.ready, true);
  assert.equal(first.set.size, 10);
  assert.ok(first.set.cards.length > 0);
  assert.ok(first.set.cards.every((card) => card.type !== "short_input"), "typing=0 不出短输入");
  assert.equal(first.summary.drillable, quickCurriculum().items.length);
  const nonced = await (await set(getRequest("/api/language/v2/quick/set?size=10&typing=0&nonce=abc123"))).json();
  assert.notEqual(nonced.set.setId, first.set.setId, "nonce 让取下一组时 setId 不撞号");
  for (const query of ["size=15", "typing=yes", "extra=2", "nonce=bad-nonce"]) {
    assert.equal((await set(getRequest(`/api/language/v2/quick/set?${query}`))).status, 400, query);
  }
  assert.equal((await summary(getRequest("/api/language/v2/quick/summary?size=15"))).status, 400);
  assert.equal(vault.writes.length, before);
});

// ── 第六轮：太简单 / 撤销排除 / 分流、针对练习、分流取题、释义表、练习日 04:00 ────────────
// 全部是虚构内容：通用寒暄短语、自编的助词改错句；公司名一律「株式会社テスト」。

const { quickDayStartIso } = await import("../lib/language/quick-progress.ts");

const R6_PATCH_GROUPS = [
  { verb: "参加する", pattern: "助詞", nouns: ["説明会", "勉強会", "研修", "交流会"] },
  { verb: "慣れる", pattern: "語法", nouns: ["環境", "業務", "職場", "手順"] },
];

function r6QuickCurriculum() {
  const base = quickCurriculum("r6-course");
  const patches = R6_PATCH_GROUPS.flatMap(({ verb, pattern, nouns }, group) => nouns.map((noun, index) => ({
    id: `patch-${group}-${index}`, kind: "error_patch", targetJa: `${noun}を${verb} → ${noun}に${verb}`,
    correctedJa: `${noun}に${verb}`, originalJa: `来月から${noun}を${verb}予定です。`, reading: "",
    meaningZh: `把「${noun}を」改为「${noun}に」`, promptZh: "", basePriority: 60, evidence: [], pattern,
    sourceInterviewKeys: [], strategyTags: [],
  })));
  // 释义是日文的面试官用语：没有中文释义表时不出题。
  const jaPhrase = { id: "phrase-ja", kind: "interviewer_phrase", targetJa: "お手すき", correctedJa: "", originalJa: "", reading: "",
    meaningZh: "時間がある状態のこと", promptZh: "", basePriority: 50, evidence: [], pattern: "" };
  const strategy = { id: "strategy-0", kind: "answer_strategy", targetJa: "結論から申し上げます。", correctedJa: "結論から申し上げます。",
    originalJa: "", reading: "", meaningZh: "先说结论", promptZh: "", basePriority: 50, evidence: [], pattern: "no-conclusion-first",
    strategyTags: ["no-conclusion-first"] };
  return {
    ...base,
    generatedAt: "2026-01-03T00:00:00Z",
    items: [...base.items, ...patches, jaPhrase, strategy],
    profile: { ...base.profile, topIssues: [
      { key: "no-conclusion-first", label: "no-conclusion-first", kind: "answer_strategy", interviewCount: 3, occurrenceCount: 7,
        itemIds: ["strategy-0"], evidence: [] },
      { key: "助詞", label: "助詞", kind: "error_patch", interviewCount: 2, occurrenceCount: 4,
        itemIds: patches.filter((item) => item.pattern === "助詞").map((item) => item.id), evidence: [] },
      { key: "不存在的型", label: "不存在的型", kind: "error_patch", interviewCount: 1, occurrenceCount: 1, itemIds: [], evidence: [] },
    ] },
  };
}

function r6GlossNote(rows = "| お手すき | 有空 |") {
  return note("20_求職/_素材/面接官用語_中文釈義.md",
    `---\ntype: material\nmaterial_kind: interviewer-phrase-gloss\n---\n# 面接官用語 中文釈義\n\n| 表現 | 中文 |\n|---|---|\n${rows}\n`);
}

/** 路由读 new Date() 定作答时刻；只给路由模块换掉 Date，测试才能把时间放在 04:00 两侧。 */
function fixedClock(iso) {
  const clock = { now: iso };
  class FixedDate extends Date {
    constructor(...args) {
      if (args.length) super(...args);
      else super(Date.parse(clock.now));
    }
    static now() { return Date.parse(clock.now); }
  }
  return { clock, FixedDate };
}

async function quickRoutesR6({ now = "2026-10-05T03:00:00.000Z", notes = [], curriculum = r6QuickCurriculum() } = {}) {
  const vault = memoryVault(notes);
  const engine = await loadAppModule("lib/server/language-v2.ts", {
    stubs: { "./obsidian": vault.io, "./language-store": { loadLanguageState: async () => ({ units: [] }) } },
  });
  await vault.io.writeNote("80_AI分析/日本語訓練/quick-course.md", engine.renderLanguageCurriculum(curriculum));
  const quick = await loadAppModule("lib/server/language-quick.ts", { stubs: { "./language-v2.ts": engine } });
  const append = await loadAppModule("lib/server/note-append.ts", { stubs: { "./obsidian.ts": vault.io } });
  const { clock, FixedDate } = fixedClock(now);
  const options = {
    stubs: {
      "@/lib/server/obsidian": vault.io,
      "@/lib/server/language-v2": engine,
      "@/lib/server/language-quick": quick,
      "@/lib/server/note-append": append,
    },
    globals: { Date: FixedDate },
  };
  const json = async (response) => {
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  const routes = {
    answer: (await loadAppModule("app/api/language/v2/quick/answer/route.ts", options)).POST,
    set: (await loadAppModule("app/api/language/v2/quick/set/route.ts", options)).GET,
    summary: (await loadAppModule("app/api/language/v2/quick/summary/route.ts", options)).GET,
    triage: (await loadAppModule("app/api/language/v2/quick/triage/route.ts", options)).GET,
  };
  return {
    vault, engine, clock, ...routes,
    post: async (answers, setId = "q20261005-20-r6") => json(await routes.answer(request(quickBody(answers, setId)))),
    get: async (route, path) => json(await routes[route](getRequest(path))),
  };
}

test("快练：太简单 / 不再出 / 分流按 action 落盘；分流只存判断、不判分不占首答；撤销排除后条目重新可出", { timeout: 5000 }, async () => {
  const { post, get, vault } = await quickRoutesR6();
  const before = await get("summary", "/api/language/v2/quick/summary?size=30");
  const body = await post([
    { eventId: "r6-easy", itemId: "phrase-1", type: "meaning_choice", action: "easy" },
    { eventId: "r6-suspend", itemId: "phrase-2", type: "meaning_choice", action: "suspend" },
    // 分流与卡无关：客户端带一个占位题型（这里故意给条目出不了的短输入），服务端照存。
    { eventId: "r6-triage", itemId: "phrase-3", type: "short_input", action: "triage", judgment: "unknown", response: "不该落盘" },
  ]);
  assert.deepEqual(body.results.map((result) => [result.status, result.first, result.passed]),
    [["recorded", false, undefined], ["recorded", false, undefined], ["recorded", false, undefined]]);
  const [easy, , triaged] = body.results;
  assert.equal(easy.stageAfter, "recognized", "太简单至少到 recognized");
  assert.equal(easy.nextDueAt, quickDayStartIso("2026-10-05", 30), "30 天后的练习日起点回来验证");
  assert.equal(triaged.stageAfter, "unseen", "分流不改阶段");
  const events = new Map(quickLogEvents(vault).map((event) => [event.eventId, event]));
  assert.equal(events.get("r6-easy").action, "easy");
  assert.equal(events.get("r6-suspend").action, "suspend");
  assert.deepEqual([events.get("r6-triage").action, events.get("r6-triage").judgment, events.get("r6-triage").type, events.get("r6-triage").response],
    ["triage", "unknown", "short_input", ""]);
  assert.equal(body.summary.suspendedCount, 1);
  assert.deepEqual(body.summary.suspended.map((item) => item.itemId), ["phrase-2"]);
  assert.equal(body.summary.triageRemaining, before.triageRemaining - 3, "答过、排除、分流过的都不再算待分流");
  const hidden = await get("set", "/api/language/v2/quick/set?size=30");
  assert.ok(!hidden.set.cards.some((card) => card.itemId === "phrase-2"), "排除的条目不出");
  const restored = await post([{ eventId: "r6-restore", itemId: "phrase-2", type: "meaning_choice", action: "restore" }]);
  assert.equal(restored.results[0].status, "recorded");
  assert.equal(restored.summary.suspendedCount, 0);
  const back = await get("set", "/api/language/v2/quick/set?size=30");
  assert.ok(back.set.cards.some((card) => card.itemId === "phrase-2"), "撤销排除后重新可出");
});

test("快练：分流判断不挡首答；同一组里先分流再作答仍是首答并判分", { timeout: 5000 }, async () => {
  const { post } = await quickRoutesR6();
  await post([{ eventId: "r6-t1", itemId: "phrase-1", type: "meaning_choice", action: "triage", judgment: "uncertain" }], "q20261005-20-same");
  const body = await post([{ eventId: "r6-a1", itemId: "phrase-1", type: "meaning_choice", response: "明白了" }], "q20261005-20-same");
  assert.deepEqual([body.results[0].first, body.results[0].passed, body.results[0].stageAfter], [true, true, "correctable"]);
});

test("快练：题面阶段按 X 再撤销，同一组里接着作答仍是首答并判分（会话把那张卡放回当前位置）", { timeout: 5000 }, async () => {
  const { post } = await quickRoutesR6();
  // 会话一次提交三条：suspend → restore → answer。同组的 suspend 若也挡首答，撤销后的作答永远判不成首答。
  const body = await post([
    { eventId: "r6-x1", itemId: "phrase-1", type: "meaning_choice", action: "suspend" },
    { eventId: "r6-x2", itemId: "phrase-1", type: "meaning_choice", action: "restore" },
    { eventId: "r6-x3", itemId: "phrase-1", type: "meaning_choice", response: "明白了" },
  ], "q20261005-20-undo");
  const answered = body.results[2];
  assert.deepEqual([answered.status, answered.first, answered.passed, answered.stageAfter], ["recorded", true, true, "correctable"]);
  assert.equal(body.summary.suspendedCount, 0);
});

test("快练：动作参数校验——未知 action、分流缺 judgment、suspend 与 action 矛盾都 400；作答仍要求题型对得上", { timeout: 5000 }, async () => {
  const { answer, vault } = await quickRoutesR6();
  for (const answers of [
    [quickAnswer({ action: "bogus" })],
    [quickAnswer({ action: "triage" })],
    [quickAnswer({ action: "triage", judgment: "reject" })],
    [quickAnswer({ action: "easy", suspend: true })],
    [quickAnswer({ action: "answer", itemId: "strategy-0", type: "meaning_choice" })],
  ]) {
    assert.equal((await answer(request(quickBody(answers)))).status, 400, JSON.stringify(answers));
  }
  assert.equal(quickLogWrites(vault), 0);
});

test("快练：focus 取组只含该错误型；未知的型 200 且说明原因；setId 与普通组不同", { timeout: 5000 }, async () => {
  const { get, vault } = await quickRoutesR6();
  const writes = vault.writes.length;
  const patternOf = new Map(r6QuickCurriculum().items.map((item) => [item.id, item.pattern]));
  const focused = await get("set", `/api/language/v2/quick/set?size=10&focus=${encodeURIComponent("助詞")}`);
  assert.equal(focused.set.focus, "助詞");
  assert.ok(focused.set.cards.length > 0);
  assert.ok(focused.set.cards.every((card) => card.group === "error_patch" && patternOf.get(card.itemId) === "助詞"));
  assert.equal(focused.emptyReason, undefined);
  const plain = await get("set", "/api/language/v2/quick/set?size=10");
  assert.notEqual(focused.set.setId, plain.set.setId);
  const unknown = await get("set", `/api/language/v2/quick/set?size=10&focus=${encodeURIComponent("没有这个型")}`);
  assert.deepEqual([unknown.set.cards.length, unknown.emptyReason], [0, "unknown_focus"]);
  assert.equal(typeof unknown.emptyMessage, "string");
  const { set } = await quickRoutesR6();
  assert.equal((await set(getRequest(`/api/language/v2/quick/set?focus=${encodeURIComponent("あ".repeat(65))}`))).status, 400);
  assert.equal((await set(getRequest("/api/language/v2/quick/set?focus=%01"))).status, 400);
  assert.equal(vault.writes.length, writes, "取题无副作用");
});

test("快练：summary 的问题带 kind、中文标签、focus 与条目数；新字段齐全", { timeout: 5000 }, async () => {
  const { get } = await quickRoutesR6();
  const summary = await get("summary", "/api/language/v2/quick/summary?size=10");
  const byKey = new Map(summary.topIssues.map((issue) => [issue.key, issue]));
  const strategy = byKey.get("no-conclusion-first");
  assert.deepEqual([strategy.kind, strategy.label, strategy.focus, strategy.itemCount, strategy.occurrenceCount],
    ["strategy", "不先说结论", undefined, 1, 7]);
  const particle = byKey.get("助詞");
  assert.deepEqual([particle.kind, particle.label, particle.focus, particle.itemCount], ["language", "助詞", "助詞", 4]);
  const missing = byKey.get("不存在的型");
  assert.deepEqual([missing.kind, missing.focus, missing.itemCount], ["language", undefined, 0]);
  for (const key of ["nextSet", "dueSoon", "suspended", "suspendedCount", "triageRemaining", "orphanEvents", "glossed"]) {
    assert.ok(key in summary, key);
  }
  assert.equal(summary.dueSoon.length, 7);
  assert.equal(summary.nextSet.total, summary.nextSet.due + summary.nextSet.lapsed + summary.nextSet.fresh + summary.nextSet.early);
});

test("快练：GET triage 无副作用，排除已作答与已分流的条目；size 只收 10–50", { timeout: 5000 }, async () => {
  const { get, post, triage, vault } = await quickRoutesR6();
  const writes = vault.writes.length;
  const first = await get("triage", "/api/language/v2/quick/triage?size=10");
  const again = await get("triage", "/api/language/v2/quick/triage?size=10");
  assert.deepEqual(first, again);
  assert.equal(first.ready, true);
  assert.ok(first.items.length > 0 && first.items.length <= 10);
  assert.ok(first.items.every((item) => typeof item.itemId === "string" && typeof item.ja === "string"));
  assert.equal(vault.writes.length, writes);
  const [answered, triaged] = first.items;
  await post([
    { eventId: "r6-x1", itemId: answered.itemId, type: "flip", action: "triage", judgment: "known" },
  ]);
  const summary = await get("summary", "/api/language/v2/quick/summary");
  const set = await get("set", "/api/language/v2/quick/set?size=30");
  const card = set.set.cards.find((entry) => entry.itemId === triaged.itemId);
  assert.ok(card, "下一批的第二条在 size=30 的组里");
  await post([{ eventId: "r6-x2", itemId: card.itemId, type: card.type, response: card.answer, ...(card.type === "flip" ? { rating: "remembered" } : {}) }]);
  const after = await get("triage", "/api/language/v2/quick/triage?size=50");
  assert.ok(!after.items.some((item) => item.itemId === answered.itemId || item.itemId === triaged.itemId));
  assert.equal(after.remaining, first.remaining - 2);
  assert.equal(summary.triageRemaining, first.remaining - 1, "summary 与 GET triage 同一口径");
  for (const size of ["9", "51", "abc", "10.5"]) {
    assert.equal((await triage(getRequest(`/api/language/v2/quick/triage?size=${size}`))).status, 400, size);
  }
});

test("快练：中文释义表——有表时日文释义的条目出题并计入 glossed，没有表时计入 excludedJaMeaning", { timeout: 5000 }, async () => {
  const without = await quickRoutesR6();
  const plain = await without.get("summary", "/api/language/v2/quick/summary");
  assert.deepEqual([plain.excludedJaMeaning, plain.glossed], [1, 0]);
  const withTable = await quickRoutesR6({ notes: [r6GlossNote()] });
  const glossed = await withTable.get("summary", "/api/language/v2/quick/summary");
  assert.deepEqual([glossed.excludedJaMeaning, glossed.glossed], [0, 1]);
  assert.equal(glossed.drillable, plain.drillable + 1);
  // 用中文释义出的题能作答，/state 的课程条目进度与应答给出同一阶段。
  const body = await withTable.post([{ eventId: "r6-g1", itemId: "phrase-ja", type: "meaning_choice", response: "有空" }]);
  assert.deepEqual([body.results[0].passed, body.results[0].stageAfter], [true, "correctable"]);
  const notes = await withTable.vault.io.readAllNotes();
  const state = await withTable.engine.loadLanguageV2State(notes);
  assert.equal(state.progress.find((entry) => entry.itemId === "phrase-ja").stage, "correctable");
  assert.equal(state.stale, body.summary.stale, "/state 与快练的过期口径一致");
});

test("快练：练习日从日本时间 04:00 起算——03:30 的作答算前一天，04:30 起是新的一天", { timeout: 5000 }, async () => {
  // JST 10-06 03:30 = 练习日 10-05。
  const { post, get, clock, vault, engine } = await quickRoutesR6({ now: "2026-10-05T18:30:00.000Z" });
  const wrong = await post([{ eventId: "r6-d1", itemId: "phrase-1", type: "meaning_choice", response: "以防万一" }]);
  assert.deepEqual([wrong.results[0].first, wrong.results[0].passed, wrong.summary.day], [true, false, "2026-10-05"]);
  assert.equal(wrong.results[0].nextDueAt, quickDayStartIso("2026-10-05", 1), "答错明天（10-06 04:00）再来");
  // 03:50 再答对：还是同一个练习日，不是首答，拿不到成功日（旧的零点日界会让它变成新一天的首答）。
  clock.now = "2026-10-05T18:50:00.000Z";
  const retry = await post([{ eventId: "r6-d2", itemId: "phrase-1", type: "meaning_choice", response: "明白了" }]);
  assert.deepEqual([retry.results[0].first, retry.results[0].stageAfter], [false, "unseen"]);
  // 04:30 起是练习日 10-06：今天已练归零，首答答对拿到成功日。
  clock.now = "2026-10-05T19:30:00.000Z";
  const summary = await get("summary", "/api/language/v2/quick/summary");
  assert.deepEqual([summary.day, summary.answeredToday], ["2026-10-06", 0]);
  const next = await post([{ eventId: "r6-d3", itemId: "phrase-1", type: "meaning_choice", response: "明白了" }], "q20261006-20-r6");
  assert.deepEqual([next.results[0].first, next.results[0].stageAfter], [true, "correctable"]);
  assert.equal(next.results[0].nextDueAt, quickDayStartIso("2026-10-06", 3));
  // /state 的阶段与应答一致。
  const state = await engine.loadLanguageV2State(await vault.io.readAllNotes());
  assert.equal(state.progress.find((entry) => entry.itemId === "phrase-1").stage, "correctable");
  // 月末 0:00–4:00 的作答写进上个月的日志。
  clock.now = "2026-10-31T18:00:00.000Z";
  await post([{ eventId: "r6-d4", itemId: "phrase-4", type: "meaning_choice", response: "不好意思" }], "q20261031-20-r6");
  const paths = [...vault.notes.keys()].filter((path) => path.startsWith(QUICK_LOG_PREFIX));
  assert.deepEqual(paths, [`${QUICK_LOG_PREFIX}2026-10_快練ログ.md`]);
});
