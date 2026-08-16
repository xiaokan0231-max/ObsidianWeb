// 回答品質復盤（type: interview-answer-review）を横断で集計する。
//
// なぜ機械で出すのか：どの弱点が「癖」でどれが「その回だけの事故」かは、1本ずつ読んでいても分からない。
// 手で書くと上流が変わっても数字が変わらず、しかも二次引用で増幅する（台帳の手書き数字の事故と同じ構図）。
// ここで出した値は generated 区块にしか書かない。**人も AI も手で書き換えない。**
//
// ⚠️ タイムスタンプを入れないこと。入れると `vault:stats --check` が常時 drift 判定になる。

import { REVIEW_DIMENSION_META, parseInterviewAnswerReview } from "./review-deep.ts";
import { getString, noteBasename } from "./notes.ts";

/**
 * 「癖」と「その回だけの事故」を分ける唯一の境目。
 *
 * この判定は Web の傾向ページと generated ノートの両方が使う。閾値を各自で持つと、
 * 片方だけ 3 に上げた時にどちらもエラーを出さないまま「Web では癖、ノートでは偶発」に割れる——
 * 派生値を二重に持つとこうなる、というのは台帳の手書き数字で既に一度やった事故。
 * だから数字そのものではなく、この関数を呼ぶこと。
 */
export const REPEATED_INTERVIEW_MIN = 2;

/** 何場で出たら癖とみなすか。引数は「その tag が出た面接の場数」（出現回数ではない）。 */
export function isRepeatedAcrossInterviews(interviewCount) {
  return interviewCount >= REPEATED_INTERVIEW_MIN;
}

export const STRATEGY_TREND_META = {
  "compound-question-miss": {
    label: "复合问题漏答",
    description: "问题包含多个子问，但回答只覆盖其中一部分。",
  },
  "no-conclusion-first": {
    label: "不先说结论",
    description: "先铺背景或过程，面试官需要自行寻找答案。",
  },
  "negative-oversharing": {
    label: "主动暴露负面信息",
    description: "在没有必要时主动扩展弱点、冲突或不利细节。",
  },
  "weak-evidence": {
    label: "证据偏弱",
    description: "观点缺少具体案例、数据、角色或结果支撑。",
  },
  "over-absolute": {
    label: "表述过于绝对",
    description: "使用容易被反例击穿的绝对化判断。",
  },
  "role-mismatch": {
    label: "角色期待错位",
    description: "回答重点与职位、职级或面试官关注点不一致。",
  },
  "numbers-confusion": {
    label: "数字口径混乱",
    description: "年份、规模、人数或成果数字前后不一致。",
  },
};

const DIMENSION_KEYS = Object.keys(REVIEW_DIMENSION_META);

/** 復盤ノート名・整理稿名から面接そのものを指すキーを作る（`2026-07-24_エージェント面談`）。 */
export function interviewKeyFromNoteName(name) {
  return name.replace(/_(回答品質復盤|整理稿|逐字稿|批注|復盤|回答品質批注)$/, "");
}

/**
 * 復盤ノート1本を横断集計の入力に変える。この5フィールドが集計側との契約なので、
 * Web と vault:stats で別々に組み立てない——片方だけフィールド名を直すと、
 * 画面と generated ノートが違う母数で数え始めても、どちらもエラーを出さない。
 *
 * 受けるのはパス・frontmatter・本文だけ。Web は Note オブジェクト、vault:stats は
 * readFile と自前の frontmatter 解析から来るので、どちらの型にも依存させない。
 * review が null（データ区块が無い・壊れている）のまま返すのは意図どおりで、
 * 除外は buildInterviewTrends 側が一箇所でやる。
 */
export function reviewTrendEntry(path, frontmatter, content) {
  return {
    key: interviewKeyFromNoteName(noteBasename(path)),
    company: getString(frontmatter.company),
    date: getString(frontmatter.date),
    round: getString(frontmatter.round),
    review: parseInterviewAnswerReview(content),
  };
}

/**
 * 標準回答集の「証据」に書かれた `[[…_整理稿#qNN …]]` から、
 * 「この設問はどのカードが既にカバーしているか」を作る。
 * 推測ではなく**実際に書かれた出典**だけを使う——曖昧マッチで作ると外れたまま気づけない。
 */
