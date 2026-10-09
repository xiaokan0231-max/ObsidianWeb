/**
 * `/api/vault` 连不上时给用户看的说明。
 *
 * 以前不管什么原因都说「没有拿到访问凭证」，而实际最常见的是 Obsidian 没开或
 * Local REST API 插件没启用——按错误原文分档，用户才知道该去开 Obsidian 还是去查 API key。
 */
export type ConnectionErrorKind = "credentials" | "unreachable" | "other";

export type ConnectionErrorHint = {
  kind: ConnectionErrorKind;
  title: string;
  hint: string;
};

const CREDENTIALS = /\b40[13]\b|unauthori[sz]ed|forbidden|api[ _-]?key/i;
const UNREACHABLE = /ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH|fetch failed|timed? ?out|TimeoutError|aborted|socket hang up/i;

export function describeConnectionError(error: string): ConnectionErrorHint {
  if (CREDENTIALS.test(error)) {
    return {
      kind: "credentials",
      title: "本地服务没有拿到 Obsidian 的访问凭证。",
      hint: "用 npm run dev 启动：它会从 Obsidian 的 Local REST API 插件配置里读取 API key。直接跑 dev:web 拿不到。",
    };
  }
  if (UNREACHABLE.test(error)) {
    return {
      kind: "unreachable",
      title: "连不上 Obsidian 的 Local REST API。",
      hint: "确认 Obsidian 正在运行、Local REST API 插件已启用，然后重新连接。",
    };
  }
  return {
    kind: "other",
    title: "读取记忆库时出错。",
    hint: "原始错误见下方；重试无效时看终端里开发服务器的输出。",
  };
}
