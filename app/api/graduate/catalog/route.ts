import { readModelFailure, readModelRuntime } from "../../../read-model-server";
import { emptyGraduateCatalog, GRADUATE_RECORD_KIND, type GraduateCatalog, type GraduateCatalogPage } from "@/lib/graduate";
import { tokyoParts } from "@/lib/dojo/utils";

/** 候选表只读 D1 中的精简投影；学校正文和备考由页面沿用同一 revision 另行读取。 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  try {
    const { model, revision, syncState, sourceUpdatedAt, indexedAt } = await readModelRuntime(params.get("revision"));
    const catalog = await model.readRecord<GraduateCatalog>(revision, GRADUATE_RECORD_KIND, "root");
    const page: GraduateCatalogPage = { ...(catalog ?? emptyGraduateCatalog()), syncState, revision, today: tokyoParts().date, indexed: Boolean(catalog), sourceUpdatedAt, indexedAt };
    return Response.json(page, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return readModelFailure(error); }
}
