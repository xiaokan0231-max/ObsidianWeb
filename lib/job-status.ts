import {
  CHANNEL_REQUIRED_FROM,
  DEFAULT_JOB_STATUS,
  JOB_STATUSES as RAW_JOB_STATUSES,
  KNOWN_CHANNELS,
  isJobStatus as rawIsJobStatus,
  normalizeJobStatus as rawNormalizeJobStatus,
  statusRequiresChannel,
} from "./job-status.mjs";

export {
  CHANNEL_REQUIRED_FROM,
  DEFAULT_JOB_STATUS,
  KNOWN_CHANNELS,
  statusRequiresChannel,
};

export const JOB_STATUSES = RAW_JOB_STATUSES as unknown as readonly [
  "未応募",
  "応募済",
  "書類通過",
  "面接中",
  "内定",
  "保留",
  "不採用",
];

export type JobStatus = (typeof JOB_STATUSES)[number];

export function isJobStatus(value: string): value is JobStatus {
  return rawIsJobStatus(value);
}

export function normalizeJobStatus(value: string): JobStatus | null {
  return rawNormalizeJobStatus(value) as JobStatus | null;
}
