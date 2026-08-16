#!/bin/sh

set -eu

OBSIDIAN_VAULT_PATH="${OBSIDIAN_VAULT_PATH:-/Users/kanxiao/obsidian/xiaokan}"
OBSIDIAN_CONFIG_PATH="${OBSIDIAN_CONFIG_PATH:-$OBSIDIAN_VAULT_PATH/.obsidian/plugins/obsidian-local-rest-api/data.json}"

if [ ! -f "$OBSIDIAN_CONFIG_PATH" ]; then
  echo "Obsidian Local REST API configuration was not found: $OBSIDIAN_CONFIG_PATH" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required to read the local Obsidian plugin configuration." >&2
  exit 1
fi

# vault の整合性を起動時に一度だけ見る。ページを実際に見ようとしている瞬間なので、
# ここでズレを知らせるのが一番役に立つ。ただし起動は止めない（Codex や手編集の
# 取りこぼしを拾うための保険であって、開発を妨げるためのものではない）。
if ! node "$(dirname -- "$0")/vault-check.mjs" >/dev/null 2>&1 ||
   ! node "$(dirname -- "$0")/vault-stats.mjs" --check >/dev/null 2>&1; then
  echo "⚠️  vault のデータに不整合がある。詳細: npm run vault:verify" >&2
fi

# 手勢用の wasm・モデルを public/mediapipe/ に用意（揃っていれば何もしない、
# 失敗しても起動は止めない——クライアントが CDN へフォールバックする）
node "$(dirname -- "$0")/fetch-mediapipe.mjs" || true

OBSIDIAN_API_KEY="$(jq -r '.apiKey // empty' "$OBSIDIAN_CONFIG_PATH")"
export OBSIDIAN_API_KEY
export OBSIDIAN_API_URL="${OBSIDIAN_API_URL:-http://127.0.0.1:27123}"

if [ -z "$OBSIDIAN_API_KEY" ]; then
  echo "No API key was found in the Obsidian plugin configuration." >&2
  exit 1
fi

if [ -n "${CODEX_BRIDGE_PORT:-}" ]; then
  export CODEX_BRIDGE_PORT
else
  CODEX_BRIDGE_PORT="$(node -e '
    const net = require("node:net");
    const preferred = 43127;
    const chooseFallback = () => {
      const fallback = net.createServer();
      fallback.listen(0, "127.0.0.1", () => {
        process.stdout.write(String(fallback.address().port));
        fallback.close();
      });
    };
    const probe = net.createServer();
    probe.once("error", (error) => {
      if (error.code !== "EADDRINUSE") throw error;
      chooseFallback();
    });
    probe.listen(preferred, "127.0.0.1", () => {
      process.stdout.write(String(preferred));
      probe.close();
    });
  ')"
  export CODEX_BRIDGE_PORT
fi
export CODEX_BRIDGE_URL="http://127.0.0.1:$CODEX_BRIDGE_PORT"
if [ -z "${CODEX_BRIDGE_TOKEN:-}" ]; then
  CODEX_BRIDGE_TOKEN="$(openssl rand -hex 32)"
  export CODEX_BRIDGE_TOKEN
fi

# vinext は画面/APIをホットリロードするが、別プロセスの bridge はその対象外。
# タスク白名单だけ新しくなった時に「画面は新・bridge は旧」という不整合を残さない。
node --watch scripts/codex-bridge.mjs &
CODEX_BRIDGE_PID=$!

cleanup() {
  kill "$CODEX_BRIDGE_PID" 2>/dev/null || true
  wait "$CODEX_BRIDGE_PID" 2>/dev/null || true
}

trap cleanup EXIT INT TERM
# プレビューハーネスは PORT 環境変数で待ち受けポートを指定してくる。
# vinext は PORT を読まないので明示的に渡す（未指定なら従来どおり 3000）。
npm run dev:web -- --port "${PORT:-3000}"
