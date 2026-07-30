import {
  CHANNEL_REQUIRED_FROM,
  DEFAULT_JOB_STATUS,
  JOB_STATUSES as RAW_JOB_STATUSES,
  JOB_STATUS_NOTE_MAX,
  KNOWN_CHANNELS,
  composeJobStatus as rawComposeJobStatus,
  isJobStatus as rawIsJobStatus,
  jobStatusNote as rawJobStatusNote,
  jobStatusNoteError as rawJobStatusNoteError,
  normalizeJobStatus as rawNormalizeJobStatus,
  statusRequiresChannel,
} from "./job-status.mjs";

export {
  CHANNEL_REQUIRED_FROM,
  DEFAULT_JOB_STATUS,
  JOB_STATUS_NOTE_MAX,
  KNOWN_CHANNELS,
  statusRequiresChannel,
};

export function jobStatusNote(value: string): string {
  return rawJobStatusNote(value) as string;
}

export function jobStatusNoteError(note: string): string | null {
  return rawJobStatusNoteError(note) as string | null;
}

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

export function composeJobStatus(status: JobStatus, note: string): string {
  return rawComposeJobStatus(status, note) as string;
}
