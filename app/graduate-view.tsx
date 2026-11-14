"use client";

import "./styles/graduate.css";
import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import MarkdownDocument from "./markdown-document";
import { readReadModelJSON } from "./read-model-resource";
import { readNoteDetail } from "./note-detail-resource";
import { URL_CHANGE_EVENT, useInitialUrlSearch } from "./use-url-state";
import { useUiLocale } from "./ui-locale";
import { appViewHref } from "./app-route";
import {
  graduateBand,
  graduateCatalogEntries,
  graduateDeviationRange,
  graduateDateLabel,
  graduateDaysUntil,
  graduateLocationFromSearch,
  graduateManYen,
  graduateNoteSections,
  graduateSearch,
  graduateStepState,
  graduateTotalFee,
  GRADUATE_TRACK_FILTERS,
  nextGraduateDeadline,
  nextGraduateEvent,
  overdueGraduatePrerequisites,
  parseGraduateSchool,
  type GraduateCatalogEntry,
  type GraduateCatalogPage,
  type GraduateCatalogRoute,
  type GraduateCatalogSchool,
  type GraduateCatalogStep,
  type GraduateDeadlineType,
  type GraduateLocation,
  type GraduateReference,
  type GraduateRoute,
  type GraduateSchool,
  type GraduateStep,
  type GraduateStepKind,
  type GraduateTrackFilter,
} from "@/lib/graduate";
import { tokyoParts } from "@/lib/dojo/utils";
import type { Note } from "@/lib/notes";
import type { UiLocale } from "@/lib/ui-locale";

