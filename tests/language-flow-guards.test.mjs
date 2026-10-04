import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readAppCss } from "./css-source.mjs";

test("fixed language training completes without Codex and only marks trained", async () => {
  const [route, engine] = await Promise.all([
    readFile("app/api/language/session/complete/route.ts", "utf8"),
    readFile("lib/server/language-engine.ts", "utf8"),
  ]);
  assert.equal(route.includes("invokeCodex"), false);
  assert.ok(engine.includes("gradeLanguageDrills(selectedDrills, answers)"));
  assert.ok(engine.includes('action: "trained"'));
  assert.equal(engine.includes('masteryStatus: "mastered"'), false);
  assert.ok(engine.includes('kind === "quick" ? 10'));
  assert.ok(engine.includes('kind === "intensive" ? 30'));
  assert.ok(engine.includes("drillIds: practiceUnits.flatMap"));
  assert.ok(engine.includes(": undefined;"));
});

test("language categories can expand through a fixed allowlisted task", async () => {
  const [route, bridge, client] = await Promise.all([
    readFile("app/api/language/expand/route.ts", "utf8"),
    readFile("scripts/codex-bridge.mjs", "utf8"),
    readFile("lib/server/codex-bridge.ts", "utf8"),
  ]);
  assert.ok(route.includes('technical_vocabulary: 30'));
  assert.ok(route.includes('"expand_language_category"'));
  assert.ok(route.includes("existingKeys.has(unit.canonicalKey)"));
  assert.ok(bridge.includes("expand_language_category"));
  assert.ok(client.includes('"expand_language_category"'));
});

test("language v2 quick drill is keyboard-first, saves every answer and has no composition box", async () => {
  // 旧三阶段（扫描 1–4 判断 → 集中编译 → 压力测试的 2–3 句作文）已从界面移除，等价约束换成快练：
  // 键盘优先（一题一屏、数字键作答）、逐题保存（不攒到一批末尾）、全程没有作文输入框。
  const [shell, drill, overview, summary, sync, css] = await Promise.all([
    readFile("app/japanese-training.tsx", "utf8"),
    readFile("app/language-quick-drill.tsx", "utf8"),
    readFile("app/language-quick-overview.tsx", "utf8"),
    readFile("app/language-quick-summary.tsx", "utf8"),
    readFile("app/language-quick-sync.ts", "utf8"),
    readAppCss(),
  ]);
  const ui = [shell, drill, overview, summary, sync].join("\n");
  // 键盘优先
  assert.ok(drill.includes('const CHOICE_KEYS = ["1", "2", "3", "4"] as const;'));
  assert.ok(drill.includes('{ "1": "remembered", "2": "fuzzy", "3": "forgot" }'));
  assert.ok(drill.includes('key === "Enter" || key === " " || key === "ArrowRight"'));
  assert.ok(drill.includes('if (key === "?")'));
  assert.ok(drill.includes('if (key === "Escape")'));
  assert.ok(drill.includes("isTypingTarget(event.target)"));
  assert.ok(overview.includes('event.key !== "Enter"'));
  // 逐题保存：每条作答一产生就进队列，串行 POST 到快练接口，卸载与离开页面时 keepalive 补发
  assert.ok(sync.includes('answer: "/api/language/v2/quick/answer"'));
  assert.ok(shell.includes("queueRef.current?.enqueue(next.setId, fresh.map((record) => record.input), next.size)"));
  assert.ok(shell.includes("queue.flushKeepalive()"));
  assert.ok(sync.includes("keepalive: true"));
  // 原断言「静默保存不刷新外壳」的等价：逐题保存与组间都不调 onVaultChanged，只有真正重建了课程才调。
  assert.deepEqual(shell.match(/onVaultChanged\(\)/g), ["onVaultChanged()"]);
  assert.ok(shell.includes("if (!result.unchanged) await onVaultChanged();"));
  assert.equal(ui.includes("/api/language/v2/batch/"), false, "界面不再调用旧批次路由");
  assert.doesNotMatch(ui, /\.currentBatch[?.!]/, "界面忽略未完成的旧批次");
  // 没有作文输入
  assert.equal(ui.includes("<textarea"), false);
  assert.ok(drill.includes('<input\n        ref={inputRef}\n        lang="ja"'));
  assert.ok(drill.includes("maxLength={16}"));
  assert.equal(ui.includes("日语考试中心"), false);
  assert.equal(ui.includes("扩充本类词库"), false);
  assert.ok(css.includes(".quick-card"));
  assert.ok(css.includes(".quick-options"));
  assert.ok(css.includes(".quick-feedback"));
});

