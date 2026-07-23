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
