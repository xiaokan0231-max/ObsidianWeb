#!/usr/bin/env node

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const commandIndex = args.indexOf("exec");
const event = {
  args,
  hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY),
  hasCodexApiKey: Boolean(process.env.CODEX_API_KEY),
  hasObsidianApiKey: Boolean(process.env.OBSIDIAN_API_KEY),
};
if (commandIndex >= 0 && args.includes("--output-schema")) {
  event.outputSchema = JSON.parse(readFileSync(args[args.indexOf("--output-schema") + 1], "utf8"));
}

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
  if (event.outputSchema?.properties?.scenarios) {
    const [, json] = input.split("\n\nINPUT_JSON:\n");
    const { companies } = JSON.parse(json);
    const releasePath = `${process.env.FAKE_CODEX_LOG}.release`;
    for (let attempt = 0; attempt < 100 && !existsSync(releasePath); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    writeFileSync(args[args.indexOf("--output-last-message") + 1], JSON.stringify({
      companies: companies.map(({ id }) => ({ id, advantages: [], tradeoffs: [], unknowns: [], questions: [] })),
      differences: [{
        axis: "职责", text: "C1 与 C2 的岗位职责不同。", implication: "按希望负责的业务模块选择。",
        evidenceIds: companies.map(({ facts }) => facts[0].id),
      }],
      scenarios: [],
    }));
    process.stdout.write("Codex run complete\n");
    process.exit(0);
  }
  process.stdout.write(JSON.stringify({ grades: [] }));
  process.exit(0);
}

process.stderr.write(`Unsupported fake Codex args: ${args.join(" ")}\n`);
process.exit(2);
