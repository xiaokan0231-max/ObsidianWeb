#!/bin/bash
set -e

launcher_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
export PORT=3000

project_dir="$launcher_dir"
if command -v git >/dev/null 2>&1 && git -C "$launcher_dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  # 临时检出不带依赖，也可能停在旧提交；日常启动统一使用 main 的检出目录。
  project_dir=""
  while IFS= read -r -d '' field; do
    case "$field" in
      "worktree "*) checkout_dir="${field#worktree }" ;;
      "branch refs/heads/main") project_dir="$checkout_dir"; break ;;
    esac
  done < <(git -C "$launcher_dir" worktree list --porcelain -z)

  if [ -z "$project_dir" ]; then
    echo "未找到 main 分支的检出目录，请先检出 main 后再启动。" >&2
    exit 1
  fi
fi

cd -- "$project_dir"
printf '启动工作区：%s\n' "$PWD"
exec npm run dev
