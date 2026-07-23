// 整理稿（transcript-study）と批注（study-annotation）のパーサ。
// 形式の正本は vault 側 99_系统/_整理稿スペック.md。ここは読むだけで、書式の規範を持たない。
// 行ベースで壊れにくくする：解釈できない行は黙って捨てず notes に残す方針は取らない
// （整理稿は AI 生成で形式が安定しているため、未知行はスキップで足りる）。

export type ReviewSpeaker = "面" | "私";

export type ReviewErrorKind = "学習者" | "転写" | "疑";

export type ReviewError = {
  /** 誤1 → 1。誤:: のみは 0 */
  index: number;
  /** «...» で正にマークされた元スパン（無い誤りもある） */
  span?: string;
  /** → の後の訂正候補 */
  correction?: string;
  kind: ReviewErrorKind;
  /** 型:: スラッグ（い形だと・助詞 など） */
  pattern?: string;
  /** ｜区切りの原文全体（表示用フォールバック） */
  raw: string;
};

export type ReviewSentence = {
  id: string;
  speaker: ReviewSpeaker;
  /** 面? / 私? → 裁定待ち */
  uncertainSpeaker: boolean;
  /** 正:: 整理済みテキスト（«»マーク込み） */
  sei: string;
  /** 原:: 転写原文。省略時は sei と同一とみなす */
  gen?: string;
  /** 訳:: 中国語訳 */
  yaku?: string;
  /** 語:: 聴解・語彙注（複数行可） */
  go: string[];
  /** 注:: その他注記 */
  notes: string[];
  errors: ReviewError[];
};

export type ReviewBlock = {
  /** q06 など */
  id: string;
  title: string;
  /** 概:: 一行要約 */
  summary?: string;
  sentences: ReviewSentence[];
};

export type ParsedSeirikou = {
  blocks: ReviewBlock[];
  sentences: ReviewSentence[];
};

export type AnnotationKind = "批注" | "裁定" | "聴解";
export type AnnotationStatus = "open" | "answered" | "applied";

export type ReviewAnnotation = {
  id: string;
  sentenceId: string;
  kind: AnnotationKind;
  status: AnnotationStatus;
  date: string;
  /** 裁定対象。error:1 / speaker。旧エントリは本文から推定する。 */
  target?: string;
  mine: string;
  ai?: string;
};

export type ReviewDecisionTask = {
  id: string;
  sentenceId: string;
  target: string;
  label: string;
  resolvedBy?: string;
  resolution?: "transcript" | "learner" | "speaker-interviewer" | "speaker-self" | "unknown";
};

const SENTENCE_HEAD = /^-\s+\*\*(s\d+[a-z]?)｜(面\??|私\??)\*\*\s*$/;
const FIELD_LINE = /^\s+-\s+(正|原|訳|語|注|評|改|台本|誤\d*)::\s?(.*)$/;
const BLOCK_HEAD = /^##\s+(q\d+)\s*(.*)$/;
const BLOCK_SUMMARY = /^-\s+概::\s?(.*)$/;

function parseErrorLine(index: number, raw: string): ReviewError {
  const segments = raw.split("｜").map((part) => part.trim()).filter(Boolean);
  const head = segments[0] ?? "";

  let kind: ReviewErrorKind = "疑";
  for (const segment of segments.slice(1)) {
    if (segment.startsWith("学習者")) kind = "学習者";
    else if (segment.startsWith("転写")) kind = "転写";
    else if (segment.startsWith("疑")) kind = "疑";
  }

  const pattern = raw.match(/型::\s*([^｜]+)/)?.[1]?.trim();
  const span = head.match(/«([^»]+)»/)?.[1];
  const correction = head
    .match(/→\s*([^｜]+)$/)?.[1]
    ?.trim();

  return { index, span, correction, kind, pattern, raw };
}

