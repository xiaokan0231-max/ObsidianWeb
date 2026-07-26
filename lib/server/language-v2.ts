import type {
  LanguageBatch,
  LanguageBatchAction,
  LanguageBatchHistory,
  LanguageBatchPhase,
  LanguageCurriculum,
  LanguageEvidenceRef,
  LanguageItemProgress,
  LanguageLearningItem,
  LanguageLearningItemKind,
  LanguageScanJudgment,
  LanguageTrainingStage,
  LanguageV2State,
} from "../language/types";
import {
  LANGUAGE_COMPILE_LIMIT,
  LANGUAGE_OPEN_STRESS_LIMIT,
  LANGUAGE_STRESS_LIMIT,
} from "../language/types.ts";
import { normalizeAnswer, stableId, tokyoParts, yamlString } from "../dojo/utils.ts";
import {
  latestListeningMarks,
  parseAnnotations,
  parseSeirikou,
  patternSlug,
  plainSei,
  reviewDecisionTasks,
  uniqueAnnotations,
} from "../review.ts";
import { parseInterviewAnswerReview } from "../review-deep.ts";
import type { ObsidianNote } from "./obsidian";

export const CURRICULUM_START = "<!-- language-curriculum-json:start -->";
export const CURRICULUM_END = "<!-- language-curriculum-json:end -->";
export const BATCH_START = "<!-- language-batch-json:start -->";
export const BATCH_END = "<!-- language-batch-json:end -->";

const ITEM_QUOTAS: Record<LanguageLearningItemKind, number> = {
  active_chunk: 70,
  error_patch: 40,
  interviewer_phrase: 35,
  technical_term: 25,
  answer_strategy: 20,
  fact_anchor: 10,
};

const ACTIVE_JOB_STATUS = new Map([
  ["面接中", 100],
  ["書類通過", 90],
  ["応募済", 80],
  ["未応募", 50],
]);

const TECH_TERMS = [
  "Java", "Spring Boot", "Spring", "Kafka", "Flink", "Spark", "Hadoop",
  "ClickHouse", "MySQL", "PostgreSQL", "Redis", "Kubernetes", "Docker",
  "AWS", "GCP", "Azure", "Terraform", "Datadog", "Prometheus", "Grafana",
  "Airflow", "dbt", "BigQuery", "Snowflake", "Redshift", "Databricks",
  "Python", "TypeScript", "React", "Next.js", "LLM", "RAG", "MCP", "GPU",
  "CUDA", "機械学習", "生成AI", "データ基盤", "データパイプライン", "分散処理",
  "要件定義", "性能改善", "可観測性", "データ品質", "アーキテクチャ",
];

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function dateText(value: string) {
  return value.slice(0, 10);
}

