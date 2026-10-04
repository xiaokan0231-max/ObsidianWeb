import { createKeyedSerialQueue } from "./serial-queue.ts";

// 回答评价与顾问层、练习入队与练习动作分别写同一文件；按路径共用短写锁，避免全文覆盖。
export const withReviewWrite = createKeyedSerialQueue(1000);
