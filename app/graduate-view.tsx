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
  graduateApplicationDates,
  graduateAssessmentScore,
  graduateBand,
  graduateBandLabel,
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
  GRADUATE_ASSESSMENT_RUBRIC,
  nextGraduateDeadline,
  nextGraduateEvent,
  overdueGraduatePrerequisites,
  parseGraduateSchool,
  sortGraduateEntries,
  type GraduateCatalogAssessment,
  type GraduateCatalogEntry,
  type GraduateCatalogPage,
  type GraduateCatalogRoute,
  type GraduateCatalogSchool,
  type GraduateCatalogStep,
  type GraduateDeadlineType,
  type GraduateLocation,
  type GraduateReference,
  type GraduateRegionFilter,
  type GraduateRoute,
  type GraduateSchool,
  type GraduateStep,
  type GraduateStepKind,
  type GraduateTrackFilter,
  type GraduateWorldRank,
} from "@/lib/graduate";
import { tokyoParts } from "@/lib/dojo/utils";
import type { Note } from "@/lib/notes";
import type { UiLocale } from "@/lib/ui-locale";

const COPY = {
  "zh-CN": {
    module: "大学院", title: "大学院申请", tracks: { master: "修士", bachelor: "本科", all: "全部" }, trackLabel: "学位类型",
    columns: { school: "学校", program: "专业", schoolProgram: "学校与专业", level: "学校水平", assessment: "申请适合度与判断", cost: "学制与费用", admission: "入试与材料", deadline: "最早截止日", result: "放榜日" },
    region: "地区", regions: { tokyo: "东京都", all: "全部地区" }, sort: "排序", sortFit: "适合度优先", sortDeadline: "截止日优先",
    assessment: { title: "对你申请的判断", score: "申请适合度", basis: "评分依据", meaning: "100 分制，表示准备优先级，不是录取概率。", context: "综合已确认的经历、语言准备、考试方式、申请条件和专业价值。条件未确认的路线会扣分，并单独标明；免笔试也不代表免专业问答。", strengths: "优势", risk: "门槛", missing: "尚未评估", author: "评估", recommendations: { priority: "优先准备", consider: "值得考虑", conditional: "有条件考虑", low: "暂不优先" } },
    filterEmpty: "这个筛选下暂无路线", filterEmptyHelp: "切换学位类型或选择全部地区，查看其他候选。",
    firstYearShort: "首年", totalShort: "全程约", materialsShort: "主要材料", levelLink: "学校层次对比",
    level: {
      section: "学校水平与依据", title: "学校层次怎么看", subtitle: "本科参照档采用河合塾 2027 年度相关学部的一般入试偏差值。细线是全校各学部的范围。",
      candidate: "候选", reference: "参照", focus: "相关学部", school: "全校各学部", deviation: "偏差值",
      undergraduate: "本科参照", band: (name: string) => `${name}档`, undergraduateValue: (range: string) => `本科偏差值 ${range}`,
      worldRank: (system: string, edition: number) => `${system} ${edition} 世界总榜`, worldMissing: "世界排名未查到",
      rankingScope: "世界总榜评价大学整体。学科榜评价学校在相应学科的表现。",
      kind: { national: "国立", public: "公立", private: "私立" }, listed: "文科省在册", registry: "文科省全国大学名录",
      guide: "参照档用来比较本科入试难度。学校设立性质以文科省名录为准，仅设大学院的学校可看专业认证和课程定位。",
      lowest: "35.0 是河合塾的最低一档，意思是「37.4 以下」。", analogyBy: (name: string) => `「约等于国内哪一档」是 ${name} 为建立概念做的粗略类比，日本没有批次线，不是官方换算。`,
      source: "数据来源", profileKind: "学校性质", founded: "创立", size: "规模",
      summary: (focus: string, range: string, band: string, analogy: string) => `${focus}偏差值 ${range}，属于「${band}」一档，${analogy}。`,
      rangeSummary: (focus: string, range: string, band: string) => `${focus}偏差值 ${range}，本科参照为「${band}」。`,
      schoolRange: (range: string) => `全校各学部 ${range}`,
      graduateOnly: "仅设大学院，无本科偏差值", pending: "暂无可比的本科偏差值",
    },
    years: (count: number) => `${count} 年`, man: "万日元", byYears: (count: number) => `按 ${count} 年计`,
    daysLeft: (days: number) => days === 0 ? "今天截止" : `还剩 ${days} 天`, closed: "已截止", noDeadline: "暂无后续截止",
    overdue: "前置期限已过", loading: "正在读取候选学校…", indexing: "资料索引正在同步，完成后自动显示。",
    failed: "候选学校暂时无法读取", retry: "重试", empty: "还没有候选学校",
    emptyDetail: "在 Vault 的 40_大学院/ 新建 type: graduate-school 的学校卷宗后会出现在这里。大学院资料只在本机，公开快照不包含。",
    notIndexed: "当前资料版本还没有大学院索引，重新同步资料后显示。",
    syncing: "资料正在更新，当前显示上一完整版本。", syncDelayed: "资料更新超时，当前显示上一完整版本。", syncFailed: "资料更新未完成，当前显示上一完整版本。",
    issues: (count: number) => `${count} 处大学院资料格式有误，相关路线未列入候选表：`,
    back: "候选学校", routes: "本校路线", now: "当前要做的事", nowEvent: "下一项日程", nothingLeft: "这条路线已没有待办的日程。",
    overdueTitle: "前置期限已过，没有完成记录", overdueHelp: "请核对这些前置手续是否已经办完；办完后在笔记该步骤加 done_on，提示就会消失。",
    materials: "要交的材料", method: "提交方式", openSource: "官方页面", sections: "本页内容",
    apply: "报名与材料", fees: "学位与费用", exam: "考试与备考", sources: "出处", levelNav: "学校层次",
    officialSources: "官方资料", renewal: "留学续签说明", difficulty: "申请难度", conditionalDeadline: "如需资格审查",
    fit: "出愿资格与匹配", fitHint: "含 AI 判断，署名见正文",
    kinds: { prerequisite: "前置手续", application: "报名", exam: "考试和面谈", result: "放榜", enrollment: "入学手续" } satisfies Record<GraduateStepKind, string>,
    states: { done: "已完成", closed: "已过", open: "进行中", upcoming: "未开始", undated: "无校方日期" },
    optional: "建议做", doneOn: "完成于",
    degree: "学位", duration: "学制", entry: "入学", firstYear: "首年", annual: "之后每年", total: "毕业前预计合计",
    feeBasis: "计算口径", yen: "円", feeSource: "学费表",
    exams: "考试科目", prep: "备考资料", openPrep: "展开备考：真题摘要与练习方法", closePrep: "收起备考", prepLoading: "正在读取备考资料…",
    prepFailed: "备考资料暂时无法读取", noPrep: "这条路线还没有备考资料。",
    indicators: { ranking: "排名", deviation: "偏差值", employment: "就业" }, indicatorSource: "查看来源", checkedOn: "资料核对日", openNote: "打开学校原笔记",
    detailLoading: "正在读取学校资料…", detailFailed: "学校资料暂时无法读取", notFound: "没有找到这所学校或路线",
    detailIssues: "学校卷宗格式有误，以下只显示候选表中的精简信息。",
    deadlineTypes: { "必着": "截止日当天必须送达", "消印有効": "截止日当天的邮戳有效", "期限内必着": "期限内必须送达", "Web締切": "网上提交截止" } satisfies Record<GraduateDeadlineType, string>,
    deadlineLabels: { "必着": "须送达", "消印有効": "邮戳有效", "期限内必着": "须在期限内送达", "Web締切": "网上截止" } satisfies Record<GraduateDeadlineType, string>,
  },
  ja: {
    module: "大学院", title: "候補校", tracks: { master: "修士", bachelor: "学部", all: "すべて" }, trackLabel: "学位の種類",
    columns: { school: "学校", program: "専攻", schoolProgram: "学校・専攻", level: "大学の目安", assessment: "出願適合度と所見", cost: "年限と学費", admission: "試験と書類", deadline: "最初の締切日", result: "合格発表日" },
    region: "地域", regions: { tokyo: "東京都", all: "全地域" }, sort: "並び順", sortFit: "適合度順", sortDeadline: "締切順",
    assessment: { title: "出願に関する所見", score: "出願適合度", basis: "採点の基準", meaning: "100点満点。準備の優先順位であり、合格確率ではありません。", context: "確認できた経験・語学力・試験方式・出願条件・専攻の価値を総合評価。未確認の条件は減点し、別途明示します。筆記免除でも専門の口頭試問はあり得ます。", strengths: "強み", risk: "課題", missing: "未評価", author: "評価", recommendations: { priority: "優先して準備", consider: "検討候補", conditional: "条件確認が必要", low: "優先度は低い" } },
    filterEmpty: "この条件に合うルートはありません", filterEmptyHelp: "学位または地域の条件を変えてください。",
    firstYearShort: "初年度", totalShort: "総額目安", materialsShort: "主な書類", levelLink: "大学レベルの比較",
    level: {
      section: "大学の目安と根拠", title: "大学のレベルの目安", subtitle: "河合塾の2027年度学部一般選抜ボーダー偏差値。候補校は関連学部、細線は全学部の範囲。",
      candidate: "候補", reference: "参照", focus: "関連学部", school: "全学部", deviation: "偏差値",
      undergraduate: "学部入試の目安", band: (name: string) => name, undergraduateValue: (range: string) => `学部偏差値 ${range}`,
      worldRank: (system: string, edition: number) => `${system} ${edition} 世界総合`, worldMissing: "世界総合の順位未確認",
      rankingScope: "総合は大学全体の評価です。分野別ランキングは各分野の実績を評価します。",
      kind: { national: "国立", public: "公立", private: "私立" }, listed: "文科省一覧掲載", registry: "文部科学省 全国大学一覧",
      guide: "偏差値帯は学部入試難易度の目安です。設置区分は文部科学省の一覧で、大学院大学の特色は認証評価と教育内容で確認できます。",
      lowest: "35.0 は河合塾の最低帯で「37.4以下」を表します。", analogyBy: (name: string) => `中国の合格ライン区分との対応は ${name} による大まかな類比で、公式な換算ではありません。`,
      source: "出典", profileKind: "種別", founded: "設立", size: "規模",
      summary: (focus: string, range: string, band: string, analogy: string) => `${focus}の偏差値は ${range}、「${band}」の帯（${analogy}）。`,
      rangeSummary: (focus: string, range: string, band: string) => `${focus}の偏差値は ${range}、「${band}」の帯です。`,
      schoolRange: (range: string) => `全学部 ${range}`,
      graduateOnly: "大学院のみ。学部偏差値なし", pending: "比較できる学部偏差値なし",
    },
    years: (count: number) => `${count}年`, man: "万円", byYears: (count: number) => `${count}年分`,
    daysLeft: (days: number) => days === 0 ? "本日締切" : `残り${days}日`, closed: "締切済み", noDeadline: "今後の締切なし",
    overdue: "前提手続きの期限切れ", loading: "候補校を読み込んでいます…", indexing: "資料の索引を同期中です。完了すると表示されます。",
    failed: "候補校を読み込めませんでした", retry: "再試行", empty: "候補校はまだありません",
    emptyDetail: "Vault の 40_大学院/ に type: graduate-school の学校ノートを作るとここに表示されます。大学院資料はこの端末だけにあり、公開スナップショットには含まれません。",
    notIndexed: "現在の資料版には大学院の索引がありません。資料を再同期すると表示されます。",
    syncing: "資料を更新中です。前回の完全な版を表示しています。", syncDelayed: "資料の更新がタイムアウトしました。前回の完全な版を表示しています。", syncFailed: "更新は未完了です。前回の完全な版を表示しています。",
    issues: (count: number) => `大学院資料に ${count} 件の形式エラーがあり、該当ルートは一覧に出ていません：`,
    back: "候補校", routes: "この学校のルート", now: "今やること", nowEvent: "次の予定", nothingLeft: "このルートに残っている予定はありません。",
    overdueTitle: "前提手続きの期限が過ぎ、完了記録がありません", overdueHelp: "手続きが済んでいるか確認してください。済んだらノートの該当ステップに done_on を書くと表示が消えます。",
    materials: "提出書類", method: "提出方法", openSource: "公式ページ", sections: "このページ",
    apply: "出願と書類", fees: "学位と学費", exam: "試験と対策", sources: "出典", levelNav: "大学のレベル",
    officialSources: "公式資料", renewal: "「留学」の在留期間更新", difficulty: "入試の難易度", conditionalDeadline: "資格審査が必要な場合",
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
    deadlineTypes: { "必着": "締切日までに到着していること", "消印有効": "締切日の消印まで有効", "期限内必着": "期限内に到着していること", "Web締切": "オンラインでの提出期限" } satisfies Record<GraduateDeadlineType, string>,
    deadlineLabels: { "必着": "必着", "消印有効": "消印有効", "期限内必着": "期限内必着", "Web締切": "Web締切" } satisfies Record<GraduateDeadlineType, string>,
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
    // 全量索引每次只导入两批，可能超过通用目录的一分钟等待时间。
    void readReadModelJSON<GraduateCatalogPage>("/api/graduate/catalog", controller.signal, fetch,
      (progress) => { if (!controller.signal.aborted) setResult({ key: `${key}:building`, page: progress, error: "" }); },
      { retryBudgetMs: 180_000, pollDelayMs: 500 })
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
  return type ? <span className="graduate-deadline-type" title={t.deadlineTypes[type]}>{t.deadlineLabels[type]}</span> : null;
}

function stepLabel(step: GraduateCatalogStep, locale: UiLocale) {
  return locale === "zh-CN" ? step.labelZh ?? step.label : step.label;
}

const SCALE_MIN = 35, SCALE_MAX = 65;
/** 河合塾每档宽 2.5：37.5 表示 37.5～39.9，所以条形画到 high＋2.5。35.0 一档实际是「37.4 以下」，画在最左端。 */
function scaleSpan(low: number, high: number) {
  const left = (Math.max(SCALE_MIN, low) - SCALE_MIN) / (SCALE_MAX - SCALE_MIN) * 100;
  const right = (Math.min(SCALE_MAX, high + 2.5) - SCALE_MIN) / (SCALE_MAX - SCALE_MIN) * 100;
  return { left: `${left}%`, width: `${Math.max(1, right - left)}%` };
}

type ScaleRow = { key: string; name: string; note: string; low: number; high: number; schoolLow?: number; schoolHigh?: number; candidate: boolean; current: boolean; url?: string; worldRank?: GraduateWorldRank };

function SchoolWorldRank({ rank, t }: { rank?: GraduateWorldRank; t: Copy }) {
  if (!rank) return <small className="graduate-world-rank-missing">{t.level.worldMissing}</small>;
  return <a className="graduate-world-rank" href={rank.url} target="_blank" rel="noreferrer">
    {t.level.worldRank(rank.system, rank.edition)} <b>{rank.rank}</b>
  </a>;
}

function schoolPositioning(school: GraduateCatalogSchool, locale: UiLocale) {
  const positioning = school.institution?.positioning;
  if (!positioning) return null;
  return locale === "ja" ? { label: positioning.label, evidence: positioning.evidence, url: positioning.url }
    : { label: positioning.labelZh, evidence: positioning.evidenceZh, url: positioning.url };
}

/** 候选校与参照校排在同一把偏差值尺上：数字和档位都直接写在行上，颜色只区分「候选／参照」。 */
export function LevelScale({ reference, schools, current, locale, t }: {
  reference: GraduateReference; schools: GraduateCatalogSchool[]; current?: string; locale: UiLocale; t: Copy;
}) {
  const candidateNames = new Set(schools.map((school) => school.name));
  const rows: ScaleRow[] = [
    ...reference.anchors.filter((anchor) => !candidateNames.has(anchor.name)).map((anchor) => ({ key: `anchor:${anchor.name}`, name: anchor.name, note: anchor.note, low: anchor.low, high: anchor.high, candidate: false, current: false, url: anchor.url })),
    ...schools.filter((school) => school.level).map((school) => ({ key: `school:${school.id}`, name: locale === "ja" ? school.name : school.nameZh, note: school.level!.focus,
      low: school.level!.focusLow, high: school.level!.focusHigh, schoolLow: school.level!.schoolLow, schoolHigh: school.level!.schoolHigh, candidate: true, current: school.id === current, url: school.level!.url, worldRank: school.worldRankings?.[0] })),
  ].sort((left, right) => right.high - left.high || right.low - left.low || Number(left.candidate) - Number(right.candidate));
  const zones = reference.bands.map((band, index) => ({ band, low: band.min, high: index === 0 ? SCALE_MAX - 2.5 : reference.bands[index - 1].min - 2.5 }));
  const ticks = [35, 40, 45, 50, 55, 60, 65];
  return <figure className="graduate-scale">
    <figcaption><strong>{t.level.title}</strong><span>{t.level.subtitle}</span></figcaption>
    <div className="graduate-scale-grid" role="table" aria-label={t.level.title}>
      <div className="graduate-scale-row graduate-scale-head" role="row">
        <span role="columnheader" />
        <div className="graduate-scale-track" role="columnheader">
          {zones.map(({ band, low, high }) => <span key={band.label} className="graduate-scale-zone" style={scaleSpan(low, high)}><b>{locale === "ja" ? band.labelJa ?? band.label : band.label}</b></span>)}
        </div>
        <span role="columnheader">{t.level.deviation}</span>
      </div>
      {rows.map((row) => {
        // 参照校跨好几档时写「中段～中上」，不能只按最高那个学部归档。
        const bandLabel = graduateBandLabel(reference.bands, row.low, row.high, locale);
        const range = graduateDeviationRange(row.low, row.high);
        return <div key={row.key} className="graduate-scale-row" role="row" data-candidate={row.candidate || undefined} data-current={row.current || undefined}>
          <span className="graduate-scale-name" role="rowheader">
            <strong>{row.name}</strong>
            <small>{row.candidate && <em>{t.level.candidate}</em>}{row.note}</small>
            {row.worldRank && <SchoolWorldRank rank={row.worldRank} t={t} />}
          </span>
          <div className="graduate-scale-track" role="cell">
            {zones.map(({ band: zone, low, high }) => <i key={zone.label} className="graduate-scale-bg" style={scaleSpan(low, high)} />)}
            {row.schoolLow !== undefined && row.schoolHigh !== undefined && <span className="graduate-scale-school" style={scaleSpan(row.schoolLow, row.schoolHigh)} title={t.level.schoolRange(graduateDeviationRange(row.schoolLow, row.schoolHigh))} />}
            <span className="graduate-scale-bar" style={scaleSpan(row.low, row.high)} title={`${row.name}：${t.level.deviation} ${range}${bandLabel ? `（${bandLabel}）` : ""}`} />
          </div>
          <span className="graduate-scale-value" role="cell">
            <strong>{row.url ? <a href={row.url} aria-label={`${row.name} · ${t.level.deviation} ${range}`} target="_blank" rel="noreferrer">{range}</a> : range}</strong>
            {bandLabel && <small>{bandLabel}</small>}
          </span>
        </div>;
      })}
      <div className="graduate-scale-row graduate-scale-axis" aria-hidden="true">
        <span />
        <div className="graduate-scale-track">{ticks.map((tick) => <span key={tick} style={{ left: `${(tick - SCALE_MIN) / (SCALE_MAX - SCALE_MIN) * 100}%` }}>{tick}</span>)}</div>
        <span />
      </div>
      {schools.filter((school) => !school.level).map((school) => {
        const positioning = schoolPositioning(school, locale);
        return <div key={school.id} className="graduate-scale-row graduate-scale-unrated" role="row" data-candidate="true" data-current={school.id === current || undefined}>
          <span className="graduate-scale-name" role="rowheader">
            <strong>{locale === "ja" ? school.name : school.nameZh}</strong>
            {school.worldRankings?.[0] && <SchoolWorldRank rank={school.worldRankings[0]} t={t} />}
          </span>
          <span role="cell">{positioning ? <>{positioning.label} · <a href={positioning.url} target="_blank" rel="noreferrer">{positioning.evidence} ↗</a></>
            : school.graduateOnly ? t.level.graduateOnly : t.level.pending}</span>
          <span role="cell">{school.institution ? <a href={school.institution.registryUrl} target="_blank" rel="noreferrer">{t.level.listed} ↗</a> : "—"}</span>
        </div>;
      })}
    </div>
    <dl className="graduate-scale-bands">
      {reference.bands.map((band) => <div key={band.label}><dt>{locale === "ja" ? band.labelJa ?? band.label : band.label}<span>{band.min === SCALE_MIN ? "35.0" : `≥ ${band.min.toFixed(1)}`}</span></dt><dd>{band.analogy}</dd></div>)}
    </dl>
    <ul className="graduate-scale-notes">
      <li>{t.level.guide}</li>
      <li>{t.level.lowest}</li>
      <li>{t.level.analogyBy(reference.analogyAuthor)}</li>
      {reference.notes.filter((note) => !note.includes("37.4") && !note.includes("类比")).map((note) => <li key={note}>{note}</li>)}
      <li>{t.level.source}：{reference.sourceUrl ? <a href={reference.sourceUrl} target="_blank" rel="noreferrer">{reference.sourceLabel} ↗</a> : reference.sourceLabel}（{reference.checkedOn}）</li>
    </ul>
  </figure>;
}

function SchoolLevelCell({ school, reference, locale, t }: { school: GraduateCatalogSchool; reference: GraduateReference | null; locale: UiLocale; t: Copy }) {
  const { level, institution, graduateOnly } = school;
  const worldRank = school.worldRankings?.[0];
  const positioning = schoolPositioning(school, locale);
  const band = level && reference ? graduateBandLabel(reference.bands, level.focusLow, level.focusHigh, locale) : null;
  const label = band ? t.level.band(band) : level ? t.level.undergraduate
    : positioning?.label ?? (graduateOnly ? t.level.graduateOnly : worldRank ? null : t.level.pending);
  return <div className="graduate-school-level">
    <SchoolWorldRank rank={worldRank} t={t} />
    {label && <strong>{label}</strong>}
    {level && <span title={level.focus}>{t.level.undergraduateValue(graduateDeviationRange(level.focusLow, level.focusHigh))}</span>}
    {positioning && <span>{level ? positioning.label : positioning.evidence}</span>}
    {institution && <small>{t.level.kind[institution.kind]} · {t.level.listed}</small>}
  </div>;
}

function SchoolIndicators({ indicators, t }: { indicators: GraduateSchool["indicators"]; t: Copy }) {
  if (indicators.length === 0) return null;
  return <dl className="graduate-indicators">
    {indicators.map((indicator) => <div key={`${indicator.kind}:${indicator.label}`}>
      <dt>{t.indicators[indicator.kind]}<span>{indicator.label}</span></dt>
      <dd><strong>{indicator.value}</strong><p>{indicator.scope}</p>{indicator.url && <a href={indicator.url} target="_blank" rel="noreferrer">{t.indicatorSource} ↗</a>}</dd>
    </div>)}
  </dl>;
}

function RouteCost({ route, t }: { route: GraduateCatalogRoute; t: Copy }) {
  return <div className="graduate-route-cost">
    <strong>{t.years(route.years)}</strong>
    {route.fees && <>
      <span>{t.firstYearShort} <span className="graduate-cost-amount">{graduateManYen(route.fees.firstYear)} {t.man}</span></span>
      <span>{t.totalShort} <span className="graduate-cost-amount">{graduateManYen(graduateTotalFee({ years: route.years, fees: route.fees }))} {t.man}</span></span>
    </>}
  </div>;
}

function RouteAdmission({ route, locale, t }: { route: GraduateCatalogRoute; locale: UiLocale; t: Copy }) {
  const exams = locale === "zh-CN" ? route.examsZh ?? route.exams : route.exams;
  const requirements = locale === "zh-CN" ? route.requirementsZh ?? route.requirements : route.requirements;
  return <div className="graduate-route-admission">
    <span>{exams.length > 0 ? exams.join(" · ") : "—"}</span>
    {requirements && <small>{t.materialsShort} · {requirements}</small>}
  </div>;
}

function AssessmentSummary({ assessment, t }: { assessment?: GraduateCatalogAssessment; t: Copy }) {
  const score = graduateAssessmentScore(assessment);
  if (!assessment || score === null) return <span className="graduate-muted">{t.assessment.missing}</span>;
  return <div className="graduate-assessment" data-recommendation={assessment.recommendation}>
    <div className="graduate-assessment-heading">
      <span className="graduate-score" aria-label={`${t.assessment.score} ${score}/100`}><strong>{score}</strong><span>/100</span></span>
      <strong className="graduate-recommendation">{t.assessment.recommendations[assessment.recommendation]}</strong>
    </div>
    <p className="graduate-assessment-summary">{assessment.summaryZh}</p>
    <p className="graduate-assessment-strengths"><b>{t.assessment.strengths}</b>{assessment.strengthsZh}</p>
    <p className="graduate-assessment-risk"><b>{t.assessment.risk}</b>{assessment.riskZh}</p>
  </div>;
}

function AssessmentBasis({ t, locale, assessment }: { t: Copy; locale: UiLocale; assessment?: GraduateCatalogAssessment }) {
  return <details className="graduate-assessment-basis">
    <summary>{t.assessment.basis}</summary>
    <p>{t.assessment.meaning}</p>
    <dl>{GRADUATE_ASSESSMENT_RUBRIC.map((dimension) => <div key={dimension.key}>
      <dt>{locale === "ja" ? dimension.labelJa : dimension.labelZh}</dt>
      <dd>{assessment ? `${assessment.scores[dimension.key]} / ${dimension.max}` : dimension.max}</dd>
    </div>)}</dl>
    <p>{t.assessment.context}</p>
    {assessment && <p>{assessment.author} · {t.assessment.author} {assessment.assessedOn}</p>}
  </details>;
}

export function CandidateTable({ entries, reference, track, region = "all", sort = "fit", today, locale, t, onOpen }: {
  entries: GraduateCatalogEntry[]; reference: GraduateReference | null; track: GraduateTrackFilter; region?: GraduateRegionFilter; sort?: "fit" | "deadline"; today: string; locale: UiLocale; t: Copy;
  onOpen: (event: MouseEvent<HTMLElement>, entry: GraduateCatalogEntry) => void;
}) {
  const rows = sortGraduateEntries(entries, today, sort).map((entry) => ({ entry, ...graduateApplicationDates(entry.route.steps, today) }));
  return <div className="graduate-table-wrap"><table className="graduate-table">
    <caption>{t.title}</caption>
    <thead><tr>
      <th scope="col" className="graduate-col-school">{t.columns.schoolProgram}</th>
      <th scope="col" className="graduate-col-level">{t.columns.level}</th>
      <th scope="col" className="graduate-col-assessment" aria-sort={sort === "fit" ? "descending" : undefined}>{t.columns.assessment}</th>
      <th scope="col" className="graduate-col-cost graduate-wide-column">{t.columns.cost}</th><th scope="col" className="graduate-col-admission graduate-wide-column">{t.columns.admission}</th>
      <th scope="col" className="graduate-col-date graduate-deadline-column" aria-sort={sort === "deadline" ? "ascending" : undefined}>{t.columns.deadline}</th><th scope="col" className="graduate-col-date graduate-result-column">{t.columns.result}</th>
    </tr></thead>
    <tbody>
      {rows.map(({ entry, deadline, result }) => {
        const { school, route } = entry;
        const conditional = deadline?.due && route.shortlisted ? route.steps.find((step) =>
          step.optional && step.kind === "prerequisite" && step.round === deadline.round && step.due &&
          step.due >= today && step.due < deadline.due!) : undefined;
        const schoolName = locale === "ja" ? school.name : school.nameZh;
        const program = locale === "ja" ? route.label : route.labelZh;
        const href = appViewHref("graduate", graduateSearch({ track, region, school: school.id, route: route.id }));
        return <tr key={route.id} data-track={route.track} onClick={(event) => {
          if ((event.target as HTMLElement).closest("a")) return;
          onOpen(event, entry);
        }}>
          <th scope="row"><a className="graduate-school-link" href={href} aria-label={`${schoolName} · ${program}`} onClick={(event) => onOpen(event, entry)}>{schoolName}</a>
            <span className="graduate-program">{program}</span>
            {region === "all" && school.location && <small className="graduate-location">{school.location}</small>}
            <div className="graduate-compact-column"><RouteCost route={route} t={t} /><RouteAdmission route={route} locale={locale} t={t} /></div>
          </th>
          <td><SchoolLevelCell school={school} reference={reference} locale={locale} t={t} /></td>
          <td><AssessmentSummary assessment={route.assessment} t={t} /></td>
          <td className="graduate-wide-column"><RouteCost route={route} t={t} /></td>
          <td className="graduate-wide-column"><RouteAdmission route={route} locale={locale} t={t} /></td>
          <td className="graduate-date-cell graduate-deadline-column">
            {deadline?.due ? <time dateTime={deadline.due}>{deadline.due.replaceAll("-", "/")}</time> : <span className="graduate-muted">{t.noDeadline}</span>}
            {conditional?.due && <small className="graduate-conditional">{t.conditionalDeadline} <time dateTime={conditional.due}>{conditional.due.replaceAll("-", "/")}</time></small>}
          </td>
          <td className="graduate-date-cell graduate-result-column">{result?.on ? <time dateTime={result.on}>{result.on.replaceAll("-", "/")}</time> : <span className="graduate-muted">—</span>}</td>
        </tr>;
      })}
    </tbody>
  </table></div>;
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
  const deadline = route.shortlisted ? graduateApplicationDates(route.steps, today).deadline : nextGraduateDeadline(route.steps, today);
  const step = deadline ?? nextGraduateEvent(route.steps, today);
  const full = step && fullRoute?.steps.find((item) => item.id === step.id);
  const days = step && (step.due ?? step.on) ? graduateDaysUntil((step.due ?? step.on)!, today) : null;
  return <section className="graduate-now" aria-label={t.now}>
    {overdue.length > 0 && <div className="graduate-overdue" role="alert">
      <strong>{t.overdueTitle}</strong>
      <ul>{overdue.map((item) => <li key={item.id}>{stepLabel(item, locale)} · <StepDate step={item} locale={locale} today={today} /> <DeadlineTag type={item.deadlineType} t={t} /></li>)}</ul>
      <p>{t.overdueHelp}</p>
    </div>}
    <div className="graduate-now-head">
      <span>{deadline ? t.now : t.nowEvent}</span>
      {onShowPrep && <button type="button" onClick={onShowPrep}>{t.prep} →</button>}
    </div>
    {step ? <>
      <h2>{stepLabel(step, locale)}</h2>
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
            <strong>{stepLabel(step, locale)}</strong>
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

function FeePanel({ route, fullRoute, degree, t }: { route: GraduateCatalogRoute; fullRoute: GraduateRoute | null; degree: string; t: Copy }) {
  const fees = route.fees;
  if (!fees) return null;
  const yen = (value: number) => `${value.toLocaleString("ja-JP")} ${t.yen}`;
  return <div className="graduate-fees">
    <dl>
      <div><dt>{t.degree}</dt><dd>{degree}</dd></div>
      <div><dt>{t.duration}</dt><dd>{t.years(route.years)}</dd></div>
      <div><dt>{t.firstYear}</dt><dd>{yen(fees.firstYear)}</dd></div>
      <div><dt>{t.annual}</dt><dd>{route.years > 1 ? yen(fees.annual) : "—"}</dd></div>
      <div className="graduate-fee-total"><dt>{t.total}</dt><dd><strong>{graduateManYen(graduateTotalFee({ years: route.years, fees }))}</strong> {t.man}<small>{yen(graduateTotalFee({ years: route.years, fees }))}</small></dd></div>
    </dl>
    {fullRoute?.fees?.basis && <p className="graduate-fee-basis"><b>{t.feeBasis}</b>{fullRoute.fees.basis}{fullRoute.fees.url && <> · <a href={fullRoute.fees.url} target="_blank" rel="noreferrer">{t.feeSource} ↗</a></>}</p>}
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
  const officialSources = [sections?.school.get("官方资料"), routeSections?.get("官方资料")].filter(Boolean);
  const degree = locale === "zh-CN" ? route.degreeZh ?? route.degree : route.degree;
  const entry = locale === "zh-CN" ? route.entryZh ?? route.entry : route.entry;
  const difficulty = routeSections?.get("申请难度");
  const renewal = routeSections?.get("续签说明") ?? sections?.school.get("续签说明");
  const positioning = schoolPositioning(school, locale);
  const rankings = fullSchool?.indicators.filter((item) => item.kind === "ranking") ?? [];
  const showLevel = !route.shortlisted || Boolean(school.worldRankings?.length || school.level || school.institution || school.graduateOnly || fullSchool?.profile || rankings.length);
  const showFees = Boolean(route.fees || routeSections?.get("学位与费用"));
  const showExam = !route.shortlisted || Boolean(route.exams.length || route.prepPath || routeSections?.get("考试与备考"));
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
        <small>{locale === "ja" ? school.name : school.nameZh}</small>
        <h1 id="graduate-detail-title">{locale === "ja" ? route.label : route.labelZh}</h1>
        <p>{entry}</p>
        <dl className="graduate-hero-facts">
          <div><dt>{t.degree}</dt><dd>{degree}</dd></div>
          <div><dt>{t.duration}</dt><dd>{t.years(route.years)}</dd></div>
          {route.fees && <>
            <div><dt>{t.firstYear}</dt><dd>{graduateManYen(route.fees.firstYear)} {t.man}</dd></div>
            <div><dt>{t.total}</dt><dd>{graduateManYen(graduateTotalFee({ years: route.years, fees: route.fees }))} {t.man}</dd></div>
          </>}
        </dl>
      </div>
      <CurrentTask route={route} fullRoute={fullRoute} today={today} locale={locale} t={t} onShowPrep={showPrep} />
    </header>
    {detail.loading && <p className="graduate-status" role="status">{t.detailLoading}</p>}
    {detail.error && <p className="graduate-status" role="alert">{t.detailFailed}<button type="button" onClick={detail.retry}>{t.retry}</button></p>}
    {parsed && !fullSchool && <p className="graduate-status" role="alert">{t.detailIssues}</p>}
    {route.assessment && <section className="graduate-section graduate-assessment-detail" aria-labelledby="graduate-assessment-title">
      <h2 id="graduate-assessment-title">{t.assessment.title}</h2>
      <AssessmentSummary assessment={route.assessment} t={t} />
      <AssessmentBasis t={t} locale={locale} assessment={route.assessment} />
      {fullRoute?.assessment?.sources && fullRoute.assessment.sources.length > 0 && <p className="graduate-assessment-sources">
        {fullRoute.assessment.sources.map((source) => source.url && <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a>)}
      </p>}
    </section>}
    {officialSources.length > 0 && <section className="graduate-official" aria-labelledby="graduate-official-title">
      <h2 id="graduate-official-title">{t.officialSources}</h2>
      <div className="graduate-official-links">
        {officialSources.map((content) => <SectionMarkdown key={content} content={content} onOpenWiki={onOpenWiki} />)}
      </div>
    </section>}
    {renewal && <section id="graduate-renewal" className="graduate-section graduate-renewal">
      <h2>{t.renewal}</h2>
      <SectionMarkdown content={renewal} onOpenWiki={onOpenWiki} />
    </section>}
    <nav className="graduate-section-nav" aria-label={t.sections}>
      {difficulty && <a href="#graduate-difficulty">{t.difficulty}</a>}
      {showLevel && <a href="#graduate-level">{t.levelNav}</a>}
      <a href="#graduate-apply">{t.apply}</a>
      {showFees && <a href="#graduate-fees">{t.fees}</a>}
      {showExam && <a href="#graduate-exam">{t.exam}</a>}
      <a href="#graduate-sources">{t.sources}</a>
    </nav>
    {difficulty && <section id="graduate-difficulty" className="graduate-section">
      <h2>{t.difficulty}</h2>
      <SectionMarkdown content={difficulty} onOpenWiki={onOpenWiki} />
    </section>}
    {showLevel && <section id="graduate-level" className="graduate-section">
      <h2>{t.level.section}</h2>
      <div className="graduate-world-rank-detail">
        {school.worldRankings?.length ? school.worldRankings.map((rank) => <SchoolWorldRank key={rank.system} rank={rank} t={t} />)
          : <SchoolWorldRank t={t} />}
        <span>{t.level.rankingScope}</span>
      </div>
      <SchoolIndicators indicators={rankings} t={t} />
      {school.institution && <div className="graduate-institution-evidence">
        <p><strong>{t.level.kind[school.institution.kind]}</strong><a href={school.institution.registryUrl} target="_blank" rel="noreferrer">{t.level.registry} ↗</a></p>
        {positioning && <p><strong>{positioning.label}</strong><a href={positioning.url} target="_blank" rel="noreferrer">{positioning.evidence} ↗</a></p>}
      </div>}
      {fullSchool?.profile && <dl className="graduate-profile">
        <div><dt>{t.level.profileKind}</dt><dd>{fullSchool.profile.kind}</dd></div>
        <div><dt>{t.level.founded}</dt><dd>{fullSchool.profile.founded}</dd></div>
        <div><dt>{t.level.size}</dt><dd>{fullSchool.profile.size}{fullSchool.profile.url && <> <a href={fullSchool.profile.url} target="_blank" rel="noreferrer">{t.indicatorSource} ↗</a></>}</dd></div>
      </dl>}
      <SectionMarkdown content={sections?.school.get("学校水平依据")} onOpenWiki={onOpenWiki} />
      {school.level ? (() => {
        const { level } = school;
        const range = graduateDeviationRange(level.focusLow, level.focusHigh);
        const bands = reference?.bands ?? [];
        const band = graduateBand(bands, level.focusLow);
        const bandLabel = graduateBandLabel(bands, level.focusLow, level.focusHigh, locale);
        let summary = `${level.focus} · ${t.level.undergraduateValue(range)}`;
        if (bandLabel) summary = t.level.rangeSummary(level.focus, range, bandLabel);
        if (band && bandLabel && band === graduateBand(bands, level.focusHigh)) summary = t.level.summary(level.focus, range, bandLabel, band.analogy);
        return <p className="graduate-level-summary">
          {summary}
          <span>{t.level.schoolRange(graduateDeviationRange(level.schoolLow, level.schoolHigh))}{level.url && <> · <a href={level.url} target="_blank" rel="noreferrer">{t.indicatorSource} ↗</a></>}</span>
        </p>;
      })() : school.graduateOnly && <p className="graduate-muted">{t.level.graduateOnly}</p>}
      {reference && <LevelScale reference={reference} schools={schools} current={school.id} locale={locale} t={t} />}
    </section>}
    <section id="graduate-apply" className="graduate-section">
      <h2>{t.apply}</h2>
      <StepTimeline route={route} fullRoute={fullRoute} today={today} locale={locale} t={t} />
      {routeSections?.get("出愿资格与匹配") && <details className="graduate-fit" open>
        <summary>{t.fit}<small>{t.fitHint}</small></summary>
        <SectionMarkdown content={routeSections.get("出愿资格与匹配")} onOpenWiki={onOpenWiki} />
      </details>}
      <SectionMarkdown content={routeSections?.get("出愿与材料")} onOpenWiki={onOpenWiki} />
    </section>
    {showFees && <section id="graduate-fees" className="graduate-section">
      <h2>{t.fees}</h2>
      <FeePanel route={route} fullRoute={fullRoute} degree={degree} t={t} />
      <SectionMarkdown content={routeSections?.get("学位与费用")} onOpenWiki={onOpenWiki} />
    </section>}
    {showExam && <section id="graduate-exam" className="graduate-section">
      <h2>{t.exam}</h2>
      <ul className="graduate-exam-list" aria-label={t.exams}>{(locale === "zh-CN" ? route.examsZh ?? route.exams : route.exams).map((exam) => <li key={exam}>{exam}</li>)}</ul>
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
    </section>}
    <section id="graduate-sources" className="graduate-section">
      <h2>{t.sources}</h2>
      {fullSchool && <SchoolIndicators indicators={fullSchool.indicators.filter((item) => item.kind !== "ranking")} t={t} />}
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
  const [sort, setSort] = useState<"fit" | "deadline">("fit");
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

  const entries = useMemo(() => page ? graduateCatalogEntries(page, location.track, location.region) : [], [page, location.track, location.region]);
  const counts = useMemo(() => Object.fromEntries(GRADUATE_TRACK_FILTERS.map((track) => [track, page ? graduateCatalogEntries(page, track, location.region).length : 0])) as Record<GraduateTrackFilter, number>, [page, location.region]);
  const school = location.school ? page?.schools.find((item) => item.id === location.school) ?? null : null;
  const route = school ? school.routes.find((item) => item.id === location.route) ?? entries.find((entry) => entry.school.id === school.id)?.route ?? school.routes[0] ?? null : null;

  const openEntry = (event: MouseEvent<HTMLElement>, entry: GraduateCatalogEntry) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    // 进详情是「去了新地方」：压一条历史，浏览器返回键回到同一筛选的列表。
    write({ ...location, school: entry.school.id, route: entry.route.id }, "push");
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  };
  const backToList = () => {
    if (window.history.state?.__echoGraduateDetail === location.school) { window.history.back(); return; }
    write({ ...location, school: "", route: "" }, "replace");
  };

  if (!page && catalog.error) return <div className="graduate-status-page" role="alert"><h1>{t.failed}</h1><p>{catalog.error}</p><button type="button" onClick={catalog.retry}>{t.retry}</button></div>;
  if (!page) return <div className="graduate-status-page" role="status">{t.loading}</div>;

  const banner = catalog.error || page.syncState === "failed" ? t.syncFailed
    : page.syncState === "building" ? (catalog.loading ? t.syncing : t.syncDelayed) : "";
  const notices = <>
    {banner && <div className="graduate-sync" role="status"><span>{banner}</span><button type="button" onClick={catalog.retry}>{t.retry}</button></div>}
    {page.issues.length > 0 && <div className="graduate-issues" role="alert">
      <strong>{t.issues(page.issues.length)}</strong>
      <ul>{page.issues.map((issue) => <li key={`${issue.path}:${issue.message}`}><button type="button" onClick={() => onOpenSource(issue.path, page.revision)}>{issue.path}</button>{issue.message}</li>)}</ul>
    </div>}
  </>;

  // 资料版本早于大学院投影时，「没有」只是索引还没建好：不能显示成空列表或「找不到学校」。
  const notIndexed = !page.indexed && <div className="graduate-status-page" role="status"><h2>{page.syncState === "building" && catalog.loading ? t.indexing : t.notIndexed}</h2><button type="button" onClick={catalog.retry}>{t.retry}</button></div>;

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
      <h1>{t.title}</h1>
      <div className="graduate-toolbar" role="group" aria-label={t.trackLabel}>
        {GRADUATE_TRACK_FILTERS.map((track) => <button type="button" key={track} aria-pressed={location.track === track} onClick={() => write({ ...location, track, school: "", route: "" }, "replace")}>
          {t.tracks[track]}<span>{counts[track]}</span>
        </button>)}
      </div>
      <label className="graduate-select">{t.region}<select value={location.region} onChange={(event) => write({ ...location, region: event.target.value as GraduateRegionFilter, school: "", route: "" }, "replace")}>
        <option value="tokyo">{t.regions.tokyo}</option><option value="all">{t.regions.all}</option>
      </select></label>
      <label className="graduate-select">{t.sort}<select value={sort} onChange={(event) => setSort(event.target.value as "fit" | "deadline")}>
        <option value="fit">{t.sortFit}</option><option value="deadline">{t.sortDeadline}</option>
      </select></label>
    </header>
    <div className="graduate-list-context">
      <span>{t.assessment.meaning}</span>
      <AssessmentBasis t={t} locale={locale} />
      <p className="graduate-today">JST {graduateDateLabel(today, locale)}{catalog.loading && <span className="graduate-refreshing" aria-hidden="true" />}</p>
      {page.reference && entries.length > 0 && <a className="graduate-level-jump" href="#graduate-level-compare">{t.levelLink}</a>}
    </div>
    {notices}
    {notIndexed || (entries.length === 0 ? <div className="graduate-status-page"><h2>{page.schools.length ? t.filterEmpty : t.empty}</h2><p>{page.schools.length ? t.filterEmptyHelp : t.emptyDetail}</p></div>
      : <>
        <CandidateTable entries={entries} reference={page.reference} track={location.track} region={location.region} sort={sort} today={today} locale={locale} t={t} onOpen={openEntry} />
        {page.reference && <section id="graduate-level-compare" className="graduate-level-panel" aria-label={t.level.title}>
          <LevelScale reference={page.reference} schools={page.schools.filter((school) => entries.some((entry) => entry.school.id === school.id))} locale={locale} t={t} />
        </section>}
      </>)}
  </section>;
}