function directory(path: string) {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

function basename(path: string) {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
}

function interviewPrefix(path: string) {
  return basename(path).replace(/_整理稿$/, "");
}

function interviewKey(note: ObsidianNote) {
  return `${text(note.frontmatter.date) || basename(note.path).slice(0, 10)}|${text(
    note.frontmatter.company,
  ) || directory(note.path).split("/").at(-1) || "面接"}|${text(note.frontmatter.round)}`;
}

function markerJson<T>(content: string, start: string, end: string): T | undefined {
  const startIndex = content.indexOf(start);
  const endIndex = content.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) return undefined;
  const raw = content
    .slice(startIndex + start.length, endIndex)
    .replace(/^\s*```json\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function sourceNote(
  notes: ObsidianNote[],
  study: ObsidianNote,
  suffix: string,
  type: string,
) {
  const dir = directory(study.path);
  const prefix = interviewPrefix(study.path);
  return notes.find((note) =>
    note.path === `${dir}/${prefix}_${suffix}.md` ||
    (directory(note.path) === dir && text(note.frontmatter.type) === type && basename(note.path).startsWith(prefix)),
  );
}

function evidence(
  study: ObsidianNote,
  key: string,
  excerpt: string,
  sentenceId?: string,
  blockId?: string,
): LanguageEvidenceRef {
  return { path: study.path, interviewKey: key, sentenceId, blockId, excerpt };
}

function firstCorrection(value: string) {
  return value.split(/[／/]/u)[0]?.trim().replace(/（.*$/, "").trim() || value.trim();
}

function readingFromGo(value: string) {
  const reading = value.match(/（([^）]+)）/)?.[1]?.trim() ?? "";
  return /^[ぁ-んァ-ヶー・\s]+$/u.test(reading) ? reading : "";
}

function topLevelEqualsIndex(value: string) {
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "（" || char === "(") depth += 1;
    if (char === "）" || char === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && (char === "＝" || char === "=")) return index;
  }
  return -1;
}

function targetFromGo(value: string) {
  const separator = topLevelEqualsIndex(value);
  if (separator < 0) return "";
  return value.slice(0, separator).replace(/（[^）]+）/g, "").trim();
}

function meaningFromGo(value: string) {
  const separator = topLevelEqualsIndex(value);
  return separator < 0 ? "" : value.slice(separator + 1).trim();
}

function splitGoEntries(value: string) {
  return value
    .split("／")
    .map((entry) => entry.trim())
    .filter((entry) => topLevelEqualsIndex(entry) >= 0);
}

const STRATEGY_TEMPLATES: Record<string, { ja: string; zh: string }> = {
  "numbers-confusion": {
    ja: "数字を整理して申し上げます。",
    zh: "先声明整理数字，再按统一口径回答",
  },
  "no-conclusion-first": {
    ja: "結論から申し上げます。",
    zh: "先给结论，再补理由和例子",
  },
  "negative-oversharing": {
    ja: "まず、前向きな理由から申し上げます。",
    zh: "先说积极理由，避免主动扩大负面信息",
  },
  "over-absolute": {
    ja: "現時点では、〜と考えています。",
    zh: "用有边界的判断替代过度绝对化",
  },
  "weak-evidence": {
    ja: "具体例を一つ挙げます。",
    zh: "用一个具体事实支撑抽象判断",
  },
  "role-mismatch": {
    ja: "私が担当した範囲は〜です。",
    zh: "准确限定自己的职责范围",
  },
  "compound-question-miss": {
    ja: "ご質問は二点あると理解しています。順にお答えします。",
    zh: "显式拆开复合问题，逐项回答",
  },
};

function compactText(value: string, max = 48) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

function normalizeUpgradeTarget(chunk: string) {
  if (/少し考える時間をいただけますか/u.test(chunk)) return "少し考える時間をいただけますか";
  if (/補足させてください/u.test(chunk)) return "一点、補足させてください";
  if (/ご懸念.+理解/u.test(chunk)) return "ご懸念は二点あると理解しました";
  if (/どのように使い分け/u.test(chunk)) return "どのように使い分けていらっしゃいますか";
  if (/キャッチアップ/u.test(chunk)) return "最短でキャッチアップする";
  if (/合意形成/u.test(chunk)) return "顧客と合意形成する";
  if (/実務経験は限定的/u.test(chunk)) return "実務経験は限定的です";
  if (/落とし込/u.test(chunk)) return "要件を実務に落とし込む";
  if (/段階的/u.test(chunk)) return "段階的に対応範囲を広げる";
  if (/性能.+可用性.+スケーラビリティ.+検証/u.test(chunk)) {
    return "性能・可用性・スケーラビリティを検証する";
  }
  if (/検証範囲を絞/u.test(chunk)) return "検証範囲を絞る";
  if (/検証段階/u.test(chunk)) return "まだ検証段階です";
  if (/検証環境/u.test(chunk)) return "小さな検証環境で実際に動かす";
  if (/見極め/u.test(chunk)) return "AIに任せる部分と人が判断する部分を見極める";
  if (/切り分け/u.test(chunk)) return "問題を切り分ける";
  if (/重視.+ますか/u.test(chunk)) return "どのような経験を重視されていますか";
  if (/重視/u.test(chunk)) return "〜を重視しています";
  if (/のではなく/u.test(chunk)) return "〜のではなく、〜";
  if (/だけでなく/u.test(chunk)) return "〜だけでなく、〜も";
  if (/ために/u.test(chunk)) return "〜ために、〜";
  if (/ようにしています/u.test(chunk)) return "〜ようにしています";
  if (/と理解/u.test(chunk)) return "〜と理解しています";
  if (/に加えて/u.test(chunk)) return "〜に加えて、〜";
  if (/を通じて/u.test(chunk)) return "〜を通じて、〜";
  if (/に基づ/u.test(chunk)) return "〜に基づいて、〜";
  if (/活か|貢献/u.test(chunk)) return "〜の経験を活かして貢献したいです";
  if (/取り組/u.test(chunk)) return "〜に継続して取り組む";
  if (/一方/u.test(chunk)) return "一方で、〜";
  // 結論先行・慎重な判断・回答順序は answer_strategy で一度だけ訓練する。
  if (/と考え|^まず|^次に|^ただ|結論/u.test(chunk)) return "";
  return "";
}

function atomicAnswerChunks(value: string) {
  const chunks: string[] = [];
  for (const sentence of value
    .replace(/\s+/g, "")
    .split(/(?<=[。！？])/u)
    .map((part) => part.replace(/[。！？]+$/u, "").trim())
    .filter(Boolean)) {
    if (sentence.length <= 32) {
      chunks.push(sentence);
      continue;
    }
    for (const clause of sentence.split("、").map((part) => part.trim()).filter(Boolean)) {
      if (clause.length <= 36) chunks.push(clause);
    }
  }
  const upgradeSignal = /結論|まず|次に|具体的には|そのため|^ただ|一方|のではなく|だけでなく|に加えて|ために|ように|ことができ|と考え|と認識|と理解|を通じて|に基づ|活か|取り組|貢献|重視|改善|検証|段階的|再現|認識のずれ|落とし込|切り分け|見極め/u;
  return [...new Set(chunks)]
    .map((chunk) => chunk.replace(/^[、。]+|[、。]+$/gu, "").trim())
    .map((chunk) => {
      if (chunk.endsWith("だけでなく")) return `${chunk}、〜も`;
      if (chunk.endsWith("のではなく")) return `${chunk}、〜`;
      if (chunk.endsWith("ために")) return `${chunk}、〜`;
      return chunk;
    })
    .filter((chunk) => !/^(という|そして|それで)/u.test(chunk))
    .filter((chunk) => !/(と考えていて|と考えていますので|し$|して$|活かし$|活かせるのは$|検証し$|確認し$|決め$|使って$|現場で$|ており$|せず$)/u.test(chunk))
    .filter((chunk) => chunk.length >= 6 && chunk.length <= 36 && upgradeSignal.test(chunk))
    .map(normalizeUpgradeTarget)
    .filter(Boolean);
}

function upgradeFunctionZh(chunk: string, questionTitle: string) {
  const rules: Array<[RegExp, string]> = [
    [/少し考える時間/u, "礼貌地争取思考时间"],
    [/補足させてください/u, "礼貌地补充说明"],
    [/ご懸念/u, "复述并确认对方的顾虑"],
    [/どのように使い分け/u, "询问两种语言的具体使用方式"],
    [/キャッチアップ/u, "表达尽快补齐知识或经验"],
    [/合意形成/u, "与客户或相关方形成共识"],
    [/実務経験は限定的/u, "诚实限定实务经验范围"],
    [/どのような経験を重視/u, "询问对方重视哪些经验或特征"],
    [/検証範囲を絞/u, "缩小并明确必要的验证范围"],
    [/まだ検証段階/u, "谨慎说明目前仍处于验证阶段"],
    [/小さな検証環境/u, "先在小型验证环境中实际运行"],
    [/性能.+可用性.+スケーラビリティ/u, "列举性能、可用性和扩展性验证指标"],
    [/継続して取り組む/u, "表达持续投入某项技术或课题"],
    [/AIに任せる部分/u, "判断AI处理范围与人工判断边界"],
    [/のではなく/u, "使用「不是A，而是B」进行对比修正"],
    [/だけでなく/u, "使用「不仅A，而且B」扩展说明"],
    [/一方/u, "使用「另一方面」建立对照"],
    [/ために/u, "使用「为了……」说明目的"],
    [/ようにしています/u, "表达平时持续采用的做法"],
    [/と理解/u, "复述并确认自己的理解"],
    [/と認識/u, "用较正式的方式表达认知"],
    [/と考え/u, "用有边界的方式表达当前判断"],
    [/まず|次に/u, "明确组织回答顺序"],
    [/具体的には/u, "从结论转入具体例"],
    [/段階的/u, "表达分阶段扩大负责范围"],
    [/落とし込/u, "表达把需求或知识落实到实务"],
    [/活か/u, "表达发挥已有经验并贡献价值"],
    [/貢献/u, "表达可以贡献的具体价值"],
    [/重視/u, "表达自己重视的判断标准"],
    [/検証|再現/u, "表达先验证、再投入实际使用"],
    [/切り分け/u, "表达对问题进行拆分定位"],
    [/見極め/u, "表达经过判断后再作决定"],
  ];
  return rules.find(([pattern]) => pattern.test(chunk))?.[1] ??
    `在「${compactText(questionTitle || "本题", 20)}」中可直接调用的新表达`;
}

function item(
  kind: LanguageLearningItemKind,
  canonicalKey: string,
  values: Partial<LanguageLearningItem> & Pick<LanguageLearningItem, "titleZh" | "targetJa" | "meaningZh">,
): LanguageLearningItem {
  return {
    id: stableId("li2", `${kind}|${canonicalKey}`),
    canonicalKey,
    kind,
    titleZh: values.titleZh,
    targetJa: values.targetJa,
    reading: values.reading ?? "",
    meaningZh: values.meaningZh,
    promptZh: values.promptZh ?? `请用日语表达：${values.meaningZh}`,
    originalJa: values.originalJa ?? "",
    correctedJa: values.correctedJa ?? values.targetJa,
    pattern: values.pattern ?? "",
    sourceInterviewKeys: values.sourceInterviewKeys ?? [],
    evidence: values.evidence ?? [],
    factSensitive: values.factSensitive ?? false,
    factSourcePaths: values.factSourcePaths ?? [],
    basePriority: values.basePriority ?? 50,
    listeningMark: values.listeningMark,
    strategyTags: values.strategyTags ?? [],
  };
}

function extractStudyItems(notes: ObsidianNote[]) {
  const studies = notes.filter((note) => text(note.frontmatter.type) === "transcript-study");
  const items: LanguageLearningItem[] = [];
  const staleReviewPaths: string[] = [];
  let learnerErrorCount = 0;
  let reviewedBlockCount = 0;
  let listeningGapCount = 0;

  for (const study of studies) {
    const key = interviewKey(study);
    const parsed = parseSeirikou(study.content);
    const annotation = sourceNote(notes, study, "批注", "study-annotation");
    const annotations = annotation
      ? uniqueAnnotations(parseAnnotations(annotation.content))
      : [];
    const decisions = new Map(
      reviewDecisionTasks(parsed.sentences, annotations).map((task) => [task.id, task.resolution]),
    );
    const listening = latestListeningMarks(annotations);
    listeningGapCount += listening.size;

    for (const sentence of parsed.sentences) {
      for (const error of sentence.errors) {
        const confirmedLearner = error.kind === "学習者" ||
          (error.kind === "疑" && decisions.get(`${sentence.id}:error:${error.index}`) === "learner");
        if (!confirmedLearner || !error.correction) continue;
        learnerErrorCount += 1;
        const correction = firstCorrection(error.correction);
        const pattern = error.pattern ? patternSlug(error.pattern) : "其他口语错误";
        const ref = evidence(study, key, `${plainSei(sentence)} → ${error.correction}`, sentence.id);
        const errorKey = `${study.path}|${sentence.id}|${error.index}`;
        const patchTarget = error.span && error.span !== correction
          ? `${error.span} → ${correction}`
          : correction;
        items.push(item("error_patch", errorKey, {
          titleZh: `局部修正 · ${pattern}`,
          targetJa: patchTarget,
          meaningZh: error.span
            ? `把「${error.span}」改为「${correction}」`
            : `使用更自然的表达「${correction}」`,
          promptZh: `请修正这句日语：${plainSei(sentence)}`,
          originalJa: plainSei(sentence),
          correctedJa: error.correction,
          pattern,
          sourceInterviewKeys: [key],
          evidence: [ref],
          basePriority: 76,
        }));
      }

      if (sentence.speaker === "面") {
        const mark = listening.get(sentence.id);
        for (const [index, note] of sentence.go.entries()) {
          for (const [partIndex, entry] of splitGoEntries(note).entries()) {
            const target = targetFromGo(entry);
            if (!target) continue;
            items.push(item("interviewer_phrase", `${study.path}|${sentence.id}|${index}|${partIndex}`, {
              titleZh: mark ? `听解${mark} · 面试官表达` : "面试官表达",
              targetJa: target,
              reading: readingFromGo(entry),
              meaningZh: meaningFromGo(entry) || sentence.yaku || entry,
              promptZh: `看到这段面试官表达时，快速确认其功能：${target}`,
              sourceInterviewKeys: [key],
              evidence: [evidence(study, key, sentence.sei, sentence.id)],
              listeningMark: mark,
              basePriority: mark === "×" ? 92 : mark === "△" ? 82 : 52,
            }));
          }
        }
      }
    }

    const deep = sourceNote(notes, study, "回答品質復盤", "interview-answer-review");
    const feedback = sourceNote(notes, study, "回答品質批注", "interview-answer-feedback");
    if (!deep) continue;
    if (feedback && feedback.stat.mtime > deep.stat.mtime) {
      staleReviewPaths.push(deep.path);
      continue;
    }
    const review = parseInterviewAnswerReview(deep.content);
    if (!review) continue;
    reviewedBlockCount += review.blocks.length;
    const priority = new Set(review.priorityBlockIds);
    for (const block of review.blocks) {
      if (!priority.has(block.blockId) && !block.strategyTags.length && !block.missedPoints.length && !block.improvedAnswerJa) {
        continue;
      }
      const sourceSentences = parsed.blocks
        .find((candidate) => candidate.id === block.blockId)
        ?.sentences.filter((sentence) => sentence.speaker === "私") ?? [];
      const original = sourceSentences.map(plainSei).join(" ");
      const refs = [evidence(study, key, block.evaluationZh, undefined, block.blockId)];
      const tags = block.strategyTags.length
        ? block.strategyTags
        : block.missedPoints.length || block.askedPoints.length > 1
          ? ["compound-question-miss"]
          : [];

      for (const tag of [...new Set(tags)]) {
        const template = STRATEGY_TEMPLATES[tag];
        if (!template) continue;
        items.push(item("answer_strategy", `${study.path}|${block.blockId}|${tag}`, {
          titleZh: `回答结构 · ${block.questionTitle || tag}`,
          targetJa: template.ja,
          meaningZh: template.zh,
          promptZh: `请写出用于“${block.questionTitle || "本题"}”的结构词块：${template.zh}`,
          originalJa: compactText(original, 90),
          correctedJa: template.ja,
          pattern: tag,
          sourceInterviewKeys: [key],
          evidence: refs,
          strategyTags: [tag],
          basePriority: priority.has(block.blockId) ? 88 : 70,
        }));
      }

      const normalizedOriginal = normalizeAnswer(original);
      for (const [index, chunk] of atomicAnswerChunks(block.improvedAnswerJa).entries()) {
        if (index >= 3 || normalizedOriginal.includes(normalizeAnswer(chunk))) continue;
        const upgradeMeaning = upgradeFunctionZh(chunk, block.questionTitle);
        items.push(item("active_chunk", `${study.path}|${block.blockId}|upgrade|${normalizeAnswer(chunk)}`, {
          titleZh: `表达升级 · ${block.questionTitle || "面试回答"}`,
          targetJa: chunk,
          meaningZh: upgradeMeaning,
          promptZh: `请写出这个升级表达：${upgradeMeaning}`,
          originalJa: compactText(original, 90),
          correctedJa: chunk,
          pattern: "表达升级",
          sourceInterviewKeys: [key],
          evidence: refs,
          basePriority: priority.has(block.blockId) ? 80 : 64,
        }));
      }
    }
  }

  return {
    studies,
    items,
    learnerErrorCount,
    reviewedBlockCount,
    listeningGapCount,
    staleReviewPaths,
  };
}

function extractJobItems(notes: ObsidianNote[]) {
  const found = new Map<string, LanguageLearningItem>();
  const jobs = notes
    .filter((note) => text(note.frontmatter.type) === "job-case")
    .map((note) => ({ note, status: text(note.frontmatter.status).replace(/（.*$/, "") }))
    .filter(({ status }) => ACTIVE_JOB_STATUS.has(status))
    .sort((left, right) => (ACTIVE_JOB_STATUS.get(right.status) ?? 0) - (ACTIVE_JOB_STATUS.get(left.status) ?? 0));
  for (const { note, status } of jobs) {
    const content = `${JSON.stringify(note.frontmatter)}\n${note.content}`;
    for (const term of TECH_TERMS) {
      if (!content.toLocaleLowerCase().includes(term.toLocaleLowerCase())) continue;
      const current = found.get(term);
      const priority = (ACTIVE_JOB_STATUS.get(status) ?? 40) - 10;
      if (current && current.basePriority >= priority) continue;
      found.set(term, item("technical_term", normalizeAnswer(term), {
        titleZh: `近期岗位技术 · ${term}`,
        targetJa: term,
        meaningZh: `能在近期目标岗位的技术说明中识别并使用 ${term}`,
        promptZh: `请输入近期岗位中出现的技术词：${term}`,
        evidence: [{
          path: note.path,
          interviewKey: `job|${text(note.frontmatter.company) || basename(note.path)}`,
          excerpt: term,
        }],
        basePriority: priority,
      }));
    }
  }
  return [...found.values()];
}

function extractLegacyFacts(notes: ObsidianNote[]) {
  const bankNote = notes.find((note) => text(note.frontmatter.type) === "language-bank");
  if (!bankNote) return [];
  const start = "<!-- language-bank-json:start -->";
  const end = "<!-- language-bank-json:end -->";
  const bank = markerJson<{ units?: Array<Record<string, unknown>> }>(bankNote.content, start, end);
  return (bank?.units ?? []).flatMap((source) => {
    if (text(source.category) !== "numbers_reading") return [];
    const paths = Array.isArray(source.factSourcePaths) ? source.factSourcePaths.map(text).filter(Boolean) : [];
    if (!paths.length) return [];
    const target = text(source.targetJa);
    if (!target) return [];
    return [item("fact_anchor", text(source.canonicalKey) || normalizeAnswer(target), {
      titleZh: text(source.titleZh) || "数字与事实口径",
      targetJa: target,
      reading: text(source.reading),
      meaningZh: text(source.meaningZh) || "稳定表达已确认的数字与事实",
      promptZh: `请准确输入这项已确认事实：${text(source.meaningZh)}`,
      factSensitive: true,
      factSourcePaths: paths,
      evidence: paths.map((path) => ({ path, interviewKey: "self", excerpt: target })),
      basePriority: 82,
    })];
  });
}

function mergeItems(values: LanguageLearningItem[]) {
  const merged = new Map<string, LanguageLearningItem>();
  for (const value of values) {
    if (/^〜みたいなの(?:って)?$/u.test(value.targetJa)) {
      value.targetJa = "〜みたいなの（って）";
      value.correctedJa = value.targetJa;
      value.meaningZh = "口语中表示“像……这样的（话题）”";
    }
    const normalizedTarget = normalizeAnswer(value.targetJa);
    const errorSource = normalizeAnswer(value.targetJa.split("→")[0] ?? value.targetJa)
      .replace(/と言う/gu, "という");
    const key = value.kind === "fact_anchor"
      ? `${value.kind}|${value.canonicalKey}`
      : value.kind === "error_patch"
        ? `${value.kind}|${value.pattern}|${errorSource}`
        : value.kind === "answer_strategy"
          ? `${value.kind}|${value.strategyTags[0] || value.pattern}|${normalizedTarget}`
          : `${value.kind}|${normalizedTarget}`;
    const current = merged.get(key);
    if (!current) {
      merged.set(key, {
        ...value,
        id: stableId("li2", key),
        canonicalKey: key,
      });
      continue;
    }
    if (value.kind === "error_patch") {
      const alternatives = [...new Set(
        [current.correctedJa, value.correctedJa]
          .flatMap((candidate) => candidate.split(/[／/]/u))
          .map((candidate) => candidate.trim())
          .filter(Boolean),
      )];
      const source = current.targetJa.split("→")[0]?.trim() || value.targetJa.split("→")[0]?.trim();
      current.correctedJa = alternatives.join("／");
      current.targetJa = source ? `${source} → ${alternatives.join("／")}` : alternatives.join("／");
      current.meaningZh = source
        ? `把「${source}」按语境改为「${alternatives.join("／")}」`
        : `按语境使用「${alternatives.join("／")}」`;
    }
    current.sourceInterviewKeys = [...new Set([...current.sourceInterviewKeys, ...value.sourceInterviewKeys])];
    current.evidence = [...current.evidence, ...value.evidence]
      .filter((entry, index, all) => all.findIndex((candidate) =>
        candidate.path === entry.path && candidate.sentenceId === entry.sentenceId && candidate.blockId === entry.blockId
      ) === index)
      .slice(0, 12);
    current.basePriority = Math.max(current.basePriority, value.basePriority);
  }
  const items = [...merged.values()];
  const groups = new Map<string, LanguageLearningItem[]>();
  for (const value of items) {
    const group = value.kind === "answer_strategy"
      ? value.strategyTags[0] || value.pattern || "回答结构"
      : value.pattern || value.kind;
    const list = groups.get(group) ?? [];
    list.push(value);
    groups.set(group, list);
  }
  for (const list of groups.values()) {
    const interviews = new Set(list.flatMap((value) => value.sourceInterviewKeys)).size;
    const boost = Math.min(18, Math.max(0, interviews - 1) * 8 + Math.max(0, list.length - 1));
    for (const value of list) value.basePriority = Math.min(100, value.basePriority + boost);
  }
  return items.sort((left, right) => right.basePriority - left.basePriority || left.id.localeCompare(right.id));
}

function issueSummaries(items: LanguageLearningItem[]) {
  const groups = new Map<string, LanguageLearningItem[]>();
  // active_chunk は error_patch から派生する別の訓練形式。同じ証拠を二重集計しない。
  for (const value of items.filter((candidate) =>
    candidate.kind === "error_patch" || candidate.kind === "answer_strategy"
  )) {
    const key = value.strategyTags[0] || value.pattern;
    const group = groups.get(key) ?? [];
    group.push(value);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([key, values]) => ({
      key,
      label: key,
      kind: values[0].kind,
      occurrenceCount: values.reduce((sum, value) => sum + Math.max(1, value.evidence.length), 0),
      interviewCount: new Set(values.flatMap((value) => value.sourceInterviewKeys)).size,
      itemIds: values.map((value) => value.id),
      evidence: values.flatMap((value) => value.evidence).slice(0, 8),
    }))
    .sort((left, right) =>
      right.interviewCount - left.interviewCount || right.occurrenceCount - left.occurrenceCount
    );
}

export function languageV2SourceFingerprint(notes: ObsidianNote[]) {
  const relevant = notes.filter((note) => {
    const type = text(note.frontmatter.type);
    if (["transcript-study", "study-annotation", "interview-answer-review", "interview-answer-feedback"].includes(type)) return true;
    if (type === "job-case") return ACTIVE_JOB_STATUS.has(text(note.frontmatter.status).replace(/（.*$/, ""));
    if (type === "language-bank") return true;
    return false;
  });
  return stableId("lcv2src", relevant
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((note) => `${note.path}:${note.stat.mtime}:${note.stat.size}`)
    .join("|"));
}

export function buildLanguageCurriculum(notes: ObsidianNote[]): LanguageCurriculum {
  const extracted = extractStudyItems(notes);
  const items = mergeItems([
    ...extracted.items,
    ...extractJobItems(notes),
    ...extractLegacyFacts(notes),
  ]);
  const sourceFingerprint = languageV2SourceFingerprint(notes);
  const contentFingerprint = stableId("lcv2content", items
    .map((value) => `${value.id}:${value.targetJa}:${value.meaningZh}`)
    .join("|"));
  return {
    version: 2,
    generatedAt: new Date().toISOString(),
    sourceFingerprint,
    contentFingerprint,
    sourceCount: extracted.studies.length,
    summaryZh: `已从${extracted.studies.length}场整理稿中提取${extracted.learnerErrorCount}处本人错误、${extracted.reviewedBlockCount}个回答复盘块，并建立${items.length}个可训练项目。`,
    items,
    profile: {
      interviewCount: extracted.studies.length,
      learnerErrorCount: extracted.learnerErrorCount,
      reviewedBlockCount: extracted.reviewedBlockCount,
      listeningGapCount: extracted.listeningGapCount,
      staleReviewPaths: extracted.staleReviewPaths,
      topIssues: issueSummaries(items).slice(0, 30),
    },
  };
}

export function renderLanguageCurriculum(curriculum: LanguageCurriculum) {
  return `---\ntype: language-curriculum\ngenerated_at: ${curriculum.generatedAt}\nsource_fingerprint: ${curriculum.sourceFingerprint}\n---\n\n# 面试证据驱动的日语集中训练课程\n\n${curriculum.summaryZh}\n\n> 本文件由 Web 生成。训练项目必须从整理稿、本人批注、回答质量复盘和活跃岗位上游重建，不手改。\n\n${CURRICULUM_START}\n\`\`\`json\n${JSON.stringify(curriculum, null, 2)}\n\`\`\`\n${CURRICULUM_END}\n`;
}

export function renderLanguageBatch(batch: LanguageBatch) {
  const completed = batch.phase === "completed";
  return `---\ntype: language-batch-log\ndate: ${batch.date}\nstatus: ${completed ? "completed" : "draft"}\nbatch_id: ${yamlString(batch.id)}\n---\n\n# ${batch.date} 日语集中训练\n\n- 目标项目：${batch.targetSize}\n- 当前阶段：${batch.phase}\n- 已保存动作：${batch.actions.length}\n\n> 本文件是自动保存的训练状态。请通过 Web 继续，不手改生成区块。\n\n${BATCH_START}\n\`\`\`json\n${JSON.stringify(batch, null, 2)}\n\`\`\`\n${BATCH_END}\n`;
}

function latestCurriculum(notes: ObsidianNote[]) {
  return notes
    .filter((note) => text(note.frontmatter.type) === "language-curriculum")
    .map((note) => markerJson<LanguageCurriculum>(note.content, CURRICULUM_START, CURRICULUM_END))
    .filter((value): value is LanguageCurriculum => Boolean(value))
    .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))[0];
}

