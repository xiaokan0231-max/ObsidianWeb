import type { JobBoardFilters, JobFilterKey, JobRatingBand, JobTouch } from "@/lib/jobs";

/*
 * 岗位机会各模块共用的类型。只放类型、不放运行时常量：
 * 类型模块不依赖任何组件，各模块都能引用它而不会绕出循环 import。
 */

/** 判定本体は lib/jobs.ts（統計格の件数テストが同じ関数を叩けるように）。 */
export type FilterKey = JobFilterKey;
export type Filters = JobBoardFilters;

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

export type Matcher = { tokens: string[]; pattern: RegExp } | null;

/** 按路径写入状态。卡片与看板拿同一个稳定函数，自己带上 path（见 JobCardView 的说明）。 */
export type StatusWriter = (
  path: string,
  status: string,
  note: string,
  channel?: string,
  expectedMtime?: number,
) => Promise<string | null>;
