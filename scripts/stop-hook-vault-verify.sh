#!/bin/sh
# Claude Code の Stop hook。ターン終了時に harness が実行する。
# vault のデータ不整合を、AI が「完了」と言い切る前に捕まえるのが目的。
#
# exit 2 で停止をブロックし、stderr がそのまま AI へのフィードバックになる。
# それ以外の異常（vault 無し等）では絶対にブロックしない ── 別マシンや
# vault を触らない作業まで巻き込むと、この防線ごと無視されるようになる。

set -u

PROJECT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
INPUT="$(cat)"

# stop_hook_active が true = 前回この hook がブロックした結果の停止。
# ここで抜けないと「ブロック→再応答→またブロック」で無限ループになる。
if printf '%s' "$INPUT" | node -e '
  let raw = "";
  process.stdin.on("data", (chunk) => (raw += chunk));
  process.stdin.on("end", () => {
    let active = false;
    try { active = JSON.parse(raw).stop_hook_active === true; } catch {}
    process.exit(active ? 0 : 1);
  });
'; then
  exit 0
fi

VAULT_DIR="${OBSIDIAN_VAULT_PATH:-/Users/kanxiao/obsidian/xiaokan}"
[ -d "$VAULT_DIR" ] || exit 0

OUTPUT="$(cd "$PROJECT_DIR" && {
  node scripts/vault-check.mjs 2>&1 && node scripts/vault-stats.mjs --check 2>&1
})"
STATUS=$?

[ "$STATUS" -eq 0 ] && exit 0

# 終了できない理由として AI に返る。何を実行すべきかまで書いておく。
{
  echo "vault のデータが不整合のまま終了しようとしている。直してから終わること。"
  echo
  echo "$OUTPUT"
  echo
  echo "対処: frontmatter の問題は該当ノートを直す。集計のズレは npm run vault:stats を実行する。"
} >&2
exit 2
