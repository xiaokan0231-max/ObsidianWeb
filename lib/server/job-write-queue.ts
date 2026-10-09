import { createKeyedSerialQueue } from "./serial-queue.ts";

// 状态、撤销与跟进会全文写回同一案件，必须共用按路径的锁，才能在读版本时看见前一次写入。
export const withJobCaseWrite = createKeyedSerialQueue();
