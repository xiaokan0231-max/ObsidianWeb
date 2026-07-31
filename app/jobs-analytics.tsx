"use client";

import { useMemo, useState } from "react";
import {
  jobRatingBand,
  JOB_RATING_BANDS,
  JOB_STATUSES,
  toJobCard,
  type JobCard,
} from "@/lib/jobs";
import { JOB_CASE_TYPE } from "@/lib/vault-boundary.mjs";
import {
  buildDailyFlow,
  parseStatsPayload,
  reachRate,
  SMALL_SAMPLE_THRESHOLD,
} from "@/lib/job-stats.mjs";
import { explicitNextEventDate, explicitNextEventTime } from "@/lib/job-progress";
import { getString, getType, type Note } from "@/lib/notes";

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

/**
 * 「現在の手札」セクションの母集団。既定は 7 点以上。
 * 4〜6 点は基本的に投げない札なので、状態内訳や技術集計に混ぜると
 * 「何を持っているか」が薄まる（実測：現役 55 件のうち 7 点未満が 9 件）。
 * ただし消すのではなく**切り替えにする**——母数が黙って変わるのが一番危ない。
 */
const HAND_SCOPES = [
  { id: "high", label: "評点 7 以上", min: 7 },
  { id: "all", label: "全件", min: 0 },
] as const;

type HandScopeId = (typeof HAND_SCOPES)[number]["id"];

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
const ACTIVE_SELECTION: string[] = [...IN_FLIGHT, "内定"];

function scheduledDate(job: JobCard) {
  return explicitNextEventDate(job.note);
}

function shortDate(value: string) {
  const match = value.match(/\b20\d{2}-(\d{2})-(\d{2})\b/);
  return match ? `${Number(match[1])}/${Number(match[2])}` : "—";
}

function scheduledTime(job: JobCard) {
  return explicitNextEventTime(job.note);
}

function focusAction(job: JobCard) {
  const waitingLabel = getString(job.note.frontmatter.waiting_label);
  if (waitingLabel) return waitingLabel;
  if (job.nextAction) return job.nextAction;
  if (job.status === "面接中") return "面接準備を最優先";
  if (job.status === "書類通過") return "次回選考の準備";
  if (job.status === "応募済") return "書類選考の結果待ち";
  if (job.status === "内定") return "条件確認・意思決定";
  return "応募判断";
}

function ProgressPriority({
  job,
  onOpen,
}: {
  job: JobCard;
  onOpen: (note: Note) => void;
}) {
  const evidence = job.matches[0] || job.reason || job.stack.slice(0, 3).join("・");

  return (
    <button
      type="button"
      className="analytics-priority-card"
      onClick={() => onOpen(job.note)}
    >
      <span className="analytics-priority-topline">
        <b>{job.status === "面接中" ? "面接を最優先" : "現在の最優先案件"}</b>
        <i data-status={job.status}>{job.status}</i>
      </span>
      <strong>{job.company}</strong>
      <small>{job.position}</small>
      <div className="analytics-priority-action">
        <span>NEXT ACTION</span>
        <p>{focusAction(job)}</p>
      </div>
      <dl>
        <div>
          <dt>次回日程</dt>
          <dd>{scheduledDate(job) ? `${shortDate(scheduledDate(job))}${scheduledTime(job) ? ` ${scheduledTime(job)}` : ""}` : "未定"}</dd>
        </div>
        <div>
          <dt>相性</dt>
          <dd>{job.rating > 0 ? `${job.rating} / 10` : "未採点"}</dd>
        </div>
      </dl>
      {evidence ? <small className="analytics-priority-evidence">{evidence}</small> : null}
      <span className="analytics-priority-open">案件を開く <b>→</b></span>
    </button>
  );
}

