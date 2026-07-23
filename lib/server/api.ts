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

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new Error("请求 JSON 格式无效。");
  }
}
