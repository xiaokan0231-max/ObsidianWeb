import assert from "node:assert/strict";
import test from "node:test";
import {
  includeAiSourceNote,
  includeRuntimeNote,
  isOperationalPath,
} from "../lib/vault-boundary.mjs";

const note = (path, type, extra = {}) => ({
  path,
  frontmatter: { type, ...extra },
});

test("runtime boundary excludes templates, archives, hidden paths and control aliases", () => {
  assert.equal(isOperationalPath("20_求職/_AI推薦/example.md"), true);
  assert.equal(isOperationalPath("99_系统/模板/tpl_会社.md"), false);
  assert.equal(isOperationalPath("90_归档/old.md"), false);
  assert.equal(isOperationalPath(".obsidian/workspace.md"), false);
  assert.equal(isOperationalPath("AGENTS.md"), false);
  assert.equal(includeRuntimeNote(note("99_系统/模板/tpl_会社.md", "company")), false);
});

test("AI boundary accepts current facts and evidence but rejects navigation and history", () => {
  assert.equal(includeAiSourceNote(note("10_关于我/事実.md", "self")), true);
  assert.equal(
    includeAiSourceNote(note("20_求職/_求人検索条件.md", "policy", { lifecycle: "current" })),
    true,
  );
  assert.equal(
    includeAiSourceNote(note("99_系统/规则变更/old.md", "policy-change", { lifecycle: "history" })),
    false,
  );
  assert.equal(includeAiSourceNote(note("20_求職/_求職総覧.md", "moc")), false);
  assert.equal(includeAiSourceNote(note("99_系统/模板/tpl_復盤.md", "review")), false);
  assert.equal(includeAiSourceNote(note("80_AI分析/面接道場/profile.md", "training-profile")), false);
  assert.equal(
    includeAiSourceNote(note("20_求職/_素材/AI专项.md", "material", {
      material_kind: "language-expression-course",
    })),
    false,
  );
  assert.equal(
    includeAiSourceNote(note(
      "30_日本語学習/専門コースログ/AI专项_進捗.md",
      "language-expression-course-progress",
    )),
    false,
  );
});