function ProgressWatchRow({
  job,
  onOpen,
}: {
  job: JobCard;
  onOpen: (note: Note) => void;
}) {
  return (
    <button type="button" className="analytics-watch-row" onClick={() => onOpen(job.note)}>
      <span>
        <b>{job.rating > 0 ? job.rating : "—"}</b>
        <small>/ 10</small>
      </span>
      <span>
        <strong>{job.company}</strong>
        <small>{job.position}</small>
      </span>
      <span>
        <i data-status={job.status}>{job.status}</i>
        <small>{focusAction(job)}</small>
      </span>
      <b aria-hidden="true">↗</b>
    </button>
  );
}

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

/**
 * 「現在の手札」に効く条件フィルタ。KPI・HOT LIST は**行動リスト**なので絞らない
 * （次の面談が条件で消えて「予定なし」に見えるのが最悪の誤読）。
 * 効く範囲は評点・状態・技術の3枚だけで、注記行に必ず母数を出す。
 */
type CondFilters = {
  statuses: string[];
  sources: string[];
  regions: string[];
  remoteOnly: boolean;
};

const EMPTY_COND: CondFilters = { statuses: [], sources: [], regions: [], remoteOnly: false };

function condMatch(job: JobCard, cond: CondFilters, except?: keyof CondFilters) {
  return (
    (except === "statuses" || cond.statuses.length === 0 || cond.statuses.includes(job.status)) &&
    (except === "sources" || cond.sources.length === 0 || cond.sources.includes(job.sourceGroup)) &&
    (except === "regions" || cond.regions.length === 0 || job.regions.some((r) => cond.regions.includes(r))) &&
    (except === "remoteOnly" || !cond.remoteOnly || job.remote)
  );
}

