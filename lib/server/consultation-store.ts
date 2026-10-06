import { CONSULTATION_PATH, CONSULTATION_RECORD_PATH, emptyDraft, parseConsultation, parseConsultationHistory, privacyText, projectConsultation, renderConsultationHistory, validateDraft, type ConsultationDraft, type SourceContent } from "../consultation.ts";
import { createKeyedSerialQueue } from "./serial-queue.ts";
import { RequestRejectedError } from "./write-guards.ts";

type NoteContent = { content: string };
type ConsultationIO = { readNote: (path: string) => Promise<NoteContent>; readNoteOrNull: (path: string) => Promise<NoteContent | null>; writeNote: (path: string, content: string) => Promise<unknown> };
export async function consultationHash(content: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, "0")).join("");
}
const queue = createKeyedSerialQueue();
export function createConsultationStore(io: ConsultationIO) {
  async function material() {
    const note = await io.readNote(CONSULTATION_PATH);
    return { data: parseConsultation(note.content), revision: await consultationHash(note.content) };
  }
  async function get(names = false) {
    const { data, revision } = await material();
    const pairs = await Promise.all(data.sources.map(async source => {
      const [raw, study, annotations] = await Promise.all([source.rawPath, source.studyPath, source.annotationPath].map(path => io.readNote(path)));
      const hashes = await Promise.all([raw, study, annotations].map(n => consultationHash(n.content)));
      // 原稿移动行号后，旧遮蔽区间可能遮错位置。版本变化必须停在服务端，不能照旧投影。
      const changed = hashes.some((h, i) => h !== [source.rawHash, source.studyHash, source.annotationHash][i]);
      if (changed) throw new RequestRejectedError("出典が更新されています。引用範囲と非表示箇所を再確認してから開いてください。", 409);
      return [source.id, { raw: raw.content, study: study.content, annotations: annotations.content, changed }] as const;
    }));
    const note = await io.readNoteOrNull(CONSULTATION_RECORD_PATH);
    const history = parseConsultationHistory(note?.content ?? null);
    if (history && history.materialId !== data.id) throw new RequestRejectedError("別の相談のメモが残っています。資料と保存先を確認してください。", 409);
    const last = history?.entries.at(-1);
    const storedDraft = last ? validateDraft(last.draft, data.cases.map(c => c.id)) : emptyDraft(data.cases);
    // 已保存的摘要也经过同一投影，不能在原稿匿名后从反馈区再次带出联系人。
    const draft = JSON.parse(JSON.stringify(storedDraft, (_key, value) => typeof value === "string" ? privacyText(value, data, names) : value)) as ConsultationDraft;
    return { material: projectConsultation(data, Object.fromEntries(pairs) as Record<string, SourceContent>, names), materialRevision: revision,
      draft, revision: await consultationHash(note?.content ?? ""), savedAt: last?.savedAt ?? null, historyCount: history?.entries.length ?? 0 };
  }
  async function save(input: { draft: ConsultationDraft; revision: string; materialRevision: string }) {
    return queue(CONSULTATION_RECORD_PATH, async () => {
      const current = await get();
      if (input.materialRevision !== current.materialRevision) throw new RequestRejectedError("相談資料が更新されています。メモを保ったまま資料を再確認してください。", 409);
      const draft = validateDraft(input.draft, current.material.cases.map(c => c.id));
      const existing = await io.readNoteOrNull(CONSULTATION_RECORD_PATH);
      const actualRevision = await consultationHash(existing?.content ?? "");
      if (input.revision !== actualRevision) throw new RequestRejectedError("別の画面でメモが更新されました。入力は残っています。内容を退避して再読み込みしてください。", 409);
      const history = parseConsultationHistory(existing?.content ?? null) ?? { materialId: current.material.id, entries: [] };
      if (JSON.stringify(history.entries.at(-1)?.draft) === JSON.stringify(draft)) return { revision: actualRevision, savedAt: history.entries.at(-1)!.savedAt, historyCount: history.entries.length };
      const savedAt = new Date().toISOString();
      history.entries.push({ savedAt, draft, materialRevision: current.materialRevision });
      const next = renderConsultationHistory(history);
      await io.writeNote(CONSULTATION_RECORD_PATH, next);
      const readBack = await io.readNote(CONSULTATION_RECORD_PATH);
      if (readBack.content !== next) throw new RequestRejectedError("保存後の確認ができませんでした。入力は残っています。再読み込み前に内容を退避してください。", 502);
      return { revision: await consultationHash(next), savedAt, historyCount: history.entries.length };
    });
  }
  return { get, save };
}
