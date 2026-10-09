/** 模型输出校验失败不等于本人缺材料；保留技术细节供排查，正文说明谁来修。 */
export function advisoryFailureMessage(message: string): string {
  if (message.startsWith("顾问复盘数据无效：")) {
    return "这次评价未能更新，旧复盘和评分已保留。你可以继续阅读原有内容，稍后重试；无需为这次更新失败补材料。";
  }
  if (message.startsWith("Codex 运行失败")) {
    return "这次评价更新中断，已有复盘和评分已保留。可以稍后重试。";
  }
  return "这次评价未能更新，已有内容仍可阅读。可以稍后重试；具体原因在详情中。";
}

export function advisoryRetryLabel(message: string): string {
  return message ? "重试更新" : "更新评价";
}
