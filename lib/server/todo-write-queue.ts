import { createKeyedSerialQueue } from "./serial-queue.ts";

export const withTodoWrite = createKeyedSerialQueue();
