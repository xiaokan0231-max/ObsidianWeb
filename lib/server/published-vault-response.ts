import { normalizeVaultScope } from "../vault-scope.ts";
import type { PublishedVault, PublishedVaultResponse } from "./published-vault.ts";

type AssetFetch = (request: Request) => Promise<Response>;
type Encoding = "br" | "gzip" | "identity";

const CACHE_CONTROL = "public, max-age=0, must-revalidate";

function clientAcceptEncoding(request: Request) {
  // Cloudflare 会重写 Accept-Encoding；协商必须保留访客原本的能力和 q=0。
  const cf = (request as Request & { cf?: { clientAcceptEncoding?: string } }).cf;
  return cf?.clientAcceptEncoding ?? request.headers.get("Accept-Encoding") ?? "";
}

function selectEncoding(request: Request, entry: PublishedVaultResponse): Encoding | null {
  const accepted = new Map<string, number>();
  for (const part of clientAcceptEncoding(request).split(",")) {
    const [name, ...parameters] = part.trim().toLowerCase().split(";");
    if (!name) continue;
    const parameter = parameters.find((value) => value.trim().startsWith("q="));
    const parsed = parameter === undefined ? 1 : Number(parameter.trim().slice(2));
    accepted.set(name, Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0);
  }
  const quality = (encoding: string) => accepted.get(encoding) ?? accepted.get("*") ?? 0;
  const candidates: { encoding: Encoding; quality: number }[] = [];
  if (entry.br && quality("br") > 0) candidates.push({ encoding: "br", quality: quality("br") });
  if (entry.gzip && quality("gzip") > 0) candidates.push({ encoding: "gzip", quality: quality("gzip") });
  candidates.sort((left, right) => right.quality - left.quality);
  const identity = accepted.get("identity") ?? (accepted.get("*") === 0 ? 0 : 1);
  // 未显式排序 identity 时优先节省传输；明确给出的优先级仍须尊重。
  if (identity > 0 && (!candidates.length || (accepted.has("identity") && identity > candidates[0].quality))) return "identity";
  return candidates[0]?.encoding ?? null;
}

function etagMatches(header: string | null, etag: string) {
  const weak = (value: string) => value.replace(/^W\//, "");
  return header?.split(",").some((value) => value.trim() === "*" || weak(value.trim()) === weak(etag)) ?? false;
}

function assetRequest(request: Request, file: string, method = "GET") {
  if (!/^[a-f0-9]{24}\.json(?:\.(?:gz|br))?$/.test(file)) throw new Error("云端内容索引无效");
  return new Request(new URL(`/_published-vault/${file}`, request.url), {
    method,
    // .gz/.br 已是压缩后的原始文件，避免资源绑定再协商一层压缩。
    headers: { "Accept-Encoding": "identity" },
  });
}

export function createPublishedVaultResponseHandler(fetchAsset: AssetFetch) {
  let pending: Promise<PublishedVault> | undefined;
  function snapshot(request: Request) {
    pending ??= (async () => {
      const response = await fetchAsset(new Request(new URL("/_published-vault/manifest.json", request.url), {
        headers: { "Accept-Encoding": "identity" },
      }));
      if (!response.ok) throw new Error("云端内容尚未发布");
      const data = await response.json() as PublishedVault;
      if (data?.schemaVersion !== 2 || !data.publishedAt || !Array.isArray(data.scopes?.all) || !data.chunks) {
        throw new Error("云端内容索引无效");
      }
      return data;
    })().catch((error) => { pending = undefined; throw error; });
    return pending;
  }

  return async (request: Request, published: boolean): Promise<Response | null> => {
    const url = new URL(request.url);
    if (!published || !["/api/vault", "/api/calendar"].includes(url.pathname) || !["GET", "HEAD"].includes(request.method)) return null;
    try {
      const scope = normalizeVaultScope(url.searchParams.get("scope"));
      const manifest = await snapshot(request);
      const entry = url.pathname === "/api/calendar" ? manifest.calendar : manifest.responses?.[scope];
      // 旧发布快照仍交给原 API，避免必须同步升级全部部署。
      if (!entry) return null;
      if (!entry.file || !entry.etag) throw new Error("云端内容索引无效");
      const headers = new Headers({
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": CACHE_CONTROL,
        ETag: entry.etag,
        Vary: "Accept-Encoding",
      });
      if (url.searchParams.get("refresh") !== "1" && etagMatches(request.headers.get("If-None-Match"), entry.etag)) {
        return new Response(null, { status: 304, headers });
      }
      const encoding = selectEncoding(request, entry);
      if (encoding === null) return new Response(null, { status: 406, headers });
      const file = encoding === "br" ? entry.br! : encoding === "gzip" ? entry.gzip! : entry.file;
      const response = await fetchAsset(assetRequest(request, file, request.method));
      if (!response.ok) throw new Error("云端内容尚未发布");
      if (encoding !== "identity") headers.set("Content-Encoding", encoding);
      const length = response.headers.get("Content-Length");
      if (length) headers.set("Content-Length", length);
      // 已压缩的流必须原样发出；自动编码会把同一份 JSON 压缩两次。
      return new Response(request.method === "HEAD" ? null : response.body, { status: 200, headers, encodeBody: "manual" });
    } catch {
      return Response.json({ connected: false, error: "云端内容读取失败，请重试或重新发布" }, {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      });
    }
  };
}