const COPY = {
  "zh-CN": {
    module: "大学院", title: "候选学校", tracks: { master: "修士", bachelor: "本科", all: "全部" }, trackLabel: "路线类型",
    columns: { route: "学校与路线", level: "学校层次", degree: "学位", years: "学制", firstYear: "首年费用", total: "预计总费用", exams: "考试科目", next: "下一道截止" },
    level: {
      section: "学校层次", title: "学校层次怎么看", subtitle: "河合塾本科一般入试的偏差值（2027 年度预测）：越靠右越难考进。候选校画的是相关学部，细线是全校各学部的范围。",
      candidate: "候选", reference: "参照", focus: "相关学部", school: "全校各学部", deviation: "偏差值",
      lowest: "35.0 是河合塾的最低一档，意思是「37.4 以下」。", analogyBy: (name: string) => `「约等于国内哪一档」是 ${name} 为建立概念做的粗略类比，日本没有批次线，不是官方换算。`,
      source: "数据来源", profileKind: "学校性质", founded: "创立", size: "规模", none: "这所学校还没有层次资料。",
      summary: (focus: string, range: string, band: string, analogy: string) => `${focus}偏差值 ${range}，属于「${band}」一档，${analogy}。`,
      schoolRange: (range: string) => `全校各学部 ${range}`,
    },
    years: (count: number) => `${count} 年`, man: "万日元", byYears: (count: number) => `按 ${count} 年计`,
    daysLeft: (days: number) => days === 0 ? "今天截止" : `还剩 ${days} 天`, closed: "已截止", noDeadline: "暂无后续截止",
    overdue: "前置期限已过", loading: "正在读取候选学校…", indexing: "资料索引正在同步，完成后自动显示。",
    failed: "候选学校暂时无法读取", retry: "重试", empty: "还没有候选学校",
    emptyDetail: "在 Vault 的 40_大学院/ 新建 type: graduate-school 的学校卷宗后会出现在这里。大学院资料只在本机，公开快照不包含。",
    notIndexed: "当前资料版本还没有大学院索引，重新同步资料后显示。",
    syncing: "资料正在更新，当前显示上一完整版本。", syncFailed: "资料更新未完成，当前显示上一完整版本。",
    issues: (count: number) => `${count} 处大学院资料格式有误，相关路线未列入候选表：`,
    back: "候选学校", routes: "本校路线", now: "当前要做的事", nowEvent: "下一项日程", nothingLeft: "这条路线已没有待办的日程。",
    overdueTitle: "前置期限已过，没有完成记录", overdueHelp: "请核对这些前置手续是否已经办完；办完后在笔记该步骤加 done_on，提示就会消失。",
    materials: "要交的材料", method: "提交方式", openSource: "官方页面", sections: "本页内容",
    apply: "出愿与材料", fees: "学位与费用", exam: "考试与备考", sources: "出处", levelNav: "学校层次",
    fit: "出愿资格与匹配", fitHint: "含 AI 判断，署名见正文",
    kinds: { prerequisite: "前置手续", application: "出愿", exam: "考试・面谈", result: "发表", enrollment: "入学手续" } satisfies Record<GraduateStepKind, string>,
    states: { done: "已完成", closed: "已过", open: "进行中", upcoming: "未开始", undated: "无校方日期" },
    optional: "建议做", doneOn: "完成于",
    degree: "学位", duration: "学制", entry: "入学", firstYear: "首年", annual: "之后每年", total: "毕业前预计合计",
    feeBasis: "计算口径", yen: "円", feeSource: "学费表",
    exams: "考试科目", prep: "备考资料", openPrep: "展开备考：真题摘要与练习方法", closePrep: "收起备考", prepLoading: "正在读取备考资料…",
    prepFailed: "备考资料暂时无法读取", noPrep: "这条路线还没有备考资料。",
    indicators: { ranking: "排名", deviation: "偏差值", employment: "就业" }, indicatorSource: "查看来源", checkedOn: "资料核对日", openNote: "打开学校原笔记",
    detailLoading: "正在读取学校资料…", detailFailed: "学校资料暂时无法读取", notFound: "没有找到这所学校或路线",
    detailIssues: "学校卷宗格式有误，以下只显示候选表中的精简信息。",
    deadlineTypes: { "必着": "截止日当天必须送达", "消印有効": "截止日当天的邮戳有效", "期限内必着": "期限内必须送达" } satisfies Record<GraduateDeadlineType, string>,
  },
  ja: {
    module: "大学院", title: "候補校", tracks: { master: "修士", bachelor: "学部", all: "すべて" }, trackLabel: "ルートの種類",
    columns: { route: "学校とルート", level: "大学のレベル", degree: "学位", years: "年限", firstYear: "初年度", total: "卒業までの概算", exams: "試験科目", next: "次の締切" },
    level: {
      section: "大学のレベル", title: "大学のレベルの目安", subtitle: "河合塾の学部一般選抜ボーダー偏差値（2027年度予想）。右ほど入りにくい。候補校は関連学部、細線は全学部の範囲。",
      candidate: "候補", reference: "参照", focus: "関連学部", school: "全学部", deviation: "偏差値",
      lowest: "35.0 は河合塾の最低帯で「37.4以下」を表します。", analogyBy: (name: string) => `中国の合格ライン区分との対応は ${name} による大まかな類比で、公式な換算ではありません。`,
      source: "出典", profileKind: "種別", founded: "設立", size: "規模", none: "この学校のレベル資料はまだありません。",
      summary: (focus: string, range: string, band: string, analogy: string) => `${focus}の偏差値は ${range}、「${band}」の帯（${analogy}）。`,
      schoolRange: (range: string) => `全学部 ${range}`,
    },
    years: (count: number) => `${count}年`, man: "万円", byYears: (count: number) => `${count}年分`,
    daysLeft: (days: number) => days === 0 ? "本日締切" : `残り${days}日`, closed: "締切済み", noDeadline: "今後の締切なし",
    overdue: "前提手続きの期限切れ", loading: "候補校を読み込んでいます…", indexing: "資料の索引を同期中です。完了すると表示されます。",
    failed: "候補校を読み込めませんでした", retry: "再試行", empty: "候補校はまだありません",
    emptyDetail: "Vault の 40_大学院/ に type: graduate-school の学校ノートを作るとここに表示されます。大学院資料はこの端末だけにあり、公開スナップショットには含まれません。",
    notIndexed: "現在の資料版には大学院の索引がありません。資料を再同期すると表示されます。",
    syncing: "資料を更新中です。前回の完全な版を表示しています。", syncFailed: "更新は未完了です。前回の完全な版を表示しています。",
    issues: (count: number) => `大学院資料に ${count} 件の形式エラーがあり、該当ルートは一覧に出ていません：`,
    back: "候補校", routes: "この学校のルート", now: "今やること", nowEvent: "次の予定", nothingLeft: "このルートに残っている予定はありません。",
    overdueTitle: "前提手続きの期限が過ぎ、完了記録がありません", overdueHelp: "手続きが済んでいるか確認してください。済んだらノートの該当ステップに done_on を書くと表示が消えます。",
    materials: "提出書類", method: "提出方法", openSource: "公式ページ", sections: "このページ",
    apply: "出願と書類", fees: "学位と学費", exam: "試験と対策", sources: "出典", levelNav: "大学のレベル",
    fit: "出願資格と適合", fitHint: "AI の判断を含む（署名は本文）",
    kinds: { prerequisite: "事前手続き", application: "出願", exam: "試験・面談", result: "発表", enrollment: "入学手続" } satisfies Record<GraduateStepKind, string>,
    states: { done: "完了", closed: "終了", open: "受付中", upcoming: "未開始", undated: "学校の期日なし" },
    optional: "推奨", doneOn: "完了日",
    degree: "学位", duration: "年限", entry: "入学", firstYear: "初年度", annual: "2年目以降（毎年）", total: "卒業までの概算",
    feeBasis: "算出の前提", yen: "円", feeSource: "学費表",
    exams: "試験科目", prep: "対策資料", openPrep: "対策を開く：過去問の要約と練習方法", closePrep: "対策を閉じる", prepLoading: "対策資料を読み込んでいます…",
    prepFailed: "対策資料を読み込めませんでした", noPrep: "このルートの対策資料はまだありません。",
    indicators: { ranking: "ランキング", deviation: "偏差値", employment: "就職" }, indicatorSource: "出典を見る", checkedOn: "資料の確認日", openNote: "学校ノートを開く",
    detailLoading: "学校の資料を読み込んでいます…", detailFailed: "学校の資料を読み込めませんでした", notFound: "この学校またはルートが見つかりません",
    detailIssues: "学校ノートの形式に誤りがあるため、一覧の簡易情報だけを表示しています。",
    deadlineTypes: { "必着": "締切日までに到着していること", "消印有効": "締切日の消印まで有効", "期限内必着": "期限内に到着していること" } satisfies Record<GraduateDeadlineType, string>,
  },
};
/** 测试与页面共用同一份文言，断言不必另抄一遍。 */
export const GRADUATE_COPY = COPY;
type Copy = typeof COPY["zh-CN"];

type GraduateViewProps = {
  revision?: number;
  onOpenSource: (path: string, revision?: string) => void;
  onOpenWiki: (target: string, section?: string) => void;
};

