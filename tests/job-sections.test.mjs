import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadSectionsModule() {
  const source = await readFile(new URL("../lib/job-sections.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

test("reads a job section before the next heading", async () => {
  const { jobSectionBody } = await loadSectionsModule();
  const markdown = "## 推荐理由\n理由正文\n\n## 注意点\n注意正文\n";
  assert.equal(jobSectionBody(markdown, "推荐理由").trim(), "理由正文");
});

test("reads the final job section through end of file", async () => {
  const { jobSectionBody } = await loadSectionsModule();
  const markdown = "## 注意点\n注意正文\n\n## 主打材料\n- Kafka\n- Flink";
  assert.equal(jobSectionBody(markdown, "主打材料").trim(), "- Kafka\n- Flink");
});

test("treats punctuation in a heading as literal text", async () => {
  const { jobSectionBody } = await loadSectionsModule();
  const markdown = "## 推荐理由（技術面）\n正文";
  assert.equal(jobSectionBody(markdown, "推荐理由（技術面）").trim(), "正文");
});
