import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import * as repo from "../lib/review-contract.mjs";
import * as skill from "../.agents/skills/review-interview-answers/scripts/review-contract.mjs";
import { STRATEGY_TREND_META } from "../lib/interview-trends.mjs";

// skill 侧不 import 仓库外的文件（拷走后校验器要能独立启动），所以契约有两份。
// 「两份」本身不危险，「两份能悄悄分叉」才危险——这条断言就是那个红灯。
// 改契约的流程：改 lib/review-contract.mjs，然后
//   cp lib/review-contract.mjs .agents/skills/review-interview-answers/scripts/review-contract.mjs
test("契约的 skill 副本与正本同值", () => {
  assert.deepEqual(
    { ...skill },
    { ...repo },
    "skill 侧契约与 lib/review-contract.mjs 分叉了。执行：cp lib/review-contract.mjs .agents/skills/review-interview-answers/scripts/review-contract.mjs",
  );
});

// 趋势页按标签取展示元数据，取不到就会在渲染时炸。
// 契约加了新标签而这张表没跟上时，要在测试里红，而不是在页面上红。
test("战略标签的展示元数据覆盖契约里的每一个标签", () => {
  assert.deepEqual(Object.keys(STRATEGY_TREND_META), [...repo.REVIEW_STRATEGY_TAGS]);
});

// 校验器把总分算成五维简单平均，前提是等权。不等权时它算出来的值
// 与正本的加权分不再相等，而且两边都不会报错——所以在这里钉住。
test("五维等权，校验器的简单平均才等于正本的加权分", () => {
  const weights = Object.values(repo.REVIEW_DIMENSION_WEIGHTS);
  assert.equal(new Set(weights).size, 1, "五维权重不再相等");
  assert.equal(
    weights.reduce((sum, w) => sum + w, 0).toFixed(4),
    "1.0000",
    "五维权重之和不是 1",
  );
});

// 語言道場側は tag → 日本語テンプレの表を持っていて、引けなかった tag は
// `if (!template) continue;` で黙って飛ばす。落ちないぶん、契約に tag を足した時に
// 「その tag だけ練習項目が生成されない」という形で静かに欠ける。ここで赤くする。
// import ではなく原文照合にしているのは、lib/server/* が sever 専用依存を引くため。
test("回答戦略テンプレは契約の全 tag を覆う", async () => {
  const source = await readFile(
    new URL("../lib/server/language-v2.ts", import.meta.url),
    "utf8",
  );
  const templates = source.slice(source.indexOf("STRATEGY_TEMPLATES"));
  const missing = repo.REVIEW_STRATEGY_TAGS.filter((tag) => !templates.includes(`"${tag}"`));
  assert.deepEqual(missing, [], `STRATEGY_TEMPLATES に無い tag: ${missing.join(", ")}`);
});

// 分数带必须是闭区间且不倒置，否则 clamp 会把所有点数压到同一个值。
test("扣分档的分数带有效", () => {
  for (const [severity, band] of Object.entries(repo.DEDUCTION_SEVERITY_BANDS)) {
    assert.ok(band.min >= 1, `${severity} 的下界应至少为 1`);
    assert.ok(band.min <= band.max, `${severity} 的区间倒置`);
  }
});
