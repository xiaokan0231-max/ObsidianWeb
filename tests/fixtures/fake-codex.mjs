#!/usr/bin/env node

import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);
const commandIndex = args.indexOf("exec");
const event = {
  args,
  hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY),
  hasCodexApiKey: Boolean(process.env.CODEX_API_KEY),
};

if (process.env.FAKE_CODEX_LOG) {
  appendFileSync(process.env.FAKE_CODEX_LOG, `${JSON.stringify(event)}\n`);
}

if (args[0] === "--version") {
  process.stdout.write("codex-cli fake-1.0\n");
  process.exit(0);
}

if (args[0] === "login" && args[1] === "status") {
  process.stdout.write(
    process.env.FAKE_CODEX_LOGIN === "api"
      ? "Logged in using an API key\n"
      : "Logged in using ChatGPT\n",
  );
  process.exit(0);
}

if (commandIndex >= 0) {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) input += chunk;
  if (process.env.FAKE_CODEX_LOG) {
    appendFileSync(
      process.env.FAKE_CODEX_LOG,
      `${JSON.stringify({ stdinLength: input.length, taskPrompt: input.slice(0, 300) })}\n`,
    );
  }
  process.stdout.write(JSON.stringify({ grades: [] }));
  process.exit(0);
}

process.stderr.write(`Unsupported fake Codex args: ${args.join(" ")}\n`);
process.exit(2);