export function languageCurriculumByFingerprint(notes: ObsidianNote[], fingerprint: string) {
  return notes
    .filter((note) => text(note.frontmatter.type) === "language-curriculum")
    .map((note) => markerJson<LanguageCurriculum>(note.content, CURRICULUM_START, CURRICULUM_END))
    .find((value) => value?.contentFingerprint === fingerprint || value?.sourceFingerprint === fingerprint);
}

function allBatches(notes: ObsidianNote[]) {
  return notes
    .filter((note) => text(note.frontmatter.type) === "language-batch-log")
    .map((note) => markerJson<LanguageBatch>(note.content, BATCH_START, BATCH_END))
    .filter((value): value is LanguageBatch => Boolean(value))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function emptyProgress(itemId: string): LanguageItemProgress {
  return {
    itemId,
    stage: "unseen",
    seenCount: 0,
    successCount: 0,
    failureCount: 0,
    successDates: [],
    rejected: false,
    postTrainingOccurrences: 0,
  };
}

function addDays(value: string, days: number) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function stageRank(stage: LanguageTrainingStage) {
  return ["unseen", "recognized", "correctable", "retrievable", "transferable", "stable"].indexOf(stage);
}

export function deriveLanguageProgress(
  curriculum: LanguageCurriculum,
  batches: LanguageBatch[],
  legacyTargets: Set<string>,
) {
  const progress = new Map(curriculum.items.map((value) => [value.id, emptyProgress(value.id)]));
  for (const value of curriculum.items) {
    if (legacyTargets.has(normalizeAnswer(value.targetJa))) {
      const state = progress.get(value.id)!;
      state.stage = "recognized";
      state.seenCount = 1;
    }
  }
  const actions = batches.flatMap((batch) => batch.actions).sort((left, right) => left.at.localeCompare(right.at));
  for (const action of actions) {
    const state = progress.get(action.itemId);
    if (!state) continue;
    state.seenCount += 1;
    state.lastSeenAt = action.at;
    if (action.phase === "scan") {
      if (action.judgment === "known" && stageRank(state.stage) < stageRank("recognized")) state.stage = "recognized";
      if (action.judgment === "reject") state.rejected = true;
      continue;
    }
    if (action.passed) {
      state.successCount += 1;
      state.firstSuccessAt ??= action.at;
      const day = dateText(action.at);
      if (!state.successDates.includes(day)) state.successDates.push(day);
      const item = curriculum.items.find((candidate) => candidate.id === action.itemId);
      if (action.phase === "stress" && item?.kind === "answer_strategy") state.stage = "transferable";
      else if (state.successDates.length >= 2) state.stage = "retrievable";
      else state.stage = "correctable";
      const span = state.firstSuccessAt
        ? (new Date(action.at).getTime() - new Date(state.firstSuccessAt).getTime()) / 86_400_000
        : 0;
      if (state.successDates.length >= 3 && span >= 7) state.stage = "stable";
      state.nextDueAt = addDays(action.at, state.stage === "stable" ? 30 : state.stage === "retrievable" ? 7 : 3);
    } else {
      state.failureCount += 1;
      if (state.stage === "stable" || state.stage === "transferable") state.stage = "retrievable";
      state.nextDueAt = addDays(action.at, 1);
    }
  }

  for (const value of curriculum.items) {
    const state = progress.get(value.id)!;
    if (!state.firstSuccessAt || !value.pattern) continue;
    const laterInterviews = curriculum.items
      .filter((candidate) => candidate.pattern === value.pattern)
      .flatMap((candidate) => candidate.evidence)
      .filter((entry) => /^\d{4}-\d{2}-\d{2}/.test(entry.interviewKey))
      .filter((entry) => entry.interviewKey.slice(0, 10) > dateText(state.firstSuccessAt!));
    state.postTrainingOccurrences = laterInterviews.length;
    if (laterInterviews.length && stageRank(state.stage) > stageRank("retrievable")) {
      state.stage = "retrievable";
      state.nextDueAt = new Date().toISOString();
    }
  }
  return [...progress.values()];
}

function historyOf(batch: LanguageBatch): LanguageBatchHistory {
  const graded = batch.actions.filter((action) => action.phase !== "scan" && typeof action.passed === "boolean");
  return {
    id: batch.id,
    date: batch.date,
    targetSize: batch.targetSize,
    completedCount: new Set(batch.actions.map((action) => action.itemId)).size,
    successCount: graded.filter((action) => action.passed).length,
    completedAt: batch.completedAt,
  };
}

export async function loadLanguageV2State(notes?: ObsidianNote[]): Promise<LanguageV2State> {
  const allNotes = notes ?? await (await import("./obsidian")).readAllNotes();
  const curriculum = latestCurriculum(allNotes);
  const batches = allBatches(allNotes);
  if (!curriculum) return { ready: false, stale: false, progress: [], history: batches.map(historyOf).reverse() };
  const legacy = await (await import("./language-store")).loadLanguageState(allNotes);
  const legacyTargets = new Set(
    legacy.units
      .filter((value) => value.trainingStatus === "trained" || value.masteryStatus === "mastered")
      .map((value) => normalizeAnswer(value.targetJa)),
  );
  const progress = deriveLanguageProgress(curriculum, batches, legacyTargets);
  return {
    ready: true,
    stale: curriculum.sourceFingerprint !== languageV2SourceFingerprint(allNotes),
    curriculum,
    progress,
    currentBatch: [...batches].reverse().find((batch) => batch.phase !== "completed"),
    history: [...batches].reverse().map(historyOf),
  };
}

function scaledQuotas(size: 100 | 150 | 200) {
  const scale = size / 200;
  const result = Object.fromEntries(
    Object.entries(ITEM_QUOTAS).map(([key, value]) => [key, Math.floor(value * scale)]),
  ) as Record<LanguageLearningItemKind, number>;
  let missing = size - Object.values(result).reduce((sum, value) => sum + value, 0);
  for (const kind of Object.keys(ITEM_QUOTAS) as LanguageLearningItemKind[]) {
    if (!missing) break;
    result[kind] += 1;
    missing -= 1;
  }
  return result;
}

function progressScore(value: LanguageLearningItem, progress: LanguageItemProgress | undefined, now: string) {
  const due = progress?.nextDueAt && progress.nextDueAt <= now ? 40 : 0;
  const failed = Math.min(30, (progress?.failureCount ?? 0) * 5);
  const stagePenalty = progress ? stageRank(progress.stage) * 8 : 0;
  return value.basePriority + due + failed - stagePenalty;
}

export function selectLanguageBatchItems(
  curriculum: LanguageCurriculum,
  progressValues: LanguageItemProgress[],
  size: 100 | 150 | 200,
  now = new Date().toISOString(),
) {
  const progress = new Map(progressValues.map((value) => [value.itemId, value]));
  const selected: LanguageLearningItem[] = [];
  const selectedIds = new Set<string>();
  const quotas = scaledQuotas(size);
  for (const kind of Object.keys(quotas) as LanguageLearningItemKind[]) {
    const candidates = curriculum.items
      .filter((value) => value.kind === kind && !progress.get(value.id)?.rejected)
      .sort((left, right) => progressScore(right, progress.get(right.id), now) - progressScore(left, progress.get(left.id), now));
    const reviewTarget = Math.floor(quotas[kind] * 0.6);
    const review = candidates.filter((value) => {
      const state = progress.get(value.id);
      return state && state.stage !== "unseen" && (!state.nextDueAt || state.nextDueAt <= now || state.failureCount > 0);
    }).slice(0, reviewTarget);
    const fresh = candidates.filter((value) => (progress.get(value.id)?.stage ?? "unseen") === "unseen")
      .slice(0, quotas[kind] - review.length);
    for (const value of [...review, ...fresh, ...candidates]) {
      if (selected.filter((candidate) => candidate.kind === kind).length >= quotas[kind]) break;
      if (selectedIds.has(value.id)) continue;
      selected.push(value);
      selectedIds.add(value.id);
    }
  }
  if (selected.length < size) {
    const rest = curriculum.items
      .filter((value) => !selectedIds.has(value.id) && !progress.get(value.id)?.rejected)
      .sort((left, right) => progressScore(right, progress.get(right.id), now) - progressScore(left, progress.get(left.id), now));
    for (const value of rest.slice(0, size - selected.length)) selected.push(value);
  }
  return selected.slice(0, size);
}

function languageSigningSecrets() {
  return [...new Set([
    process.env.LANGUAGE_BATCH_SIGNING_KEY,
    process.env.OBSIDIAN_API_KEY,
    process.env.CODEX_BRIDGE_TOKEN,
  ].filter((value): value is string => Boolean(value)))];
}

async function hmacWithSecret(value: object, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(JSON.stringify(value))));
  return btoa(String.fromCharCode(...bytes));
}

