/**
 * 探索キュー（type: job-queue）の契約。
 *
 * キューは「探索でこの求人を見つけた」という**事実**だけを持つ。
 * 各行が精読済みかどうかは持たない——それは job-case / excluded-job ノートが
 * 存在するかどうかから**導出**するものであり、手で書くと必ず上流とずれる。
 *
 * この契約を scripts/vault-stats.mjs（generated 区块の計算）と
 * Web ランタイム（キュー残数の表示）の両方が使う。lib/job-status.mjs と同じ役回り。
 */

export const JOB_QUEUE_TYPE = "job-queue";

/** 会社名の表記ゆれ（全半角・「株式会社」の位置・括弧書き）だけを吸収する照合キー。 */
export function queueCompanyKey(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/株式会社|有限会社|合同会社|\(株\)|\(.*?\)|（.*?）|[\s　・･_]/g, "")
    .trim();
}

/**
 * キュー本文の表を行に分解する。
 * 期待する列: `| 発見日 | 媒体 | 会社 | 職種名 | 求人ID/URL | kw |`
 * 見出し行と区切り行（---）は読み飛ばす。列が足りない行は不正としてスキップする。
 */
export function parseQueue(content) {
  const rows = [];
  for (const line of String(content ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    const cells = trimmed.slice(1, trimmed.endsWith("|") ? -1 : undefined).split("|").map((c) => c.trim());
    if (cells.length < 5) continue;
    const [found, media, company, position, ref, kw = ""] = cells;
    if (!company || /^-+$/.test(company)) continue;
    if (company === "会社" || found === "発見日") continue;
    rows.push({ found, media, company, position, ref, kw });
  }
  return rows;
}

/**
 * 求人URLから媒体ごとの求人IDを取り出して安定キーにする。
 *
 * 会社名＋職種名での照合は使えない。**媒体一覧のタイトルと求人票のタイトルは
 * 系統的に一致しない**（媒体側はSEO文字列や煽り文が混ざる）ためで、実測でも
 * キュー「データ基盤エンジニア（課長相当）」に対し求人票は
 * 「データ基盤エンジニア(課長相当/ハイブリッド勤務/フルフレックス制度)」だった。
 * 求人の同一性は求人IDで見る、というのが求人探索ルールの原則でもある。
 */
export function queueRefKey(value) {
  const raw = String(value ?? "");

  // ドメインで先に振り分ける。Indeed と RA はどちらも `jk` + 16桁16進数という
  // 同じ形の求人IDを使うので、緩いパターンを先に当てると RA を Indeed と誤認する。
  const ra = raw.match(/r-agent\.com\/viewjob\/jk([0-9a-f]+)/i);
  if (ra) return `ra:${ra[1].toLowerCase()}`;

  // RA の PDT（担当者経由の求人票ビュー）。求人の同一性キーは jobofferManagementNo。
  const pdt = raw.match(/[?&]jobofferManagementNo=([A-Za-z0-9]+)/i);
  if (pdt) return `ra:${pdt[1].toLowerCase()}`;

  const green = raw.match(/green-japan\.com\/(?:company\/\d+\/)?job\/(\d+)/i);
  if (green) return `green:${green[1]}`;

  const indeed = raw.match(/[?&]jk=([0-9a-f]+)/i) ?? raw.match(/indeed\.com\S*?\bjk([0-9a-f]{16})\b/i);
  if (indeed) return `indeed:${indeed[1].toLowerCase()}`;

  return null;
}

/**
 * キュー各行に「対応するノートが既にあるか」を付けて返す。
 *
 * 一次キーは求人ID（`queueRefKey`）。IDが取れない行（RAの検索経由など、URLを
 * 記録できていないもの）だけ、会社名＋職種名の部分一致にフォールバックする。
 * フォールバックは取りこぼしやすいが、**未精読を多めに数える方が安全**なので
 * そのままにしてある——精読済みを見落としても再度読むだけで済むが、
 * 未精読を精読済みと誤判定すると候補が永久に埋もれる。
 */
export function reconcileQueue(rows, notes) {
  const byRef = new Map();
  const byCompany = new Map();
  for (const note of notes) {
    const ref = queueRefKey(note.url);
    if (ref && !byRef.has(ref)) byRef.set(ref, note);
    const key = queueCompanyKey(note.company);
    if (!key) continue;
    if (!byCompany.has(key)) byCompany.set(key, []);
    byCompany.get(key).push(note);
  }

  return rows.map((row) => {
    const ref = queueRefKey(row.ref);
    let matched = ref ? byRef.get(ref) : undefined;

    if (!matched && !ref) {
      const candidates = byCompany.get(queueCompanyKey(row.company)) ?? [];
      const position = String(row.position ?? "").normalize("NFKC").toLowerCase();
      matched = candidates.find((note) => {
        const notePosition = String(note.position ?? "").normalize("NFKC").toLowerCase();
        if (!notePosition || !position) return false;
        return notePosition.includes(position) || position.includes(notePosition);
      });
    }

    return { ...row, reviewed: Boolean(matched), reviewedAs: matched?.kind ?? null };
  });
}

/**
 * 精読した結果「起票する価値もない」と判断した行の印。
 * 行を消すと次の探索で同じ求人をまた拾って往復するので、消さずにこれを付ける約束。
 */
export function isWithdrawn(row) {
  return /【取下げ/.test(String(row?.position ?? ""));
}

/** 未精読の件数と媒体別内訳。generated 区块と Web の両方がこの形を使う。 */
export function queueStats(rows, notes) {
  const reconciled = reconcileQueue(rows, notes).map((row) => ({ ...row, withdrawn: isWithdrawn(row) }));
  // 取下げ済みは「まだ読んでいない」ではないので未精読から外す。
  const pending = reconciled.filter((r) => !r.reviewed && !r.withdrawn);
  const withdrawn = reconciled.filter((r) => r.withdrawn).length;
  const byMedia = new Map();
  for (const row of pending) {
    const media = row.media || "不明";
    byMedia.set(media, (byMedia.get(media) ?? 0) + 1);
  }
  const lastFound = rows
    .map((r) => r.found)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
    .at(-1) ?? null;
  return {
    total: reconciled.length,
    pending: pending.length,
    reviewed: reconciled.filter((r) => r.reviewed).length,
    withdrawn,
    byMedia: [...byMedia.entries()].sort((a, b) => b[1] - a[1]),
    lastFound,
    rows: reconciled,
  };
}
