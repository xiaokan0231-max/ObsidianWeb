/**
 * 台帳の集計を**機械可読**にして Web に渡すための契約。
 *
 * なぜ必要か：Web ランタイムは Obsidian REST API 経由でノート本文しか読めない。
 * 175社分の凍結 CSV は iCloud にあり Web からは到達不能で、集計を持っているのは
 * `scripts/vault-stats.mjs` だけ。台帳の markdown 表を Web 側で再パースするのは脆いので、
 * script が同じ generated 機構で JSON も書き、Web はそれを読む。
 * 唯一 writer が script のままなので `_数据字典` の writer 表に違反しない。
 *
 * この 1 ファイルを script と Web の両方が import する（lib/job-queue.mjs と同じ役回り）。
 */

export const STATS_BLOCK_ID = "stats-json";

/**
 * @typedef {{ channel: string, total: number, reached: number }} ChannelRow
 * @typedef {{ month: string, count: number }} MonthRow
 * @typedef {{ reason: string, count: number }} ReasonRow
 * @typedef {{ total: number, reachedInterview: number, byChannel: ChannelRow[], byMonth: MonthRow[], byReason: ReasonRow[] }} Rejections
 *
 * `applied` が **null は「その月の応募数が分からない」**、`0` は「その月は本当に0件」。
 * 応募日は 2026-07 に Gmail の受理メールから遡って入れ始めたもので、それ以前は
 * どこにも記録が無い（凍結CSVは last_rejection_date しか持たない）。
 * この2つを同じ「0」で描くと「昔は応募していなかった」という嘘のグラフになる。
 * @typedef {{ month: string, applied: number | null, rejected: number }} TimelineRow
 * @typedef {{ appliedOn: string, resolvedOn: string | null }} AppliedPair
 * @typedef {{ appliedKnownFrom: string | null, months: TimelineRow[], pairs: AppliedPair[] }} Timeline
 *
 * @typedef {{ rejections: Rejections, timeline: Timeline }} StatsPayload
 */

/**
 * 集計を JSON 化する。**タイムスタンプを入れてはいけない** ——
 * 入れると毎回 generated 区块が変わり、`vault:stats --check` が常時 drift 判定になって
 * Stop hook が毎ターン鳴く。中身が変わった時だけ差分が出る状態を保つ。
 */
/**
 * 応募と不採用を月別に突き合わせる。
 *
 * @param {Map<string, number>} rejectedByMonth 月 → 不採用数（全期間そろっている）
 * @param {Map<string, number>} appliedByMonth 月 → 応募数（**遡れた範囲だけ**）
 * @param {string | null} knownFrom 応募日が分かる最初の月。これより前は applied を null にする
 * @returns {Timeline}
 */
export function buildTimeline(rejectedByMonth, appliedByMonth, knownFrom, pairs = []) {
  const allMonths = [...new Set([...rejectedByMonth.keys(), ...appliedByMonth.keys()])]
    .filter(Boolean)
    .sort();

  return {
    appliedKnownFrom: knownFrom,
    pairs,
    months: allMonths.map((month) => ({
      month,
      // knownFrom より前は「0件」ではなく「不明」。ここを 0 にすると
      // 「昔は応募していなかった」というグラフになってしまう。
      applied: knownFrom && month >= knownFrom ? appliedByMonth.get(month) ?? 0 : null,
      rejected: rejectedByMonth.get(month) ?? 0,
    })),
  };
}

/**
 * @param {{ total: number, reached: number, byChannel: Map<string, {total:number,reached:number}>,
 *           byMonth: Map<string, number>, byReason: Map<string, number>, timeline?: Timeline }} input
 * @returns {StatsPayload}
 */
export function buildStatsPayload({ total, reached, byChannel, byMonth, byReason, timeline }) {
  const entries = (map, key) =>
    [...map.entries()].map(([name, value]) =>
      typeof value === "number" ? { [key]: name, count: value } : { [key]: name, ...value },
    );

  return {
    rejections: {
      total,
      reachedInterview: reached,
      byChannel: entries(byChannel, "channel")
        .map(({ channel, total: n, reached: r }) => ({ channel, total: n, reached: r }))
        .sort((a, b) => b.total - a.total),
      byMonth: entries(byMonth, "month").sort((a, b) => a.month.localeCompare(b.month)),
      byReason: entries(byReason, "reason").sort((a, b) => b.count - a.count),
    },
    timeline: timeline ?? { appliedKnownFrom: null, months: [], pairs: [] },
  };
}

/** generated 区块に入れる本文。人が開いても壊れていないと分かるようフェンスで包む。 */
export function renderStatsBlock(payload) {
  return ["```json", JSON.stringify(payload, null, 2), "```"].join("\n");
}

/** @type {StatsPayload} */
const EMPTY = {
  rejections: {
    total: 0,
    reachedInterview: 0,
    byChannel: /** @type {ChannelRow[]} */ ([]),
    byMonth: /** @type {MonthRow[]} */ ([]),
    byReason: /** @type {ReasonRow[]} */ ([]),
  },
  timeline: {
    appliedKnownFrom: null,
    months: /** @type {TimelineRow[]} */ ([]),
    pairs: /** @type {AppliedPair[]} */ ([]),
  },
};

/**
 * 台帳ノートの本文から payload を取り出す。
 *
 * **絶対に throw しない。** これを読むのは画面描画のパスで、台帳がまだ生成されていない
 * ／JSON が壊れている程度のことでページ全体を落とすわけにはいかない。
 * 読めなければ空集計を返し、呼び出し側が「データなし」を描く。
 */
/**
 * @param {string | null | undefined} content
 * @returns {StatsPayload}
 */
