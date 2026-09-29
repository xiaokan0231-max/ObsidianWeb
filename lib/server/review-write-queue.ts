import { createKeyedSerialQueue } from "./serial-queue.ts";

// 回答评价与顾问层写入同一个文件，必须共用短写锁，避免长任务完成时互相覆盖。
export const withReviewWrite = createKeyedSerialQueue(1000);
