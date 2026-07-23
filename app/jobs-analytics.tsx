"use client";

import { useMemo, useState } from "react";
import {
  jobRatingBand,
  JOB_RATING_BANDS,
  JOB_STATUSES,
  toJobCard,
} from "@/lib/jobs";
import { JOB_CASE_TYPE } from "@/lib/vault-boundary.mjs";
import {
  buildDailyFlow,
  parseStatsPayload,
  reachRate,
  SMALL_SAMPLE_THRESHOLD,
} from "@/lib/job-stats.mjs";
import { getType, type Note } from "@/lib/notes";

/**
 * 期間フィルタは**1本だけ**、全チャートに効く。
 * チャートごとにフィルタを置くと、隣り合う2枚が別のスライスを見ている状態になり、
 * 見比べた瞬間に誤読する。
 */
const RANGES = [
  { id: "all", label: "全期間", months: 0 },
  { id: "m6", label: "直近6か月", months: 6 },
  { id: "m3", label: "直近3か月", months: 3 },
] as const;

type RangeId = (typeof RANGES)[number]["id"];

/** 月文字列の比較だけで足りるので Date を作らない（タイムゾーンの罠を持ち込まない）。 */
function monthFloor(months: number): string | null {
  if (months <= 0) return null;
  const now = new Date();
  const shifted = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
  return `${shifted.getFullYear()}-${`${shifted.getMonth() + 1}`.padStart(2, "0")}`;
}

const pct1 = (value: number) => `${(value * 100).toFixed(1)}%`;

/** 台帳は不採用しか記録していない。「応募済」系はノート側からしか数えられない。 */
const IN_FLIGHT: string[] = ["応募済", "書類通過", "面接中"];
const PASSED_SCREENING: string[] = ["書類通過", "面接中", "内定"];

function Tile({ value, label, note }: { value: string; label: string; note?: string }) {
  return (
    <div className="stat-tile">
      <strong>{value}</strong>
      <span>{label}</span>
      {note ? <small>{note}</small> : null}
    </div>
  );
}

/**
 * 表ビュー。ツールチップだけが値に到達する唯一の手段になってはいけないので、
 * どのチャートにも必ず付ける（既定は畳んでおく）。
 */