/** 整理稿本文（frontmatter 除去前でも可）→ ブロック構造 */
export function parseSeirikou(content: string): ParsedSeirikou {
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, "");
  const blocks: ReviewBlock[] = [];
  let block: ReviewBlock | null = null;
  let sentence: ReviewSentence | null = null;

  for (const line of body.split("\n")) {
    const blockMatch = line.match(BLOCK_HEAD);
    if (blockMatch) {
      block = { id: blockMatch[1], title: blockMatch[2].trim(), sentences: [] };
      blocks.push(block);
      sentence = null;
      continue;
    }
    if (!block) continue;

    const summaryMatch = line.match(BLOCK_SUMMARY);
    if (summaryMatch) {
      block.summary = summaryMatch[1];
      continue;
    }

    const headMatch = line.match(SENTENCE_HEAD);
    if (headMatch) {
      const speakerRaw = headMatch[2];
      sentence = {
        id: headMatch[1],
        speaker: speakerRaw.startsWith("面") ? "面" : "私",
        uncertainSpeaker: speakerRaw.endsWith("?"),
        sei: "",
        go: [],
        notes: [],
        errors: [],
      };
      block.sentences.push(sentence);
      continue;
    }
    if (!sentence) continue;

    const fieldMatch = line.match(FIELD_LINE);
    if (!fieldMatch) continue;
    const [, key, value] = fieldMatch;
    if (key === "正") sentence.sei = value;
    else if (key === "原") sentence.gen = value;
    else if (key === "訳") sentence.yaku = value;
    else if (key === "語") sentence.go.push(value);
    else if (key === "注") sentence.notes.push(value);
    else if (key.startsWith("誤")) {
      sentence.errors.push(parseErrorLine(Number(key.slice(1) || "0"), value));
    }
    // 評/改/台本（二層）は現段階で文単位に出ないため読み飛ばす
  }

  return { blocks, sentences: blocks.flatMap((item) => item.sentences) };
}

/** 正:: の «» を分割して描画用セグメントにする。マーク n 番目 ↔ span持ち誤り n 番目で対応付け */
export type SeiSegment = { text: string; error?: ReviewError };

export function segmentSei(sentence: ReviewSentence): SeiSegment[] {
  const spanErrors = sentence.errors.filter((error) => error.span);
  const segments: SeiSegment[] = [];
  const pattern = /«([^»]+)»/g;
  let cursor = 0;
  let markIndex = 0;
  for (;;) {
    const match = pattern.exec(sentence.sei);
    if (!match) break;
    if (match.index > cursor) {
      segments.push({ text: sentence.sei.slice(cursor, match.index) });
    }
    segments.push({
      text: match[1],
      error: spanErrors[markIndex] ?? spanErrors.find((error) => error.span === match[1]),
    });
    markIndex += 1;
    cursor = match.index + match[0].length;
  }
  if (cursor < sentence.sei.length) {
    segments.push({ text: sentence.sei.slice(cursor) });
  }
  return segments.length ? segments : [{ text: sentence.sei }];
}

/** «» を外した素のテキスト（コピー・検索用） */
export function plainSei(sentence: ReviewSentence): string {
  return sentence.sei.replace(/«([^»]+)»/g, "$1");
}

const ANNOTATION_HEAD =
  /^-\s+\*\*(a\d+)｜(s\d+[a-z]?)｜(批注|裁定|聴解)｜(open|answered|applied)｜(\d{4}-\d{2}-\d{2})\*\*\s*$/;
const ANNOTATION_FIELD = /^\s+-\s+(我|AI|対象)::\s?(.*)$/;

/** 批注ノート本文 → エントリ一覧（引用ブロック内の書き方例は拾わない） */
export function parseAnnotations(content: string): ReviewAnnotation[] {
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, "");
  const entries: ReviewAnnotation[] = [];
  let entry: ReviewAnnotation | null = null;
  for (const line of body.split("\n")) {
    if (line.startsWith(">")) continue;
    const head = line.match(ANNOTATION_HEAD);
    if (head) {
      entry = {
        id: head[1],
        sentenceId: head[2],
        kind: head[3] as AnnotationKind,
        status: head[4] as AnnotationStatus,
        date: head[5],
        mine: "",
      };
      entries.push(entry);
      continue;
    }
    if (!entry) continue;
    const field = line.match(ANNOTATION_FIELD);
    if (!field) continue;
    if (field[1] === "我") entry.mine = field[2];
    else if (field[1] === "AI") entry.ai = field[2];
    else entry.target = field[2];
  }
  return entries;
}

