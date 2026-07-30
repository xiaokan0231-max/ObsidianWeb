/**
 * 応募案件の状態契約。Web・検証・集計が同じ値と正規化処理を使うため、
 * TypeScript 側と Node スクリプト側の両方から読める素の ESM に置く。
 */
export const JOB_STATUSES = [
  "未応募",
  "応募済",
  "書類通過",
  "面接中",
  "内定",
  "保留",
  "不採用",
];

export const DEFAULT_JOB_STATUS = "未応募";

export const CHANNEL_REQUIRED_FROM = ["応募済", "書類通過", "面接中", "内定", "不採用"];

export const KNOWN_CHANNELS = [
  "Recruit Agent",
  "Green",
  // Indeed は求人媒体であって企業直投ではない（Green と同じ層）。2026-07-23 追加：
  // 本人が Indeed の求人URLから直接応募した案件が6件あり、既存の値では正しく表現できなかった。
  "Indeed",
  "企業直投/ATS",
  "Daijob",
  "OpenWork",
  "ミドルの転職",
  "日経転職版",
  // ワークポートの転職コンシェルジュ経由（eコンシェルで進捗管理）。2026-07-27 追加：
  // 面談後にワークポートが紹介・企業へ書類提出する応募が10件発生し、既存の値では表現できなかった。
  "ワークポート",
  "その他",
];

export function isJobStatus(value) {
  return JOB_STATUSES.includes(value);
}

/** `不採用（2026-07-21・書類選考）` のような補足だけを許す。 */
export function normalizeJobStatus(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  for (const status of JOB_STATUSES) {
    if (raw === status) return status;
    if (!raw.startsWith(status)) continue;
    const suffix = raw.slice(status.length);
    if (/^(?:\s|[（(【\[・:：—–-])/.test(suffix)) return status;
  }
  return null;
}

export function statusRequiresChannel(value) {
  const status = normalizeJobStatus(value);
  return status !== null && CHANNEL_REQUIRED_FROM.includes(status);
}

/** 括弧の中身だけを取り出す。`不採用（2026-07-21・書類選考）` → `2026-07-21・書類選考`。 */
export function jobStatusNote(value) {
  const raw = String(value ?? "").trim();
  const status = normalizeJobStatus(raw);
  if (!status || raw === status) return "";
  return raw
    .slice(status.length)
    .replace(/^[\s（(【[・:：—–-]+/, "")
    .replace(/[）)】\]]+$/, "")
    .trim();
}

/**
 * 7つの枚举は「今どの段階か」しか表せない。**なぜそこで止まったか**は括弧の中にしか書けず、
 * 台帳も報告もその文字列を引用している（例：募集終了・推薦不可・取扱終了は全部「死んだ」だが
 * 死因が違う）。だから注記は status の飾りではなく、状態と同格の記録である。
 */
export function composeJobStatus(status, note) {
  const body = String(note ?? "").trim();
  return body ? `${status}（${body}）` : status;
}

export const JOB_STATUS_NOTE_MAX = 120;

/**
 * 注記の検査。frontmatter は `status: 値` を**引用符なし**で書く既存表記に合わせているので、
 * YAML 行を壊す文字はここで弾く（引用符で包む方式にすると既存ノートと表記が二種類になる）。
 * 戻り値は人向けの理由文字列、問題なしなら null。
 */
export function jobStatusNoteError(note) {
  const body = String(note ?? "").trim();
  if (!body) return null;
  if (body.length > JOB_STATUS_NOTE_MAX) {
    return `注记最长 ${JOB_STATUS_NOTE_MAX} 字，现在 ${body.length} 字。`;
  }
  if (/[\r\n]/.test(body)) return "注记不能换行。";
  if (/[（）()]/.test(body)) return "注记里不能再套括号，括号本身是状态和注记的分隔符。";
  if (/:\s/.test(body) || /^#/.test(body) || /\s#/.test(body)) {
    return "注记不能包含「: 」或 #，会破坏 frontmatter 的 YAML 行。改用「・」分隔。";
  }
  return null;
}
