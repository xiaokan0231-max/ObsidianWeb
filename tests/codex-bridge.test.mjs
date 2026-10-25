import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const bridgePath = resolve("scripts/codex-bridge.mjs");
const fakeCodexPath = resolve("tests/fixtures/fake-codex.mjs");

async function waitForBridge(url, token) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${url}/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) return response.json();
    } catch {
      // The child server is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 40));
  }
  throw new Error("Fake bridge did not start");
}

function startBridge({ port, token, logPath, login = "chatgpt", executable = fakeCodexPath, searchPath = process.env.PATH }) {
  return spawn(process.execPath, [bridgePath], {
    cwd: resolve("."),
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      CODEX_BRIDGE_PORT: String(port),
      CODEX_BRIDGE_TOKEN: token,
      CODEX_BRIDGE_CODEX_PATH: executable,
      PATH: searchPath,
      FAKE_CODEX_LOG: logPath,
      FAKE_CODEX_LOGIN: login,
      OPENAI_API_KEY: "must-not-reach-child",
      CODEX_API_KEY: "must-not-reach-child",
    },
  });
}

test("bridge discovers Codex through PATH when no explicit binary is configured", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dojo-bridge-path-"));
  const logPath = join(directory, "fake.log");
  await symlink(fakeCodexPath, join(directory, "codex"));
  const port = 46000 + Math.floor(Math.random() * 1000);
  const token = "path-discovery-token-longer-than-24-characters";
  const child = startBridge({ port, token, logPath, executable: "", searchPath: `${directory}:${process.env.PATH}` });
  try {
    const status = await waitForBridge(`http://127.0.0.1:${port}`, token);
    assert.equal(status.authentication, "chatgpt");
    assert.equal(status.safeBilling, true);
  } finally {
    await stopBridge(child);
    await rm(directory, { recursive: true, force: true });
  }
});

async function stopBridge(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolvePromise) => child.once("exit", resolvePromise)),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

