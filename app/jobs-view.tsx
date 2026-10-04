"use client";

import ScopeLoading from "./scope-loading";
import {
  memo,
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  compareJobs,
  elapsedLabel,
  rateText,
  rateTone,
  salaryLabel,
  shortDay,
  intakeLabel,
  intakeRelative,
  isJobStatus,
  jobIntake,
  jobMatchesFilters,
  jobMatchesRatingBands,
  jobFitAccess,
  jobFitBand,
  jobFitGate,
  jobStatTileFilters,
  jobStatTilePools,
  jobTouch,
  jobWaitsOnCounterpart,
  EMPTY_JOB_FILTERS,
  JOB_STAT_TILES,
  JOB_TOUCHES,
  UNRATED_FIT,
  type JobBoardFilters,
  type JobFilterKey,
  type JobStatTileId,
  type JobTouch,
  jobStatusNoteError,
  JOB_INTAKES,
  JOB_ORIGIN_LABEL,
  JOB_RATING_BANDS,
  JOB_SORTS,
  JOB_STATUSES,
  JOB_STATUS_NOTE_MAX,
  KNOWN_CHANNELS,
  normalizeDay,
  OFFICIAL_APPLY_LABEL,
  statusRequiresChannel,
  toJobCard,
  VERIFICATION_LABEL,
  WAITING_FOR_LABEL,
  type JobCard,
  type JobIntake,
  type JobRatingBand,
  type JobSort,
  type JobStatus,
  type JobVerification,
  awaitingCounterpart,
  SELECTION_STATUSES,
  statusTone,
  IN_PROGRESS_STATUSES,
  ACCESS_STATE_LABEL,
  HARD_GATE_LABEL,
  JOB_FIT_AXES,
  JOB_FIT_GATE_LABEL,
  JOB_FIT_SCORE_LABEL,
  UNRATED_V2_LABEL,
  type JobFit,
} from "@/lib/jobs";
import { ACCESS_STATE_VALUES, FIT_BANDS, HARD_GATE_VALUES } from "@/lib/job-case-schema";
import { isTypingTarget } from "@/lib/keyboard";
import { ConflictError, postJson } from "@/lib/client-api";
import { parseAppliedLedger } from "@/lib/job-stats.mjs";
import { opportunityAppliedOn } from "@/lib/job-opportunity";
import { JOB_CASE_TYPE } from "@/lib/vault-boundary.mjs";
import {
  formatDate,
  getString,
  getTitle,
  getType,
  noteBasename,
  type Note,
} from "@/lib/notes";
import { OPEN_NOTE_LABEL, changedToLabel } from "@/lib/ui-labels";
import MarkdownDocument from "./markdown-document";
import type { UndoAction } from "./undo-flash";
import { useDialogFocus } from "./use-dialog-focus";
import { URL_CHANGE_EVENT } from "./use-url-state";
import { useUiLocale } from "./ui-locale";

// 只翻译界面词与枚举的显示标签；筛选值和笔记正文始终沿用原始数据。
const JOB_MENU_COPY = {
  "岗位机会": ["岗位机会", "求人機会"],
  "决策台": ["决策台", "判断デスク"],
  "卡片": ["卡片", "カード"],
  "列表": ["列表", "リスト"],
  "看板": ["看板", "ボード"],
  "周复盘": ["周复盘", "週次レビュー"],
  "筛选条件": ["筛选条件", "絞り込み条件"],
  "组合筛选 · FILTERS": ["组合筛选 · FILTERS", "条件の組み合わせ · FILTERS"],
  "已启用 {count} 项": ["已启用 {count} 项", "有効な条件 {count} 件"],
  "默认只看未応募": ["默认只看未応募", "既定では未応募のみ"],
  "看板按状态分列，不受状态筛选影响": ["看板按状态分列，不受状态筛选影响", "ボードは状態ごとに並ぶため、状態の絞り込みは使いません"],
  "当前显示全部岗位": ["当前显示全部岗位", "すべての求人を表示中"],
  "恢复默认": ["恢复默认", "既定に戻す"],
  "应募状态": ["应募状态", "応募状況"],
  "动手状态": ["动手状态", "着手状況"],
  "等待": ["等待", "返答待ち"],
  "只看等对方": ["只看等对方", "相手の返答待ちのみ"],
  "入库时期": ["入库时期", "登録時期"],
  "応募优先度": ["应募优先度", "応募優先度"],
  "到達（v2）": ["到达（v2）", "到達（v2）"],
  "来源": ["来源", "求人の出典"],
  "年収上限": ["年薪上限", "年収上限"],
  "全部": ["全部", "すべて"],
  "リモート可": ["可远程", "リモート可"],
  "技術スタック": ["技术栈", "技術スタック"],
  "勤務地": ["工作地点", "勤務地"],
  "原文核对": ["原文核对", "原文確認"],
  "搜索公司、职位、技术栈、推荐理由…": ["搜索公司、职位、技术栈、推荐理由…", "会社・職種・技術・推薦理由を検索…"],
  "搜索推荐岗位": ["搜索推荐岗位", "求人機会を検索"],
  "清空搜索": ["清空搜索", "検索をクリア"],
  "排序": ["排序", "並び順"],
  "视图切换": ["视图切换", "表示切り替え"],
  "清空筛选": ["清空筛选", "条件をクリア"],
  "对比候选": ["对比候选", "比較候補"],
  "并排对比": ["并排对比", "並べて比較"],
  "岗位并排对比": ["岗位并排对比", "求人を並べて比較"],
  "清空": ["清空", "クリア"],
  "关闭提示": ["关闭提示", "通知を閉じる"],
  "关闭详情": ["关闭详情", "詳細を閉じる"],
  "关闭对比": ["关闭对比", "比較を閉じる"],
  "+{count} 更多": ["+{count} 更多", "+{count} 件を表示"],
  "收起": ["收起", "折りたたむ"],
  "写入中…": ["写入中…", "保存中…"],
  "投递渠道": ["投递渠道", "応募経路"],
  "投递渠道…": ["投递渠道…", "応募経路…"],
  "状态理由": ["状态理由", "状況の理由"],
  "给这个状态补一句理由": ["给这个状态补一句理由", "この状況の理由を追記"],
  "理由：{note}": ["理由：{note}", "理由：{note}"],
  "保存": ["保存", "保存"],
  "取消": ["取消", "キャンセル"],
  "最多同时对比 {count} 个岗位": ["最多同时对比 {count} 个岗位", "同時に比較できる求人は {count} 件まで"],
  "加入对比": ["加入对比", "比較に追加"],
  "已加入对比": ["已加入对比", "比較に追加済み"],
  "对比": ["对比", "比較"],
  "详情": ["详情", "詳細"],
  "官网直投 ↗": ["官网直投 ↗", "公式サイトから応募 ↗"],
  "官网相近职位 ↗": ["官网相近职位 ↗", "公式サイトの関連求人 ↗"],
  "官网招聘 ↗": ["官网招聘 ↗", "公式採用サイト ↗"],
  "官网应募 ↗": ["官网应募 ↗", "公式サイトから応募 ↗"],
  "查看求人原文 ↗": ["查看求人原文 ↗", "求人原文を見る ↗"],
  "求人票 ↗": ["求人票 ↗", "求人票 ↗"],
  [OPEN_NOTE_LABEL]: [OPEN_NOTE_LABEL, "原文ノートを開く"],
  "机会队列": ["机会队列", "求人候補一覧"],
  "待判断机会": ["待判断机会", "判断待ちの求人"],
  "上一周": ["上一周", "前の週"],
  "下一周": ["下一周", "次の週"],
  "本周复盘": ["本周复盘", "今週のレビュー"],
  "{count} 周前": ["{count} 周前", "{count} 週間前"],
  "{count} 周后": ["{count} 周后", "{count} 週間後"],
  "岗位详情": ["岗位详情", "求人詳細"],
  "案件推进": ["案件推进", "案件の進行"],
  "下一步与承诺": ["下一步与承诺", "次の行動と予定"],
  "等待对象": ["等待对象", "返答待ちの相手"],
  "跟进日期": ["跟进日期", "確認する日"],
  "下一场日程": ["下一场日程", "次回の日程"],
  "保存跟进": ["保存跟进", "確認予定を保存"],
  "没有外部等待": ["没有外部等待", "外部の返答待ちなし"],
  "本人": ["本人", "本人"],
  "企业": ["企业", "企業"],
  "中介": ["中介", "エージェント"],
  "平台": ["平台", "プラットフォーム"],
  "v2 採点（Fit）": ["v2 评分（Fit）", "v2 採点（Fit）"],
  "入库时间": ["入库时间", "登録日"],
  "応募日（古い順）": ["应募日期（最早在前）", "応募日（古い順）"],
  "更新时间": ["更新时间", "更新日時"],
  "公司名": ["公司名", "会社名"],
  "未着手": ["未着手", "未着手"],
  "已动手·等对方": ["已动手·等对方", "着手済み・相手の返答待ち"],
  "已动手 · 等对方": ["已动手 · 等对方", "着手済み・相手の返答待ち"],
  "7 分以上待判断": ["7 分以上待判断", "7 点以上・判断待ち"],
  "7 日内新增": ["7 日内新增", "7 日以内の新着"],
  "原文已核对": ["原文已核对", "原文確認済み"],
  "今日": ["今天", "今日"],
  "3日以内": ["3 日以内", "3日以内"],
  "7日以内": ["7 日以内", "7日以内"],
  "それ以前": ["更早", "それ以前"],
  "不明": ["不明", "不明"],
  "已核对": ["已核对", "確認済み"],
  "需确认": ["需确认", "要確認"],
  "未核对": ["未核对", "未確認"],
  "通过": ["通过", "通過"],
  "保留": ["保留", "保留"],
  "拒否": ["拒绝", "不可"],
  [UNRATED_V2_LABEL]: ["未评分（v2）", UNRATED_V2_LABEL],
  "企业已筛选": ["企业已筛选", "企業選定済み"],
  "直投": ["直投", "直接応募"],
  "企业已收": ["企业已收", "企業受領済み"],
  "未发送": ["未发送", "未送信"],
  "仅代理": ["仅代理", "エージェントのみ"],
  "下一项応募判断": ["下一项应募判断", "次に応募を判断する求人"],
  "当前岗位机会摘要（点击查看对应岗位）": ["当前岗位机会摘要（点击查看对应岗位）", "求人機会の概要（クリックして該当求人を表示）"],
  "只看这 {count} 条（替换当前全部筛选）": ["只看这 {count} 条（替换当前全部筛选）", "この {count} 件のみ表示（現在の条件を置き換え）"],
  "判断是否応募": ["判断是否应募", "応募するか判断"],
  "已记等待对象、且不是本人的案件（选考中・内定，或未応募但已动手）": ["已记等待对象、且不是本人的案件（选考中・内定，或未応募但已动手）", "本人以外の返答待ちの案件（選考中・内定、または未応募で着手済み）"],
  "未応募，本人还没动过手": ["未应募，本人还没动过手", "未応募で、本人は未着手"],
  "未応募，但已点过いいかも／回过スカウト，球在对方手里": ["未应募，但已点过いいかも／回过スカウト，球在对方手里", "未応募だが、いいかもやスカウト返信済みで相手の返答待ち"],
  "今天入库": ["今天入库", "今日登録"],
  "1〜3 天前入库": ["1〜3 天前入库", "1〜3 日前に登録"],
  "4〜7 天前入库": ["4〜7 天前入库", "4〜7 日前に登録"],
  "8 天以上之前": ["8 天以上之前", "8 日以上前"],
  "笔记里没写 date": ["笔记里没写 date", "ノートの date が未記入"],
  "7点以上をまとめて・応募すべき帯": ["7 分以上合并・值得应募", "7点以上をまとめて・応募すべき帯"],
  "9点以上・今週応募すべき": ["9 分以上・本周应募", "9点以上・今週応募すべき"],
  "8点台・応募すべき": ["8 分档・值得应募", "8点台・応募すべき"],
  "7点台・応募すべき": ["7 分档・值得应募", "7点台・応募すべき"],
  "6点台・応募可だが優先度低": ["6 分档・可应募但优先度低", "6点台・応募可だが優先度低"],
  "5点台・応募可だが優先度低": ["5 分档・可应募但优先度低", "5点台・応募可だが優先度低"],
  "4点以下・要確認事項が解消すれば上がる": ["4 分以下・待确认事项解决后可提高", "4点以下・要確認事項が解消すれば上がる"],
  "其余": ["其余", "その他"],
  "条": ["条", "件"],
  "关键词": ["关键词", "キーワード"],
  "已选 {count} 个筛选": ["已选 {count} 个筛选", "選択中の条件 {count} 件"],
  "已选": ["已选", "選択済み"],
  "応募优先度 {score}，满分 10": ["应募优先度 {score}，满分 10", "応募優先度 {score}、10 点満点"],
  "未採点（求人原文を読んでいない）": ["未评分（未读求人原文）", "未採点（求人原文を読んでいない）"],
  "求人原文：{label}": ["求人原文：{label}", "求人原文：{label}"],
  "例：2026-07-30・募集終了で応募機会なし": ["例：2026-07-30・招聘已结束，无法应募", "例：2026-07-30・募集終了で応募機会なし"],
  "公司 / 职位": ["公司 / 职位", "会社 / 職種"],
  "匹配": ["匹配", "適合度"],
  "年収": ["年薪", "年収"],
  "入库": ["入库", "登録"],
  "状态": ["状态", "状況"],
  "核对": ["核对", "確認"],
  "v2 採点": ["v2 评分", "v2 採点"],
  "未採点": ["未评分", "未採点"],
  "入库日 {date}": ["入库日 {date}", "登録日 {date}"],
  "応募日 {date}": ["应募日 {date}", "応募日 {date}"],
  "笔记 frontmatter 里没有 date": ["笔记 frontmatter 里没有 date", "ノートの frontmatter に date がありません"],
} as const satisfies Record<string, readonly [string, string]>;

