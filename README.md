# ObsidianWeb

**Obsidian の Vault を唯一のデータソースにする、DB を持たないローカルファースト・ナレッジワークベンチ。**

Markdown ノート群（frontmatter・wikilink・見出し）をそのままドメインモデルとして扱い、
案件ボード・カレンダー・タイムライン・3D ナレッジグラフ・学習ループをリアルタイムに構築する。
Next.js (vinext) / React 19 / TypeScript、デプロイ先は Cloudflare Workers。

![ObsidianWeb](public/og.png)

- 🇬🇧 [English](README.en.md) ・ 🇨🇳 [中文](README.zh.md)

---

## この設計の何が面白いか

### 1. データベースを持たない、という設計判断

`db/schema.ts` は**意図的に空**。永続化層は Obsidian の Vault（ただの Markdown ディレクトリ）そのもの。

```
Obsidian (Local REST API) ──► app/api/vault ──► readAllNotes() ──► 各ビュー
        ▲                          │
        └───── 書き戻しは frontmatter の限定フィールドのみ ─────┘
```

- コピーを作らない＝**二重口径が構造的に発生しない**。Obsidian で編集しても Web で編集しても事実は一つ。
- API キーはサーバープロセスだけが持ち、ブラウザにもリポジトリにも出ない（`app/api/vault/route.ts`）。
- 書き込み口は 1 本に集約。パス・ノート種別・値域をホワイトリストで縛り、
  frontmatter の該当行だけを差し替えて本文は一切触らない。
  「読む→書く」が原子的でないため、短い直列区間に入れて後勝ち消失を防ぐ
  （`app/api/jobs/status/route.ts`、`lib/server/serial-queue.ts`）。

### 2. 「生成ブロック」による派生値の単一事実源

集計値・比率・推移といった**派生データを人が手で書くことを機械的に禁止**する。

```markdown
<!-- generated:stats 勿手改 -->
（スクリプトだけが書き換える領域）
<!-- /generated -->
```

派生値が一度散文に溶けると上流と切れ、上流が変わっても追随せず、間違っていても誰も気付かない。
実際にこの事故が起きたので、**事実（人が書く）／派生（機械が計算する）** を型として分離し、
`npm run vault:check`（frontmatter 検証）と `npm run vault:stats`（再生成）で強制している。

### 3. 検査を CI ではなく三層に置く

Vault は「別マシンには存在しないかもしれない外部データ」なので、コードのテストに縛ると
CI が理由なく落ちる。赤信号が増えると誰も見なくなる——そこで検査を三層に分けた。

| 層 | 発火 | 挙動 |
|---|---|---|
| エージェントの Stop hook | AI が応答を終える度 | 不整合なら **exit 2 で差し戻し**、理由を AI に返す |
| `npm run dev` 起動時 | 画面を見る時 | warning のみ、ブロックしない |
| Vault リポジトリの pre-commit | `git commit` 時 | 不整合なら**コミット拒否** |

### 4. 増分キャッシュ：workerd に `fs` が無い前提で組む

Vault 全体を毎回読むのは遅い。しかしサーバーは workerd 上で動くため
（`nodejs_compat` は仮想ファイルシステム）、`fs` の mtime は使えない。

そこで **REST API の `POST /search/` に JsonLogic `{"var":"stat.mtime"}` を投げ、
1 リクエストで全ノートの mtime を取る**（実測 12ms）。以降は
「1 回のスキャン + mtime が変わったファイルだけ再取得」になる（`lib/server/vault-cache.ts`）。

書き込み直後の読み取り整合性、書き込みの直列化（看板の連打で後勝ち消失が起きる）、
metadata cache の遅延といった競合条件は、実測に基づいてテストで固定してある。

### 5. 3D 表現と手のジェスチャー操作

three.js でノート間の意味的関係を 2.5D の「記憶星図」として、活動量を時間軸の
「時之航道」として描く。全画面時は MediaPipe Tasks Vision のハンドトラッキングで
カメラを操作できる（wasm とモデルは**自ホスト**、`scripts/fetch-mediapipe.mjs` が取得）。

### 6. ローカル LLM ブリッジ

生成系は `127.0.0.1` にのみバインドしたローカルブリッジ経由（`scripts/codex-bridge.mjs`）。

- 起動ごとに使い捨てトークンを発行し、Web とブリッジを同一トークンで束縛
- ログイン方式を検証し、API キー方式なら**実行を拒否**
- 子プロセスに `OPENAI_API_KEY` / `CODEX_API_KEY` を継承させない
- ポート衝突時は空きポートを自動選択（「古いブリッジが居るのに新しい画面が 503」を排除）

---

## 画面

| ビュー | 内容 |
|---|---|
| 総覧 | 「今いちばん重要なこと」と進行中の案件 |
| 案件ボード | 全文検索（ヒット語ハイライト）・多軸フィルタ・最大3件の横並び比較 |
| TODO / カレンダー | frontmatter の期日と本文中の予定を横断して拾う |
| 面接レビュー | 逐語稿と注釈を突き合わせ、5次元スコアで回答品質を採点 |
| 日本語トレーニング | 語彙・読み・文法など8分類の練習／訓練／試験ループ |
| 時之航道 | 活動量を光柱で可視化する 3D タイムライン |
| 記憶星図 | 意味的関係を描く 2.5D ナレッジグラフ |

---

## 動かし方

Obsidian と **Local REST API** プラグインが起動している状態で：

```bash
npm install
npm run dev
```

`http://localhost:3000`。起動スクリプトが Obsidian のプラグイン設定から API キーを読み、
サーバープロセスにだけ渡す。

| 環境変数 | 用途 |
|---|---|
| `OBSIDIAN_VAULT_PATH` | Vault の場所 |
| `OBSIDIAN_CONFIG_PATH` / `OBSIDIAN_API_URL` | 既定値の上書き |
| `CODEX_BRIDGE_PORT` | ブリッジのポート（既定 `43127`） |

---

## 品質ゲート

```bash
npm test    # tsc --noEmit → build → node --test（298 tests）
npm run lint   # eslint --max-warnings 0
```

`npm test` は型チェックとビルドを含む。テストは純関数として切り出したデータ層
（`lib/*.ts` / `lib/*.mjs`）を中心に、パーサ・正規化・競合条件・レンダリング結果まで覆う。

会社名の表記ゆれ（全角/半角・「株式会社」の位置・括弧書き）のような、
実運用で実際に壊れた形はすべてテストに固定してある。

---

## 技術スタック

| 領域 | 採用 |
|---|---|
| フレームワーク | Next.js 16 / vinext / React 19（RSC） |
| 言語 | TypeScript 5.9（`strict`） |
| ランタイム | Cloudflare Workers（wrangler / vite） |
| 3D・入力 | three.js / MediaPipe Tasks Vision |
| スタイル | Tailwind CSS 4 + ビュー単位の CSS |
| テスト | `node:test`（外部ランナー無し） |
| データ | Obsidian Local REST API（**DB 無し**） |

## ディレクトリ

```
app/     ルーティング・API ルート・ビュー（React）
lib/     データ層。zero-import の純関数を優先し、テストしやすさを担保
lib/server/  サーバー専用（Obsidian 接続・キャッシュ・書き込み・ブリッジ）
scripts/ Vault 検証／再生成、開発サーバー、ブリッジ
tests/   node:test。298 ケース
```

## ライセンス

個人プロジェクト。ライセンス未設定（All rights reserved）。