export default function JobsAnalytics({
  notes,
  onOpen,
  onViewJobs,
}: {
  notes: Note[];
  onOpen: (note: Note) => void;
  /** statuses を渡すと求人一覧側の状態フィルタに引き継がれる（渡さなければ全件）。 */
  onViewJobs: (statuses?: string[]) => void;
}) {
  const [range, setRange] = useState<RangeId>("all");
  const [handScope, setHandScope] = useState<HandScopeId>("high");
  const [cond, setCond] = useState<CondFilters>(EMPTY_COND);

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
  const interviewCount = jobs.filter((job) => job.status === "面接中").length;
  const resultWaiting = jobs.filter((job) => ["応募済", "書類通過"].includes(job.status)).length;
  const readyToApply = jobs.filter((job) => job.status === "未応募" && job.rating >= 7).length;
  const focusJobs = useMemo(
    () =>
      jobs
        .filter(
          (job) =>
            ACTIVE_SELECTION.includes(job.status)
            && (job.rating >= 8 || job.status === "書類通過" || job.status === "面接中" || job.status === "内定"),
        )
        .sort((left, right) => {
          const stage = (job: JobCard) => {
            if (job.status === "内定") return 4;
            if (job.status === "面接中") return 3;
            if (job.status === "書類通過") return 2;
            return 1;
          };
          return (
            stage(right) - stage(left)
            || right.rating - left.rating
            || right.statusUpdated.localeCompare(left.statusUpdated)
            || left.company.localeCompare(right.company, "ja")
          );
        })
        .slice(0, 8),
    [jobs],
  );
  const nextInterview = useMemo(
    () =>
      jobs
        .filter((job) => job.status === "面接中")
        .sort((left, right) => {
          const leftDate = scheduledDate(left) || "9999-12-31";
          const rightDate = scheduledDate(right) || "9999-12-31";
          return leftDate.localeCompare(rightDate);
        })[0] ?? null,
    [jobs],
  );
  const priorityJob = nextInterview ?? focusJobs[0] ?? null;
  const watchJobs = focusJobs
    .filter((job) => job.path !== priorityJob?.path)
    .slice(0, 4);
  const liveJobs = useMemo(
    () => jobs.filter((job) => job.status !== "不採用"),
    [jobs],
  );

  /**
   * 状態内訳・技術集計の母集団。評点フィルタが効くのはこの2枚だけ。
   * 「現役案件の評点」チャートには**掛けない**——しきい値を決めるための図を
   * そのしきい値で絞ったら、7 点未満が何件あるか永久に見えなくなる。
   *
   * 🔴 選考が動いている案件（応募済〜内定）は評点に関わらず必ず残す。
   * 評点は「投げるかどうか」の判断軸であって、既に投げた案件を隠す軸ではない。
   * 実例：面接中の Sharing Innovations は rating 未記入（＝0 点扱い）で、
   * 素直に `rating >= 7` で絞ると**唯一の面接中案件が状態内訳から消えた**。
   * この例外があるおかげで、状態内訳の進行中の合計は上の KPI「進行中」と必ず一致する。
   */
  const handMin = HAND_SCOPES.find((item) => item.id === handScope)?.min ?? 0;
  /** 条件フィルタ通過後の現役案件。評点チャートの母数（handScope は掛けない）。 */
  const condJobs = useMemo(() => liveJobs.filter((job) => condMatch(job, cond)), [liveJobs, cond]);
  const handJobs = useMemo(
    () => condJobs.filter((job) => job.rating >= handMin || ACTIVE_SELECTION.includes(job.status)),
    [condJobs, handMin],
  );
  const handExcluded = condJobs.length - handJobs.length;
  /**
   * 状態チャートだけは状態フィルタを**自分に掛けない**（facet の except 方式）。
   * 「応募済だけに絞ったら状態図が1本になる」のは情報ゼロで、
   * 評点チャートに評点フィルタを掛けないのと同じ理屈。
   */
  const statusPool = useMemo(
    () =>
      liveJobs
        .filter((job) => condMatch(job, cond, "statuses"))
        .filter((job) => job.rating >= handMin || ACTIVE_SELECTION.includes(job.status)),
    [liveJobs, cond, handMin],
  );
  const condActive =
    cond.statuses.length + cond.sources.length + cond.regions.length + (cond.remoteOnly ? 1 : 0);
  /** chips の件数は常に現役全件からの静的カウント。動的に変わる件数は注記行で出す。 */
  const condOptions = useMemo(() => {
    const countBy = (values: (job: JobCard) => string[]) => {
      const map = new Map<string, number>();
      liveJobs.forEach((job) => values(job).forEach((v) => v && map.set(v, (map.get(v) ?? 0) + 1)));
      return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja"));
    };
    return {
      statuses: JOB_STATUSES.map((status) => [status, liveJobs.filter((j) => j.status === status).length] as const)
        .filter(([, count]) => count > 0),
      sources: countBy((job) => [job.sourceGroup]),
      regions: countBy((job) => job.regions),
      remote: liveJobs.filter((job) => job.remote).length,
    };
  }, [liveJobs]);
  const toggleCond = (key: "statuses" | "sources" | "regions", value: string) =>
    setCond((current) => ({
      ...current,
      [key]: current[key].includes(value)
        ? current[key].filter((item) => item !== value)
        : [...current[key], value],
    }));

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
    count: condJobs.filter((job) => jobRatingBand(job.rating) === band.id).length,
  }));
  const bandMax = Math.max(1, ...bands.map((band) => band.count));

  const statuses = JOB_STATUSES.map((status) => ({
    status,
    count: statusPool.filter((job) => job.status === status).length,
  })).filter((row) => row.count > 0);
  const statusTotal = statuses.reduce((sum, row) => sum + row.count, 0) || 1;

  const stacks = useMemo(() => {
    const counts = new Map<string, number>();
    for (const job of handJobs) {
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
  }, [handJobs]);
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
      <dl className="analytics-head-glance" aria-label="当前求职进展摘要">
        <div data-tone="active">
          <dt>
            进行中
            <small>ACTIVE PIPELINE</small>
          </dt>
          <dd><strong>{inFlight}</strong><small>件</small></dd>
          <span aria-hidden="true">01</span>
        </div>
        <div data-tone="interview">
          <dt>
            面试阶段
            <small>INTERVIEW</small>
          </dt>
          <dd><strong>{interviewCount}</strong><small>件</small></dd>
          <span aria-hidden="true">02</span>
        </div>
        <div data-tone="waiting">
          <dt>
            结果等待
            <small>WAITING</small>
          </dt>
          <dd><strong>{resultWaiting}</strong><small>件</small></dd>
          <span aria-hidden="true">03</span>
        </div>
        <div data-tone="ready">
          <dt>
            可応募
            <small>READY TO APPLY</small>
          </dt>
          <dd><strong>{readyToApply}</strong><small>件</small></dd>
          <span aria-hidden="true">04</span>
        </div>
      </dl>

      <section className="analytics-command">
        <header>
          <div>
            <span>NOW</span>
            <h2>当前推进</h2>
            <p>1 件优先处理，{watchJobs.length} 件持续观察</p>
          </div>
          <button type="button" onClick={() => onViewJobs(IN_FLIGHT)}>
            全部进行中 <b>{inFlight}</b> <i aria-hidden="true">→</i>
          </button>
        </header>
        {priorityJob ? (
          <div className="analytics-command-grid">
            <ProgressPriority job={priorityJob} onOpen={onOpen} />
            <div className="analytics-watch-list">
              <header>
                <strong>观察名单</strong>
                <small>高相性・选考中</small>
              </header>
              {watchJobs.length > 0 ? (
                watchJobs.map((job) => <ProgressWatchRow key={job.path} job={job} onOpen={onOpen} />)
              ) : (
                <p className="chart-empty">暂时没有其他需要持续观察的高相性案件。</p>
              )}
            </div>
          </div>
        ) : (
          <p className="chart-empty">当前没有处于选考中的案件。</p>
        )}
      </section>

      <details className="analytics-hand">
        <summary>
          <span>
            <b>DEEPER VIEW</b>
            <strong>当前手札分析</strong>
            <small>评分、状态与技术需求；只有需要比较下一批岗位时再看</small>
          </span>
          <em>打开</em>
        </summary>
        <div className="analytics-hand-body">
          {/* 母数を変えるスイッチなので、影響する図より必ず**上**に置く。 */}
          <div className="analytics-filter">
        <span>集計対象</span>
        {HAND_SCOPES.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`job-chip${handScope === item.id ? " active" : ""}`}
            aria-pressed={handScope === item.id}
            onClick={() => setHandScope(item.id)}
          >
            {item.label}
          </button>
        ))}
        <small className="analytics-filter-note">
          {handScope === "high"
            ? `状態内訳と技術集計は ${handJobs.length} 件で算出（7 点未満の未応募 ${handExcluded} 件を除外／選考中の案件は評点に関わらず残す）。評点チャートは条件通過後の ${condJobs.length} 件。`
            : `条件通過後の ${condJobs.length} 件すべてで算出。4〜6 点の投げない札も母数に入っている。`}
        </small>
          </div>

          {/* 条件フィルタ。下の3枚（評点・状態・技術）にだけ効く——
              上の KPI・重点案件は行動リストなので絞らない。 */}
          <div className="analytics-filter analytics-cond-filter">
        <span>条件</span>
        {condOptions.statuses.map(([status, count]) => (
          <button
            key={status}
            type="button"
            className={`job-chip${cond.statuses.includes(status) ? " active" : ""}`}
            aria-pressed={cond.statuses.includes(status)}
            onClick={() => toggleCond("statuses", status)}
          >
            {status} <small>{count}</small>
          </button>
        ))}
        {condActive > 0 ? (
          <button type="button" className="job-chip" onClick={() => setCond(EMPTY_COND)}>
            重置（{condActive}）
          </button>
        ) : null}
        <small className="analytics-filter-note">
          状態で絞っても状態内訳の図は全状態を表示し続ける（評点図に評点を掛けないのと同じ理屈）。
          上の KPI・重点案件には効かない。
        </small>
          </div>
          <div className="analytics-filter analytics-cond-filter">
        <span>来源</span>
        {condOptions.sources.map(([source, count]) => (
          <button
            key={source}
            type="button"
            className={`job-chip${cond.sources.includes(source) ? " active" : ""}`}
            aria-pressed={cond.sources.includes(source)}
            onClick={() => toggleCond("sources", source)}
          >
            {source} <small>{count}</small>
          </button>
        ))}
          </div>
          <div className="analytics-filter analytics-cond-filter">
        <span>勤務地</span>
        {condOptions.regions.slice(0, 8).map(([region, count]) => (
          <button
            key={region}
            type="button"
            className={`job-chip${cond.regions.includes(region) ? " active" : ""}`}
            aria-pressed={cond.regions.includes(region)}
            onClick={() => toggleCond("regions", region)}
          >
            {region} <small>{count}</small>
          </button>
        ))}
        <button
          type="button"
          className={`job-chip${cond.remoteOnly ? " active" : ""}`}
          aria-pressed={cond.remoteOnly}
          onClick={() => setCond((current) => ({ ...current, remoteOnly: !current.remoteOnly }))}
        >
          リモート可 <small>{condOptions.remote}</small>
        </button>
          </div>

          <div className="chart-grid-2">
        <Card
          title="現役案件の評点"
          caption={`不採用を除いた現在の手札${condActive > 0 ? `・条件通過後の ${condJobs.length} 件` : "・全件"}。7 点以上が「応募すべき」帯。しきい値を決める図なので、上の集計対象（評点）は掛けない。`}
        >
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

        <Card
          title="現役案件の状態"
          caption={
            handScope === "high"
              ? `評点 7 以上＋選考中の ${statusPool.length} 件。いま動かせる札の内訳${condActive === 0 ? "で、進行中の合計は上の KPI と一致する" : "（条件フィルタ適用中・状態自身は絞らない）"}。`
              : `現役 ${statusPool.length} 件${condActive === 0 ? "すべて" : "（条件フィルタ適用中）"}。4〜6 点の投げない札も含む。`
          }
        >
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

          <Card
        title="現役求人が求める技術（上位10）"
        caption={
          handScope === "high"
            ? `評点 7 以上＋選考中の ${handJobs.length} 件の stack を集計。次の応募先を選ぶ材料。`
            : `現役 ${handJobs.length} 件の stack を集計。投げない帯の求人も母数に入っている。`
        }
      >
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
      </details>

      <details className="analytics-history">
        <summary>
          <span>
            <b>参考データ</b>
            <strong>過去の不採用・経路別到達率・選考ファネル</strong>
            <small>日々の判断には使わないため、通常は閉じておく</small>
          </span>
          <em>開く</em>
        </summary>
        <div className="analytics-history-body">
          {/* 期間フィルタは履歴チャートだけに効く。 */}
          <div className="analytics-filter">
            <span>履歴の期間</span>
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

          <div className="stat-row analytics-history-stats">
            <Tile value={`${stats.rejections.total}`} label="不採用（累計）" note="凍結CSV 175 ＋ ノート" />
            <Tile
              value={pct1(reachRate(stats.rejections.reachedInterview, stats.rejections.total))}
              label="面接到達率"
              note={`${stats.rejections.reachedInterview} 社が書類を通過`}
            />
          </div>

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
                  <strong>n が小さい経路の率を単独で読まない。</strong>
                  企業直投の {channels.find((c) => c.channel.includes("直投"))?.reached ?? 0} / {channels.find((c) => c.channel.includes("直投"))?.total ?? 0} 社は、
                  1 社増減するだけで率が十数ポイント動く。
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
              <p className="chart-empty">台帳の集計がまだ生成されていない。</p>
            )}
          </Card>

          <Card
            title="選考ファネル（観測できている範囲）"
            caption="台帳は不採用しか記録していないため、総応募数は直接には分からない。"
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
                ? `応募数が分かるのは ${stats.timeline.appliedKnownFrom} 以降。それ以前は未走査。`
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
            title="応募と結果の推移"
            caption={`応募日が分かる ${flow.length > 0 ? flow[0].date : "—"} 以降の分だけ。`}
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
              <p className="chart-empty">応募日台帳がまだ無い。</p>
            )}
          </Card>
        </div>
      </details>
    </div>
  );
}
