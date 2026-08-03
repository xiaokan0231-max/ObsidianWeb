// vault-check / vault-stats 共用的最小工具。
// 刻意不引第三方依赖：这两个脚本要能在任何时候直接 node 跑起来。

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CHANNEL_REQUIRED_FROM,
  JOB_STATUSES,
  KNOWN_CHANNELS,
  normalizeJobStatus,
} from "../lib/job-status.mjs";
import { JOB_CASE_TYPE, isOperationalPath } from "../lib/vault-boundary.mjs";

export const VAULT =
  process.env.OBSIDIAN_VAULT_PATH ?? "/Users/kanxiao/obsidian/xiaokan";

export const JOB_CASE_ROOT = join(VAULT, "20_求職");
export const LEDGER = join(VAULT, "20_求職/_不採用台帳_正.md");
export const DICTIONARY = join(VAULT, "99_系统/_数据字典.md");
export const QUEUE = join(VAULT, "20_求職/_AI推薦/_探索キュー.md");
export const APPLIED_LEDGER = join(VAULT, "20_求職/_応募日台帳.md");
export const PREP_LIBRARY = join(VAULT, "20_求職/_素材/面接標準回答集.md");
export const TRENDS = join(VAULT, "20_求職/_素材/面接傾向_横断.md");

/** CSV は iCloud 側にある（vault 外）。無い環境でも壊れないよう呼び出し側で握る。 */
export const REJECTIONS_CSV =
  process.env.REJECTIONS_CSV ??
  "/Users/kanxiao/Library/Mobile Documents/com~apple~CloudDocs/日本就职/面试/履歴書/分析/job_search_rejections.csv";

export { CHANNEL_REQUIRED_FROM, JOB_STATUSES, KNOWN_CHANNELS };

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/**
 * frontmatter だけ読めれば足りるので YAML パーサは入れない。
 * `key: value` と `key:\n  - item` の2形だけ扱う。それ以外は素の文字列で返す。
 */
export function parseFrontmatter(text) {
  const matched = text.match(FRONTMATTER);
  if (!matched) return {};

  const out = {};
  let listKey = null;
  for (const raw of matched[1].split(/\r?\n/)) {
    const item = raw.match(/^\s+-\s+(.*)$/);
    if (item && listKey) {
      out[listKey].push(item[1].trim());
      continue;
    }
    const pair = raw.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!pair) continue;
    const [, key, value] = pair;
    if (value === "") {
      listKey = key;
      out[key] = [];
    } else {
      listKey = null;
      out[key] = value.trim();
    }
  }
  return out;
}

/** 状態は `不採用（…）` のように補足が付く。括弧の手前だけを見る。 */
export function baseStatus(value) {
  return normalizeJobStatus(value) ?? "";
}

/** 応募案件は発見経路に関係なく 20_求職 配下から再帰的に読む。 */
export async function readJobCases() {
  const notes = [];
  for (const path of await listMarkdownFiles(JOB_CASE_ROOT)) {
    const content = await readFile(path, "utf8");
    const frontmatter = parseFrontmatter(content);
    if (frontmatter.type !== JOB_CASE_TYPE) continue;
    notes.push({ name: path.slice(path.lastIndexOf("/") + 1), path, frontmatter, content });
  }
  return notes;
}

/** vault 全体の再帰列挙。90_归档（廃棄済み）・99_系统/模板（雛形）・隠しフォルダは対象外。 */
export async function listMarkdownFiles(dir = VAULT) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    const relativePath = path.slice(VAULT.length + 1);
    if (!isOperationalPath(relativePath)) continue;
    if (entry.isDirectory()) {
      out.push(...(await listMarkdownFiles(path)));
    } else if (entry.name.endsWith(".md")) {
      out.push(path);
    }
  }
  return out;
}

/** 参照キーの正規化。lib/knowledge-graph.ts の normalizeIndexKey と同じ規則にする。 */
export function vaultRefKey(value) {
  return String(value).normalize("NFKC").trim().replace(/\.md$/iu, "");
}

/**
 * vault に実在する全ファイルの参照キー（相対パスと basename の両方）。
 *
 * listMarkdownFiles は 90_归档・99_系统/模板・AGENTS.md を意図的に落とすが、
 * それらは Obsidian からは普通に辿れる実体で、リンクは切れていない。画像や PDF も同じ。
 * 「グラフの対象外」を「参照先が無い」と報告すると、スクショを1枚貼っただけで
 * vault:check が落ち、Stop hook が毎回のターンを止め pre-commit が無関係な commit を拒む。
 * 実体の有無で判定するので、本当に消えた添付・改名されたノートは今まで通り検出できる。
 */
export async function listVaultFileKeys(dir = VAULT, keys = new Set()) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await listVaultFileKeys(path, keys);
      continue;
    }
    keys.add(vaultRefKey(path.slice(VAULT.length + 1)));
    keys.add(vaultRefKey(entry.name));
  }
  return keys;
}

/** `owns: [A, B]`（インライン）と `owns:` 直下のリスト、両方の書き方を ID 配列にする。 */
export function parseOwns(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  return String(value ?? "")
    .trim()
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 引用符も改行埋め込みも扱う最小 CSV パーサ。 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") cell += char;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const [header, ...body] = rows.filter((r) => r.some((c) => c !== ""));
  return body.map((cells) =>
    Object.fromEntries(header.map((key, i) => [key.trim(), (cells[i] ?? "").trim()])),
  );
}

/**
 * `<!-- generated:id ... -->` 〜 `<!-- /generated -->` を差し替える。
 * マーカーが無ければ null を返す（勝手に挿入しない）。
 */
export function replaceGenerated(text, id, body) {
  const pattern = new RegExp(
    `(<!--\\s*generated:${id}\\b[^>]*-->)[\\s\\S]*?(<!--\\s*/generated\\s*-->)`,
  );
  if (!pattern.test(text)) return null;
  return text.replace(pattern, `$1\n${body.trim()}\n$2`);
}