type JobMenuKey = keyof typeof JOB_MENU_COPY;
function useJobMenu() {
  const { locale } = useUiLocale();
  const translate = (key: JobMenuKey, values: Record<string, string | number> = {}) =>
    JOB_MENU_COPY[key][locale === "ja" ? 1 : 0].replace(/\{(\w+)\}/g, (match, name: string) => String(values[name] ?? match));
  const label = (value: string) => Object.hasOwn(JOB_MENU_COPY, value) ? translate(value as JobMenuKey) : value;
  return { locale, t: translate, label };
}

const SALARY_STEPS = [0, 600, 700, 800, 900, 1000, 1200];

const VERIFICATIONS: JobVerification[] = ["verified", "warned", "unchecked"];

const COMPARE_LIMIT = 3;

const ORIGIN_LABEL = JOB_ORIGIN_LABEL;

/**
 * v2 採点の絞り込み値。`none`（UNRATED_FIT）は「未採点（v2）」の擬似値で frontmatter には無い——
 * 採点待ちの案件を拾えるようにするために置く。枚举本体は lib/job-case-schema.ts と共有し、ここで書き直さない。
 */
const GATE_FILTER_VALUES: readonly string[] = [...HARD_GATE_VALUES, UNRATED_FIT];
const BAND_FILTER_VALUES: readonly string[] = [...FIT_BANDS, UNRATED_FIT];
const ACCESS_FILTER_VALUES: readonly string[] = [...ACCESS_STATE_VALUES, UNRATED_FIT];
const TOUCH_VALUES: readonly JobTouch[] = JOB_TOUCHES.map((touch) => touch.id);
const fitFilterLabel = (value: string, labels: Record<string, string>) => (value === UNRATED_FIT ? UNRATED_V2_LABEL : labels[value] ?? value);

const WAITING_FOR_OPTIONS = [
  { value: "", label: "没有外部等待" },
  ...Object.entries(WAITING_FOR_LABEL).map(([value, label]) => ({ value, label })),
];

/** 结果区的四种视图。卡片/列表/看板共享同一份筛选结果，周复盘看的是全量笔记。 */
const VIEW_MODES = [
  { id: "decision", label: "决策台" },
  { id: "card", label: "卡片" },
  { id: "list", label: "列表" },
  { id: "kanban", label: "看板" },
  { id: "weekly", label: "周复盘" },
] as const;

type ViewMode = (typeof VIEW_MODES)[number]["id"];

/** 看板里始终显示的核心列，其余状态列只有有数据时才占位。 */
const KANBAN_CORE_STATUSES: string[] = ["未応募", ...IN_PROGRESS_STATUSES];


/** 判定本体は lib/jobs.ts（統計格の件数テストが同じ関数を叩けるように）。 */
type FilterKey = JobFilterKey;
type Filters = JobBoardFilters;
const EMPTY_FILTERS: Filters = EMPTY_JOB_FILTERS;

/**
 * 「岗位机会」は新しい応募先を選ぶ画面。終了案件まで含む全件を既定表示すると、
 * 高得点の不採用案件が先頭を占めて「次に投る先」が見えなくなる。
 * 全件は状態 chip を外せば見られるため、入口だけ未応募に絞る。
 */
const DEFAULT_OPPORTUNITY_FILTERS: Filters = {
  ...EMPTY_FILTERS,
  statuses: ["未応募"],
};

/** 別画面の数字カードから「その数字の中身」へ飛ぶ時に渡す初期フィルタ。
 * readonly なのは、送り手（分析画面の GLANCE_CARDS）が as const の定数を渡すため。 */
export type JobsInitialFilters = {
  statuses?: readonly string[];
  ratings?: readonly JobRatingBand[];
  /** 动手状态（URL では `touch`）。「未着手」「已动手·等对方」は status だけでは表せない。 */
  touch?: readonly JobTouch[];
  /** 只看等对方（URL では `waiting=1`），按 waiting_for 与案件状态筛选。 */
  waiting?: boolean;
};

type JobsUrlState = {
  query: string;
  sort: JobSort;
  filters: Filters;
  viewMode: ViewMode;
  weekOffset: number;
  detailPath: string | null;
};