async function hmac(value: object) {
  const secret = languageSigningSecrets()[0];
  if (!secret) throw new Error("训练签名密钥未配置，请通过 npm run dev 启动。");
  return hmacWithSecret(value, secret);
}

function batchSignaturePayload(batch: Omit<LanguageBatch, "signature"> | LanguageBatch) {
  return {
    id: batch.id,
    date: batch.date,
    curriculumFingerprint: batch.curriculumFingerprint,
    targetSize: batch.targetSize,
    scanItemIds: batch.scanItemIds,
  };
}

export async function createLanguageBatch(state: LanguageV2State, size: 100 | 150 | 200) {
  if (!state.curriculum) throw new Error("请先建立面试证据训练课程。");
  if (state.currentBatch) return state.currentBatch;
  const now = new Date().toISOString();
  const batchWithoutSignature: Omit<LanguageBatch, "signature"> = {
    id: crypto.randomUUID(),
    date: tokyoParts().date,
    createdAt: now,
    updatedAt: now,
    curriculumFingerprint: state.curriculum.contentFingerprint ?? state.curriculum.sourceFingerprint,
    targetSize: size,
    phase: "scan",
    cursor: 0,
    scanItemIds: selectLanguageBatchItems(state.curriculum, state.progress, size).map((value) => value.id),
    compileItemIds: [],
    stressItemIds: [],
    actions: [],
  };
  return { ...batchWithoutSignature, signature: await hmac(batchSignaturePayload(batchWithoutSignature)) };
}

