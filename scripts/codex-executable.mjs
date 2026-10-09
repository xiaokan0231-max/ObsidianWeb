import { accessSync, constants, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";

const MACOS_CODEX_PATHS = [
  "ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
  "ChatGPT.app/Contents/Resources/codex-cli/bin/codex",
  "Codex.app/Contents/Resources/codex",
];

function isExecutableFile(path) {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function findCommand(command, searchPath) {
  const candidates = command.includes("/") || command.includes("\\")
    ? [resolve(command)]
    : searchPath.split(delimiter).map((directory) => resolve(directory, command));
  return candidates.find(isExecutableFile);
}

export function resolveCodexExecutable({
  env = process.env,
  platform = process.platform,
  applicationDirectories = ["/Applications", join(homedir(), "Applications")],
} = {}) {
  const searchPath = env.PATH ?? "/usr/bin:/bin";
  const configured = env.CODEX_BRIDGE_CODEX_PATH;
  if (configured) {
    const executable = findCommand(configured, searchPath);
    if (executable) return executable;
    // 显式配置代表用户的选择；失效时不能悄悄改用另一份 CLI。
    throw new Error("CODEX_BRIDGE_CODEX_PATH 指定的 Codex 命令不存在或不可执行，请检查配置路径。");
  }

  const executable = findCommand("codex", searchPath);
  if (executable) return executable;

  // 普通终端不会继承桌面应用注入的 PATH，但仍可使用应用附带的 CLI。
  if (platform === "darwin") {
    for (const directory of applicationDirectories) {
      for (const relativePath of MACOS_CODEX_PATHS) {
        const candidate = resolve(directory, relativePath);
        if (isExecutableFile(candidate)) return candidate;
      }
    }
  }
  throw new Error("无法找到本地 Codex 可执行文件。请将 CODEX_BRIDGE_CODEX_PATH 设置为 Codex CLI 的完整路径，或将 codex 加入 PATH。");
}
