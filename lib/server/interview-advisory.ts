import { createAdvisoryEngine } from "./advisory-engine.ts";
import { readAllNotes, readNoteOrNull, writeNote } from "./obsidian.ts";
import { invokeCodex } from "./codex-bridge.ts";

export const interviewAdvisory = createAdvisoryEngine({
  readAll: () => readAllNotes(),
  read: readNoteOrNull,
  write: writeNote,
  invoke: (task, payload) => invokeCodex<Record<string, unknown>>(task, payload),
});