export async function verifyLanguageBatch(batch: LanguageBatch) {
  const payload = batchSignaturePayload(batch);
  for (const secret of languageSigningSecrets()) {
    if (batch.signature === await hmacWithSecret(payload, secret)) return true;
  }
  return false;
}

export async function refreshLanguageBatchSignature(
  batch: LanguageBatch,
  curriculum: LanguageCurriculum,
) {
  const curriculumFingerprint = curriculum.contentFingerprint ?? curriculum.sourceFingerprint;
  const curriculumIds = new Set(curriculum.items.map((value) => value.id));
  const uniqueScanIds = new Set(batch.scanItemIds);
  const structurallyValid =
    [100, 150, 200].includes(batch.targetSize) &&
    batch.curriculumFingerprint === curriculumFingerprint &&
    batch.scanItemIds.length === batch.targetSize &&
    uniqueScanIds.size === batch.scanItemIds.length &&
    batch.scanItemIds.every((id) => curriculumIds.has(id)) &&
    batch.compileItemIds.every((id) => uniqueScanIds.has(id)) &&
    batch.stressItemIds.every((id) => uniqueScanIds.has(id)) &&
    batch.actions.every((action) =>
      action.phase === "scan"
        ? uniqueScanIds.has(action.itemId)
        : action.phase === "compile"
          ? batch.compileItemIds.includes(action.itemId)
          : batch.stressItemIds.includes(action.itemId)
    );
  if (!structurallyValid) throw new Error("训练批次结构与课程不一致，已停止写入以保护现有记录。");
  return { ...batch, signature: await hmac(batchSignaturePayload(batch)) };
}

