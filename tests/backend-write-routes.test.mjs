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
