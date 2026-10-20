#!/bin/zsh -l

# Finder 双击启动时也从脚本所在项目读取配置。
cd -- "${0:A:h}" || exit 1
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
export PORT=3000

if ! command -v npm >/dev/null 2>&1; then
  print '未找到 npm，请先安装 Node.js，再重新启动。'
  read '?按回车关闭窗口…'
  exit 1
fi

print '正在启动 ObsidianWeb：http://localhost:3000'
print '按 Control+C 停止服务。'
npm run dev
result=$?

# 保留退出信息，便于双击启动时查看错误。
print '\n服务已停止。'
read '?按回车关闭窗口…'
exit "$result"