export async function migrateScanningBatchToCurriculum(
  batch: LanguageBatch,
  curriculum: LanguageCurriculum,
  progress: LanguageItemProgress[],
  previousCurriculum?: LanguageCurriculum,
) {
  if (batch.phase !== "scan") return batch;
  const newIds = new Set(curriculum.items.map((value) => value.id));
  const selected = selectLanguageBatchItems(curriculum, progress, batch.targetSize);
  const used = new Set<string>();
  const kept = batch.scanItemIds.map((id) => {
    if (!newIds.has(id) || used.has(id)) return "";
    used.add(id);
    return id;
  });
  let replacementIndex = 0;
  const scanItemIds = kept.map((id) => {
    if (id) return id;
    while (replacementIndex < selected.length && used.has(selected[replacementIndex].id)) replacementIndex += 1;
    const replacement = selected[replacementIndex]?.id;
    if (!replacement) return "";
    replacementIndex += 1;
    used.add(replacement);
    return replacement;
  }).filter(Boolean);
  for (const value of selected) {
    if (scanItemIds.length >= batch.targetSize) break;
    if (used.has(value.id)) continue;
    scanItemIds.push(value.id);
    used.add(value.id);
  }
  const keptIds = new Set(scanItemIds);
  const previousById = new Map(previousCurriculum?.items.map((value) => [value.id, value]) ?? []);
  const currentById = new Map(curriculum.items.map((value) => [value.id, value]));
  const changedIds = new Set(scanItemIds.filter((id) => {
    const previous = previousById.get(id);
    const current = currentById.get(id);
    return Boolean(previous && current && (
      previous.targetJa !== current.targetJa ||
      previous.meaningZh !== current.meaningZh ||
      previous.promptZh !== current.promptZh
    ));
  }));
  const actions = batch.actions.filter((action) =>
    action.phase === "scan" &&
    Boolean(action.judgment) &&
    batch.scanItemIds.includes(action.itemId) &&
    keptIds.has(action.itemId) &&
    !changedIds.has(action.itemId)
  );
  const judged = new Set(actions
    .filter((action) => action.phase === "scan" && action.judgment)
    .map((action) => action.itemId));
  const cursor = Math.max(0, scanItemIds.findIndex((id) => !judged.has(id)));
  const nextWithoutSignature: Omit<LanguageBatch, "signature"> = {
    ...batch,
    curriculumFingerprint: curriculum.contentFingerprint ?? curriculum.sourceFingerprint,
    scanItemIds,
    compileItemIds: [],
    stressItemIds: [],
    actions,
    cursor,
    updatedAt: new Date().toISOString(),
  };
  return { ...nextWithoutSignature, signature: await hmac(batchSignaturePayload(nextWithoutSignature)) };
}

