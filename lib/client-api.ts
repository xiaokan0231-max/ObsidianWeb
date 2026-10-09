/**
 * 页面写回 API 的唯一入口。
 *
 * 以前 6 处各自 fetch，成功判定各不相同（有的只看 response.ok，有的还看 payload.ok），
 * 409 冲突有的刷新有的报错，也没有超时——服务端一旦黙り込む，按钮就永远转圈。
 * 这里统一：JSON 进出、response.ok 与 payload.ok 都要真、409 抛 ConflictError、默认 15 秒超时。
 */
export class ClientApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ClientApiError";
    this.status = status;
  }
}

export class ConflictError extends ClientApiError {
  constructor(message: string) {
    super(message, 409);
    this.name = "ConflictError";
  }
}

export async function postJson<T extends { ok?: boolean; error?: string }>(
  path: string,
  body: unknown,
  options: { timeoutMs?: number; fetcher?: typeof fetch } = {},
): Promise<T> {
  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
    cache: "no-store",
    signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
  });
  let payload: T;
  try {
    payload = (await response.json()) as T;
  } catch {
    throw new ClientApiError(`服务端返回了无法解析的响应（${response.status}）`, response.status);
  }
  if (response.status === 409) throw new ConflictError(payload.error || "版本不一致，请刷新后重试。");
  if (!response.ok || payload.ok === false) throw new ClientApiError(payload.error || `请求失败（${response.status}）`, response.status);
  return payload;
}