test("language v2 batch engine keeps its phase limits and quotas while old batches stay readable", async () => {
  // 旧批次引擎与记录保留到下一轮清理；界面移除不等于引擎的上限与配额可以随手删。
  const engine = await readFile("lib/server/language-v2.ts", "utf8");
  assert.ok(engine.includes("LANGUAGE_COMPILE_LIMIT"));
  assert.ok(engine.includes("LANGUAGE_STRESS_LIMIT"));
  assert.ok(engine.includes("LANGUAGE_OPEN_STRESS_LIMIT"));
  assert.ok(engine.includes("ITEM_QUOTAS"));
});

test("one sentence-coaching submission makes one Terra call", async () => {
  const route = await readFile("app/api/language/session/coach/route.ts", "utf8");
  assert.equal(route.match(/invokeCodex</g)?.length, 1);
  assert.ok(route.includes('"coach_language_output"'));
  assert.ok(route.includes("allowedUnitIds.has(sentence.unitId)"));
  assert.ok(route.includes("slice(0, 10)"));
});

test("quick language exams stay objective while open questions are graded once", async () => {
  const engine = await readFile("lib/server/language-engine.ts", "utf8");
  assert.ok(engine.includes('const openCount = kind === "formal" ? 3 : productionSpecial ? 2 : 0'));
  assert.equal(engine.match(/"grade_language_exam"/g)?.length, 1);
  assert.ok(engine.includes("if (openQuestions.length)"));
});

test("language bank rebuild preserves stable ids and enforces the minimum bank size", async () => {
  const [route, store, bridge] = await Promise.all([
    readFile("app/api/language/rebuild/route.ts", "utf8"),
    readFile("lib/server/language-store.ts", "utf8"),
    readFile("scripts/codex-bridge.mjs", "utf8"),
  ]);
  assert.ok(route.includes("previousState.bank?.units"));
  assert.ok(route.includes("buildLanguageSourceContext(notes)"));
  assert.ok(route.includes("if (bank.units.length < 36)"));
  assert.ok(store.includes('const id = previous?.id || stableId("lu", canonicalKey)'));
  assert.ok(store.includes("const LANGUAGE_SOURCE_LIMIT = 320_000"));
  assert.ok(bridge.includes("questionBank也必须返回空数组"));
  assert.ok(bridge.includes("drills必须返回空数组"));
  assert.ok(bridge.includes("rebuild_language_bank: { model: SOL_MODEL, timeoutMs: 480_000 }"));
  assert.ok(bridge.includes("Vault 没有写入任何不完整内容"));
});

test("generated language artifacts use content fingerprints and do not duplicate unchanged versions", async () => {
  const [bankRoute, expandRoute, curriculumRoute, store, curriculum, artifact] = await Promise.all([
    readFile("app/api/language/rebuild/route.ts", "utf8"),
    readFile("app/api/language/expand/route.ts", "utf8"),
    readFile("app/api/language/v2/rebuild/route.ts", "utf8"),
    readFile("lib/server/language-store.ts", "utf8"),
    readFile("lib/server/language-v2.ts", "utf8"),
    readFile("lib/server/generated-artifact.ts", "utf8"),
  ]);
  for (const route of [bankRoute, expandRoute, curriculumRoute]) {
    assert.ok(route.includes("unchanged: true"));
    assert.ok(route.includes("latest"));
    assert.ok(route.indexOf("await writeNote(path") < route.indexOf("await supersedeCurrentArtifacts"));
  }
  for (const renderer of [store, curriculum]) {
    assert.ok(renderer.includes("lifecycle: current"));
    assert.ok(renderer.includes("schema_version: 2"));
    assert.ok(renderer.includes("content_fingerprint"));
  }
  assert.ok(artifact.includes('lifecycle: "superseded"'));
});

test("the dev launcher selects a free bridge port when the default is occupied", async () => {
  const source = await readFile("scripts/dev-with-obsidian.sh", "utf8");
  assert.ok(source.includes('error.code !== "EADDRINUSE"'));
  assert.ok(source.includes('fallback.listen(0, "127.0.0.1"'));
  assert.ok(source.includes('CODEX_BRIDGE_URL="http://127.0.0.1:$CODEX_BRIDGE_PORT"'));
  assert.ok(source.includes("node --watch scripts/codex-bridge.mjs"));
});

test("unsafe personal examples are hidden and stale facts are excluded", async () => {
  const [store, state] = await Promise.all([
    readFile("lib/server/language-store.ts", "utf8"),
    readFile("lib/language/state.ts", "utf8"),
  ]);
  assert.ok(store.includes('exampleJa: factSafe ? text(source.exampleJa) : ""'));
  assert.ok(store.includes("safeFactPaths.has(path)"));
  assert.ok(state.includes("stale && unit.factSensitive"));
});