function acceptedAnswers(value: LanguageLearningItem) {
  return [value.targetJa, value.correctedJa]
    .flatMap((answer) => answer.split(/[／/]/u))
    .map((answer) => normalizeAnswer(answer.replace(/（.*$/, "")))
    .filter(Boolean);
}

export function gradeLanguageItem(value: LanguageLearningItem, answer: string) {
  const normalized = normalizeAnswer(answer);
  if (!normalized) return false;
  return acceptedAnswers(value).some((accepted) => accepted === normalized);
}

export function mergeLanguageBatchCheckpoint(
  batch: LanguageBatch,
  curriculum: LanguageCurriculum,
  incoming: LanguageBatchAction[],
  nextPhase?: LanguageBatchPhase,
  cursor = batch.cursor,
) {
  const itemById = new Map(curriculum.items.map((value) => [value.id, value]));
  const actions = new Map(batch.actions.map((value) => [value.actionId, value]));
  for (const source of incoming.slice(0, 250)) {
    if (!itemById.has(source.itemId)) continue;
    const previous = actions.get(source.actionId);
    if (previous && previous.at >= source.at) continue;
    const allowed = source.phase === "scan"
      ? batch.scanItemIds.includes(source.itemId)
      : source.phase === "compile"
        ? batch.compileItemIds.includes(source.itemId)
        : batch.stressItemIds.includes(source.itemId);
    if (!allowed) continue;
    const value: LanguageBatchAction = {
      actionId: source.actionId,
      itemId: source.itemId,
      phase: source.phase,
      at: source.at || new Date().toISOString(),
      judgment: source.phase === "scan" ? source.judgment : undefined,
      answer: source.phase === "scan" ? undefined : text(source.answer),
      passed: source.phase === "scan" ? undefined : gradeLanguageItem(itemById.get(source.itemId)!, text(source.answer)),
    };
    actions.set(value.actionId, value);
  }
  const merged = [...actions.values()].sort((left, right) => left.at.localeCompare(right.at));
  let phase = nextPhase ?? batch.phase;
  let compileItemIds = batch.compileItemIds;
  let stressItemIds = batch.stressItemIds;
  if (phase === "compile") {
    if (!compileItemIds.length) {
      const latestJudgment = new Map<string, LanguageScanJudgment>();
      for (const action of merged) if (action.phase === "scan" && action.judgment) latestJudgment.set(action.itemId, action.judgment);
      compileItemIds = batch.scanItemIds
        .filter((id) => ["uncertain", "unknown"].includes(latestJudgment.get(id) ?? ""))
        .sort((left, right) => (itemById.get(right)?.basePriority ?? 0) - (itemById.get(left)?.basePriority ?? 0));
    }
    // 已经作答的旧批次项目不丢；尚未开始输入的 60 项旧批次会直接收紧为 20 项。
    const answered = merged
      .filter((action) => action.phase === "compile" && action.answer?.trim())
      .map((action) => action.itemId);
    compileItemIds = [...new Set([...answered, ...compileItemIds])]
      .slice(0, Math.max(LANGUAGE_COMPILE_LIMIT, new Set(answered).size));
  }
  if (phase === "stress") {
    if (!stressItemIds.length) {
      const knownIds = batch.scanItemIds.filter((id) => merged.some((action) =>
        action.itemId === id && action.phase === "scan" && action.judgment === "known"
      ));
      const candidates = [...compileItemIds, ...knownIds]
        .filter((id, index, all) => all.indexOf(id) === index)
        .sort((left, right) => (itemById.get(right)?.basePriority ?? 0) - (itemById.get(left)?.basePriority ?? 0));
      let openCount = 0;
      stressItemIds = candidates.filter((id) => {
        if (itemById.get(id)?.kind !== "answer_strategy") return true;
        openCount += 1;
        return openCount <= LANGUAGE_OPEN_STRESS_LIMIT;
      });
    }
    const answered = merged
      .filter((action) => action.phase === "stress" && action.answer?.trim())
      .map((action) => action.itemId);
    stressItemIds = [...new Set([...answered, ...stressItemIds])]
      .slice(0, Math.max(LANGUAGE_STRESS_LIMIT, new Set(answered).size));
  }
  if (phase === "completed") phase = "completed";
  const now = new Date().toISOString();
  return {
    ...batch,
    actions: merged,
    compileItemIds,
    stressItemIds,
    phase,
    cursor: Math.max(0, cursor),
    updatedAt: now,
    completedAt: phase === "completed" ? now : batch.completedAt,
  };
}

export function batchVaultPath(batch: LanguageBatch) {
  return `30_日本語学習/集中訓練ログ/${batch.date}_${batch.id}.md`;
}