export function buildCardCoverage(libraryContent) {
  const coverage = new Map();
  const cards = [...libraryContent.matchAll(/^##\s+(p\d+)\s+(.+)$/gm)];
  cards.forEach((card, index) => {
    const start = (card.index ?? 0) + card[0].length;
    const end = cards[index + 1]?.index ?? libraryContent.length;
    const block = libraryContent.slice(start, end);
    for (const link of block.matchAll(/\[\[([^\]|#]+)#(q\d+)[^\]]*\]\]/g)) {
      const key = `${interviewKeyFromNoteName(link[1].trim())}#${link[2]}`;
      const list = coverage.get(key) ?? [];
      if (!list.some((item) => item.id === card[1])) {
        list.push({ id: card[1], title: card[2].trim() });
      }
      coverage.set(key, list);
    }
  });
  return coverage;
}

/**
 * entries: [{ key, company, date, round, review }]（review は parseInterviewAnswerReview の結果）
 * coverage: buildCardCoverage の結果（省略可）
 */
export function buildInterviewTrends(entries, coverage = new Map()) {
  const interviews = [...entries]
    .filter((entry) => entry.review)
    .sort((left, right) => (left.date || "").localeCompare(right.date || ""))
    .map((entry) => ({
      key: entry.key,
      company: entry.company,
      date: entry.date,
      round: entry.round,
      overall: Math.round(entry.review.overallScore),
      dimensions: Object.fromEntries(
        DIMENSION_KEYS.map((dim) => [dim, entry.review.dimensions?.[dim]?.score ?? null]),
      ),
      priorityBlocks: (entry.review.priorityBlockIds ?? []).map((blockId) => {
        const block = entry.review.blocks?.find((item) => item.blockId === blockId);
        return {
          blockId,
          title: block?.questionTitle ?? "",
          cards: coverage.get(`${entry.key}#${blockId}`) ?? [],
        };
      }),
    }));

  const dimensionAverages = {};
  for (const dim of DIMENSION_KEYS) {
    const values = interviews.map((item) => item.dimensions[dim]).filter((value) => value !== null);
    dimensionAverages[dim] = values.length
      ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
      : null;
  }
  const scored = DIMENSION_KEYS.filter((dim) => dimensionAverages[dim] !== null);
  const weakestDimension = scored.length
    ? scored.reduce((worst, dim) => (dimensionAverages[dim] < dimensionAverages[worst] ? dim : worst))
    : null;

  const byTag = new Map();
  for (const entry of entries) {
    if (!entry.review) continue;
    for (const block of entry.review.blocks ?? []) {
      for (const tag of new Set(block.strategyTags ?? [])) {
        const item = byTag.get(tag) ?? { tag, keys: new Set(), occurrences: 0, examples: [] };
        item.keys.add(entry.key);
        item.occurrences += 1;
        item.examples.push({
          key: entry.key,
          company: entry.company,
          date: entry.date,
          blockId: block.blockId,
          title: block.questionTitle,
          cards: coverage.get(`${entry.key}#${block.blockId}`) ?? [],
        });
        byTag.set(tag, item);
      }
    }
  }

  const latestKey = interviews.at(-1)?.key ?? null;
  // 「直近1回で出なかった」は弱すぎる合図——その設問が出なかっただけで消えて見える。
  // 直近2場のどちらにも出ていないものだけを「静かになった」として扱う。
  const recentKeys = new Set(interviews.slice(-2).map((item) => item.key));
  const tags = [...byTag.values()]
    .map((item) => ({
      tag: item.tag,
      label: STRATEGY_TREND_META[item.tag]?.label ?? item.tag,
      description: STRATEGY_TREND_META[item.tag]?.description ?? "",
      interviews: item.keys.size,
      occurrences: item.occurrences,
      repeated: isRepeatedAcrossInterviews(item.keys.size),
      inLatest: latestKey ? item.keys.has(latestKey) : false,
      inRecent: [...recentKeys].some((key) => item.keys.has(key)),
      examples: item.examples.sort(
        (left, right) => (right.date || "").localeCompare(left.date || "") ||
          left.blockId.localeCompare(right.blockId),
      ),
    }))
    .sort(
      (left, right) =>
        right.interviews - left.interviews ||
        right.occurrences - left.occurrences ||
        left.tag.localeCompare(right.tag),
    );

  return {
    interviews,
    dimensionAverages,
    weakestDimension,
    tags,
    latestKey,
    recentKeys: [...recentKeys],
    // 過去に反復したが直近2場のどちらにも出ていないもの。**「改善済み」とは言わない**——
    // その設問が出なかっただけの可能性が残る
    quietRecently: tags.filter((item) => item.repeated && !item.inRecent),
    uncoveredBlocks: interviews.flatMap((item) =>
      item.priorityBlocks
        .filter((block) => block.cards.length === 0)
        .map((block) => ({ ...block, company: item.company, date: item.date, key: item.key })),
    ),
  };
}

function dimensionRow(interview) {
  return [
    interview.date,
    interview.company,
    interview.round,
    interview.overall,
    ...DIMENSION_KEYS.map((dim) => interview.dimensions[dim] ?? "—"),
  ];
}

function table(head, rows) {
  return [
    `| ${head.join(" | ")} |`,
    `|${head.map(() => "---").join("|")}|`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

/** generated 区块の中身。ここが唯一の書き手。 */
export function renderInterviewTrends(trends) {
  if (trends.interviews.length === 0) {
    return "まだ回答品質復盤がありません（`type: interview-answer-review` のノートが 0 件）。";
  }

  const dimensionLabels = DIMENSION_KEYS.map((dim) => REVIEW_DIMENSION_META[dim].label);
  const out = [];

  out.push(`### 五維スコアの推移（${trends.interviews.length} 場）`, "");
  out.push(table(
    ["日付", "会社", "回", "総合", ...dimensionLabels],
    trends.interviews.map(dimensionRow),
  ));
  out.push("");
  out.push(table(
    ["", "平均"],
    DIMENSION_KEYS.map((dim) => [
      REVIEW_DIMENSION_META[dim].label + (dim === trends.weakestDimension ? " ⚠️最弱" : ""),
      trends.dimensionAverages[dim] ?? "—",
    ]),
  ));
  out.push("");
  if (trends.weakestDimension) {
    out.push(
      `> ⚠️ 平均が最も低いのは **${REVIEW_DIMENSION_META[trends.weakestDimension].label}**` +
        `（${trends.dimensionAverages[trends.weakestDimension]}）。次の面接準備はここを重点に置く。`,
      "",
    );
  }

  const repeated = trends.tags.filter((item) => item.repeated);
  out.push("### 反復している戦略タグ（2 場以上で出たものだけ）", "");
  if (repeated.length === 0) {
    out.push("2 場以上で重複して出た戦略タグは無い。");
  } else {
    out.push(table(
      ["タグ", "出た面接", "のべ問数", "直近も", "直近の実例"],
      repeated.map((item) => [
        `**${item.label}**`,
        `${item.interviews} / ${trends.interviews.length}`,
        item.occurrences,
        item.inLatest ? "🔴 はい" : "—",
        item.examples
          .slice(0, 2)
          .map((example) => `${example.date} ${example.blockId}（${example.title}）`)
          .join("<br>"),
      ]),
    ));
  }
  out.push("");

  const once = trends.tags.filter((item) => !item.repeated);
  if (once.length > 0) {
    out.push(
      "> 1 場だけで出たタグ（癖と偶発の区別がつかないので参考のみ）：" +
        once.map((item) => `${item.label}（${item.occurrences}問）`).join("・"),
      "",
    );
  }

  if (trends.quietRecently.length > 0) {
    out.push("### 直近2場では出ていない反復タグ", "");
    out.push(
      "> ⚠️ **「改善済み」ではない。** その設問が出なかっただけの可能性が残る。" +
        "出なかった回の言い方を確認して、意図的に再現できるかを見る用途。",
      "",
    );
    for (const item of trends.quietRecently) {
      out.push(
        `- **${item.label}** — 過去 ${item.interviews} 場で計 ${item.occurrences} 問。` +
          `直近2場（${trends.recentKeys.join("・")}）では出ていない`,
      );
    }
    out.push("");
  }

  out.push("### 優先復習ブロックと、対応する回答カード", "");
  out.push(
    "> カードの対応は各カードの「证据」に書かれた `整理稿#qNN` の出典だけから作っている（推測しない）。",
    "",
  );
  for (const interview of trends.interviews.slice().reverse()) {
    if (interview.priorityBlocks.length === 0) continue;
    out.push(`**${interview.date} ${interview.company}（${interview.round}）**`, "");
    for (const block of interview.priorityBlocks) {
      const cards = block.cards.length
        ? block.cards.map((card) => `[[面接標準回答集#${card.id} ${card.title}\\|${card.id}]]`).join("・")
        : "⚠️ **対応カード無し**";
      out.push(`- ${block.blockId}${block.title ? `（${block.title}）` : ""} → ${cards}`);
    }
    out.push("");
  }

  if (trends.uncoveredBlocks.length > 0) {
    out.push(
      `> 🔴 対応カードが無い優先復習ブロックが ${trends.uncoveredBlocks.length} 件ある。` +
        "ここは [[面接標準回答集]] にカードを起こす候補（p26 SES可否がまさにこの経路で生まれた）。",
      "",
    );
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
