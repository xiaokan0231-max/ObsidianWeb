import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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

test("language v2 uses a keyboard-first three-phase batch and keeps old routes out of the main UI", async () => {
  const [ui, css, engine] = await Promise.all([
    readFile("app/japanese-training.tsx", "utf8"),
    readFile("app/globals.css", "utf8"),
    readFile("lib/server/language-v2.ts", "utf8"),
  ]);
  assert.ok(ui.includes('"1": "known", "2": "uncertain", "3": "unknown", "4": "reject"'));
  assert.ok(ui.includes('advance("compile")'));
  assert.ok(ui.includes('advance("stress")'));
  assert.ok(ui.includes("日语输入法"));
  assert.ok(ui.includes("AUTO_SAVE_ACTION_COUNT = 50"));
  assert.ok(ui.includes("pending.length < AUTO_SAVE_ACTION_COUNT"));
  assert.ok(ui.includes("checkpoint(pending, undefined, cursor, true)"));
  assert.ok(ui.includes("if (!silent) await onVaultChanged()"));
  assert.equal(ui.includes("日语考试中心"), false);
  assert.equal(ui.includes("扩充本类词库"), false);
  assert.ok(ui.includes("language-scan-focus-card"));
  assert.ok(ui.includes("showScanOverview &&"));
  assert.ok(ui.includes("(cursor + offset) % batch.scanItemIds.length"));
  assert.ok(css.includes(".language-scan-table"));
  assert.ok(css.includes(".language-scan-focus-card"));
  assert.ok(css.includes(".language-input-list"));
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
