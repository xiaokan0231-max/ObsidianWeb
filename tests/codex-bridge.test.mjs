import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

function startBridge({ port, token, logPath, login = "chatgpt" }) {
  return spawn(process.execPath, [bridgePath], {
    cwd: resolve("."),
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      CODEX_BRIDGE_PORT: String(port),
      CODEX_BRIDGE_TOKEN: token,
      CODEX_BRIDGE_CODEX_PATH: fakeCodexPath,
      FAKE_CODEX_LOG: logPath,
      FAKE_CODEX_LOGIN: login,
      OPENAI_API_KEY: "must-not-reach-child",
      CODEX_API_KEY: "must-not-reach-child",
    },
  });
}

async function stopBridge(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolvePromise) => child.once("exit", resolvePromise)),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

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

    const events = (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const executions = events.filter((event) => event.args?.includes("exec"));
    assert.equal(executions.length, 4);
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