/** 候选表：只读 D1 投影；外壳推进 revision（回到页面、按 R 重读）时重取，取到之前保留上一版。 */
function useGraduateCatalog(refreshVersion: number | undefined) {
  const [attempt, setAttempt] = useState(0);
  const key = `${refreshVersion ?? 0}:${attempt}`;
  const [result, setResult] = useState<{ key: string; page: GraduateCatalogPage | null; error: string }>({ key: "", page: null, error: "" });
  useEffect(() => {
    const controller = new AbortController();
    void readReadModelJSON<GraduateCatalogPage>("/api/graduate/catalog", controller.signal, fetch,
      (progress) => { if (!controller.signal.aborted) setResult({ key: `${key}:building`, page: progress, error: "" }); })
      .then((page) => { if (!controller.signal.aborted) setResult({ key, page, error: "" }); })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setResult((current) => ({ key, page: current.page, error: error instanceof Error ? error.message : "资料读取失败" }));
      });
    return () => controller.abort();
  }, [key]);
  return { page: result.page, error: result.error, loading: result.key !== key, retry: useCallback(() => setAttempt((value) => value + 1), []) };
}

/** 学校正文和备考都沿用候选表的 revision 按需读取，不能拿另一版正文配这一版的期限。 */
function useNoteAtRevision(path: string | null, revision: string | undefined) {
  const [attempt, setAttempt] = useState(0);
  const key = path && revision ? `${revision}:${path}:${attempt}` : "";
  const [result, setResult] = useState<{ key: string; note: Note | null; error: boolean }>({ key: "", note: null, error: false });
  useEffect(() => {
    if (!path || !revision) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]);
    const requestKey = `${revision}:${path}:${attempt}`;
    void readNoteDetail(path, revision, signal)
      .then(({ note }) => { if (!controller.signal.aborted) setResult({ key: requestKey, note, error: false }); })
      .catch(() => { if (!controller.signal.aborted) setResult({ key: requestKey, note: null, error: true }); });
    return () => controller.abort();
  }, [path, revision, attempt]);
  const current = result.key === key;
  return { note: current ? result.note : null, error: current && result.error, loading: Boolean(key) && !current, retry: useCallback(() => setAttempt((value) => value + 1), []) };
}

function jstToday() {
  return tokyoParts().date;
}

function DeadlineTag({ type, t }: { type?: GraduateDeadlineType; t: Copy }) {
  return type ? <span className="graduate-deadline-type" title={t.deadlineTypes[type]}>{type}</span> : null;
}

function DeadlineCell({ route, today, locale, t }: { route: GraduateCatalogRoute; today: string; locale: UiLocale; t: Copy }) {
  const next = nextGraduateDeadline(route.steps, today);
  const overdue = overdueGraduatePrerequisites(route.steps, today);
  return <div className="graduate-next">
    {next ? <>
      <strong><time dateTime={next.due}>{graduateDateLabel(next.due!, locale, today)}</time><DeadlineTag type={next.deadlineType} t={t} /></strong>
      <span>{next.label}</span>
      <small data-urgent={graduateDaysUntil(next.due!, today) <= 7 || undefined}>{t.daysLeft(graduateDaysUntil(next.due!, today))}</small>
    </> : <span className="graduate-muted">{t.noDeadline}</span>}
    {overdue.length > 0 && <em className="graduate-overdue-flag">{t.overdue}：{overdue.map((step) => step.label).join("、")}</em>}
  </div>;
}