test("bridge clears ready status when the configured CLI disappears", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dojo-bridge-missing-"));
  const executable = join(directory, "codex");
  await symlink(fakeCodexPath, executable);
  const port = 47000 + Math.floor(Math.random() * 1000);
  const token = "missing-cli-token-longer-than-24-characters";
  const url = `http://127.0.0.1:${port}`;
  const child = startBridge({ port, token, executable, logPath: join(directory, "fake.log") });
  try {
    const ready = await waitForBridge(url, token);
    assert.equal(ready.bridge, "ready");
    await rm(executable);

    const response = await fetch(`${url}/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const status = await response.json();
    assert.equal(status.bridge, "misconfigured");
    assert.equal(status.authentication, "unknown");
    assert.equal(status.safeBilling, false);
    assert.equal(status.codexVersion, undefined);
    assert.match(status.lastError, /CODEX_BRIDGE_CODEX_PATH/);

    const invoke = await fetch(`${url}/invoke`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ task: "grade_language_exam", payload: { items: [] } }),
    });
    assert.equal(invoke.status, 502);
    assert.match((await invoke.json()).error, /CODEX_BRIDGE_CODEX_PATH/);
  } finally {
    await stopBridge(child);
    await rm(directory, { recursive: true, force: true });
  }
});

test("bridge shares concurrent runtime checks and recovers when the CLI returns", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dojo-bridge-concurrent-"));
  const executable = join(directory, "codex");
  const logPath = join(directory, "fake.log");
  await symlink(fakeCodexPath, executable);
  const port = 48000 + Math.floor(Math.random() * 1000);
  const token = "concurrent-status-token-longer-than-24-characters";
  const url = `http://127.0.0.1:${port}`;
  const child = startBridge({ port, token, executable, logPath });
  const fetchStatus = async () => {
    const response = await fetch(`${url}/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const readEvents = async () => (await readFile(logPath, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  try {
    const ready = await waitForBridge(url, token);
    assert.equal(ready.bridge, "ready");
    const previousEventCount = (await readEvents()).length;

    const statuses = await Promise.all(Array.from({ length: 8 }, fetchStatus));
    for (const status of statuses) {
      assert.equal(status.bridge, "ready");
      assert.equal(status.authentication, "chatgpt");
      assert.equal(status.safeBilling, true);
    }
    const newEvents = (await readEvents()).slice(previousEventCount);
    assert.equal(newEvents.length, 2);
    assert.equal(newEvents.filter((event) => event.args[0] === "--version").length, 1);
    assert.equal(newEvents.filter((event) => event.args[0] === "login" && event.args[1] === "status").length, 1);

    await rm(executable);
    const missingStatuses = await Promise.all(Array.from({ length: 8 }, fetchStatus));
    for (const status of missingStatuses) {
      assert.equal(status.bridge, "misconfigured");
      assert.equal(status.authentication, "unknown");
      assert.equal(status.safeBilling, false);
      assert.equal(status.codexVersion, undefined);
      assert.match(status.lastError, /CODEX_BRIDGE_CODEX_PATH/);
    }

    await symlink(fakeCodexPath, executable);
    const recovered = await fetchStatus();
    assert.equal(recovered.bridge, "ready");
    assert.equal(recovered.authentication, "chatgpt");
    assert.equal(recovered.safeBilling, true);
    assert.equal(recovered.lastError, undefined);
  } finally {
    await stopBridge(child);
    await rm(directory, { recursive: true, force: true });
  }
});

test("bridge accepts only allowlisted tasks and strips API key credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dojo-bridge-test-"));
  const logPath = join(directory, "fake.log");
  const port = 44000 + Math.floor(Math.random() * 1000);
  const token = "test-token-that-is-longer-than-24-characters";
  const url = `http://127.0.0.1:${port}`;
  const child = startBridge({ port, token, logPath });
  try {
    const status = await waitForBridge(url, token);
    assert.equal(status.authentication, "chatgpt");
    assert.equal(status.safeBilling, true);

    const rejected = await fetch(`${url}/invoke`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ task: "arbitrary_prompt", payload: { prompt: "run rm" } }),
    });
    assert.equal(rejected.status, 400);

    const languageBank = await fetch(`${url}/invoke`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        task: "rebuild_language_bank",
        payload: { sourceContext: "safe test context" },
      }),
    });
    assert.equal(languageBank.status, 200, await languageBank.text());

    const languageExpansion = await fetch(`${url}/invoke`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        task: "expand_language_category",
        payload: { category: "technical_vocabulary", requestedCount: 10 },
      }),
    });
    assert.equal(languageExpansion.status, 200, await languageExpansion.text());

    const languageCoach = await fetch(`${url}/invoke`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        task: "coach_language_output",
        payload: { units: [] },
      }),
    });
    assert.equal(languageCoach.status, 200, await languageCoach.text());

    const languageExam = await fetch(`${url}/invoke`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        task: "grade_language_exam",
        payload: { items: [] },
      }),
    });
    assert.equal(languageExam.status, 200, await languageExam.text());

    for (const task of ["review_interview_advisory", "review_interview_insights"]) {
      const response = await fetch(`${url}/invoke`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ task, payload: { interviews: [], blocks: [], generationContract:{evidenceSources:[{sourcePath:"20_求職/株式会社テスト/一次面接_整理稿.md",blocks:[{blockId:"q01",sentenceIds:["s001"]}]}],contextPaths:[]} } }),
      });
      const body = await response.json();
      assert.equal(response.status, 200, JSON.stringify(body));
      assert.ok(body.diagnosticPath);
      const saved = JSON.parse(await readFile(body.diagnosticPath, "utf8"));
      assert.deepEqual(saved.output, body.output);
      assert.equal(saved.task, task);
      assert.ok(saved.schema.$defs.evidenceReference.anyOf.length);
      assert.deepEqual(saved.generationContract.evidenceSources[0].blocks, [{blockId:"q01",sentenceIds:["s001"]}]);
      await rm(dirname(body.diagnosticPath), {recursive:true,force:true});
    }

    const events = (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const executions = events.filter((event) => event.args?.includes("exec"));
    assert.equal(executions.length, 6);
    const advisorySchema = executions.find(event => event.outputSchema?.properties?.stage)?.outputSchema;
    assert.equal(advisorySchema.properties.evidence.items.$ref, "#/$defs/evidenceReference");
    assert.deepEqual(advisorySchema.$defs.evidenceReference.anyOf[0].properties.sourcePath.enum, ["20_求職/株式会社テスト/一次面接_整理稿.md"]);
    assert.equal(advisorySchema.properties.nextSteps.items.properties.evidence.items.$ref, "#/$defs/evidenceReference");
    assert.deepEqual(advisorySchema.$defs.evidenceReference.anyOf[0].properties.blockId.enum, ["q01"]);
    assert.deepEqual(advisorySchema.$defs.evidenceReference.anyOf[0].properties.sentenceIds.items.enum, ["s001"]);
    const execution = executions[0];
    for (const event of executions) {
      assert.equal(event.hasOpenAiKey, false);
      assert.equal(event.hasCodexApiKey, false);
      assert.equal(event.args.includes("--fast"), false);
    }
    assert.deepEqual(
      execution.args.slice(0, 3),
      ["--ask-for-approval", "never", "exec"],
    );
    assert.ok(execution.args.includes("--ephemeral"));
    assert.ok(execution.args.includes("read-only"));
    assert.ok(execution.args.includes("--ignore-user-config"));
    assert.ok(execution.args.includes("--ignore-rules"));
    assert.ok(execution.args.includes("--output-schema"));
    assert.equal(executions[0].args[executions[0].args.indexOf("-m") + 1], "gpt-5.6-sol");
    assert.equal(executions[1].args[executions[1].args.indexOf("-m") + 1], "gpt-5.6-sol");
    assert.equal(executions[2].args[executions[2].args.indexOf("-m") + 1], "gpt-5.6-terra");
    assert.equal(executions[3].args[executions[3].args.indexOf("-m") + 1], "gpt-5.6-terra");
    for (const execution of executions.slice(4)) {
      assert.equal(execution.args[execution.args.indexOf("-m") + 1], "gpt-5.6-sol");
      assert.ok(execution.args.includes("read-only"));
    }
  } finally {
    await stopBridge(child);
    await rm(directory, { recursive: true, force: true });
  }
});