function TableView({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="chart-table">
      <summary>数値で見る</summary>
      <table>
        <thead>
          <tr>{head.map((cell) => <th key={cell}>{cell}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function Card({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="chart-card">
      <header>
        <h3>{title}</h3>
        {caption ? <p>{caption}</p> : null}
      </header>
      {children}
    </section>
  );
}

/**
 * 横棒。**名義カテゴリなので全バー同色**——濃淡で大きさを二重符号化するのは
 * anti-pattern（長さが既に大きさを表している）。順序カテゴリのときだけ step を渡す。
 */
function BarRow({
  label,
  valueLabel,
  ratio,
  step,
  title,
  flag,
}: {
  label: string;
  valueLabel: string;
  ratio: number;
  step?: number;
  title: string;
  flag?: string;
}) {
  return (
    <div className="chart-bar-row" tabIndex={0} title={title}>
      <span className="chart-bar-label">{label}</span>
      <div className="chart-bar-track">
        <i
          className="chart-bar-fill"
          data-step={step ?? ""}
          style={{ width: `${Math.max(ratio * 100, ratio > 0 ? 1.5 : 0)}%` }}
        />
      </div>
      <span className="chart-bar-value">
        {valueLabel}
        {flag ? <em>{flag}</em> : null}
      </span>
    </div>
  );
}

export default function JobsAnalytics({ notes }: { notes: Note[] }) {
  const [range, setRange] = useState<RangeId>("all");

  const jobs = useMemo(
    () => notes.filter((note) => getType(note) === JOB_CASE_TYPE).map(toJobCard),
    [notes],
  );

  // 台帳ノートの generated JSON。無ければ空集計が返り、各チャートが「データなし」を描く。
  const stats = useMemo(() => {
    const ledger = notes.find((note) => note.path.endsWith("_不採用台帳_正.md"));
    return parseStatsPayload(ledger?.content ?? "");
  }, [notes]);

  const floor = monthFloor(RANGES.find((item) => item.id === range)?.months ?? 0);

  /** 月別の「投げた／落ちた」。applied が null の月は**不明**であって 0 ではない。 */
  const timeline = useMemo(
    () => stats.timeline.months.filter((row) => !floor || row.month >= floor),
    [stats, floor],
  );
  const timelineMax = Math.max(1, ...timeline.map((row) => Math.max(row.applied ?? 0, row.rejected)));

  /**
   * 「いま何件待っているか」は日別。応募日が分かる窓が1か月しか無いので、
   * 月別だと点が1つしか立たない。期間フィルタはここには効かせない
   * （窓そのものが1か月なので、絞るとグラフが消える）。
   */
  const flow = useMemo(() => buildDailyFlow(stats.timeline.pairs), [stats]);
  const flowMax = Math.max(1, ...flow.map((d) => d.appliedCum));

  /**
   * 経路別は月内訳を持っていないので、**期間フィルタを適用できない**。
   * 黙って全期間の数字を出すと、他のチャートと母数が違うことに気づけない。
   * → フィルタ中はその旨をキャプションに出す。
   */
  const channels = useMemo(
    () =>
      stats.rejections.byChannel
        .map((row) => ({ ...row, rate: reachRate(row.reached, row.total) }))
        .sort((a, b) => b.rate - a.rate || b.total - a.total),
    [stats],
  );

  const inFlight = jobs.filter((job) => IN_FLIGHT.includes(job.status)).length;
  const readyToApply = jobs.filter((job) => job.status === "未応募" && job.rating >= 7).length;

  // ファネル：観測できている範囲だけ。総応募数は台帳（不採用のみ）からは出せない。
  const passedNow = jobs.filter((job) => PASSED_SCREENING.includes(job.status)).length;
  const interviewNow = jobs.filter((job) => ["面接中", "内定"].includes(job.status)).length;
  const offers = jobs.filter((job) => job.status === "内定").length;
  const funnel = [
    { stage: "応募（観測済）", value: stats.rejections.total + inFlight },
    { stage: "書類通過", value: stats.rejections.reachedInterview + passedNow },
    { stage: "面接実施", value: stats.rejections.reachedInterview + interviewNow },
    { stage: "内定", value: offers },
  ];
  const funnelTop = funnel[0].value || 1;

  const bands = JOB_RATING_BANDS.filter((band) => band.id !== "7plus").map((band) => ({
    ...band,
    count: jobs.filter((job) => jobRatingBand(job.rating) === band.id).length,
  }));
  const bandMax = Math.max(1, ...bands.map((band) => band.count));

  const statuses = JOB_STATUSES.map((status) => ({
    status,
    count: jobs.filter((job) => job.status === status).length,
  })).filter((row) => row.count > 0);
  const statusTotal = statuses.reduce((sum, row) => sum + row.count, 0) || 1;

  const stacks = useMemo(() => {
    const counts = new Map<string, number>();
    for (const job of jobs) {
      // 「Spark（歓迎欄のみ）」のような注記付きは同じ技術として数える
      for (const tag of job.stack) {
        const key = tag.replace(/[（(].*$/, "").trim();
        if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 10);
  }, [jobs]);
  const stackMax = Math.max(1, ...stacks.map((row) => row.count));

  const hasHistory = stats.rejections.total > 0;

  // 折れ線の座標。padding は軸ラベル帯を含めて確保する（カード内に入れ子スクロールを作らない）。
  const W = 720;
  const H = 200;
  const PAD = { left: 34, right: 16, top: 12, bottom: 28 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  return (
    <div className="analytics">
      <header className="analytics-head">
        <span className="eyebrow">● JOB ANALYTICS</span>
        <h1>求職分析</h1>
        <p>
          応募の実績と現在の手札を、リストでは見えない形で見る。
          <strong>上段は 181 社の履歴</strong>（凍結 CSV ＋ ノート）、
          <strong>下段は現在の {jobs.length} 件</strong>（job-case ノート）——
          データ源が違うので混ぜて読まないこと。
        </p>
      </header>

      {/* フィルタは1行だけ。すべてのチャートが同じスライスを見る。 */}
      <div className="analytics-filter">
        <span>期間</span>
        {RANGES.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`job-chip${range === item.id ? " active" : ""}`}
            aria-pressed={range === item.id}
            onClick={() => setRange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="stat-row">
        <Tile value={`${stats.rejections.total}`} label="不採用（累計）" note="凍結CSV 175 ＋ ノート" />
        <Tile
          value={pct1(reachRate(stats.rejections.reachedInterview, stats.rejections.total))}
          label="面接到達率"
          note={`${stats.rejections.reachedInterview} 社が書類を通過`}
        />
        <Tile value={`${inFlight}`} label="進行中" note="応募済・書類通過・面接中" />
        <Tile value={`${readyToApply}`} label="未応募 7点以上" note="いま投げられる手札" />
      </div>

      <h2 className="analytics-section">これまでの実績（{stats.rejections.total} 社）</h2>

      <Card
        title="経路別の面接到達率"
        caption={
          range === "all"
            ? "どの経路が書類を通っているか。バーの長さ＝到達率、右の n＝その経路の不採用社数。"
            : "⚠️ 経路別は月内訳を持たないため、ここだけ常に全期間の数字。他のチャートとは母数が違う。"
        }
      >
        {hasHistory ? (
          <>
            <div className="chart-bars">
              {channels.map((row) => (
                <BarRow
                  key={row.channel}
                  label={row.channel}
                  ratio={row.rate}
                  valueLabel={pct1(row.rate)}
                  title={`${row.channel}：${row.reached} / ${row.total} 社が面接到達`}
                  flag={
                    row.total < SMALL_SAMPLE_THRESHOLD
                      ? `n=${row.total}・少数`
                      : `n=${row.total}`
                  }
                />
              ))}
            </div>
            <p className="chart-note">
              🔴 <strong>n が小さい経路の率を単独で読まない。</strong>
              企業直投の {channels.find((c) => c.channel.includes("直投"))?.reached ?? 0} / {channels.find((c) => c.channel.includes("直投"))?.total ?? 0} 社は、
              1 社増減するだけで率が十数ポイント動く。母数 {SMALL_SAMPLE_THRESHOLD} 未満には「少数」と付けてある。
            </p>
            <TableView
              head={["経路", "不採用", "書類終了", "面接到達", "到達率"]}
              rows={channels.map((row) => [
                row.channel,
                row.total,
                row.total - row.reached,
                row.reached,
                pct1(row.rate),
              ])}
            />
          </>
        ) : (
          <p className="chart-empty">台帳の集計がまだ生成されていない（`npm run vault:stats`）。</p>
        )}
      </Card>

      <Card
        title="選考ファネル（観測できている範囲）"
        caption="⚠️ 台帳は不採用しか記録していないため、総応募数は直接には分からない。さらに Indeed の求人URLから直接応募した分は受理メールが来ないので、ここには含まれていない。"
      >
        <div className="chart-bars">
          {funnel.map((row, index) => (
            <BarRow
              key={row.stage}
              label={row.stage}
              ratio={row.value / funnelTop}
              step={index}
              valueLabel={`${row.value}`}
              title={`${row.stage}：${row.value} 件（応募比 ${pct1(row.value / funnelTop)}）`}
              flag={index === 0 ? undefined : pct1(row.value / funnelTop)}
            />
          ))}
        </div>
        <TableView
          head={["段階", "件数", "応募比"]}
          rows={funnel.map((row) => [row.stage, row.value, pct1(row.value / funnelTop)])}
        />
      </Card>

      <Card
        title="月別：投げた数と落ちた数"
        caption={
          stats.timeline.appliedKnownFrom
            ? `応募数が分かるのは ${stats.timeline.appliedKnownFrom} 以降。それ以前は Gmail を遡っていないので「不明」であって 0 件ではない（当然どこかで応募している）。`
            : "応募日台帳がまだ無いので応募数は全月不明。"
        }
      >
        {timeline.length > 0 ? (
          <>
            <ul className="chart-legend">
              <li><b data-step="1" /> 投げた <small>応募</small></li>
              <li><b data-step="4" /> 落ちた <small>不採用</small></li>
            </ul>
            <div className="chart-months">
              {timeline.map((row) => (
                <div className="chart-month" key={row.month}>
                  <div className="chart-month-bars">
                    {/* 不明を 0 の棒で描くと「応募していなかった」に見える。棒ごと出さずハッチにする */}
                    {row.applied === null ? (
                      <i className="chart-month-unknown" title={`${row.month}：応募数は不明（未走査）`} />
                    ) : (
                      <i
                        data-step="1"
                        style={{ height: `${(row.applied / timelineMax) * 100}%` }}
                        title={`${row.month}：${row.applied} 件応募`}
                      />
                    )}
                    <i
                      data-step="4"
                      style={{ height: `${(row.rejected / timelineMax) * 100}%` }}
                      title={`${row.month}：${row.rejected} 社が不採用`}
                    />
                  </div>
                  <span>{row.month.slice(2).replace("-", "/")}</span>
                </div>
              ))}
            </div>
            <TableView
              head={["月", "投げた", "落ちた"]}
              rows={timeline.map((row) => [row.month, row.applied === null ? "不明" : row.applied, row.rejected])}
            />
          </>
        ) : (
          <p className="chart-empty">この期間に該当するデータがない。</p>
        )}
      </Card>

      <Card
        title="いま何件待っているか"
        caption={`応募日が分かる ${flow.length > 0 ? flow[0].date : "—"} 以降の分だけ。この線は「投げた − 結果が出た」で、過去181社の不採用は混ぜていない（それらは窓より前の応募なので引くと数が壊れる）。`}
      >
        {flow.length > 0 ? (
          <>
            <ul className="chart-legend">
              <li><b data-step="1" /> 累計で投げた <small>{flow[flow.length - 1].appliedCum}</small></li>
              <li><b data-step="4" /> 累計で結果が出た <small>{flow[flow.length - 1].resolvedCum}</small></li>
              <li><b data-step="2" /> 待っている <small>{flow[flow.length - 1].pending}</small></li>
            </ul>
            <svg className="chart-line" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="応募・結果・待機の推移">
              {[0, 0.5, 1].map((tick) => {
                const y = PAD.top + plotH - tick * plotH;
                return (
                  <g key={tick}>
                    <line className="chart-grid" x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} />
                    <text className="chart-tick" x={PAD.left - 8} y={y + 4} textAnchor="end">
                      {Math.round(tick * flowMax)}
                    </text>
                  </g>
                );
              })}
              {([
                { key: "appliedCum", step: 1 },
                { key: "resolvedCum", step: 4 },
                { key: "pending", step: 2 },
              ] as const).map(({ key, step }) => (
                <polyline
                  key={key}
                  className="chart-line-path"
                  data-step={step}
                  points={flow
                    .map((d, i) => {
                      const x = PAD.left + (flow.length <= 1 ? plotW / 2 : (i / (flow.length - 1)) * plotW);
                      const y = PAD.top + plotH - (d[key] / flowMax) * plotH;
                      return `${x},${y}`;
                    })
                    .join(" ")}
                />
              ))}
              {flow.map((d, i) => {
                const x = PAD.left + (flow.length <= 1 ? plotW / 2 : (i / (flow.length - 1)) * plotW);
                const y = PAD.top + plotH - (d.pending / flowMax) * plotH;
                return (
                  <g key={d.date} tabIndex={0}>
                    <title>{`${d.date}：投げた計 ${d.appliedCum}・結果 ${d.resolvedCum}・待ち ${d.pending}`}</title>
                    <circle className="chart-hit" cx={x} cy={y} r={12} />
                    {(d.applied > 0 || d.resolved > 0) && <circle className="chart-dot" data-step="2" cx={x} cy={y} r={4} />}
                  </g>
                );
              })}
              <text className="chart-tick" x={PAD.left} y={H - 8} textAnchor="start">{flow[0].date.slice(5)}</text>
              <text className="chart-tick" x={W - PAD.right} y={H - 8} textAnchor="end">
                {flow[flow.length - 1].date.slice(5)}
              </text>
            </svg>
            <TableView
              head={["日付", "投げた", "結果", "累計投げた", "累計結果", "待ち"]}
              rows={flow
                .filter((d) => d.applied > 0 || d.resolved > 0)
                .map((d) => [d.date, d.applied, d.resolved, d.appliedCum, d.resolvedCum, d.pending])}
            />
          </>
        ) : (
          <p className="chart-empty">応募日台帳がまだ無い（`npm run vault:stats` と Gmail 走査が必要）。</p>
        )}
      </Card>

      <h2 className="analytics-section">現在のパイプライン（{jobs.length} 件）</h2>

      <div className="chart-grid-2">
        <Card title="評点の分布" caption="job-case ノートの rating。7 点以上が「応募すべき」帯。">
          <div className="chart-bars">
            {bands.map((band, index) => (
              <BarRow
                key={band.id}
                label={band.label}
                ratio={band.count / bandMax}
                step={bands.length - 1 - index}
                valueLabel={`${band.count}`}
                title={`${band.hint}：${band.count} 件`}
              />
            ))}
          </div>
          <TableView head={["評点", "件数", "意味"]} rows={bands.map((b) => [b.label, b.count, b.hint])} />
        </Card>

        <Card title="状態の分布" caption="選考のどの段階に何件あるか。">
          <div className="chart-stack" role="img" aria-label="状態の分布">
            {statuses.map((row, index) => (
              <i
                key={row.status}
                data-step={index}
                style={{ width: `${(row.count / statusTotal) * 100}%` }}
                title={`${row.status}：${row.count} 件`}
              />
            ))}
          </div>
          <ul className="chart-legend">
            {statuses.map((row, index) => (
              <li key={row.status}>
                <b data-step={index} /> {row.status} <small>{row.count}</small>
              </li>
            ))}
          </ul>
          <TableView
            head={["状態", "件数", "割合"]}
            rows={statuses.map((row) => [row.status, row.count, pct1(row.count / statusTotal)])}
          />
        </Card>
      </div>

      <Card title="求人が求める技術（上位10）" caption="現在のパイプラインの stack を集計。市場が実際に何を書いているか。">
        <div className="chart-bars">
          {stacks.map((row) => (
            <BarRow
              key={row.name}
              label={row.name}
              ratio={row.count / stackMax}
              valueLabel={`${row.count}`}
              title={`${row.name}：${row.count} 件の求人に出現`}
            />
          ))}
        </div>
        <TableView head={["技術", "出現件数"]} rows={stacks.map((row) => [row.name, row.count])} />
      </Card>
    </div>
  );
}
