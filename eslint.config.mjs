import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  // 这里是忽略规则的唯一出处，别再往 package.json 的 lint 命令堆 --ignore-pattern：
  // 命令行的 `--ignore-pattern dist` 只锚定在仓库根，扫不到嵌套层级的构建产物。
  globalIgnores([
    // Default ignores of eslint-config-next（前缀 ** 是本仓库的加强，见下）:
    "**/.next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 构建产物。带 ** 前缀是因为 worktree 之类的嵌套 checkout 里也有自己的 dist/.next，
    // 它们是压缩后的 rolldown 输出，lint 出来的上千条都是噪音。
    "**/dist/**",
    // MediaPipe 的 wasm 加载器（scripts/fetch-mediapipe.mjs 复制来的第三方产物）。
    "public/mediapipe/**",
    // 设计交付稿的原型运行时，只作参考，不参与构建。
    "**/design_handoff_*/**",
    // Claude Code 的 worktree：每个都是一份完整仓库，各自的 checkout 自己 lint，
    // 主仓库不要连带扫进来（否则同一份源码会被重复报，且混入对方的构建产物）。
    "**/.claude/worktrees/**",
  ]),
]);

export default eslintConfig;