test("bridge refuses API-key login", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dojo-bridge-auth-test-"));
  const logPath = join(directory, "fake.log");
  const port = 45000 + Math.floor(Math.random() * 1000);
  const token = "another-test-token-longer-than-24-characters";
  const url = `http://127.0.0.1:${port}`;
  const child = startBridge({ port, token, logPath, login: "api" });
  try {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        const response = await fetch(`${url}/status`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.ok) break;
      } catch {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 40));
      }
    }
    const statusResponse = await fetch(`${url}/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const status = await statusResponse.json();
    assert.equal(status.authentication, "api-key");
    assert.equal(status.safeBilling, false);

    const invoke = await fetch(`${url}/invoke`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ task: "grade_language_exam", payload: { items: [] } }),
    });
    assert.equal(invoke.status, 412);
  } finally {
    await stopBridge(child);
    await rm(directory, { recursive: true, force: true });
  }
});

// 通过真实 HTTP/CLI 返回路径检查评分证据拒绝发生在交付之前，fixture 不含求职事实。
test("bridge enforces v3 evidence bases, recovery and model-number boundaries over HTTP", async () => {
  const directory = await mkdtemp(join(tmpdir(), "interview-scoring-bridge-"));
  const executable = join(directory, "fake-scoring.mjs");
  await writeFile(executable, `#!/usr/bin/env node
import {readFileSync} from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "--version") { process.stdout.write("codex-cli fake-scoring\\n"); }
else if (args[0] === "login") { process.stdout.write("Logged in using ChatGPT\\n"); }
else {
  const schema = JSON.parse(readFileSync(args[args.indexOf("--output-schema") + 1],"utf8"));
  if(schema.properties.evaluationMode.enum[0] !== "scored_evidence" || !schema.properties.dimensions.properties.coverage.required.includes("baseScore") || schema.properties.dimensions.properties.coverage.properties.score || !schema.properties.evaluation.required.includes("scoringEligible")) process.exit(3);
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const payload = JSON.parse(input.split("\\n\\nINPUT_JSON:\\n")[1]);
  process.stdout.write(JSON.stringify(payload.testReview));
}
`, { mode: 0o700 });
  const port = 52000 + Math.floor(Math.random() * 1000);
  const token = "interview-scoring-test-token-longer-than-24";
  const child = startBridge({ port, token, executable });
  const url = `http://127.0.0.1:${port}`;
  const entry = { blockId: "q01", severity: "major", points: 25, recovery: "unresolved", labelZh: "核心未交付", detailZh:"原问题核心到后文未恢复，原因未知。", fixZh:"核事实后先答。", evidenceSentenceIds: ["s001"] };
  const blank = { level: "not_assessed", baseScore:null, basisZh:"未受检验。", positiveEvidenceBlockIds:[], rationaleZh:"资料不足。", evidenceBlockIds:[], deductions:[] };
  const good = { evaluationMode:"scored_evidence", evaluation:{conclusionZh:"核心未恢复。",coverageZh:"仅现有文本。",limitsZh:"无原音。",scoringEligible:false,eligibilityZh:"仅一维可评。",materialScope:"full_available_text"}, dimensions:Object.fromEntries(["questionUnderstanding","coverage","directness","evidenceCredibility","riskControl"].map(key=>[key,{...blank}])), blocks:[{blockId:"q01"}] };
  good.dimensions.coverage = {...blank, level:"core_gap",baseScore:75,basisZh:"所问范围为标准参考线，核心未恢复。", evidenceBlockIds:["q01"],deductions:[entry]};
  const quoted = { evidence:[{blockId:"q01",sentenceIds:["s001"]}] };
  const unseen = { verdict:"not_applicable", fixZh:"", evidence:[] };
  good.japanSignals = {
    motivation:{verdict:"poor",observationZh:"没有说出入社意欲。",fixZh:"收尾补一句志望。",...quoted},
    closing:{verdict:"poor",observationZh:"以「以上です」结束。",fixZh:"道谢后表明希望推进。",...quoted},
    concernRecovery:{...unseen,observationZh:"面试官没有流露懸念。"},
    unpromptedNegative:{verdict:"good",observationZh:"没有主动说负面。",fixZh:"",...quoted},
    registerConsistency:{verdict:"good",observationZh:"保持敬体。",fixZh:"",...quoted},
    salaryVisaLine:{...unseen,observationZh:"本场没谈年收在留。"},
    reverseQuestions:{...unseen,observationZh:"没有逆質問环节。"},
  };
  const cases = [
    [value=>value,200],
    [value=>{value.dimensions.coverage.deductions[0].points=17;return value;},502],
    [value=>{value.dimensions.riskControl={...value.dimensions.coverage};return value;},502],
    [value=>{value.dimensions.coverage.baseScore=85;value.dimensions.coverage.positiveEvidenceBlockIds=["q01"];return value;},502],
    [value=>{value.dimensions.coverage.level="supported";return value;},502],
    [value=>{value.overallScore=99;return value;},502],
    [value=>{value.dimensions.coverage.score=99;return value;},502],
    [value=>{value.dimensions.coverage.deductions[0].evidenceSentenceIds=["s999"];return value;},502],
    [value=>{value.evaluationMode="evidence";return value;},502],
    [value=>{delete value.japanSignals;return value;},502],
    [value=>{value.japanSignals.closing={...value.japanSignals.closing,verdict:"not_applicable",evidence:[]};return value;},502],
    [value=>{value.japanSignals.motivation.evidence=[{blockId:"q01",sentenceIds:["s999"]}];return value;},502],
    [value=>{value.dimensions.coverage.level="partial";value.dimensions.coverage.deductions=[{...entry,severity:"moderate",points:0,recovery:"repaired",detailZh:"请求澄清后即时答完整，未见残余损失。"}];return value;},200],
    [value=>{value.dimensions.coverage.level="partial";value.dimensions.coverage.deductions=[{...entry,severity:"moderate",points:5,recovery:"repaired",detailZh:"最终字段补齐，但反复提取当前条件成本已发生。"}];return value;},200],
  ];
  try {
    await waitForBridge(url, token);
    for (const [mutate,expected] of cases) {
      const response = await fetch(`${url}/invoke`, {
        method:"POST", headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},
        body:JSON.stringify({task:"review_interview_answers",payload:{blocks:[{id:"q01",sentences:[{id:"s001"}]}],testReview:mutate(structuredClone(good))}}),
      });
      const body = await response.text();
      assert.equal(response.status,expected,body);
      if(expected===502) assert.match(body,/账本不符合2026-10-v3/);
    }
  } finally { await stopBridge(child); await rm(directory,{recursive:true,force:true}); }
});