/** 連打事故で同じ追記が複数できても、読み側では一つの事実として扱う。 */
export function uniqueAnnotations(annotations: ReviewAnnotation[]): ReviewAnnotation[] {
  const seen = new Set<string>();
  return annotations.filter((annotation) => {
    const key = [
      annotation.sentenceId,
      annotation.kind,
      annotation.status,
      annotation.target ?? "",
      annotation.mine,
      annotation.ai ?? "",
    ].join("\u0000");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 整理稿の「疑」と話者疑を、人が一つずつ裁定できる作業単位へ変換する。
 * 新規エントリは対象を構造化して持ち、旧エントリは文面と一文内の候補数から安全に推定する。
 */
export function reviewDecisionTasks(
  sentences: ReviewSentence[],
  annotations: ReviewAnnotation[],
): ReviewDecisionTask[] {
  const tasks: ReviewDecisionTask[] = [];
  for (const sentence of sentences) {
    if (sentence.uncertainSpeaker) {
      tasks.push({
        id: `${sentence.id}:speaker`,
        sentenceId: sentence.id,
        target: "speaker",
        label: "话者待确认",
      });
    }
    for (const error of sentence.errors) {
      if (error.kind !== "疑") continue;
      tasks.push({
        id: `${sentence.id}:error:${error.index}`,
        sentenceId: sentence.id,
        target: `error:${error.index}`,
        label: error.span ? `«${error.span}»` : `誤${error.index}`,
      });
    }
  }

  const decisions = uniqueAnnotations(annotations).filter((item) => item.kind === "裁定");
  for (const task of tasks) {
    const sentenceTasks = tasks.filter((candidate) => candidate.sentenceId === task.sentenceId);
    const sentence = sentences.find((candidate) => candidate.id === task.sentenceId);
    const error = sentence?.errors.find(
      (candidate) => task.target === `error:${candidate.index}`,
    );
    const decision = decisions.find((annotation) => {
      if (annotation.sentenceId !== task.sentenceId) return false;
      if (annotation.target) return annotation.target === task.target;
      if (task.target === "speaker") return annotation.mine.startsWith("話者裁定：");
      if (annotation.mine.startsWith("話者裁定：")) return false;
      if (annotation.mine.includes(`誤${error?.index ?? ""}`)) return true;
      if (error?.span && annotation.mine.includes(`«${error.span}»`)) return true;
      return sentenceTasks.length === 1;
    });
    if (decision) {
      task.resolvedBy = decision.id;
      task.resolution = decision.mine.includes("転写誤りで確定")
        ? "transcript"
        : decision.mine.includes("学習者誤りで確定")
          ? "learner"
          : decision.mine.includes("面接官の発言")
            ? "speaker-interviewer"
            : decision.mine.includes("自分の発言")
              ? "speaker-self"
              : "unknown";
    }
  }
  return tasks;
}

/** 聴解マーク（△/×）の文ごとの最新値。エントリは追記のみなので後勝ち */
export function latestListeningMarks(annotations: ReviewAnnotation[]): Map<string, "×" | "△"> {
  const marks = new Map<string, "×" | "△">();
  for (const annotation of annotations) {
    if (annotation.kind !== "聴解") continue;
    if (annotation.mine.startsWith("×")) marks.set(annotation.sentenceId, "×");
    else if (annotation.mine.startsWith("△")) marks.set(annotation.sentenceId, "△");
  }
  return marks;
}

/** 型:: の補足（）を落とした集計キー。「感じします（既載）」→「感じします」 */
export function patternSlug(pattern: string): string {
  return pattern.replace(/（.*$/, "").trim();
}

export type ReviewStats = {
  sentenceTotal: number;
  bySpeaker: Record<ReviewSpeaker, number>;
  learnerErrors: number;
  uncertainErrors: number;
  uncertainSpeakers: number;
  goCount: number;
  /** 型スラッグ → { learner, uncertain } */
  patterns: Map<string, { learner: number; uncertain: number }>;
};

export function computeStats(sentences: ReviewSentence[]): ReviewStats {
  const stats: ReviewStats = {
    sentenceTotal: sentences.length,
    bySpeaker: { 面: 0, 私: 0 },
    learnerErrors: 0,
    uncertainErrors: 0,
    uncertainSpeakers: 0,
    goCount: 0,
    patterns: new Map(),
  };
  for (const sentence of sentences) {
    stats.bySpeaker[sentence.speaker] += 1;
    if (sentence.uncertainSpeaker) stats.uncertainSpeakers += 1;
    stats.goCount += sentence.go.length;
    for (const error of sentence.errors) {
      if (error.kind === "学習者") stats.learnerErrors += 1;
      if (error.kind === "疑") stats.uncertainErrors += 1;
      if (error.pattern && error.kind !== "転写") {
        const slug = patternSlug(error.pattern);
        const bucket = stats.patterns.get(slug) ?? { learner: 0, uncertain: 0 };
        if (error.kind === "学習者") bucket.learner += 1;
        else bucket.uncertain += 1;
        stats.patterns.set(slug, bucket);
      }
    }
  }
  return stats;
}
