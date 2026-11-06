import { readModelRuntime, ReadModelError } from "./read-model-server";
import type { CalendarSnapshot } from "@/lib/calendar-snapshot";

export async function calendarProjection(revision?: string | null) {
  const runtime = await readModelRuntime(revision);
  return {
    revision: runtime.revision,
    async snapshot() {
      const data = await runtime.model.readRecord<CalendarSnapshot>(runtime.revision, "calendar-source", "root");
      if (!data) throw new ReadModelError("日历资料版本不完整");
      return data;
    },
  };
}
