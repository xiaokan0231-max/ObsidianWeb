import { errorResponse, readJson } from "@/lib/server/api";
import {
  batchVaultPath,
  createLanguageBatch,
  loadLanguageV2State,
  renderLanguageBatch,
} from "@/lib/server/language-v2";
import { writeNote } from "@/lib/server/obsidian";

export async function POST(request: Request) {
  try {
    const body = await readJson<{ size?: unknown }>(request);
    if (![100, 150, 200].includes(Number(body.size))) throw new Error("训练规模只能是100、150或200。");
    const state = await loadLanguageV2State();
    const batch = await createLanguageBatch(state, Number(body.size) as 100 | 150 | 200);
    await writeNote(batchVaultPath(batch), renderLanguageBatch(batch));
    return Response.json({ ok: true, batch, state: await loadLanguageV2State() });
  } catch (error) {
    return errorResponse(error, "开始集中训练失败");
  }
}