function examShort(exam: string) {
  return exam.replace(/[（(].*$/, "").trim() || exam;
}

const SCALE_MIN = 35, SCALE_MAX = 65;
/** 河合塾每档宽 2.5：37.5 表示 37.5～39.9，所以条形画到 high＋2.5。35.0 一档实际是「37.4 以下」，画在最左端。 */
function scaleSpan(low: number, high: number) {
  const left = (Math.max(SCALE_MIN, low) - SCALE_MIN) / (SCALE_MAX - SCALE_MIN) * 100;
  const right = (Math.min(SCALE_MAX, high + 2.5) - SCALE_MIN) / (SCALE_MAX - SCALE_MIN) * 100;
  return { left: `${left}%`, width: `${Math.max(1, right - left)}%` };
}

type ScaleRow = { key: string; name: string; note: string; low: number; high: number; schoolLow?: number; schoolHigh?: number; candidate: boolean; current: boolean };

/** 候选校与参照校排在同一把偏差值尺上：数字和档位都直接写在行上，颜色只区分「候选／参照」。 */
export function LevelScale({ reference, schools, current, locale, t }: {
  reference: GraduateReference; schools: GraduateCatalogSchool[]; current?: string; locale: UiLocale; t: Copy;
}) {
  const rows: ScaleRow[] = [
    ...reference.anchors.map((anchor) => ({ key: `anchor:${anchor.name}`, name: anchor.name, note: anchor.note, low: anchor.low, high: anchor.high, candidate: false, current: false })),
    ...schools.filter((school) => school.level).map((school) => ({ key: `school:${school.id}`, name: locale === "ja" ? school.name : school.nameZh, note: school.level!.focus,
      low: school.level!.focusLow, high: school.level!.focusHigh, schoolLow: school.level!.schoolLow, schoolHigh: school.level!.schoolHigh, candidate: true, current: school.id === current })),
  ].sort((left, right) => right.high - left.high || right.low - left.low || Number(left.candidate) - Number(right.candidate));
  const zones = reference.bands.map((band, index) => ({ band, low: band.min, high: index === 0 ? SCALE_MAX - 2.5 : reference.bands[index - 1].min - 2.5 }));
  const ticks = [35, 40, 45, 50, 55, 60, 65];
  return <figure className="graduate-scale">
    <figcaption><strong>{t.level.title}</strong><span>{t.level.subtitle}</span></figcaption>
    <div className="graduate-scale-grid" role="table" aria-label={t.level.title}>
      <div className="graduate-scale-row graduate-scale-head" role="row">
        <span role="columnheader" />
        <div className="graduate-scale-track" role="columnheader">
          {zones.map(({ band, low, high }) => <span key={band.label} className="graduate-scale-zone" style={scaleSpan(low, high)}><b>{band.label}</b></span>)}
        </div>
        <span role="columnheader">{t.level.deviation}</span>
      </div>
      {rows.map((row) => {
        // 参照校跨好几档时写「中段～中上」，不能只按最高那个学部归档。
        const band = graduateBand(reference.bands, row.high), lowBand = graduateBand(reference.bands, row.low);
        const bandLabel = band && lowBand && lowBand.label !== band.label ? `${lowBand.label}～${band.label}` : band?.label ?? "";
        const range = graduateDeviationRange(row.low, row.high);
        return <div key={row.key} className="graduate-scale-row" role="row" data-candidate={row.candidate || undefined} data-current={row.current || undefined}>
          <span className="graduate-scale-name" role="rowheader">
            <strong>{row.name}</strong>
            <small>{row.candidate && <em>{t.level.candidate}</em>}{row.note}</small>
          </span>
          <div className="graduate-scale-track" role="cell">
            {zones.map(({ band: zone, low, high }) => <i key={zone.label} className="graduate-scale-bg" style={scaleSpan(low, high)} />)}
            {row.schoolLow !== undefined && row.schoolHigh !== undefined && <span className="graduate-scale-school" style={scaleSpan(row.schoolLow, row.schoolHigh)} title={t.level.schoolRange(graduateDeviationRange(row.schoolLow, row.schoolHigh))} />}
            <span className="graduate-scale-bar" style={scaleSpan(row.low, row.high)} title={`${row.name}：${t.level.deviation} ${range}${bandLabel ? `（${bandLabel}）` : ""}`} />
          </div>
          <span className="graduate-scale-value" role="cell"><strong>{range}</strong>{bandLabel && <small>{bandLabel}</small>}</span>
        </div>;
      })}
      <div className="graduate-scale-row graduate-scale-axis" aria-hidden="true">
        <span />
        <div className="graduate-scale-track">{ticks.map((tick) => <span key={tick} style={{ left: `${(tick - SCALE_MIN) / (SCALE_MAX - SCALE_MIN) * 100}%` }}>{tick}</span>)}</div>
        <span />
      </div>
    </div>
    <dl className="graduate-scale-bands">
      {reference.bands.map((band) => <div key={band.label}><dt>{band.label}<span>{band.min === SCALE_MIN ? "35.0" : `≥ ${band.min.toFixed(1)}`}</span></dt><dd>{band.analogy}</dd></div>)}
    </dl>
    <ul className="graduate-scale-notes">
      <li>{t.level.lowest}</li>
      <li>{t.level.analogyBy(reference.analogyAuthor)}</li>
      {reference.notes.filter((note) => !note.includes("37.4") && !note.includes("类比")).map((note) => <li key={note}>{note}</li>)}
      <li>{t.level.source}：{reference.sourceUrl ? <a href={reference.sourceUrl} target="_blank" rel="noreferrer">{reference.sourceLabel} ↗</a> : reference.sourceLabel}（{reference.checkedOn}）</li>
    </ul>
  </figure>;
}

function LevelCell({ school, reference }: { school: GraduateCatalogSchool; reference: GraduateReference | null }) {
  if (!school.level) return <span className="graduate-muted">—</span>;
  const band = reference ? graduateBand(reference.bands, school.level.focusHigh) : null;
  return <div className="graduate-level-cell">
    {band && <span className="graduate-level-band" data-band={band.label}>{band.label}</span>}
    {band && <span>{band.analogy}</span>}
    <small>{school.level.focus} {graduateDeviationRange(school.level.focusLow, school.level.focusHigh)}</small>
  </div>;
}

export function CandidateTable({ entries, reference, track, today, locale, t, onOpen }: {
  entries: GraduateCatalogEntry[]; reference: GraduateReference | null; track: GraduateTrackFilter; today: string; locale: UiLocale; t: Copy;
  onOpen: (event: MouseEvent<HTMLElement>, entry: GraduateCatalogEntry) => void;
}) {
  return <table className="graduate-table">
    <caption>{t.title}</caption>
    <thead><tr>
      <th scope="col">{t.columns.route}</th><th scope="col">{t.columns.level}</th><th scope="col">{t.columns.degree}</th><th scope="col">{t.columns.years}</th>
      <th scope="col" className="graduate-num">{t.columns.firstYear}</th><th scope="col" className="graduate-num">{t.columns.total}</th>
      <th scope="col">{t.columns.exams}</th><th scope="col">{t.columns.next}</th>
    </tr></thead>
    <tbody>
      {entries.map((entry) => {
        const { school, route } = entry;
        const href = appViewHref("graduate", graduateSearch({ track, school: school.id, route: route.id }));
        return <tr key={route.id} data-track={route.track} onClick={(event) => {
          // 行内的链接自己处理；点到空白处才走整行打开，按住修饰键时交给浏览器。
          if ((event.target as HTMLElement).closest("a")) return;
          onOpen(event, entry);
        }}>
          <th scope="row">
            <a href={href} onClick={(event) => onOpen(event, entry)}>
              <span className="graduate-school-name">{locale === "ja" ? school.name : school.nameZh}</span>
              <strong>{locale === "ja" ? route.label : route.labelZh}</strong>
            </a>
            <small>{locale === "ja" ? route.entry : route.label}</small>
          </th>
          <td><LevelCell school={school} reference={reference} /></td>
          <td><span className={`graduate-track-badge ${route.track}`}>{t.tracks[route.track]}</span><span className="graduate-degree">{route.degree}</span></td>
          <td className="graduate-years">{t.years(route.years)}</td>
          <td className="graduate-num"><strong>{graduateManYen(route.fees.firstYear)}</strong><small>{t.man}</small></td>
          <td className="graduate-num"><strong>{graduateManYen(graduateTotalFee(route))}</strong><small>{t.byYears(route.years)}</small></td>
          <td><ul className="graduate-exam-chips">{route.exams.map((exam) => <li key={exam} title={exam}>{examShort(exam)}</li>)}</ul></td>
          <td><DeadlineCell route={route} today={today} locale={locale} t={t} /></td>
        </tr>;
      })}
    </tbody>
  </table>;
}

function SectionMarkdown({ content, onOpenWiki }: { content?: string; onOpenWiki: (target: string, section?: string) => void }) {
  if (!content?.trim()) return null;
  return <div className="graduate-md"><MarkdownDocument content={content} onWikiLink={onOpenWiki} /></div>;
}

function StepDate({ step, locale, today }: { step: GraduateCatalogStep; locale: UiLocale; today: string }) {
  if (step.start && step.due) return <><time dateTime={step.start}>{graduateDateLabel(step.start, locale, today)}</time><span aria-hidden="true"> – </span><time dateTime={step.due}>{graduateDateLabel(step.due, locale, today)}</time></>;
  const date = step.due ?? step.on;
  return date ? <time dateTime={date}>{graduateDateLabel(date, locale, today)}</time> : null;
}

function StepMaterials({ step, t }: { step: GraduateStep; t: Copy }) {
  if (!step.materials.length && !step.method && !step.note && !step.url) return null;
  return <div className="graduate-step-extra">
    {step.materials.length > 0 && <ul className="graduate-materials" aria-label={t.materials}>
      {step.materials.map((material) => <li key={material.label}>{material.url
        ? <a href={material.url} target="_blank" rel="noreferrer">{material.label}<span aria-hidden="true"> ↗</span></a>
        : <span>{material.label}</span>}</li>)}
    </ul>}
    {step.method && <p><b>{t.method}</b>{step.method}</p>}
    {step.note && <p>{step.note}</p>}
    {step.url && <a className="graduate-source-link" href={step.url} target="_blank" rel="noreferrer">{t.openSource} ↗</a>}
  </div>;
}

function CurrentTask({ route, fullRoute, today, locale, t, onShowPrep }: {
  route: GraduateCatalogRoute; fullRoute: GraduateRoute | null; today: string; locale: UiLocale; t: Copy; onShowPrep: (() => void) | null;
}) {
  const overdue = overdueGraduatePrerequisites(route.steps, today);
  const deadline = nextGraduateDeadline(route.steps, today);
  const step = deadline ?? nextGraduateEvent(route.steps, today);
  const full = step && fullRoute?.steps.find((item) => item.id === step.id);
  const days = step && (step.due ?? step.on) ? graduateDaysUntil((step.due ?? step.on)!, today) : null;
  return <section className="graduate-now" aria-label={t.now}>
    {overdue.length > 0 && <div className="graduate-overdue" role="alert">
      <strong>{t.overdueTitle}</strong>
      <ul>{overdue.map((item) => <li key={item.id}>{item.label} · <StepDate step={item} locale={locale} today={today} /> <DeadlineTag type={item.deadlineType} t={t} /></li>)}</ul>
      <p>{t.overdueHelp}</p>
    </div>}
    <div className="graduate-now-head">
      <span>{deadline ? t.now : t.nowEvent}</span>
      {onShowPrep && <button type="button" onClick={onShowPrep}>{t.prep} →</button>}
    </div>
    {step ? <>
      <h2>{step.label}</h2>
      <p className="graduate-now-date">
        <StepDate step={step} locale={locale} today={today} />
        <DeadlineTag type={step.deadlineType} t={t} />
        {days !== null && <small data-urgent={days <= 7 || undefined}>{t.daysLeft(days)}</small>}
      </p>
      {full && <StepMaterials step={full} t={t} />}
    </> : <p className="graduate-muted">{t.nothingLeft}</p>}
  </section>;
}

function StepTimeline({ route, fullRoute, today, locale, t }: { route: GraduateCatalogRoute; fullRoute: GraduateRoute | null; today: string; locale: UiLocale; t: Copy }) {
  return <ol className="graduate-steps">
    {route.steps.map((step) => {
      const state = graduateStepState(step, today);
      const full = fullRoute?.steps.find((item) => item.id === step.id);
      return <li key={step.id} data-state={state} data-kind={step.kind}>
        <div className="graduate-step-date">
          <StepDate step={step} locale={locale} today={today} />
          {!step.due && !step.on && <span className="graduate-muted">{t.states.undated}</span>}
        </div>
        <div className="graduate-step-body">
          <p className="graduate-step-title">
            <span className="graduate-step-kind">{t.kinds[step.kind]}</span>
            {step.round && <span className="graduate-step-round">{step.round}</span>}
            <strong>{step.label}</strong>
            <DeadlineTag type={step.deadlineType} t={t} />
            {step.optional && <span className="graduate-step-optional">{t.optional}</span>}
            {state !== "undated" && <span className="graduate-step-state" data-state={state}>{step.doneOn ? `${t.doneOn} ${step.doneOn}` : t.states[state]}</span>}
          </p>
          {full && <StepMaterials step={full} t={t} />}
        </div>
      </li>;
    })}
  </ol>;
}

function FeePanel({ route, fullRoute, t }: { route: GraduateCatalogRoute; fullRoute: GraduateRoute | null; t: Copy }) {
  const yen = (value: number) => `${value.toLocaleString("ja-JP")} ${t.yen}`;
  return <div className="graduate-fees">
    <dl>
      <div><dt>{t.degree}</dt><dd>{route.degree}</dd></div>
      <div><dt>{t.duration}</dt><dd>{t.years(route.years)}</dd></div>
      <div><dt>{t.firstYear}</dt><dd>{yen(route.fees.firstYear)}</dd></div>
      <div><dt>{t.annual}</dt><dd>{route.years > 1 ? yen(route.fees.annual) : "—"}</dd></div>
      <div className="graduate-fee-total"><dt>{t.total}</dt><dd><strong>{graduateManYen(graduateTotalFee(route))}</strong> {t.man}<small>{yen(graduateTotalFee(route))}</small></dd></div>
    </dl>
    {fullRoute?.fees.basis && <p className="graduate-fee-basis"><b>{t.feeBasis}</b>{fullRoute.fees.basis}{fullRoute.fees.url && <> · <a href={fullRoute.fees.url} target="_blank" rel="noreferrer">{t.feeSource} ↗</a></>}</p>}
  </div>;
}

export function SchoolDetail({ school, route, schools, reference, revision, today, locale, t, onSelectRoute, onBack, onOpenSource, onOpenWiki }: {
  school: GraduateCatalogSchool; route: GraduateCatalogRoute; schools: GraduateCatalogSchool[]; reference: GraduateReference | null;
  revision: string; today: string; locale: UiLocale; t: Copy;
  onSelectRoute: (routeId: string) => void; onBack: () => void;
  onOpenSource: (path: string, revision?: string) => void; onOpenWiki: (target: string, section?: string) => void;
}) {
  const detail = useNoteAtRevision(school.path, revision);
  const [prepOpen, setPrepOpen] = useState(false);
  const prep = useNoteAtRevision(prepOpen ? route.prepPath : null, revision);
  const parsed = useMemo(() => detail.note ? parseGraduateSchool(detail.note) : null, [detail.note]);
  const fullSchool: GraduateSchool | null = parsed?.school ?? null;
  const fullRoute = fullSchool?.routes.find((item) => item.id === route.id) ?? null;
  const sections = useMemo(() => detail.note && fullSchool ? graduateNoteSections(detail.note.content, fullSchool.routes.map((item) => item.label)) : null, [detail.note, fullSchool]);
  const routeSections = sections?.routes.get(route.label);
  const showPrep = route.prepPath ? () => {
    setPrepOpen(true);
    window.requestAnimationFrame?.(() => document.getElementById("graduate-exam")?.scrollIntoView({ block: "start" }));
  } : null;

  return <article className="graduate-detail" aria-labelledby="graduate-detail-title">
    <div className="graduate-detail-bar">
      <button type="button" className="graduate-back" onClick={onBack}>← {t.back}</button>
      <nav aria-label={t.routes} className="graduate-route-tabs">
        {school.routes.map((item) => <button type="button" key={item.id} aria-pressed={item.id === route.id} onClick={() => onSelectRoute(item.id)}>
          <span className={`graduate-track-badge ${item.track}`}>{t.tracks[item.track]}</span>{locale === "ja" ? item.label : item.labelZh}
        </button>)}
      </nav>
    </div>
    <header className="graduate-hero">
      <div className="graduate-hero-title">
        <small>{locale === "ja" ? school.name : `${school.nameZh} · ${school.name}`}</small>
        <h1 id="graduate-detail-title">{locale === "ja" ? route.label : route.labelZh}</h1>
        <p>{locale === "ja" ? route.entry : `${route.label} · ${route.entry}`}</p>
        <dl className="graduate-hero-facts">
          <div><dt>{t.degree}</dt><dd>{route.degree}</dd></div>
          <div><dt>{t.duration}</dt><dd>{t.years(route.years)}</dd></div>
          <div><dt>{t.firstYear}</dt><dd>{graduateManYen(route.fees.firstYear)} {t.man}</dd></div>
          <div><dt>{t.total}</dt><dd>{graduateManYen(graduateTotalFee(route))} {t.man}</dd></div>
        </dl>
      </div>
      <CurrentTask route={route} fullRoute={fullRoute} today={today} locale={locale} t={t} onShowPrep={showPrep} />
    </header>
    {detail.loading && <p className="graduate-status" role="status">{t.detailLoading}</p>}
    {detail.error && <p className="graduate-status" role="alert">{t.detailFailed}<button type="button" onClick={detail.retry}>{t.retry}</button></p>}
    {parsed && !fullSchool && <p className="graduate-status" role="alert">{t.detailIssues}</p>}
    <nav className="graduate-section-nav" aria-label={t.sections}>
      <a href="#graduate-level">{t.levelNav}</a><a href="#graduate-apply">{t.apply}</a><a href="#graduate-fees">{t.fees}</a><a href="#graduate-exam">{t.exam}</a><a href="#graduate-sources">{t.sources}</a>
    </nav>
    <section id="graduate-level" className="graduate-section">
      <h2>{t.level.section}</h2>
      {fullSchool?.profile && <dl className="graduate-profile">
        <div><dt>{t.level.profileKind}</dt><dd>{fullSchool.profile.kind}</dd></div>
        <div><dt>{t.level.founded}</dt><dd>{fullSchool.profile.founded}</dd></div>
        <div><dt>{t.level.size}</dt><dd>{fullSchool.profile.size}{fullSchool.profile.url && <> <a href={fullSchool.profile.url} target="_blank" rel="noreferrer">{t.indicatorSource} ↗</a></>}</dd></div>
      </dl>}
      {school.level && reference ? (() => {
        const band = graduateBand(reference.bands, school.level.focusHigh);
        return <p className="graduate-level-summary">
          {band && t.level.summary(school.level.focus, graduateDeviationRange(school.level.focusLow, school.level.focusHigh), band.label, band.analogy)}
          <span>{t.level.schoolRange(graduateDeviationRange(school.level.schoolLow, school.level.schoolHigh))}{school.level.url && <> · <a href={school.level.url} target="_blank" rel="noreferrer">{t.indicatorSource} ↗</a></>}</span>
        </p>;
      })() : <p className="graduate-muted">{t.level.none}</p>}
      {reference && <LevelScale reference={reference} schools={schools} current={school.id} locale={locale} t={t} />}
    </section>
    <section id="graduate-apply" className="graduate-section">
      <h2>{t.apply}</h2>
      <StepTimeline route={route} fullRoute={fullRoute} today={today} locale={locale} t={t} />
      {routeSections?.get("出愿资格与匹配") && <details className="graduate-fit" open>
        <summary>{t.fit}<small>{t.fitHint}</small></summary>
        <SectionMarkdown content={routeSections.get("出愿资格与匹配")} onOpenWiki={onOpenWiki} />
      </details>}
      <SectionMarkdown content={routeSections?.get("出愿与材料")} onOpenWiki={onOpenWiki} />
    </section>
    <section id="graduate-fees" className="graduate-section">
      <h2>{t.fees}</h2>
      <FeePanel route={route} fullRoute={fullRoute} t={t} />
      <SectionMarkdown content={routeSections?.get("学位与费用")} onOpenWiki={onOpenWiki} />
    </section>
    <section id="graduate-exam" className="graduate-section">
      <h2>{t.exam}</h2>
      <ul className="graduate-exam-list" aria-label={t.exams}>{route.exams.map((exam) => <li key={exam}>{exam}</li>)}</ul>
      <SectionMarkdown content={routeSections?.get("考试与备考")} onOpenWiki={onOpenWiki} />
      <div className="graduate-prep">
        {route.prepPath ? <>
          <button type="button" aria-expanded={prepOpen} onClick={() => setPrepOpen((open) => !open)}>{prepOpen ? t.closePrep : t.openPrep}</button>
          {prepOpen && prep.loading && <p className="graduate-status" role="status">{t.prepLoading}</p>}
          {prepOpen && prep.error && <p className="graduate-status" role="alert">{t.prepFailed}<button type="button" onClick={prep.retry}>{t.retry}</button></p>}
          {prepOpen && prep.note && <div className="graduate-prep-body">
            <div className="graduate-prep-head"><strong>{t.prep}</strong><button type="button" onClick={() => onOpenSource(prep.note!.path, revision)}>{t.openNote} ↗</button></div>
            <SectionMarkdown content={prep.note.content} onOpenWiki={onOpenWiki} />
          </div>}
        </> : <p className="graduate-muted">{t.noPrep}</p>}
      </div>
    </section>
    <section id="graduate-sources" className="graduate-section">
      <h2>{t.sources}</h2>
      {fullSchool && fullSchool.indicators.length > 0 && <dl className="graduate-indicators">
        {fullSchool.indicators.map((indicator) => <div key={`${indicator.kind}:${indicator.label}`}>
          <dt>{t.indicators[indicator.kind]}<span>{indicator.label}</span></dt>
          <dd><strong>{indicator.value}</strong><p>{indicator.scope}</p>{indicator.url && <a href={indicator.url} target="_blank" rel="noreferrer">{t.indicatorSource} ↗</a>}</dd>
        </div>)}
      </dl>}
      <SectionMarkdown content={sections?.school.get("学校口径")} onOpenWiki={onOpenWiki} />
      <SectionMarkdown content={sections?.school.get("出处")} onOpenWiki={onOpenWiki} />
      <p className="graduate-checked">{t.checkedOn}：{school.checkedOn} JST<button type="button" onClick={() => onOpenSource(school.path, revision)}>{t.openNote} ↗</button></p>
    </section>
  </article>;
}

export default function GraduateView({ revision: refreshVersion, onOpenSource, onOpenWiki }: GraduateViewProps) {
  const { locale } = useUiLocale();
  const t = COPY[locale];
  const initialSearch = useInitialUrlSearch();
  const [location, setLocation] = useState<GraduateLocation>(() => graduateLocationFromSearch(initialSearch));
  const catalog = useGraduateCatalog(refreshVersion);
  const page = catalog.page;
  const today = page?.today ?? jstToday();

  // 前进／后退和外壳在同页 pushState（再点左栏「大学院」）时，以地址栏为准。
  useEffect(() => {
    const sync = () => { if (window.location.pathname === appViewHref("graduate")) setLocation(graduateLocationFromSearch(window.location.search)); };
    window.addEventListener("popstate", sync);
    window.addEventListener(URL_CHANGE_EVENT, sync);
    return () => { window.removeEventListener("popstate", sync); window.removeEventListener(URL_CHANGE_EVENT, sync); };
  }, []);

  const write = useCallback((next: GraduateLocation, mode: "push" | "replace") => {
    const search = graduateSearch(next, window.location.search).toString();
    const href = `${window.location.pathname}${search ? `?${search}` : ""}`;
    if (mode === "push") window.history.pushState({ ...(window.history.state ?? {}), __echoGraduateDetail: next.school }, "", href);
    else window.history.replaceState({ ...(window.history.state ?? {}), ...(next.school ? {} : { __echoGraduateDetail: null }) }, "", href);
    setLocation(next);
  }, []);

  const entries = useMemo(() => page ? graduateCatalogEntries(page, location.track) : [], [page, location.track]);
  const counts = useMemo(() => Object.fromEntries(GRADUATE_TRACK_FILTERS.map((track) => [track, page ? graduateCatalogEntries(page, track).length : 0])) as Record<GraduateTrackFilter, number>, [page]);
  const school = location.school ? page?.schools.find((item) => item.id === location.school) ?? null : null;
  const route = school ? school.routes.find((item) => item.id === location.route) ?? school.routes.find((item) => location.track === "all" || item.track === location.track) ?? school.routes[0] ?? null : null;

  const openEntry = (event: MouseEvent<HTMLElement>, entry: GraduateCatalogEntry) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    // 进详情是「去了新地方」：压一条历史，浏览器返回键回到同一筛选的列表。
    write({ track: location.track, school: entry.school.id, route: entry.route.id }, "push");
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  };
  const backToList = () => {
    if (window.history.state?.__echoGraduateDetail === location.school) { window.history.back(); return; }
    write({ track: location.track, school: "", route: "" }, "replace");
  };

  if (!page && catalog.error) return <div className="graduate-status-page" role="alert"><h1>{t.failed}</h1><p>{catalog.error}</p><button type="button" onClick={catalog.retry}>{t.retry}</button></div>;
  if (!page) return <div className="graduate-status-page" role="status">{t.loading}</div>;

  const banner = catalog.error || page.syncState === "failed" ? t.syncFailed : page.syncState === "building" ? t.syncing : "";
  const notices = <>
    {banner && <div className="graduate-sync" role="status"><span>{banner}</span><button type="button" onClick={catalog.retry}>{t.retry}</button></div>}
    {page.issues.length > 0 && <div className="graduate-issues" role="alert">
      <strong>{t.issues(page.issues.length)}</strong>
      <ul>{page.issues.map((issue) => <li key={`${issue.path}:${issue.message}`}><button type="button" onClick={() => onOpenSource(issue.path, page.revision)}>{issue.path}</button>{issue.message}</li>)}</ul>
    </div>}
  </>;

  // 资料版本早于大学院投影时，「没有」只是索引还没建好：不能显示成空列表或「找不到学校」。
  const notIndexed = !page.indexed && <div className="graduate-status-page" role="status"><h2>{page.syncState === "building" ? t.indexing : t.notIndexed}</h2><button type="button" onClick={catalog.retry}>{t.retry}</button></div>;

  if (location.school) {
    if (notIndexed) return <section className="graduate-workspace" aria-label={t.module}>{notices}{notIndexed}</section>;
    if (!school || !route) return <section className="graduate-workspace">{notices}<div className="graduate-status-page"><h1>{t.notFound}</h1><button type="button" onClick={backToList}>{t.back}</button></div></section>;
    return <section className="graduate-workspace" aria-label={t.module}>
      {notices}
      <SchoolDetail key={`${school.id}:${route.id}`} school={school} route={route} schools={page.schools} reference={page.reference ?? null} revision={page.revision} today={today} locale={locale} t={t}
        onSelectRoute={(routeId) => write({ ...location, route: routeId }, "replace")} onBack={backToList} onOpenSource={onOpenSource} onOpenWiki={onOpenWiki} />
    </section>;
  }

  return <section className="graduate-workspace" aria-label={t.module}>
    <header className="graduate-list-head">
      <div><small>{t.module}</small><h1>{t.title}</h1></div>
      <div className="graduate-toolbar" role="group" aria-label={t.trackLabel}>
        {GRADUATE_TRACK_FILTERS.map((track) => <button type="button" key={track} aria-pressed={location.track === track} onClick={() => write({ track, school: "", route: "" }, "replace")}>
          {t.tracks[track]}<span>{counts[track]}</span>
        </button>)}
      </div>
      <p className="graduate-today">JST {graduateDateLabel(today, locale)}{catalog.loading && <span className="graduate-refreshing" aria-hidden="true" />}</p>
    </header>
    {notices}
    {notIndexed || (page.schools.length === 0 ? <div className="graduate-status-page"><h2>{t.empty}</h2><p>{t.emptyDetail}</p></div>
      : <>
        <CandidateTable entries={entries} reference={page.reference ?? null} track={location.track} today={today} locale={locale} t={t} onOpen={openEntry} />
        {page.reference && <section className="graduate-level-panel" aria-label={t.level.title}><LevelScale reference={page.reference} schools={page.schools} locale={locale} t={t} /></section>}
      </>)}
  </section>;
}