function csvParam(params: URLSearchParams, key: string) {
  return (params.get(key) ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function readJobsUrlState(initialFilters?: JobsInitialFilters | null): JobsUrlState {
  const params = typeof window === "undefined"
    ? new URLSearchParams()
    : new URLSearchParams(window.location.search);
  const seeded = initialFilters?.statuses?.length || initialFilters?.ratings?.length || initialFilters?.touch?.length || initialFilters?.waiting;
  const statusParam = params.get("status");
  const baseFilters = seeded
    ? {
        ...EMPTY_FILTERS,
        statuses: [...(initialFilters?.statuses ?? [])],
        ratings: [...(initialFilters?.ratings ?? [])],
        touches: (initialFilters?.touch ?? []).filter((value) => TOUCH_VALUES.includes(value)),
        waitingOnly: Boolean(initialFilters?.waiting),
      }
    : DEFAULT_OPPORTUNITY_FILTERS;
  const hasUrlFilters = [
    "status",
    "rating",
    "salary",
    "stack",
    "region",
    "source",
    "verification",
    "intake",
    "touch",
    "gate",
    "band",
    "access",
    "remote",
    "waiting",
  ].some((key) => params.has(key));
  const ratings = csvParam(params, "rating").filter((value): value is JobRatingBand =>
    JOB_RATING_BANDS.some((band) => band.id === value),
  );
  const verifications = csvParam(params, "verification").filter((value): value is JobVerification =>
    VERIFICATIONS.includes(value as JobVerification),
  );
  const intakes = csvParam(params, "intake").filter((value): value is JobIntake =>
    JOB_INTAKES.some((bucket) => bucket.id === value),
  );
  const touches = csvParam(params, "touch").filter((value): value is JobTouch =>
    TOUCH_VALUES.includes(value as JobTouch),
  );
  const salary = Number(params.get("salary") ?? 0);
  const sortParam = params.get("sort");
  const modeParam = params.get("mode");
  const week = Number(params.get("week") ?? 0);

  return {
    query: params.get("q") ?? "",
    sort: JOB_SORTS.some((option) => option.id === sortParam) ? sortParam as JobSort : "rating",
    filters: hasUrlFilters
      ? {
          ...EMPTY_FILTERS,
          statuses: statusParam === "all" ? [] : csvParam(params, "status"),
          ratings,
          minSalary: SALARY_STEPS.includes(salary) ? salary : 0,
          stacks: csvParam(params, "stack"),
          regions: csvParam(params, "region"),
          sources: csvParam(params, "source"),
          verifications,
          intakes,
          touches,
          gates: csvParam(params, "gate").filter((value) => GATE_FILTER_VALUES.includes(value)),
          bands: csvParam(params, "band").filter((value) => BAND_FILTER_VALUES.includes(value)),
          accesses: csvParam(params, "access").filter((value) => ACCESS_FILTER_VALUES.includes(value)),
          remoteOnly: params.get("remote") === "1",
          waitingOnly: params.get("waiting") === "1",
        }
      : baseFilters,
    viewMode: VIEW_MODES.some((mode) => mode.id === modeParam) ? modeParam as ViewMode : "decision",
    weekOffset: Number.isInteger(week) && Math.abs(week) <= 52 ? week : 0,
    detailPath: params.get("case") || null,
  };
}

function isDefaultOpportunityFilters(filters: Filters) {
  return filters.statuses.length === 1 &&
    filters.statuses[0] === "未応募" &&
    filters.ratings.length === 0 &&
    filters.minSalary === 0 &&
    filters.stacks.length === 0 &&
    filters.regions.length === 0 &&
    filters.sources.length === 0 &&
    filters.verifications.length === 0 &&
    filters.intakes.length === 0 &&
    filters.touches.length === 0 &&
    filters.gates.length === 0 &&
    filters.bands.length === 0 &&
    filters.accesses.length === 0 &&
    !filters.remoteOnly &&
    !filters.waitingOnly;
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

/**
 * 「已经动过手，但还没形成応募」的机会。
 *
 * Findy 的「いいかも」、媒体上的スカウト回信这类动作，本人做完了但企业没回应，
 * 求人票也没提交出去——按 7 枚举只能是 `未応募`。可是它和「还没看过的推荐」
 * 完全不是一回事：前者球在对方手里，本人现在做不了任何事。
 *
 * 混在一起会同时坏两头：未応募 的数字虚高，首页还催你去「判断是否応募」
 * 一个你三天前就点过的岗位。用 waiting_for 把两者分开。
 */

/**
 * 入库时期的强调档。今天进的必须一眼跳出来 —— 卡片按匹配度排时，
 * 新着は列の途中に埋もれる。ここが霞むと「今日は何が増えたか」を目で拾えない。
 */
function intakeTone(intake: JobIntake) {
  if (intake === "today") return "new";
  if (intake === "d3" || intake === "d7") return "recent";
  return "old";
}

function clip(text: string, limit: number) {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/**
 * 联动计数下，某个值在当前上下文里可能一条都没有，于是根本不在 counts 里。
 * 它要是已经被选中，就必须补回选项列表，否则用户取消不掉这个筛选。
 */
function facetOptions(counts: Map<string, number>, selected: string[]) {
  return Array.from(new Set([...counts.keys(), ...selected]))
    .map((value) => ({ value, label: value, count: counts.get(value) ?? 0 }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value, "ja"));
}

function pad(value: number) {
  return `${value}`.padStart(2, "0");
}

function isoDate(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 以周一为起点算出第 offset 周（0 = today 所在周）的闭区间，用于周复盘。 */
function weekBounds(today: string, offset: number) {
  const [year, month, day] = today.split("-").map(Number);
  const base = new Date(year, month - 1, day);
  const mondayIndex = (base.getDay() + 6) % 7;
  const start = new Date(year, month - 1, day - mondayIndex + offset * 7);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  return {
    from: isoDate(start),
    to: isoDate(end),
    label: `${start.getMonth() + 1}月${start.getDate()}日 – ${end.getMonth() + 1}月${end.getDate()}日`,
  };
}

function dayInRange(raw: string, from: string, to: string) {
  const day = normalizeDay(raw);
  return day !== null && day >= from && day <= to;
}

const dayLabel = (raw: string) => shortDay(raw, "—");

/**
 * 周复盘事件锚定在最近一次状态变化日（status_updated）。
 * `date` 是推薦入库日，拿它当事件日会把 7/21 投的岗位画到 7/20（入库那天）。
 * 未応募的笔记没有 status_updated，此时入库日就是唯一事件（AI 新規推薦）。
 */
function eventDay(job: JobCard) {
  return job.statusUpdated || job.date;
}

/** 时间线上的事件文案由状态推导 —— 状态与日期是笔记里的证据，不是 AI 的假设。 */
function eventLabel(job: JobCard) {
  switch (job.status) {
    case "未応募": return `机会入库（応募优先度 ${job.rating}）`;
    case "応募済": return "応募完了";
    case "書類通過": return "書類選考通過";
    case "面接中": return "面接を実施";
    case "内定": return "内定";
    case "不採用": return "不採用";
    default: return job.status;
  }
}

/** 命中的搜索词在卡片文本里高亮，便于确认为什么这条被搜出来。 */
function Highlight({ text, query }: { text: string; query: string }) {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return <>{text}</>;
  // 正则交替是最左优先而不是最长优先，先排长词，`java javascript` 才不会把 JavaScript 切成两半。
  const alternatives = [...tokens]
    .sort((left, right) => right.length - left.length)
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(${alternatives.join("|")})`, "gi");
  return (
    <>
      {text.split(pattern).map((piece, index) =>
        tokens.includes(piece.toLowerCase())
          ? <mark key={index}>{piece}</mark>
          : <Fragment key={index}>{piece}</Fragment>,
      )}
    </>
  );
}

/** 技術スタック 有四十多个标签，默认只露出高频的几个，避免筛选栏把结果区挤到屏幕外。 */
/** カード右上の v2 採点札。Band と合計だけ——Gate は hold が既定で情報量が薄く、reject の時だけ色で知らせる。 */
function FitChip({ fit }: { fit: JobFit }) {
  const { t, label: menuLabel } = useJobMenu();
  return (
    <span
      className={`job-fit-chip band-${fit.band} gate-${fit.hardGate}`}
      title={`${t("v2 採点")} ${fit.score}/100 · Band ${fit.band} · Gate ${menuLabel(HARD_GATE_LABEL[fit.hardGate])}`}
    >
      <b>{fit.band}</b><small>{fit.score}</small>
    </span>
  );
}

/** 抽屉の v2 六軸。未採点は文言のまま出す——0 のバーを 6 本並べると「全部最低」に見える。 */
function FitPanel({ fit }: { fit: JobFit | null }) {
  const { t, label: menuLabel } = useJobMenu();
  if (!fit) return <p className="job-fit-panel job-fit-unrated">{t("v2 採点")}：{menuLabel(UNRATED_V2_LABEL)}</p>;
  const gateKeys = Object.keys(JOB_FIT_GATE_LABEL) as (keyof JobFit["gates"])[];
  return (
    <section className="job-fit-panel" aria-label={t("v2 採点")}>
      <header>
        <strong>Fit {fit.score}<small>/100</small></strong>
        <em className={`job-fit-band band-${fit.band}`}>Band {fit.band}</em>
        <em className={`job-fit-gate gate-${fit.hardGate}`}>Gate {HARD_GATE_LABEL[fit.hardGate]}</em>
        {fit.accessState && <span className="job-fit-access">{ACCESS_STATE_LABEL[fit.accessState]}</span>}
      </header>
      <ul className="job-fit-axes">
        {JOB_FIT_AXES.map((key) => {
          const { label, max } = JOB_FIT_SCORE_LABEL[key];
          return (
            <li key={key}>
              <span>{label}</span>
              <i><b style={{ width: `${(fit.scores[key] / max) * 100}%` }} /></i>
              <small>{fit.scores[key]}/{max}</small>
            </li>
          );
        })}
      </ul>
      <p className="job-fit-gates">
        {gateKeys.map((key) => fit.gates[key] && (
          <span key={key} className={`gate-${fit.gates[key]}`}>{JOB_FIT_GATE_LABEL[key]} {HARD_GATE_LABEL[fit.gates[key]]}</span>
        ))}
      </p>
    </section>
  );
}

function FilterChips({
  label,
  options,
  selected,
  onToggle,
  collapseAfter = 0,
}: {
  label: string;
  options: { value: string; label: string; count: number; hint?: string }[];
  selected: string[];
  onToggle: (value: string) => void;
  collapseAfter?: number;
}) {
  const { t } = useJobMenu();
  const [expanded, setExpanded] = useState(false);

  // 在当前其它条件下选不出任何东西的值直接不显示 —— 但已选中的要留着，否则取消不掉。
  const available = options.filter((option) => option.count > 0 || selected.includes(option.value));
  if (available.length === 0) return null;

  const collapsible = collapseAfter > 0 && available.length > collapseAfter;
  // 联动筛选会让可选项池剧烈伸缩。池子小到不需要折叠时就把展开态收回来：
  // 否则它会一直挂着，等池子涨回去时这一组突然炸开几百像素，把下面的分组顶走，
  // 用户连点两下取消筛选时第二下就会落到别的组上。
  if (expanded && !collapsible) setExpanded(false);

  const collapsed = collapsible && !expanded;
  const shown = collapsed
    ? available.filter((option, index) => index < collapseAfter || selected.includes(option.value))
    : available;
  const hidden = available.length - shown.length;

  return (
    <div className="job-filter-row">
      <span className="job-filter-label">{label}</span>
      <div className="job-chips">
        {shown.map((option) => (
          <button
            key={option.value}
            type="button"
            className={selected.includes(option.value) ? "job-chip active" : "job-chip"}
            aria-pressed={selected.includes(option.value)}
            // 笔记里的自定义状态可能是一整段说明，截断显示，全文交给 tooltip。
            // hint 是分档本身需要解释时（入库时期的各档互斥）由调用方给的补充说明。
            title={option.hint ?? (option.label.length > 12 ? option.label : undefined)}
            onClick={() => onToggle(option.value)}
          >
            <span>{option.label}</span> <small>{option.count}</small>
          </button>
        ))}
        {/* 溢出项刚好全被选中时 hidden 会是 0，那就没有「+0 更多」可点。 */}
        {(hidden > 0 || expanded) && (
          <button
            type="button"
            className="job-chip job-chip-more"
            aria-expanded={!collapsed}
            onClick={() => setExpanded(!expanded)}
          >
            {collapsed ? t("+{count} 更多", { count: hidden }) : t("收起")}
          </button>
        )}
      </div>
    </div>
  );
}

function JobsView({
  notes,
  loading = false,
  today,
  onOpen,
  onVaultChanged,
  onNoteWritten,
  initialFilters,
  onFlash,
}: {
  notes: Note[];
  /**
   * 岗位 scope 还没到。外壳只在「一条笔记都没有」时画全屏加载；从别的视图切过来时
   * notes 已非空但不含 job-case，不区分的话会先闪一下「还没有可以展示的岗位机会」。
   */
  loading?: boolean;
  /** 「今日」は殻が持つ（零時の切替も殻が面倒を見る）。ここで new Date() すると跨日後の「今日入库」が前日のまま凍る。 */
  today: string;
  onOpen: (note: Note) => void;
  onVaultChanged?: () => void | Promise<void>;
  /** 写路由が返した更新後の note を1件だけ差し替える。全量再取得（onVaultChanged）の代替。 */
  onNoteWritten?: (note: Note) => void;
  /**
   * 別画面（求職分析の数字カードなど）から遷移してきた時の初期フィルタ。
   * このコンポーネントは view 切替でアンマウントされるので、初期値として一度読むだけでよい。
   * 呼び出し側はナビで直接来た時に null に戻す責任を持つ（memory-atlas.tsx）。
   *
   * status だけでなく rating も受けるのは、「可応募」＝ `未応募 かつ rating 7以上` のように
   * 数字カードの定義が status 単独では表せないため。カードの数字と遷移先の件数が食い違うと、
   * 画面がそのまま嘘になる。
   */
  initialFilters?: JobsInitialFilters | null;
  /**
   * 状态写入成功后的「已改为 X · 撤销」。条幅由外壳统一渲染（同一时刻只该有一条），
   * 这里只把消息和撤销动作交出去。
   */
  onFlash?: (message: string, undo?: UndoAction) => void;
}) {
  const { t, label: menuLabel } = useJobMenu();
  const [initialUrlState] = useState(() => readJobsUrlState(initialFilters));
  const [query, setQuery] = useState(initialUrlState.query);
  const [sort, setSort] = useState<JobSort>(initialUrlState.sort);
  const [filters, setFilters] = useState<Filters>(initialUrlState.filters);
  const [viewMode, setViewMode] = useState<ViewMode>(initialUrlState.viewMode);
  const [weekOffset, setWeekOffset] = useState(initialUrlState.weekOffset);
  // 这个面板常挂着不关，「今天」要在跨天后重新取，否则周复盘会一直停在打开那天的那一周。
  const [detailPath, setDetailPath] = useState<string | null>(initialUrlState.detailPath);
  const [comparePaths, setComparePaths] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [savingPaths, setSavingPaths] = useState<string[]>([]);
  /**
   * 🔴 書込み失敗は **path をキーにここへ持つ**。操作部品（StatusPicker）の中に持つと、
   * 応答が返る前に抽屉を閉じられた瞬間に部品ごとアンマウントされ、`setFailure` が
   * React の静かな no-op になってエラーが消える。抽屉は背景クリック・×・Esc の
   * どれでも閉じられ、どれも書込み中を待たない。
   */
  const [statusErrors, setStatusErrors] = useState<Record<string, string>>({});
  const searchRef = useRef<HTMLInputElement>(null);
  const openDetail = useCallback((path: string) => {
    const params = new URLSearchParams(window.location.search);
    params.set("case", path);
    window.history.pushState(
      { ...(window.history.state ?? {}), __echoJob: path },
      "",
      `${window.location.pathname}?${params.toString()}`,
    );
    setDetailPath(path);
  }, []);
  const closeDetail = useCallback(() => {
    if (window.history.state?.__echoJob) {
      window.history.back();
      return;
    }
    setDetailPath(null);
  }, []);

  /**
   * 応募日の**正本**は `20_求職/_応募日台帳.md`。status から拾えるのは `応募済` の間だけで、
   * 先へ進むと同じ位置が段階の日付に変わる（jobs.ts の `jobAppliedOn` 参照）。
   * 台帳に載っていれば不採用になった後でも応募日が残るので、そちらを優先する。
   * 照合は会社名（台帳の「照合名」列があればそれ）。
   */
  const appliedByCompany = useMemo(() => {
    const ledger = notes.find((note) => note.path.endsWith("_応募日台帳.md"));
    const map = new Map<string, string>();
    for (const row of parseAppliedLedger(ledger?.content ?? "")) {
      // 同一社に複数応募がある場合は**最初の応募日**を残す（経過日数を短く見せない）。
      const key = row.matchName;
      if (!map.has(key) || row.appliedOn < (map.get(key) ?? "")) map.set(key, row.appliedOn);
    }
    return map;
  }, [notes]);

  const jobs = useMemo(() => {
    return notes
      .filter((note) => getType(note) === JOB_CASE_TYPE)
      .map(toJobCard)
      .map((job) => ({
        ...job,
        // 台帳は会社単位の照合なので、同じ会社の別求人へ応募日が移る可能性がある。
        // 未応募に応募日が出るのは論理矛盾なので、この状態では台帳補完を使わない。
        appliedOn: opportunityAppliedOn(
          job.status,
          job.appliedOn,
          appliedByCompany.get(job.company),
        ),
        // 笔记里同一个技術スタック 可能写重复，不去重会撞 React key，facet 计数也会比结果多。
        stack: Array.from(new Set(job.stack)),
      }));
  }, [notes, appliedByCompany]);

  /**
   * facet 计数是「联动」的：每组的数字都算在**其它所有条件已生效**的前提下。
   * 每组要排除自己，否则多选组里没选中的项会全变 0，就再也加不上第二个值了。
   */
  const narrow = useCallback(
    (except?: FilterKey) => {
      return jobs.filter((job) => jobMatchesFilters(job, filters, { query, today, except }));
    },
    // today 进依赖是必须的：跨天后「今日」那一档要重算，否则面板挂一夜就永远停在昨天。
    [jobs, query, filters, today],
  );

  const facets = useMemo(() => {
    const count = (pool: JobCard[], values: (job: JobCard) => string[]) => {
      const map = new Map<string, number>();
      pool.forEach((job) => values(job).forEach((value) => map.set(value, (map.get(value) ?? 0) + 1)));
      return map;
    };
    return {
      statuses: count(narrow("statuses"), (job) => [job.status]),
      stacks: count(narrow("stacks"), (job) => job.stack),
      regions: count(narrow("regions"), (job) => job.regions),
      sources: count(narrow("sources"), (job) => (job.sourceGroup ? [job.sourceGroup] : [])),
      verifications: count(narrow("verifications"), (job) => [job.verification]),
      intakes: count(narrow("intakes"), (job) => [jobIntake(job.date, today)]),
      touches: count(narrow("touches"), (job) => {
        const touch = jobTouch(job);
        return touch ? [touch] : [];
      }),
      gates: count(narrow("gates"), (job) => [jobFitGate(job)]),
      bands: count(narrow("bands"), (job) => [jobFitBand(job)]),
      accesses: count(narrow("accesses"), (job) => [jobFitAccess(job)]),
      ratingPool: narrow("rating"),
      salaryPool: narrow("salary"),
      remote: narrow("remote").filter((job) => job.remote).length,
      waiting: narrow("waiting").filter(jobWaitsOnCounterpart).length,
    };
  }, [narrow, today]);

  /**
   * 状态选项：枚举顺序在前、自定义状态在后。
   * 计数归零的项会被 FilterChips 隐藏，但已选中的必须留着，否则取消不掉。
   */
  const statusOptions = useMemo(() => {
    const seen = new Set([...facets.statuses.keys(), ...filters.statuses]);
    const known = JOB_STATUSES.filter((status) => seen.has(status));
    const custom = Array.from(seen)
      .filter((status) => !isJobStatus(status))
      .sort((left, right) => left.localeCompare(right, "ja"));
    return [...known, ...custom].map((status) => ({
      value: status,
      label: status,
      count: facets.statuses.get(status) ?? 0,
    }));
  }, [facets.statuses, filters.statuses]);

  const visible = useMemo(
    () => narrow().sort((left, right) => compareJobs(left, right, sort)),
    [narrow, sort],
  );

  /**
   * 看板本身就按状态分列，状态筛选对它没有意义：默认筛选只看未応募，
   * 直接用 visible 的话切到看板只有第一列有卡、其余四列永远是「—」。
   * 所以看板的池子排除状态这一组，其余筛选（关键词・技术栈・地点…）照常生效。
   */
  const kanbanJobs = useMemo(
    () => narrow("statuses").sort((left, right) => compareJobs(left, right, sort)),
    [narrow, sort],
  );

  /** 看板列：枚举顺序在前，核心五列常驻；笔记里出现的自定义状态补在末尾，避免岗位被吞掉。 */
  const kanbanColumns = useMemo(() => {
    const custom = Array.from(new Set(kanbanJobs.map((job) => job.status)))
      .filter((status) => !isJobStatus(status))
      .sort((left, right) => left.localeCompare(right, "ja"));
    return [...JOB_STATUSES, ...custom]
      .map((status) => ({ status, jobs: kanbanJobs.filter((job) => job.status === status) }))
      .filter((column) => column.jobs.length > 0 || KANBAN_CORE_STATUSES.includes(column.status as JobStatus));
  }, [kanbanJobs]);

  const week = useMemo(() => weekBounds(today, weekOffset), [today, weekOffset]);

  const weekEvents = useMemo(() => {
    return jobs
      .filter((job) => dayInRange(eventDay(job), week.from, week.to))
      .sort(
        (left, right) =>
          eventDay(right).localeCompare(eventDay(left)) ||
          left.company.localeCompare(right.company, "ja"),
      );
  }, [jobs, week]);

  const weekKpis = useMemo(() => {
    const count = (predicate: (job: JobCard) => boolean) => jobs.filter(predicate).length;
    return [
      {
        label: "本周应募 / 进展",
        tone: "green",
        // 不採用也是这一周真实发生的选考动态（应募次日就书类落ち的会只剩这一条记录），
        // 所以口径是「状态在本周变化到未応募以外」，而不是只数还活着的。
        value: count((job) => job.status !== "未応募" && dayInRange(eventDay(job), week.from, week.to)),
      },
      { label: "面试进行中", tone: "orange", value: count((job) => job.status === "面接中") },
      { label: "选考推进中", tone: "ink", value: count((job) => SELECTION_STATUSES.includes(job.status)) },
      { label: "待投递（8+）", tone: "gold", value: count((job) => job.status === "未応募" && job.rating >= 8) },
    ];
  }, [jobs, week]);

  const nextFocus = useMemo(() => {
    const items: { path: string; company: string; action: string }[] = [];
    const push = (job: JobCard, action: string) => {
      items.push({ path: job.path, company: job.company, action: job.caution ? `${action}${job.caution}` : action });
    };
    jobs.forEach((job) => {
      if (job.status === "面接中") push(job, "面接準備・逆質問の整理。");
      else if (job.status === "書類通過") push(job, "面接日程を調整。");
    });
    jobs
      .filter((job) => job.status === "未応募" && job.rating >= 9)
      .forEach((job) => push(job, "今週中に優先応募。"));
    // 7〜8 分的残弹不该沉默地躺在池子里：要么投掉要么明确弃掉，波次才能宣告投げ切り。
    jobs
      .filter((job) => job.status === "未応募" && job.rating >= 7 && job.rating < 9)
      .forEach((job) => push(job, "応募するか見送るか判断。"));
    return items.slice(0, 4);
  }, [jobs]);

  /** 本周的叙事复盘笔记（80_AI分析/…週次復盤…，type: ai-report）。只认日期落在显示周内的那份。 */
  const weekReview = useMemo(() => {
    const candidates = notes.filter((note) => {
      if (getType(note) !== "ai-report") return false;
      if (!/週次復盤|周复盘|週復盤/.test(noteBasename(note.path))) return false;
      const day = getString(note.frontmatter.date) || noteBasename(note.path);
      return dayInRange(day, week.from, week.to);
    });
    // 同一周写了多份时取文件名最新的一份（文件名以日期开头，字典序即时间序）。
    return candidates.sort((left, right) => right.path.localeCompare(left.path))[0] ?? null;
  }, [notes, week]);

  /** 复盘笔记里的 [[wiki链接]]：能在库里找到目标就打开，找不到就保持纯文本。 */
  const openWikiLink = useCallback(
    (target: string) => {
      const base = target.split("|")[0].split("#")[0].trim();
      const note =
        notes.find((item) => noteBasename(item.path) === base) ??
        notes.find((item) => item.path.endsWith(`/${base}.md`));
      if (note) onOpen(note);
    },
    [notes, onOpen],
  );

  const jobPaths = useMemo(() => new Set(jobs.map((job) => job.path)), [jobs]);
  const detail = jobs.find((job) => job.path === detailPath) ?? null;
  const detailOpen = detail !== null;

  // 笔记被删掉 / 移出 AI 推薦目录后，comparePaths 里会留下失效路径；
  // 一切判断都走这份已对账的 compared，免得幽灵岗位占着对比名额。
  const compared = comparePaths
    .map((path) => jobs.find((job) => job.path === path))
    .filter((job): job is JobCard => Boolean(job));
  const compareFull = compared.length >= COMPARE_LIMIT;

  const activeFilterCount =
    filters.statuses.length +
    filters.stacks.length +
    filters.regions.length +
    filters.sources.length +
    filters.verifications.length +
    filters.intakes.length +
    filters.touches.length +
    filters.gates.length +
    filters.bands.length +
    filters.accesses.length +
    filters.ratings.length +
    (filters.minSalary > 0 ? 1 : 0) +
    (filters.remoteOnly ? 1 : 0) +
    (filters.waitingOnly ? 1 : 0);

  const resetFilters = () => {
    setFilters(DEFAULT_OPPORTUNITY_FILTERS);
    setQuery("");
  };

  const toggleCompare = (path: string) => {
    // 每次都先按现有笔记对账一遍，被删掉的岗位不该继续占着 COMPARE_LIMIT 的名额。
    setComparePaths((current) => {
      const live = current.filter((item) => jobPaths.has(item));
      if (live.includes(path)) return live.filter((item) => item !== path);
      if (live.length >= COMPARE_LIMIT) return live;
      return [...live, path];
    });
    if (compared.length <= 2 && compared.some((job) => job.path === path)) setCompareOpen(false);
  };

  /**
   * 🔴 楽観更新はしない。以前は即座に新 status を当てていたが、既定のフィルタが
   * `statuses: ["未応募"]` なので、その瞬間にカードが `visible` から外れて StatusPicker ごと
   * アンマウントされ、書込みが失敗しても**エラーを出す相手がもう居ない**。
   * 抽屉は `visible` を経由しないので抽屉だけエラーが出る、という非対称が実際に起きた
   * （2026-07-30 ミロク情報サービス）。`saving` が「写入中…」を出すので楽観更新は元々不要。
   *
   * 失敗理由は `statusErrors[path]` に積む（部品ローカルに持てない理由はそこのコメント）。
   * 戻り値は呼び出し元が「注記エディタを閉じてよいか」を判断するためだけのもの。
   */
  const dismissStatusError = useCallback((path: string) => {
    setStatusErrors((current) => {
      if (!(path in current)) return current;
      const next = { ...current };
      delete next[path];
      return next;
    });
  }, []);

  /**
   * 撤销＝把服务端记下的旧值原样放回。只对「刚写完的那个版本」有效（expectedMtime 必填）：
   * 中间有别处改过就 409，这时放回旧值会连那次修改一起抹掉，所以只报告、不重试。
   * 撤销成功不再弹条幅——条幅本身会收起，再弹一条「已改为」反而分不清哪次是哪次。
   */
  const statusUndo = useCallback(
    (path: string, restore: Record<string, string | null> | undefined, mtime: number | undefined): UndoAction | undefined => {
      if (!restore || mtime === undefined) return undefined;
      return async () => {
        setSavingPaths((current) => current.includes(path) ? current : [...current, path]);
        try {
          const payload = await postJson<{ ok?: boolean; error?: string; note?: Note }>("/api/jobs/status", {
            path,
            restore,
            expectedMtime: mtime,
          });
          if (payload.note && onNoteWritten) onNoteWritten(payload.note);
          else await onVaultChanged?.();
          return null;
        } catch (error) {
          if (error instanceof ConflictError) {
            // 画面の版が古いままだと次の操作も 409 になる。撤销はしないが最新は取り直す。
            await onVaultChanged?.();
            return "已在别处更新，无法撤销";
          }
          return error instanceof Error ? error.message : "撤销失败";
        } finally {
          setSavingPaths((current) => current.filter((item) => item !== path));
        }
      };
    },
    [onNoteWritten, onVaultChanged],
  );

  const changeStatus = useCallback(
    async (
      path: string,
      status: string,
      statusNote = "",
      channel?: string,
      expectedMtime?: number,
    ): Promise<string | null> => {
      setSavingPaths((current) => current.includes(path) ? current : [...current, path]);
      setStatusErrors((current) => {
        if (!(path in current)) return current;
        const next = { ...current };
        delete next[path];
        return next;
      });
      try {
        let payload: {
          ok?: boolean;
          error?: string;
          note?: Note;
          derivedState?: "fresh" | "stale";
          unchanged?: boolean;
          /** 这次写入动过的键的旧值。服务端判断无法按标量写回时不给。 */
          undo?: Record<string, string | null>;
        };
        try {
          payload = await postJson("/api/jobs/status", {
            path,
            status,
            statusNote,
            ...(channel ? { channel } : {}),
            ...(expectedMtime !== undefined ? { expectedMtime } : {}),
          });
        } catch (writeError) {
          if (writeError instanceof ConflictError) {
            await onVaultChanged?.();
            throw new Error(writeError.message || "状态已更新，已自动刷新到最新版本，请重新点击。");
          }
          throw writeError;
        }
        // 画面へ反映してから savingPaths を落とす（finally は下の分岐の後）。
        // そうしないと一瞬だけ古い値に戻って、書けたのか失敗したのか読めなくなる。
        // 応答が更新後の note を持っているので単条差し替えで足りる。
        // 無い場合（unchanged 応答・旧サーバ）だけ全量再取得へ退く。
        if (payload.note && onNoteWritten) onNoteWritten(payload.note);
        else await onVaultChanged?.();
        if (!payload.unchanged) onFlash?.(changedToLabel(status), statusUndo(path, payload.undo, payload.note?.stat.mtime));
        return null;
      } catch (error) {
        const message = error instanceof Error ? error.message : "写入 Vault 失败";
        setStatusErrors((current) => ({ ...current, [path]: message }));
        return message;
      } finally {
        setSavingPaths((current) => current.filter((item) => item !== path));
      }
    },
    [onFlash, onNoteWritten, onVaultChanged, statusUndo],
  );

  const changeFollowUp = useCallback(async (
    path: string,
    values: { waitingFor: string | null; followUpAt: string | null; nextEventAt: string | null },
    expectedMtime?: number,
  ): Promise<string | null> => {
    setSavingPaths((current) => current.includes(path) ? current : [...current, path]);
    dismissStatusError(path);
    try {
      const payload = await postJson<{ ok?: boolean; error?: string; note?: Note }>("/api/jobs/follow-up", { path, ...values, ...(expectedMtime !== undefined ? { expectedMtime } : {}) });
      if (!payload.note) throw new Error(payload.error || "写入 Vault 失败");
      onNoteWritten?.(payload.note);
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : "写入 Vault 失败";
      setStatusErrors((current) => ({ ...current, [path]: message }));
      return message;
    } finally {
      setSavingPaths((current) => current.filter((item) => item !== path));
    }
  }, [dismissStatusError, onNoteWritten]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (compareOpen) setCompareOpen(false);
        // 决策台没有抽屉，选中项是常驻的右栏：Esc 在这里关不掉任何东西，只会把正在看的岗位重置回队首。
        else if (detailOpen && viewMode !== "decision") closeDetail();
        return;
      }
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeDetail, compareOpen, detailOpen, viewMode]);

  useEffect(() => {
    const pathname = window.location.pathname;
    const syncFromUrl = () => {
      // 回到别的页面时本组件马上卸载；别把对方页面的同名参数（mode 等）读进看板。
      if (window.location.pathname !== pathname) return;
      const next = readJobsUrlState();
      setQuery(next.query);
      setSort(next.sort);
      setFilters(next.filters);
      setViewMode(next.viewMode);
      setWeekOffset(next.weekOffset);
      setDetailPath(next.detailPath);
    };
    window.addEventListener("popstate", syncFromUrl);
    // 在看板上再点一次左栏「岗位机会」：外壳 pushState 回到不带参数的 /jobs，筛选要跟着回到默认。
    window.addEventListener(URL_CHANGE_EVENT, syncFromUrl);
    return () => {
      window.removeEventListener("popstate", syncFromUrl);
      window.removeEventListener(URL_CHANGE_EVENT, syncFromUrl);
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (!isDefaultOpportunityFilters(filters)) {
      params.set("status", filters.statuses.length ? filters.statuses.join(",") : "all");
      if (filters.ratings.length) params.set("rating", filters.ratings.join(","));
      if (filters.minSalary > 0) params.set("salary", String(filters.minSalary));
      if (filters.stacks.length) params.set("stack", filters.stacks.join(","));
      if (filters.regions.length) params.set("region", filters.regions.join(","));
      if (filters.sources.length) params.set("source", filters.sources.join(","));
      if (filters.verifications.length) params.set("verification", filters.verifications.join(","));
      if (filters.intakes.length) params.set("intake", filters.intakes.join(","));
      if (filters.touches.length) params.set("touch", filters.touches.join(","));
      if (filters.gates.length) params.set("gate", filters.gates.join(","));
      if (filters.bands.length) params.set("band", filters.bands.join(","));
      if (filters.accesses.length) params.set("access", filters.accesses.join(","));
      if (filters.remoteOnly) params.set("remote", "1");
      if (filters.waitingOnly) params.set("waiting", "1");
    }
    if (sort !== "rating") params.set("sort", sort);
    if (viewMode !== "decision") params.set("mode", viewMode);
    if (viewMode === "weekly" && weekOffset !== 0) params.set("week", String(weekOffset));
    if (detailPath) params.set("case", detailPath);
    const queryString = params.toString();
    window.history.replaceState(
      { ...(window.history.state ?? {}), __echoAppView: "jobs" },
      "",
      `${window.location.pathname}${queryString ? `?${queryString}` : ""}`,
    );
  }, [detailPath, filters, query, sort, viewMode, weekOffset]);

  // 统计格从全部案件数（不随筛选变），口径与点开后的筛选在 lib/jobs.ts 里成对定义、由测试钉住。
  // 已经动过手的不再算「待判断」——本人这边没有下一步，催也没用。
  const tilePools = jobStatTilePools(jobs, today);
  const untouchedJobs = tilePools.untouched;
  const readyJobs = [...tilePools.ready].sort((left, right) => compareJobs(left, right, "rating"));
  const nextPick =
    readyJobs[0] ??
    [...untouchedJobs].sort((left, right) => compareJobs(left, right, "rating"))[0] ??
    null;
  const highlightedNextPick =
    viewMode === "card" &&
    sort === "rating" &&
    query.trim() === "" &&
    isDefaultOpportunityFilters(filters)
      ? nextPick
      : null;
  const resultVisible = highlightedNextPick
    ? visible.filter((job) => job.path !== highlightedNextPick.path)
    : visible;
  // 统计格＝一次性替换全部筛选：从空条件起步、清掉关键词，只保留排序与视图。
  // 在旧条件上叠加的话，点开后的条数会比格子上的数字少，格子就成了谎话。
  const applyStatTile = (id: JobStatTileId) => {
    setFilters(jobStatTileFilters(id));
    setQuery("");
    // 周复盘不画列表：停在那里的话，点了「只看这 N 条」却什么都看不到。
    if (viewMode === "weekly") setViewMode("decision");
  };
  const statTileActive = (id: JobStatTileId) =>
    query.trim() === "" && JSON.stringify(filters) === JSON.stringify(jobStatTileFilters(id));

  const isJobList = viewMode !== "weekly";
  // 看板不用状态筛选，计数里也不该算它，否则「已选 1 个筛选」指向一个看不见的条件。
  const shownFilterCount = viewMode === "kanban" ? activeFilterCount - filters.statuses.length : activeFilterCount;
  // 结果条的条数和空态都要跟画面上实际画出的那一池对齐：看板用的是不含状态筛选的池子。
  const listedJobs = viewMode === "kanban" ? kanbanJobs : resultVisible;
  const matchedJobs = viewMode === "kanban" ? kanbanJobs : visible;
  const decisionDetail = viewMode === "decision" ? detail ?? visible[0] ?? null : null;

  return (
    <section className="jobs-view">
      <h1 className="sr-only">{t("岗位机会")}</h1>
      {highlightedNextPick && (
        <section className="jobs-next-pick" aria-label={t("下一项応募判断")}>
          <span className={`jobs-next-score rate-${rateTone(highlightedNextPick.rating)}`}>
            <strong>{rateText(highlightedNextPick)}</strong>
            <small>{highlightedNextPick.rated ? "/ 10" : "未採点"}</small>
          </span>
          <div className="jobs-next-copy">
            <span>NEXT DECISION</span>
            <h2>{highlightedNextPick.company}</h2>
            <p>{highlightedNextPick.position}</p>
            <small>
              {readyJobs.length > 0
                ? clip(highlightedNextPick.reason || "达到当前可投线，打开详情确认硬性条件与风险。", 110)
                : "当前没有达到 7 分线的未应募岗位；先复核最高分候选，不自动建议投递。"}
            </small>
          </div>
          <dl className="jobs-next-facts">
            <div>
              <dt>年収</dt>
              <dd>{salaryLabel(highlightedNextPick)}</dd>
            </div>
            <div>
              <dt>原文</dt>
              <dd>{VERIFICATION_LABEL[highlightedNextPick.verification]}</dd>
            </div>
          </dl>
          <button type="button" onClick={() => openDetail(highlightedNextPick.path)}>
            {t("判断是否応募")} <span aria-hidden="true">→</span>
          </button>
        </section>
      )}

      <div className="jobs-stat page-stat-strip module-stat-strip" role="group" aria-label={t("当前岗位机会摘要（点击查看对应岗位）")}>
        {JOB_STAT_TILES.map((tile) => {
          const count = tilePools[tile.id].length;
          return (
            <button
              key={tile.id}
              type="button"
              data-zero={count === 0}
              aria-pressed={statTileActive(tile.id)}
              title={t("只看这 {count} 条（替换当前全部筛选）", { count })}
              onClick={() => applyStatTile(tile.id)}
            >
              <strong>{count}</strong><span>{menuLabel(tile.label)}</span>
            </button>
          );
        })}
      </div>

      <div className="jobs-body">
        <details className="jobs-filter-panel">
          <summary>
            <span>
              <b>{t("筛选条件")}</b>
              <small>
                {shownFilterCount > 0
                  ? `${t("已启用 {count} 项", { count: shownFilterCount })}${viewMode !== "kanban" && filters.statuses.length === 1 && filters.statuses[0] === "未応募" ? ` · ${t("默认只看未応募")}` : ""}`
                  : t("当前显示全部岗位")}
              </small>
            </span>
            <em aria-hidden="true" />
          </summary>
          <div className="jobs-filter-sticky">
            <div className="jobs-filter-head">
              <span>{t("组合筛选 · FILTERS")}</span>
              <button type="button" className="jobs-filter-reset" onClick={resetFilters}>
                {t("恢复默认")}
              </button>
            </div>

            <div className="jobs-filter-groups">
              {viewMode === "kanban" ? (
                <p className="jobs-filter-note">{t("看板按状态分列，不受状态筛选影响")}</p>
              ) : (
                <FilterChips
                  label={t("应募状态")}
                  options={statusOptions}
                  selected={filters.statuses}
                  onToggle={(value) => setFilters((current) => ({ ...current, statuses: toggle(current.statuses, value) }))}
                />
              )}

              {/* 只有未応募才有动手状态；选中后应募済以降会全部落选，与顶部统计格同一口径。 */}
              <FilterChips
                label={t("动手状态")}
                options={JOB_TOUCHES.map((touch) => ({
                  value: touch.id,
                  label: menuLabel(touch.label),
                  hint: menuLabel(touch.hint),
                  count: facets.touches.get(touch.id) ?? 0,
                }))}
                selected={filters.touches}
                onToggle={(value) =>
                  setFilters((current) => ({ ...current, touches: toggle(current.touches, value as JobTouch) }))
                }
              />

              {/* 等待筛选沿用案件的等待方判定，保留在求职看板中处理跟进。 */}
              {(facets.waiting > 0 || filters.waitingOnly) && (
                <div className="job-filter-row">
                  <span className="job-filter-label">{t("等待")}</span>
                  <div className="job-chips">
                    <button
                      type="button"
                      className={`job-chip${filters.waitingOnly ? " active" : ""}`}
                      aria-pressed={filters.waitingOnly}
                      title={t("已记等待对象、且不是本人的案件（选考中・内定，或未応募但已动手）")}
                      onClick={() => setFilters((current) => ({ ...current, waitingOnly: !current.waitingOnly }))}
                    >
                      <span>{t("只看等对方")}</span> <small>{facets.waiting}</small>
                    </button>
                  </div>
                </div>
              )}

              {/* 顺序固定按「新→旧」，不像 facetOptions 那样按计数排 —— 时间轴重排了就读不成时间轴了。 */}
              <FilterChips
                label={t("入库时期")}
                options={JOB_INTAKES.map((bucket) => ({
                  value: bucket.id,
                  label: menuLabel(bucket.label),
                  hint: menuLabel(bucket.hint),
                  count: facets.intakes.get(bucket.id) ?? 0,
                }))}
                selected={filters.intakes}
                onToggle={(value) =>
                  setFilters((current) => ({
                    ...current,
                    intakes: toggle(current.intakes, value as JobIntake),
                  }))
                }
              />

              <FilterChips
                label={t("応募优先度")}
                options={JOB_RATING_BANDS.map((band) => ({
                  value: band.id,
                  label: menuLabel(band.label),
                  hint: menuLabel(band.hint),
                  count: facets.ratingPool.filter((job) => jobMatchesRatingBands(job.rating, [band.id])).length,
                }))}
                selected={filters.ratings}
                onToggle={(value) =>
                  setFilters((current) => ({
                    ...current,
                    ratings: toggle(current.ratings, value as JobRatingBand),
                  }))
                }
              />

              {/* v2 採点は応募优先度とは別軸：rating は求人原文を読んだ上での主観的な優先度、
                  Gate / Band は六軸採点の結論。未採点を擬似値として並べるのは、採点待ちの案件を拾うため。 */}
              <FilterChips
                label="Gate（v2）"
                options={GATE_FILTER_VALUES.map((value) => ({ value, label: menuLabel(fitFilterLabel(value, HARD_GATE_LABEL)), count: facets.gates.get(value) ?? 0 }))}
                selected={filters.gates}
                onToggle={(value) => setFilters((current) => ({ ...current, gates: toggle(current.gates, value) }))}
              />
              <FilterChips
                label="Band（v2）"
                options={BAND_FILTER_VALUES.map((value) => ({ value, label: menuLabel(fitFilterLabel(value, {})), count: facets.bands.get(value) ?? 0 }))}
                selected={filters.bands}
                onToggle={(value) => setFilters((current) => ({ ...current, bands: toggle(current.bands, value) }))}
              />
              <FilterChips
                label={t("到達（v2）")}
                options={ACCESS_FILTER_VALUES.map((value) => ({ value, label: menuLabel(fitFilterLabel(value, ACCESS_STATE_LABEL)), count: facets.accesses.get(value) ?? 0 }))}
                selected={filters.accesses}
                onToggle={(value) => setFilters((current) => ({ ...current, accesses: toggle(current.accesses, value) }))}
              />

              {/* 来源在年収より上：応募経路の混在（ワークポート起票以降 6 経路超）で、
                  「どこ由来の求人か」が年収より先に効く絞り込みになった（2026-07-27 本人指示）。 */}
              <FilterChips
                label={t("来源")}
                options={facetOptions(facets.sources, filters.sources)}
                selected={filters.sources}
                onToggle={(value) => setFilters((current) => ({ ...current, sources: toggle(current.sources, value) }))}
              />

              <div className="job-filter-row">
                <span className="job-filter-label">{t("年収上限")}</span>
                <div className="job-chips">
                  {SALARY_STEPS.map((step) => {
                    const count = facets.salaryPool.filter((job) => (job.salary.max ?? 0) >= step).length;
                    const active = filters.minSalary === step;
                    return (
                      <button
                        key={step}
                        type="button"
                        className={`job-chip${active ? " active" : ""}${count === 0 && !active ? " empty" : ""}`}
                        aria-pressed={active}
                        onClick={() => setFilters((current) => ({ ...current, minSalary: step }))}
                      >
                        <span>{step === 0 ? t("全部") : `${step}万+`}</span> <small>{count}</small>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className={`job-chip${filters.remoteOnly ? " active" : ""}${facets.remote === 0 && !filters.remoteOnly ? " empty" : ""}`}
                    aria-pressed={filters.remoteOnly}
                    onClick={() => setFilters((current) => ({ ...current, remoteOnly: !current.remoteOnly }))}
                  >
                    <span>{t("リモート可")}</span> <small>{facets.remote}</small>
                  </button>
                </div>
              </div>

              <FilterChips
                label={t("技術スタック")}
                collapseAfter={12}
                options={facetOptions(facets.stacks, filters.stacks)}
                selected={filters.stacks}
                onToggle={(value) => setFilters((current) => ({ ...current, stacks: toggle(current.stacks, value) }))}
              />

              <FilterChips
                label={t("勤務地")}
                options={facetOptions(facets.regions, filters.regions)}
                selected={filters.regions}
                onToggle={(value) => setFilters((current) => ({ ...current, regions: toggle(current.regions, value) }))}
              />

              <FilterChips
                label={t("原文核对")}
                options={VERIFICATIONS.map((key) => ({
                  value: key,
                  label: menuLabel(VERIFICATION_LABEL[key]),
                  count: facets.verifications.get(key) ?? 0,
                }))}
                selected={filters.verifications}
                onToggle={(value) =>
                  setFilters((current) => ({
                    ...current,
                    verifications: toggle(current.verifications, value as JobVerification),
                  }))
                }
              />
            </div>
          </div>
        </details>

        <div className="jobs-results">
          <div className="jobs-toolbar">
            <div className="job-search">
              <span aria-hidden="true">⌕</span>
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("搜索公司、职位、技术栈、推荐理由…")}
                aria-label={t("搜索推荐岗位")}
              />
              {query ? (
                <button type="button" className="job-search-clear" onClick={() => setQuery("")} aria-label={t("清空搜索")}>×</button>
              ) : (
                <kbd>/</kbd>
              )}
            </div>
            <label className="job-sort">
              <span>{t("排序")}</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as JobSort)}>
                {JOB_SORTS.map((option) => (
                  <option key={option.id} value={option.id}>{menuLabel(option.label)}</option>
                ))}
              </select>
            </label>
            <div className="jobs-view-switch" role="group" aria-label={t("视图切换")}>
              {VIEW_MODES.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  className={viewMode === mode.id ? "active" : undefined}
                  aria-pressed={viewMode === mode.id}
                  onClick={() => setViewMode(mode.id)}
                >
                  {menuLabel(mode.label)}
                </button>
              ))}
            </div>
          </div>

          {isJobList && (
            <div className="jobs-result-bar">
              <span>
                {highlightedNextPick ? `${t("其余")} ` : ""}<strong>{listedJobs.length}</strong> / {jobs.length} {t("条")}
                {query && <> · {t("关键词")}「{query.trim()}」</>}
              </span>
              <span className="jobs-filter-count">{t("已选 {count} 个筛选", { count: shownFilterCount })}</span>
            </div>
          )}

          {jobs.length === 0 && loading && <ScopeLoading label={t("岗位机会")} />}

          {jobs.length === 0 && !loading && (
            <div className="jobs-empty">
              <p>还没有可以展示的岗位机会。</p>
              <small>在 Vault 的 <code>20_求職/</code> 下新建 <code>type: job-case</code> 的应募案件即可显示；AI 推荐只是 <code>origin</code> 的一种。</small>
            </div>
          )}

          {jobs.length > 0 && isJobList && matchedJobs.length === 0 && (
            <div className="jobs-empty">
              <p>没有岗位同时满足这些条件。</p>
              <button type="button" className="job-detail" onClick={resetFilters}>{t("清空筛选")}</button>
            </div>
          )}

          {jobs.length > 0 && highlightedNextPick && resultVisible.length === 0 && (
            <div className="jobs-featured-only">当前筛选下只有上方这一项需要判断。</div>
          )}

          {jobs.length > 0 && viewMode === "card" && resultVisible.length > 0 && (
            <div className="jobs-grid">
              {resultVisible.map((job) => (
                <JobCardView
                  key={job.path}
                  job={job}
                  query={query}
                  today={today}
                  compared={comparePaths.includes(job.path)}
                  compareFull={compareFull}
                  saving={savingPaths.includes(job.path)}
                  onDetail={() => openDetail(job.path)}
                  onCompare={() => toggleCompare(job.path)}
                  onStatus={(status, note, channel) => changeStatus(
                    job.path,
                    status,
                    note,
                    channel,
                    job.note.stat.mtime,
                  )}
                />
              ))}
            </div>
          )}

          {jobs.length > 0 && viewMode === "decision" && visible.length > 0 && decisionDetail && (
            <JobDecisionWorkspace
              jobs={visible}
              selected={decisionDetail}
              today={today}
              saving={savingPaths.includes(decisionDetail.path)}
              onSelect={setDetailPath}
              onStatus={(status, note, channel) => changeStatus(
                decisionDetail.path,
                status,
                note,
                channel,
                decisionDetail.note.stat.mtime,
              )}
              onOpenNote={() => onOpen(decisionDetail.note)}
            />
          )}

          {jobs.length > 0 && viewMode === "list" && resultVisible.length > 0 && (
            <JobListView jobs={resultVisible} query={query} today={today} onDetail={openDetail} />
          )}

          {jobs.length > 0 && viewMode === "kanban" && kanbanJobs.length > 0 && (
            <JobKanbanView columns={kanbanColumns} query={query} onDetail={openDetail} />
          )}

          {jobs.length > 0 && viewMode === "weekly" && (
            <JobWeeklyView
              offset={weekOffset}
              range={week.label}
              kpis={weekKpis}
              events={weekEvents}
              focus={nextFocus}
              review={weekReview}
              onShift={(delta) => setWeekOffset((current) => current + delta)}
              onDetail={openDetail}
              onOpenReview={onOpen}
              onWiki={openWikiLink}
            />
          )}
        </div>
      </div>

      {compared.length > 0 && (
        <div className="job-compare-tray" role="region" aria-label={t("对比候选")}>
          <span className="job-compare-count">{compared.length} / {COMPARE_LIMIT} {t("已选")}</span>
          <div className="job-compare-items">
            {compared.map((job) => (
              <button key={job.path} type="button" onClick={() => toggleCompare(job.path)}>
                {job.company} <i aria-hidden="true">×</i>
              </button>
            ))}
          </div>
          <button
            type="button"
            className="job-compare-open"
            onClick={() => setCompareOpen(true)}
            disabled={compared.length < 2}
          >
            {t("并排对比")}
          </button>
          <button type="button" className="job-compare-clear" onClick={() => { setComparePaths([]); setCompareOpen(false); }}>{t("清空")}</button>
        </div>
      )}

      {detail && viewMode !== "decision" && (
        <JobDrawer
          key={detail.path}
          job={detail}
          notes={notes}
          today={today}
          saving={savingPaths.includes(detail.path)}
          compared={comparePaths.includes(detail.path)}
          compareFull={compareFull}
          onClose={closeDetail}
              onStatus={(status, note, channel) => changeStatus(
                detail.path,
                status,
                note,
                channel,
                detail.note.stat.mtime,
              )}
          onFollowUp={(values) => changeFollowUp(detail.path, values, detail.note.stat.mtime)}
          onCompare={() => toggleCompare(detail.path)}
          onOpenNote={(note) => onOpen(note ?? detail.note)}
        />
      )}

      {compareOpen && compared.length >= 2 && (
        <JobCompare jobs={compared} onClose={() => setCompareOpen(false)} onDetail={(path) => {
          setCompareOpen(false);
          openDetail(path);
        }} />
      )}

      {/*
        🔴 書込み失敗の表示は**ここ一箇所だけ**。操作部品の隣に出す案を2回試して2回とも
        見えなくなった：①部品ローカル state → 応答前に抽屉を閉じるとアンマウントで消える
        ②カードにインライン → そのカードがスクロール外なら結局見えない。
        描画場所を増やすたびに「見えない条件」が増えるので、
        マウント状態にもスクロール位置にもビュー種別にも依存しない固定層に集約する。
        会社名を必ず添えるので、部品から離れてもどの案件か 迷わない。
      */}
      {Object.keys(statusErrors).length > 0 && (
        <div className="job-status-orphan-alerts" role="alert">
          {Object.entries(statusErrors).map(([path, message]) => (
            <p key={path}>
              <b>{jobs.find((job) => job.path === path)?.company ?? noteBasename(path)}</b>
              <span>没有写入。{message}</span>
              <button type="button" onClick={() => dismissStatusError(path)} aria-label={t("关闭提示")}>×</button>
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * 状態と**その理由**を1つの操作にまとめる。7 枚举だけでは「募集終了」「推薦不可」「取扱終了」が
 * 全部ただの `不採用` に潰れ、後から死因を追えなくなる（2026-07-30 ミロク情報サービスの
 * 募集終了で表面化）。プルダウンは今までどおり1操作で確定し、理由は任意で足す形にしてある。
 */
function StatusPicker({
  value,
  note,
  channel,
  sourceGuess,
  today,
  saving,
  expectedMtime,
  onChange,
}: {
  value: string;
  note: string;
  /** ノートの frontmatter `channel`。空なら応募記録なし＝応募済系へ変える時に選ばせる。 */
  channel: string;
  /** 求人の source。既知の渠道と一致すればセレクトの初期値に使う（Findy 起点なら Findy が既定）。 */
  sourceGuess: string;
  today: string;
  saving: boolean;
  /** 上一次已知的笔记 mtime：写入时带上，服务端不一致就 409。 */
  expectedMtime?: number;
  onChange: (
    status: string,
    note: string,
    channel?: string,
    expectedMtime?: number,
  ) => Promise<string | null>;
}) {
  const { t } = useJobMenu();
  const customValue = value && !isJobStatus(value) ? value : null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // 応募済系を選んだが channel が無い：即座に拒否せず、ここに保留して渠道を選ばせる。
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [channelDraft, setChannelDraft] = useState("");
  const draftError = jobStatusNoteError(draft);

  const openEditor = () => {
    // 既存注記があれば編集、無ければ vault 表記（日付が先頭）の書き出しを置いておく。
    // channel パネルとは排他：どちらの操作が進行中か読めなくなるので同時には開かない。
    setPendingStatus(null);
    setDraft(note || `${today}・`);
    setEditing(true);
  };

  const submit = async () => {
    if (draftError) return;
    if (!(await onChange(value, draft, undefined, expectedMtime))) setEditing(false);
  };

  const pickStatus = (next: string) => {
    // channel 必須の状態（応募済〜不採用）へ、応募記録の無い案件を動かす時だけ渠道を聞く。
    // API はどのみち拒否するので、先に聞く方が「ボタンがあるのに使えない」を消せる。
    if (statusRequiresChannel(next) && !channel) {
      setEditing(false);
      // source 表記は channel の語彙と少しずれる（RA だけ日英が逆）。一致した時だけ初期値にする。
      const guess = (KNOWN_CHANNELS as readonly string[]).includes(sourceGuess)
        ? sourceGuess
        : sourceGuess === "リクルートエージェント" ? "Recruit Agent" : "";
      setChannelDraft(guess);
      setPendingStatus(next);
      return;
    }
    setPendingStatus(null);
    void onChange(next, "", undefined, expectedMtime);
  };

  const submitChannel = async () => {
    // Enter 連打での同一ノートへの並行 POST を塞ぐ（保存ボタンは disabled で守られている）。
    if (saving || !pendingStatus || !channelDraft) return;
    if (!(await onChange(pendingStatus, "", channelDraft, expectedMtime))) setPendingStatus(null);
  };

  return (
    <div className="job-status-control" onClick={(event) => event.stopPropagation()}>
      <div className="job-status-row">
        <label
          className={`job-status-picker tone-${statusTone(value)}${saving ? " saving" : ""}`}
          title={customValue ?? undefined}
        >
          <select
            value={value}
            disabled={saving}
            aria-label={t("应募状态")}
            onChange={(event) => pickStatus(event.target.value)}
          >
            {customValue && <option value={customValue}>{customValue}</option>}
            {JOB_STATUSES.map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
          <span aria-hidden="true">{saving ? t("写入中…") : value}</span>
        </label>
        <button
          type="button"
          className={`job-status-note-toggle${note ? " filled" : ""}`}
          disabled={saving}
          aria-expanded={editing}
          title={note ? t("理由：{note}", { note }) : t("给这个状态补一句理由")}
          onClick={() => (editing ? setEditing(false) : openEditor())}
        >
          {note ? "✎" : "＋"}
        </button>
      </div>

      {note && !editing && <p className="job-status-note">{note}</p>}

      {pendingStatus && (
        <div className="job-status-note-edit job-status-channel-edit">
          <select
            value={channelDraft}
            autoFocus
            aria-label={t("投递渠道")}
            onChange={(event) => setChannelDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") { event.preventDefault(); void submitChannel(); }
              // 途中破棄が抽屉ごと閉じる巻き添えにならないよう、Escape はここで止める。
              if (event.key === "Escape") { event.stopPropagation(); setPendingStatus(null); }
            }}
          >
            <option value="">{t("投递渠道…")}</option>
            {KNOWN_CHANNELS.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          <button type="button" disabled={saving || !channelDraft} onClick={() => void submitChannel()}>
            {t("保存")}
          </button>
          <button type="button" onClick={() => setPendingStatus(null)}>{t("取消")}</button>
          <small className="job-status-channel-hint">
            「{pendingStatus}」需要记下实际投递渠道（写入 channel，台帳按渠道统计到达率）。没投过就选「保留」并写理由。
          </small>
        </div>
      )}

      {editing && (
        <div className="job-status-note-edit">
          <input
            type="text"
            value={draft}
            autoFocus
            maxLength={JOB_STATUS_NOTE_MAX}
            placeholder={t("例：2026-07-30・募集終了で応募機会なし")}
            aria-label={t("状态理由")}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") { event.preventDefault(); void submit(); }
              if (event.key === "Escape") setEditing(false);
            }}
          />
          <button type="button" disabled={saving || Boolean(draftError)} onClick={() => void submit()}>
            {t("保存")}
          </button>
          <button type="button" onClick={() => setEditing(false)}>{t("取消")}</button>
          {draftError && <small className="job-status-note-error">{draftError}</small>}
        </div>
      )}
    </div>
  );
}

function JobCardView({
  job,
  query,
  today,
  compared,
  compareFull,
  saving,
  onDetail,
  onCompare,
  onStatus,
}: {
  job: JobCard;
  query: string;
  today: string;
  compared: boolean;
  compareFull: boolean;
  saving: boolean;
  onDetail: () => void;
  onCompare: () => void;
  onStatus: (
    status: string,
    note: string,
    channel?: string,
    expectedMtime?: number,
  ) => Promise<string | null>;
}) {
  const { t, label: menuLabel } = useJobMenu();
  return (
    <article className={`job-card${compared ? " compared" : ""}`} onClick={onDetail}>
      <header className="job-card-head">
        <div className="job-card-id">
          <span
            className={`job-rate-badge rate-${rateTone(job.rating)}`}
            role="img"
            aria-label={job.rated ? t("応募优先度 {score}，满分 10", { score: job.rating }) : t("未採点（求人原文を読んでいない）")}
            title={job.rated ? undefined : t("未採点（求人原文を読んでいない）")}
          >
            {rateText(job)}
          </span>
          <div className="job-card-titles">
            <h2><Highlight text={job.company} query={query} /></h2>
            {job.position && <p className="job-position"><Highlight text={job.position} query={query} /></p>}
          </div>
        </div>
        <span className="job-card-marks">
          {job.fit && <FitChip fit={job.fit} />}
          <span className={`job-verify verify-${job.verification}`} title={t("求人原文：{label}", { label: menuLabel(VERIFICATION_LABEL[job.verification]) })}>{menuLabel(VERIFICATION_LABEL[job.verification])}</span>
        </span>
      </header>

      <div className="job-salary-row">
        {/* 解析不出年収区间时退回笔记原文，字号跟着降下来，免得一行长文顶掉卡片的层级。 */}
        <span className={`job-salary-figure${job.salary.min === null ? " is-text" : ""}`}>{salaryLabel(job)}</span>
        <span className="job-rate-meta">応募优先度 {job.rating}/10</span>
      </div>

      {/* 入库日は常に出す：欠けている（＝「入库日不明」）ことも読み取れる情報なので黙って消さない。 */}
      <div className="job-facts">
        <span
          className={`job-intake tone-${intakeTone(jobIntake(job.date, today))}`}
          title={job.date ? t("入库日 {date}", { date: job.date }) : t("笔记 frontmatter 里没有 date")}
        >
          入库 {intakeLabel(job.date, today)}
        </span>
        {/* 応募日は「投げてから何日たったか」を出すために入库日とは別に見せる。
            入库日で代用すると 7/20 に入って 7/24 に投げた案件が4日ずれる。 */}
        {job.appliedOn && (
          <span className="job-applied" title={t("応募日 {date}", { date: job.appliedOn })}>
            応募 {shortDay(job.appliedOn)}
            <em>{elapsedLabel(job.appliedOn, today)}</em>
          </span>
        )}
        {job.employment && <span>{job.employment}</span>}
        {job.location && <span><Highlight text={job.location} query={query} /></span>}
        {job.remote && <span className="job-remote">{t("リモート可")}</span>}
      </div>

      {job.stack.length > 0 && (
        <div className="job-stack">
          {job.stack.slice(0, 7).map((tag) => <span key={tag}><Highlight text={tag} query={query} /></span>)}
          {job.stack.length > 7 && <span className="job-stack-more">+{job.stack.length - 7}</span>}
        </div>
      )}

      {job.reason && (
        <div className="job-block">
          <span className="job-block-label">推荐理由</span>
          <p><Highlight text={clip(job.reason, 92)} query={query} /></p>
        </div>
      )}

      <footer className="job-card-foot" onClick={(event) => event.stopPropagation()}>
        <StatusPicker
              value={job.status}
              note={job.statusNote}
              channel={job.channel}
              sourceGuess={job.sourceGroup}
              today={today}
              saving={saving}
              expectedMtime={job.note.stat.mtime}
              onChange={onStatus}
            />
        <button
          type="button"
          className={compared ? "job-compare-toggle active" : "job-compare-toggle"}
          aria-pressed={compared}
          disabled={!compared && compareFull}
          title={!compared && compareFull ? t("最多同时对比 {count} 个岗位", { count: COMPARE_LIMIT }) : t("加入对比")}
          onClick={onCompare}
        >
          {compared ? t("已加入对比") : t("对比")}
        </button>
        <button type="button" className="job-detail" onClick={onDetail}>{t("详情")}</button>
        {job.officialApplyUrl && (
          <a
            className="job-link job-official-link"
            href={job.officialApplyUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
          >
            {job.officialApplyStatus === "exact" ? t("官网直投 ↗") : job.officialApplyStatus === "related" ? t("官网相近职位 ↗") : t("官网招聘 ↗")}
          </a>
        )}
        {job.url && job.url !== job.officialApplyUrl && (
          <a
            className="job-link"
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
          >
            求人票 ↗
          </a>
        )}
      </footer>
    </article>
  );
}

function JobDecisionWorkspace({
  jobs,
  selected,
  today,
  saving,
  onSelect,
  onStatus,
  onOpenNote,
}: {
  jobs: JobCard[];
  selected: JobCard;
  today: string;
  saving: boolean;
  onSelect: (path: string) => void;
  onStatus: (
    status: string,
    note: string,
    channel?: string,
    expectedMtime?: number,
  ) => Promise<string | null>;
  onOpenNote: () => void;
}) {
  const { t, label: menuLabel } = useJobMenu();
  return (
    <div className="jobs-decision-workspace">
      <aside className="jobs-decision-queue" aria-label={t("机会队列")}>
        <header><strong>{t("待判断机会")}</strong><span>{jobs.length}</span></header>
        {jobs.map((job, index) => (
          <button
            key={job.path}
            className={job.path === selected.path ? "active" : ""}
            onClick={() => onSelect(job.path)}
          >
            <span className={`job-rate-badge rate-${rateTone(job.rating)}`} title={job.rated ? undefined : t("未採点（求人原文を読んでいない）")}>{rateText(job)}</span>
            <span>
              <small>
                {String(index + 1).padStart(2, "0")} ·{" "}
                {awaitingCounterpart(job) ? `${job.status}（已动手·等对方）` : job.status}
              </small>
              <strong>{job.company}</strong>
              <em>{job.position || "职位未记录"}</em>
            </span>
          </button>
        ))}
      </aside>

      <article className="jobs-decision-detail">
        <header>
          <div>
            <span>{ORIGIN_LABEL[selected.origin] ?? "岗位机会"} · 応募优先度 {selected.rating}/10{selected.fit && ` · Fit ${selected.fit.score} · Band ${selected.fit.band}`}</span>
            <h2>{selected.company}</h2>
            <p>{selected.position || "职位未记录"}</p>
          </div>
          <StatusPicker
            key={selected.path}
            value={selected.status}
            note={selected.statusNote}
            channel={selected.channel}
            sourceGuess={selected.sourceGroup}
            today={today}
            saving={saving}
            expectedMtime={selected.note.stat.mtime}
            onChange={onStatus}
          />
        </header>
        <dl>
          <div><dt>年収</dt><dd>{salaryLabel(selected)}</dd></div>
          <div><dt>v2 採点</dt><dd>{selected.fit ? `Fit ${selected.fit.score} · Band ${selected.fit.band} · Gate ${HARD_GATE_LABEL[selected.fit.hardGate]}` : UNRATED_V2_LABEL}</dd></div>
          <div><dt>勤務地</dt><dd>{selected.location || "—"}</dd></div>
          <div><dt>原文</dt><dd>{VERIFICATION_LABEL[selected.verification]}</dd></div>
          <div><dt>入库</dt><dd>{selected.date || "—"}</dd></div>
        </dl>
        {selected.reason && <section><h3>为什么值得判断</h3><p>{selected.reason}</p></section>}
        {selected.caution && <section className="is-caution"><h3>应募前确认</h3><p>{selected.caution}</p></section>}
        {selected.matches.length > 0 && (
          <section><h3>岗位契合点</h3><ul>{selected.matches.slice(0, 5).map((item, index) => <li key={index}>{item}</li>)}</ul></section>
        )}
        <footer>
          {selected.officialApplyUrl && (
            <a href={selected.officialApplyUrl} target="_blank" rel="noopener noreferrer">{t("官网应募 ↗")}</a>
          )}
          {selected.url && selected.url !== selected.officialApplyUrl && (
            <a href={selected.url} target="_blank" rel="noopener noreferrer">{t("查看求人原文 ↗")}</a>
          )}
          <button type="button" onClick={onOpenNote}>{menuLabel(OPEN_NOTE_LABEL)}</button>
        </footer>
      </article>
    </div>
  );
}

/** 列表视图：一行一个岗位，密度最高，用来快速扫全量结果。 */
function JobListView({
  jobs,
  query,
  today,
  onDetail,
}: {
  jobs: JobCard[];
  query: string;
  today: string;
  onDetail: (path: string) => void;
}) {
  const { t, label: menuLabel } = useJobMenu();
  return (
    <div className="job-list">
      <div className="job-list-head" aria-hidden="true">
        <span>{t("公司 / 职位")}</span>
        <span>{t("匹配")}</span>
        <span>{t("年収")}</span>
        <span>{t("技術スタック")}</span>
        <span>{t("入库")}</span>
        <span>{t("状态")}</span>
        <span>{t("核对")}</span>
      </div>
      {jobs.map((job) => (
        <button key={job.path} type="button" className="job-list-row" onClick={() => onDetail(job.path)}>
          <span className="job-list-title">
            <strong><Highlight text={job.company} query={query} /></strong>
            <small><Highlight text={job.position || "—"} query={query} /></small>
          </span>
          <span className={`job-list-rate rate-${rateTone(job.rating)}`} title={job.rated ? undefined : t("未採点（求人原文を読んでいない）")}>{rateText(job)}</span>
          <span className="job-list-salary">{salaryLabel(job)}</span>
          <span className="job-list-stack">
            {job.stack.map((tag) => <i key={tag}>{tag}</i>)}
          </span>
          {/* 「入库时间」で並べ替えても列がないと順序の根拠が読めないので、リストにも出す。 */}
          <span
            className={`job-list-intake tone-${intakeTone(jobIntake(job.date, today))}`}
            title={job.date ? t("入库日 {date}", { date: job.date }) : t("笔记 frontmatter 里没有 date")}
          >
            {intakeLabel(job.date, today)}
          </span>
          <span className={`job-status-pill tone-${statusTone(job.status)}`} title={job.status}>{job.status}</span>
          <span className={`job-verify verify-${job.verification}`} title={t("求人原文：{label}", { label: menuLabel(VERIFICATION_LABEL[job.verification]) })}>{menuLabel(VERIFICATION_LABEL[job.verification])}</span>
        </button>
      ))}
    </div>
  );
}

/** 看板视图：按 `status` 分列，列顺序即 `JOB_STATUSES`。结构按拖拽改状态预留。 */
function JobKanbanView({
  columns,
  query,
  onDetail,
}: {
  columns: { status: string; jobs: JobCard[] }[];
  query: string;
  onDetail: (path: string) => void;
}) {
  const { t } = useJobMenu();
  return (
    <div className="job-kanban">
      {columns.map((column) => (
        <section key={column.status} className={`job-kanban-col tone-${statusTone(column.status)}`}>
          <header className="job-kanban-head">
            <strong title={column.status}>{column.status}</strong>
            <span>{column.jobs.length}</span>
          </header>
          <div className="job-kanban-body">
            {column.jobs.map((job) => (
              <button
                key={job.path}
                type="button"
                className={`job-kanban-card rate-${rateTone(job.rating)}`}
                onClick={() => onDetail(job.path)}
              >
                <span className="job-kanban-title">
                  <strong><Highlight text={job.company} query={query} /></strong>
                  <i title={job.rated ? undefined : t("未採点")}>{rateText(job)}</i>
                </span>
                <small><Highlight text={job.position || "—"} query={query} /></small>
                <span className="job-kanban-salary">{salaryLabel(job)}</span>
              </button>
            ))}
            {column.jobs.length === 0 && <span className="job-kanban-empty">—</span>}
          </div>
        </section>
      ))}
    </div>
  );
}

/** 周复盘：证据层口径来自笔记的 `status` + `status_updated`（缺则退回 `date`），不掺 AI 打分；叙事层显示本周的週次復盤笔记。 */
function JobWeeklyView({
  offset,
  range,
  kpis,
  events,
  focus,
  review,
  onShift,
  onDetail,
  onOpenReview,
  onWiki,
}: {
  offset: number;
  range: string;
  kpis: { label: string; tone: string; value: number }[];
  events: JobCard[];
  focus: { path: string; company: string; action: string }[];
  review: Note | null;
  onShift: (delta: number) => void;
  onDetail: (path: string) => void;
  onOpenReview: (note: Note) => void;
  onWiki: (target: string) => void;
}) {
  const { t, label: menuLabel } = useJobMenu();
  const title = offset === 0 ? t("本周复盘") : offset < 0 ? t("{count} 周前", { count: -offset }) : t("{count} 周后", { count: offset });
  return (
    <div className="job-week">
      <div className="job-week-nav">
        <button type="button" onClick={() => onShift(-1)} aria-label={t("上一周")}>‹</button>
        <div>
          <strong>{title}</strong>
          <span>{range}</span>
        </div>
        <button type="button" onClick={() => onShift(1)} aria-label={t("下一周")}>›</button>
      </div>

      <div className="job-week-kpis">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="job-week-kpi">
            <strong className={`tone-${kpi.tone}`}>{kpi.value}</strong>
            <span>{kpi.label}</span>
          </div>
        ))}
      </div>

      <div className="job-week-split">
        {/* 只有时间线是按周口径的，翻周落空时别把另外三个全量 KPI 和待办也一起藏掉。 */}
        <section className="job-week-panel">
          <span className="job-week-label">本周动态 · TIMELINE</span>
          {events.length === 0 ? (
            <p className="job-week-blank">这一周还没有求职记录。</p>
          ) : (
            <div className="job-week-timeline">
              {events.map((job) => (
                <button key={job.path} type="button" className="job-week-event" onClick={() => onDetail(job.path)}>
                  <time>{dayLabel(eventDay(job))}</time>
                  <span>
                    <i className={`tone-${statusTone(job.status)}`} aria-hidden="true" />
                    <strong>{job.company}</strong>
                    <small>{eventLabel(job)}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        <div className="job-week-side">
          <section className="job-week-panel">
            <span className="job-week-label">下周重点 · NEXT</span>
            <div className="job-week-focus">
              {focus.length === 0 && <p className="panel-empty">现在没有需要跟进的选考。</p>}
              {focus.map((item) => (
                <button key={item.path} type="button" onClick={() => onDetail(item.path)}>
                  <i aria-hidden="true" />
                  <span>
                    <strong>{item.company}</strong>
                    <small>{item.action}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="job-week-note">
            <span>复盘提醒</span>
            <p>本周动态来自笔记的状态与日期字段，属于「证据层」；応募优先度是时间分配判断，不代表录用概率。</p>
          </section>
        </div>
      </div>

      <section className="job-week-panel job-week-review">
        <span className="job-week-label">本周复盘笔记 · REVIEW</span>
        {review ? (
          <>
            <div className="job-week-review-head">
              <strong>{getTitle(review)}</strong>
              <button type="button" className="job-week-review-open" onClick={() => onOpenReview(review)}>
                {menuLabel(OPEN_NOTE_LABEL)}
              </button>
            </div>
            {/* 与原笔记 drawer 同一个渲染器：私有的简版解析器漏掉了代码块・callout・外链，两处读到的不是同一篇。 */}
            <div className="job-week-md">
              <MarkdownDocument content={review.content} onWikiLink={onWiki} />
            </div>
          </>
        ) : (
          <p className="job-week-review-empty">
            这一周还没有叙事复盘。在 <code>80_AI分析/</code> 新建 <code>YYYY-MM-DD_週次復盤_主题.md</code>
            （type: ai-report，date 落在本周），这里就会自动显示。
          </p>
        )}
      </section>
    </div>
  );
}

function DetailList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <section className="job-detail-block">
      <h3>{title}</h3>
      <ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul>
    </section>
  );
}

function JobDrawer({
  job,
  notes,
  today,
  saving,
  compared,
  compareFull,
  onClose,
  onStatus,
  onFollowUp,
  onCompare,
  onOpenNote,
}: {
  job: JobCard;
  notes: Note[];
  today: string;
  saving: boolean;
  compared: boolean;
  compareFull: boolean;
  onClose: () => void;
  onStatus: (
    status: string,
    note: string,
    channel?: string,
    expectedMtime?: number,
  ) => Promise<string | null>;
  onFollowUp: (values: {
    waitingFor: string | null;
    followUpAt: string | null;
    nextEventAt: string | null;
  }) => Promise<string | null>;
  onCompare: () => void;
  onOpenNote: (note?: Note) => void;
}) {
  const { t, label: menuLabel } = useJobMenu();
  const intakeAge = intakeRelative(job.date, today);
  const dialogRef = useRef<HTMLElement>(null);
  useDialogFocus(dialogRef);
  const [waitingFor, setWaitingFor] = useState(job.waitingFor);
  const [followUpAt, setFollowUpAt] = useState(job.followUpAt);
  const [nextEventAt, setNextEventAt] = useState(job.nextEventAt);
  const [followUpSaving, setFollowUpSaving] = useState(false);
  const [followUpMessage, setFollowUpMessage] = useState("");
  const related = job.caseId
    ? notes.filter((note) => note.path !== job.path && getString(note.frontmatter.case_id) === job.caseId)
    : [];
  const saveFollowUp = async () => {
    setFollowUpSaving(true);
    setFollowUpMessage("");
    const error = await onFollowUp({
      waitingFor: waitingFor || null,
      followUpAt: followUpAt || null,
      nextEventAt: nextEventAt || null,
    });
    setFollowUpMessage(error || "跟进信息已写入 Vault。");
    setFollowUpSaving(false);
  };
  return (
    <div
      className="drawer-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <aside ref={dialogRef} tabIndex={-1} className="note-drawer job-drawer" aria-label={t("岗位详情")} aria-modal="true" role="dialog">
        <header className="drawer-header">
          <div>
            <span style={{ color: "var(--green)" }}>{ORIGIN_LABEL[job.origin] ?? "岗位机会"}</span>
            <small>{job.path}</small>
          </div>
          <button onClick={onClose} aria-label={t("关闭详情")}>×</button>
        </header>
        <div className="drawer-scroll">
          <div className="job-detail-head">
            <div>
              <h1>{job.company}</h1>
              {job.position && <p className="job-position">{job.position}</p>}
            </div>
            <div className={`job-rating job-rating-large rate-${rateTone(job.rating)}`}>
              <span className="job-score">
                <b>{rateText(job)}</b>
                <small>{job.rated ? "/10" : "未採点"}</small>
              </span>
              <span className="job-meter"><i style={{ width: `${job.rated ? job.rating * 10 : 0}%` }} /></span>
            </div>
          </div>

          <FitPanel fit={job.fit} />

          <div className="job-detail-actions">
            <StatusPicker
              value={job.status}
              note={job.statusNote}
              channel={job.channel}
              sourceGuess={job.sourceGroup}
              today={today}
              saving={saving}
              expectedMtime={job.note.stat.mtime}
              onChange={onStatus}
            />
            {/* 列表 / 看板 / 周复盘视图里没有对比按钮，都从详情这里加入。 */}
            <button
              type="button"
              className={compared ? "job-compare-toggle active" : "job-compare-toggle"}
              aria-pressed={compared}
              disabled={!compared && compareFull}
              title={!compared && compareFull ? t("最多同时对比 {count} 个岗位", { count: COMPARE_LIMIT }) : t("加入对比")}
              onClick={onCompare}
            >
              {compared ? t("已加入对比") : t("对比")}
            </button>
            {job.officialApplyUrl && (
              <a className="job-link job-official-link" href={job.officialApplyUrl} target="_blank" rel="noopener noreferrer">
                {job.officialApplyStatus === "exact" ? t("官网直投 ↗") : job.officialApplyStatus === "related" ? t("官网相近职位 ↗") : t("官网招聘 ↗")}
              </a>
            )}
            {job.url && job.url !== job.officialApplyUrl && (
              <a className="job-link" href={job.url} target="_blank" rel="noopener noreferrer">{t("求人票 ↗")}</a>
            )}
            <button type="button" className="job-detail" onClick={() => onOpenNote()}>{menuLabel(OPEN_NOTE_LABEL)}</button>
          </div>

          <dl className="job-detail-facts">
            <div><dt>年収</dt><dd>{job.salaryText || "—"}</dd></div>
            <div><dt>勤務地</dt><dd>{job.location || "—"}</dd></div>
            <div><dt>雇用形態</dt><dd>{job.employment || "—"}</dd></div>
            <div><dt>来源</dt><dd>{job.source || "—"}</dd></div>
            <div><dt>录入方式</dt><dd>{ORIGIN_LABEL[job.origin] ?? (job.origin || "—")}</dd></div>
            <div><dt>案件 ID</dt><dd>{job.caseId || "—"}</dd></div>
            <div><dt>官方渠道</dt><dd>{OFFICIAL_APPLY_LABEL[job.officialApplyStatus]}{job.officialApplyNote ? ` · ${job.officialApplyNote}` : ""}</dd></div>
            {/* 「推荐日期」だと応募日と紛らわしい。frontmatter `date` は AI 推薦が入库した日。 */}
            <div><dt>入库日</dt><dd>{job.date ? `${job.date}${intakeAge && ` · ${intakeAge}`}` : "—"}</dd></div>
            <div><dt>笔记更新</dt><dd>{formatDate(job.updatedAt, true)}</dd></div>
          </dl>

          <section className="job-case-workspace" aria-label={t("案件推进")}>
            <div className="job-case-workspace-head">
              <div>
                <span>CASE WORKSPACE</span>
                <h2>{t("下一步与承诺")}</h2>
              </div>
              <small>{job.nextAction || "尚未记录下一动作"}</small>
            </div>
            <div className="job-follow-up-form">
              <label>
                <span>{t("等待对象")}</span>
                <select value={waitingFor} onChange={(event) => setWaitingFor(event.target.value)}>
                  {WAITING_FOR_OPTIONS.map((option) => <option key={option.value} value={option.value}>{menuLabel(option.label)}</option>)}
                </select>
              </label>
              <label>
                <span>{t("跟进日期")}</span>
                <input type="date" value={followUpAt} disabled={!waitingFor} onChange={(event) => setFollowUpAt(event.target.value)} />
              </label>
              <label>
                <span>{t("下一场日程")}</span>
                <input
                  type="text"
                  value={nextEventAt}
                  placeholder="YYYY-MM-DD HH:MM"
                  onChange={(event) => setNextEventAt(event.target.value)}
                />
              </label>
              <button type="button" disabled={followUpSaving} onClick={() => void saveFollowUp()}>
                {followUpSaving ? t("写入中…") : t("保存跟进")}
              </button>
            </div>
            {followUpMessage && (
              <p className={followUpMessage.includes("已写入") ? "job-follow-up-success" : "job-status-note-error"} role="status">
                {followUpMessage}
              </p>
            )}
            {related.length > 0 && (
              <div className="job-case-related">
                <span>同一案件</span>
                {related.map((note) => (
                  <button key={note.path} type="button" onClick={() => onOpenNote(note)}>
                    {getTitle(note)} <small>{getType(note)}</small>
                  </button>
                ))}
              </div>
            )}
          </section>

          {job.verification !== "verified" && (
            <p className="job-detail-warning">
              {job.verification === "warned"
                ? "笔记里有未验证 / 需要核对的标记。应募前请自行打开求人原文确认必须要件。"
                : "这条岗位还没有求人原文核对记录。AI 打分只是假设，不能当作事实。"}
            </p>
          )}

          {job.stack.length > 0 && (
            <div className="job-stack">{job.stack.map((tag) => <span key={tag}>{tag}</span>)}</div>
          )}

          {job.reason && (
            <section className="job-detail-block">
              <h3>推荐理由</h3>
              <p>{job.reason}</p>
            </section>
          )}
          <DetailList title="匹配点" items={job.matches} />
          {job.caution && (
            <section className="job-detail-block job-detail-caution">
              <h3>注意点</h3>
              <p>{job.caution}</p>
            </section>
          )}
          <DetailList title="主打材料" items={job.materials} />
        </div>
      </aside>
    </div>
  );
}

const COMPARE_ROWS: { label: string; render: (job: JobCard) => ReactNode }[] = [
  { label: "応募优先度", render: (job) => <strong className="job-compare-rating">{job.rating} / 10</strong> },
  {
    label: "v2 採点",
    render: (job) => job.fit
      ? <><strong className="job-compare-rating">{job.fit.score}</strong> / 100 · Band {job.fit.band} · Gate {HARD_GATE_LABEL[job.fit.hardGate]}</>
      : <span className="job-compare-unrated">{UNRATED_V2_LABEL}</span>,
  },
  // 六軸は行を分けて並べる：合計だけ見ると「B 同士」で差が無いように見える案件が、軸単位では逆転している。
  ...JOB_FIT_AXES.map((key) => ({
    label: `　${JOB_FIT_SCORE_LABEL[key].label}`,
    render: (job: JobCard) => (job.fit ? `${job.fit.scores[key]} / ${JOB_FIT_SCORE_LABEL[key].max}` : "—"),
  })),
  // 年収は構造化値（salary_min/max）優先で自由文を title に残す——古い求人票の文言と採点時の確認値がずれることがある。
  { label: "年収", render: (job) => <span title={job.salaryText || undefined}>{salaryLabel(job)}</span> },
  { label: "勤務地", render: (job) => job.location || "—" },
  { label: "雇用形態", render: (job) => job.employment || "—" },
  { label: "状态", render: (job) => job.status },
  { label: "原文核对", render: (job) => VERIFICATION_LABEL[job.verification] },
  {
    label: "技術スタック",
    render: (job) => <div className="job-stack">{job.stack.map((tag) => <span key={tag}>{tag}</span>)}</div>,
  },
  { label: "推荐理由", render: (job) => job.reason || "—" },
  { label: "注意点", render: (job) => job.caution || "—" },
  {
    label: "主打材料",
    render: (job) => (job.materials.length ? <ul>{job.materials.map((item, index) => <li key={index}>{item}</li>)}</ul> : "—"),
  },
];

function JobCompare({
  jobs,
  onClose,
  onDetail,
}: {
  jobs: JobCard[];
  onClose: () => void;
  onDetail: (path: string) => void;
}) {
  const { t } = useJobMenu();
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef);
  return (
    <div
      className="job-compare-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div ref={dialogRef} tabIndex={-1} className="job-compare-panel" role="dialog" aria-modal="true" aria-label={t("岗位并排对比")}>
        <header>
          <h2>{t("并排对比")}</h2>
          <button onClick={onClose} aria-label={t("关闭对比")}>×</button>
        </header>
        <div className="job-compare-scroll">
          <table className="job-compare-table">
            <thead>
              <tr>
                <th scope="col" />
                {jobs.map((job) => (
                  <th key={job.path} scope="col">
                    <button type="button" onClick={() => onDetail(job.path)}>
                      <strong>{job.company}</strong>
                      <small>{job.position || "—"}</small>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARE_ROWS.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  {jobs.map((job) => <td key={job.path}>{row.render(job)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// 外壳的 UI state（⌘K・overlay）变化时不重渲染整个视圖。props 都是稳定引用。
export default memo(JobsView);
