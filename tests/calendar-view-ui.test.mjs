import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as notes from "../lib/notes.ts";
import * as calendarMonth from "../lib/calendar-month.ts";
import * as model from "../lib/memory-atlas-data.ts";

const source = await readFile(new URL("../app/calendar-view.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const require = createRequire(import.meta.url);
const components = {};
const modules = { "@/lib/notes": notes, "@/lib/calendar-month": calendarMonth, "@/lib/memory-atlas-data": model };
runInNewContext(compiled.outputText, {
  exports: components,
  require: (specifier) => modules[specifier] ?? require(specifier),
  window: { location: { search: "?month=2026-08" } },
  URLSearchParams,
});

test("日历月格与议程显示明确时间范围，并标注日本时间", () => {
  const html = renderToStaticMarkup(createElement(components.default, {
    today: "2026-08-10",
    events: [{
      id: "test", note: {}, kind: "event", date: "2026-08-10", time: "10:00", endTime: "10:30",
      company: "株式会社テスト", label: "面谈", phase: "upcoming", caseId: "", prepPath: "",
    }],
    interviewTargets: new Map(), onOpen() {}, onInterview() {},
  }));
  assert.match(html, /日本时间（JST）/);
  assert.match(html, /dateTime="2026-08-10T10:00\+09:00">10:00–10:30<\/time>/);
  assert.match(html, /<small>10:00–10:30 · 面谈<\/small>/);
  assert.match(html, /aria-label="2026-08-10 · 10:00–10:30 · JST · 株式会社テスト/);
});