export function parseStatsPayload(content) {
  const text = String(content ?? "");
  const block = text.match(
    new RegExp(`<!--\\s*generated:${STATS_BLOCK_ID}[\\s\\S]*?-->([\\s\\S]*?)<!--\\s*/generated\\s*-->`),
  );
  if (!block) return EMPTY;

  const fenced = block[1].match(/```(?:json)?\s*([\s\S]*?)```/);
  if (!fenced) return EMPTY;

  try {
    const parsed = JSON.parse(fenced[1]);
    const r = parsed?.rejections;
    if (!r || typeof r.total !== "number") return EMPTY;
    const t = parsed?.timeline;
    return {
      rejections: {
        total: r.total,
        reachedInterview: Number(r.reachedInterview) || 0,
        byChannel: Array.isArray(r.byChannel) ? r.byChannel : [],
        byMonth: Array.isArray(r.byMonth) ? r.byMonth : [],
        byReason: Array.isArray(r.byReason) ? r.byReason : [],
      },
      timeline: {
        appliedKnownFrom: typeof t?.appliedKnownFrom === "string" ? t.appliedKnownFrom : null,
        months: Array.isArray(t?.months) ? t.months : [],
        pairs: Array.isArray(t?.pairs) ? t.pairs : [],
      },
    };
  } catch {
    return EMPTY;
  }
}

/**
 * 「いま何件待っているか」を日ごとに出す。
 *
 * 🔴 **月別ではなく日別なのは、応募日が分かる窓が1か月しか無いから。**
 * 月別だと点が1つしか立たず、曲線にならない。
 *
 * 🔴 **窓の中だけで完結させる。** 181社の過去の不採用をこの引き算に混ぜてはいけない——
 * それらは窓より前に応募したものなので、「窓内の応募 − 全期間の不採用」は
 * 意味の無い数（大きくマイナスに振れる）になる。ここで数えるのは
 * **窓内で応募したものが、その後どうなったか**だけ。
 *
 * @param {{ appliedOn: string, resolvedOn: string | null }[]} pairs 応募日と、結果が出た日（未解決は null）
 * @returns {{ date: string, applied: number, resolved: number, appliedCum: number, resolvedCum: number, pending: number }[]}
 */
export function buildDailyFlow(pairs) {
  if (pairs.length === 0) return [];

  const days = new Set();
  for (const pair of pairs) {
    days.add(pair.appliedOn);
    if (pair.resolvedOn) days.add(pair.resolvedOn);
  }
  const sorted = [...days].sort();

  // 端が1日だけだと折れ線にならないので、応募の最初の日から最後のイベント日まで埋める
  const filled = [];
  const [start, end] = [sorted[0], sorted[sorted.length - 1]];
  for (let d = new Date(`${start}T00:00:00Z`); ; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    filled.push(iso);
    if (iso >= end) break;
  }

  let appliedCum = 0;
  let resolvedCum = 0;
  return filled.map((date) => {
    const applied = pairs.filter((p) => p.appliedOn === date).length;
    const resolved = pairs.filter((p) => p.resolvedOn === date).length;
    appliedCum += applied;
    resolvedCum += resolved;
    return { date, applied, resolved, appliedCum, resolvedCum, pending: appliedCum - resolvedCum };
  });
}

/**
 * 応募日台帳（`20_求職/_応募日台帳.md`）の表を読む。
 * 期待する列：`| 応募日 | 会社名 | 照合名 | 職種名 | 経路 | 証拠 |`
 *
 * **照合名**は不採用台帳と突き合わせるための名前。受理メールの社名が
 * 持株会社だったり紹介会社だったりして実際の応募先と違う場合に使う
 * （例：メールは「ＦＰＴジャパンホールディングス株式会社」、vault は
 * 「FPTソフトウェアジャパン株式会社」）。空なら会社名をそのまま使う。
 *
 * 重複受理の表は「応募日」列が日付にならない（求人No が来る）ので自然に弾かれるが、
 * 念のため ISO 日付だけを受け付ける。
 *
 * @param {string | null | undefined} content
 * @returns {{ appliedOn: string, company: string, matchName: string, channel: string }[]}
 */
export function parseAppliedLedger(content) {
  const rows = [];
  for (const line of String(content ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    const cells = trimmed.slice(1, trimmed.endsWith("|") ? -1 : undefined).split("|").map((c) => c.trim());
    if (cells.length < 5) continue;
    const [appliedOn, company, matchName, , channel] = cells;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(appliedOn)) continue;
    if (!company) continue;
    rows.push({ appliedOn, company, matchName: matchName || company, channel });
  }
  return rows;
}

/**
 * 台帳の「収録範囲」表から、応募数が**完全に分かる最初の月**を読む。
 * 走査開始が月の途中なら、その月は部分月なので翌月からが完全。
 * 見つからなければ null（＝全月を不明として扱う。ゼロ埋めより安全）。
 *
 * @param {string | null | undefined} content
 * @returns {string | null}
 */
export function parseAppliedKnownFrom(content) {
  const match = String(content ?? "").match(
    /応募数が\*\*完全に分かる最初の月\*\*\s*\|\s*\*\*(\d{4}-\d{2})\*\*/,
  );
  return match ? match[1] : null;
}

/** 到達率。母数 0 で NaN を出さない。 */
export function reachRate(reached, total) {
  return total > 0 ? reached / total : 0;
}

/**
 * 母数がこれ未満の到達率は**単独で読むと誤読する**。
 * 実データ：企業直投 25% は 8社中2社、Green 10% は 10社中1社。
 * Recruit Agent の 4.9%（163社）と並べると、少数サンプルが過大に見える。
 * この閾値を下回るものは画面で必ず注記する。
 */
export const SMALL_SAMPLE_THRESHOLD = 30;
