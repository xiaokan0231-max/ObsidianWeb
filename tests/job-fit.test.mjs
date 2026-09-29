import assert from "node:assert/strict";
import test from "node:test";
import { jobFit, toJobCard } from "../lib/jobs.ts";

const note = (frontmatter) => ({ path: "20_求職/テスト/x.md", frontmatter: { type: "job-case", company: "株式会社テスト", ...frontmatter }, content: "# 株式会社テスト — x", tags: [], stat: { ctime: 0, mtime: 1, size: 0 } });
const v2 = {
  rating_version: "v2", fit_score_100: 74, fit_band_final: "B", fit_band: "B", hard_gate: "hold",
  gate_employment_visa: "pass", gate_salary: "hold", gate_english: "pass", gate_role_center: "pass", gate_japanese_client: "pass", gate_original: "pass",
  score_technical_value: 20, score_document_match: 6, score_transferability: 12, score_org_legibility: 16, score_client_deployability: 12, score_role_coherence: 8,
  access_state: "direct", salary_range_class: "high_possible", role_family: "senior_data_platform", primary_cohort: "data_ai_platform",
  salary_min: 700, salary_max: 1200, salary: "年収 650万〜900万円（求人票の古い記載）",
};

test("v2 採点は六軸・Band・Gate が揃って初めて数字になる；欠けたら null（0 ではない）", () => {
  const fit = jobFit(note(v2));
  assert.deepEqual({ score: fit.score, band: fit.band, hardGate: fit.hardGate, access: fit.accessState }, { score: 74, band: "B", hardGate: "hold", access: "direct" });
  assert.equal(fit.scores.technicalValue, 20);
  assert.equal(fit.gates.salary, "hold");
  assert.equal(jobFit(note({ ...v2, rating_version: undefined })), null, "v1 案件");
  assert.equal(jobFit(note({ ...v2, score_role_coherence: "" })), null, "六軸が一つ欠ける");
  assert.equal(jobFit(note({ ...v2, fit_band_final: "Z", fit_band: "Z" })), null, "枚举外の Band");
  assert.equal(jobFit(note({ ...v2, fit_score_100: "abc" })).score, 74, "合計が壊れていれば六軸から足す");
});

test("年収は v2 の salary_min/max を優先し、無ければ自由文を解析する", () => {
  assert.deepEqual(toJobCard(note(v2)).salary, { min: 700, max: 1200, estimated: false });
  assert.deepEqual(toJobCard(note({ ...v2, salary_min: "", salary_max: "" })).salary, { min: 650, max: 900, estimated: false }, "構造化値が無ければ自由文");
  assert.deepEqual(toJobCard(note({ salary: "月給 50万〜60万円" })).salary, { min: 600, max: 720, estimated: true });
  assert.equal(toJobCard(note({ salary: "" })).fit, null);
});

test("並び替え fit は合計点の降順、未採点（null）は末尾", async () => {
  const { compareJobs } = await import("../lib/jobs.ts");
  const high = toJobCard(note({ ...v2, fit_score_100: 90 }));
  const low = toJobCard(note({ ...v2, fit_score_100: 40, company: "株式会社サンプル" }));
  const unrated = toJobCard(note({ company: "株式会社ダミー" }));
  assert.deepEqual([unrated, low, high].sort((a, b) => compareJobs(a, b, "fit")).map((job) => job.company), ["株式会社テスト", "株式会社サンプル", "株式会社ダミー"]);
});

test("看板の接線：Gate/Band/到達の URL パラメータが読み書き両方にあり、未採点は共有文言で出す", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../app/jobs-view.tsx", import.meta.url), "utf8");
  for (const key of ["gate", "band", "access"]) {
    assert.match(source, new RegExp(`csvParam\\(params, "${key}"\\)`), `${key} を URL から読む`);
    assert.match(source, new RegExp(`params\\.set\\("${key}",`), `${key} を URL に書く`);
  }
  assert.match(source, /import \{ ACCESS_STATE_VALUES, FIT_BANDS, HARD_GATE_VALUES \} from "@\/lib\/job-case-schema"/, "枚举は schema から取り、書き直さない");
  assert.doesNotMatch(source, /\["pass", "hold", "reject"\]|\["A", "B", "C", "D"\]/, "Gate / Band の値リテラルは看板に無い");
  assert.doesNotMatch(source, /"未採点（v2）"/, "未採点文言はリテラルでなく UNRATED_V2_LABEL");
  assert.match(source, /<FitPanel fit=\{job\.fit\} \/>/);
  assert.match(source, /\.\.\.JOB_FIT_AXES\.map\(\(key\) => \(\{/, "対比表は六軸を行に展開する");
});
