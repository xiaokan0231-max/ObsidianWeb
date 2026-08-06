// 这个文件里有两套**不能合并**的错误映射，合并会静默丢信息。
// errorResponse：跑过一次 Codex/长任务之后失败 —— 超时 504、输入不合规 400、其余 500。
// obsidianErrorResponse：把 Vault 的现状直接回给前端 —— 笔记不存在 404、写不进去 502。
// 合成一个的话，「复盘还没生成」会变成 500，调用方就分不清该重试还是该先去生成它。
// 前端今天只看 response.ok，所以改错了不会有人报错 —— 正因如此才写在这里。
export function errorResponse(error: unknown, fallback = "请求失败") {
  const rawMessage = error instanceof Error ? error.message : fallback;
  const timedOut = /timed out|SIGTERM|SIGKILL|分钟内未完成/i.test(rawMessage);
  const looksLikeInternalOutput =
    rawMessage.length > 1_200 ||
    /"(?:units|questionBank|learningItems|masteryStatus)"\s*:/.test(rawMessage);
  const message = timedOut
    ? "本地 Codex 在规定时间内未完成，任务已安全停止。Vault 没有写入不完整内容，也不会切换到收费 API。请重试一次。"
    : looksLikeInternalOutput
      ? `${fallback}。Codex 返回了无法安全展示的内部输出，请重试。`
      : rawMessage;
  const status = timedOut
    ? 504
    : /不存在|没有|请先|未配置|签名|已更新/.test(message)
      ? 400
      : 500;
  return Response.json({ ok: false, error: message }, { status });
}

// Obsidian 的状态直传给前端的 route 用这条。
// 判定文案「returned 404」的产地是 lib/server/obsidian.ts 的 request()，那边有
// 同名判定 isMissingNoteError —— 这里没有 import 它是刻意的：api.ts 一旦引入 "@/"
// 别名就再也不能被 node --test 直接 import，而这层映射只有单测能守住（源码 grep
// 守不住状态码）。两处必须一起改。
export function obsidianErrorResponse(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  const status = message.includes("returned 404") ? 404 : 502;
  return Response.json({ error: message }, { status });
}

// 入参校验统一从这里回。响应体只有 { error }，不加 ok ——
// 前端读的是 payload.error，形状变了没人会报错，只会变成一句更差的提示。
export function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new Error("请求 JSON 格式无效。");
  }
}
