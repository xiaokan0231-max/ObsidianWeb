/**
 * 写路由共用的三道门。纯函数、不引 "@/"，node:test 能直接加载。
 *
 * 1. 同源：dev server 跑着的时候，浏览器里任何网页都能对 127.0.0.1:3000 发一个「简单请求」
 *    （text/plain 的 POST 不触发预检）去改 vault、触发 Codex 任务。浏览器一定会带 Sec-Fetch-Site
 *    或 Origin，两者都没有的（非浏览器客户端）也拒——这些接口只服务这个页面。
 * 2. Content-Type 必须是 JSON：把 text/plain 伪装挡在外面，也让「忘了带头」的调用立刻报错而不是解析出 undefined。
 * 3. 409：三条带乐观锁的路由各自 new 一个带 status 的 Error，收到这里。
 */
export class RequestRejectedError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "RequestRejectedError";
    this.status = status;
  }
}

type HeaderReader = { get(name: string): string | null };

export function sameOriginVerdict(headers: HeaderReader, requestUrl: string): { ok: boolean; reason: string } {
  const site = headers.get("sec-fetch-site");
  if (site) {
    return site === "same-origin" || site === "none"
      ? { ok: true, reason: `sec-fetch-site=${site}` }
      : { ok: false, reason: `sec-fetch-site=${site}` };
  }
  const origin = headers.get("origin");
  if (origin) {
    let host = "";
    try {
      host = new URL(origin).host;
    } catch {
      return { ok: false, reason: `origin 无法解析：${origin}` };
    }
    const expected = headers.get("host") || new URL(requestUrl).host;
    return host === expected ? { ok: true, reason: `origin=${origin}` } : { ok: false, reason: `origin=${origin} ≠ ${expected}` };
  }
  return { ok: false, reason: "既无 Sec-Fetch-Site 也无 Origin（不是浏览器里的本页面）" };
}

export function assertSameOrigin(request: { headers: HeaderReader; url: string }) {
  const verdict = sameOriginVerdict(request.headers, request.url);
  if (!verdict.ok) throw new RequestRejectedError(`只接受本页面发出的请求（${verdict.reason}）。`, 403);
}

export function assertJsonContentType(headers: HeaderReader) {
  const type = headers.get("content-type") ?? "";
  if (!/^application\/json(\s*;.*)?$/i.test(type.trim())) {
    throw new RequestRejectedError(`请求必须是 application/json（收到：${type || "无 Content-Type"}）。`, 415);
  }
}

/** 乐观锁不一致：调用方拿到的是过期版本，让它刷新后重试。 */
export function conflictError(message = "笔记已被别处修改，版本不一致。请刷新后重试。") {
  return new RequestRejectedError(message, 409);
}

/** 版本比对：期待值缺席（旧客户端／首次）时放行，给了就必须精确相等。 */
export function assertExpectedMtime(expected: number | undefined, actual: number) {
  if (expected !== undefined && expected !== actual) throw conflictError();
}
