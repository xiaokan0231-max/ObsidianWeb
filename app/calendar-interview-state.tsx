import type { CalendarInterviewTarget } from "@/lib/calendar-interview";
import type { UiLocale } from "@/lib/ui-locale";
import { useUiLocale } from "./ui-locale";

// 公司名、日期、轮次是 vault 原文，只翻译界面上的说明与按钮。
const STATE_COPY: Record<UiLocale, {
  label: (view: CalendarInterviewTarget["view"]) => string;
  locating: string;
  missing: (view: CalendarInterviewTarget["view"]) => string;
  missingDetail: (view: CalendarInterviewTarget["view"]) => string;
  reviewHint: (target: CalendarInterviewTarget) => string;
  source: string;
  showAll: (label: string) => string;
}> = {
  "zh-CN": {
    label: (view) => view === "session" ? "面试准备" : "面试复盘",
    locating: "正在定位本场面试…",
    missing: (view) => `本场${view === "session" ? "准备资料" : "复盘资料"}待补充`,
    missingDetail: (view) => view === "session"
      ? "还没有找到与本场日期、轮次对应的准备稿。补充后可从日历直接进入。"
      : "还没有找到与本场日期、轮次对应的面试整理稿。补充后可在这里阅读与复盘。",
    reviewHint: (target) => `下一步：把这场的录音／记录做成整理稿（${target.company} · ${target.date} · ${target.label}），再用 /review-interview-answers 复盘。`,
    source: "查看原始记录",
    showAll: (label) => `查看全部${label}`,
  },
  ja: {
    label: (view) => view === "session" ? "面接準備" : "面接の振り返り",
    locating: "この面接を探しています…",
    missing: (view) => `この回の${view === "session" ? "準備資料" : "振り返り資料"}はまだありません`,
    missingDetail: (view) => view === "session"
      ? "この日付・段階に対応する準備稿が見つかりません。追加するとカレンダーから直接開けます。"
      : "この日付・段階に対応する面接の整理稿が見つかりません。追加するとここで読んで振り返れます。",
    reviewHint: (target) => `次の一歩：この回の録音・記録を整理稿にして（${target.company} · ${target.date} · ${target.label}）、/review-interview-answers で振り返ります。`,
    source: "元の記録を見る",
    showAll: (label) => `${label}をすべて見る`,
  },
};

export default function CalendarInterviewState({ target, loading, onOpenSource, onShowAll }: {
  target: CalendarInterviewTarget;
  loading: boolean;
  onOpenSource?: () => void;
  onShowAll: () => void;
}) {
  const { locale } = useUiLocale();
  const copy = STATE_COPY[locale];
  const label = copy.label(target.view);
  return (
    <section className="prep-view interview-route-state" aria-busy={loading}>
      <div className="prep-empty">
        <span>{label} · {target.date} · {target.label}</span>
        <h1>{target.company}</h1>
        {loading ? <p role="status">{copy.locating}</p> : <>
          <h2>{copy.missing(target.view)}</h2>
          <p>{copy.missingDetail(target.view)}</p>
          {target.view === "review" && (
            <p className="interview-route-hint">{copy.reviewHint(target)}</p>
          )}
          <div className="interview-route-actions">
            {onOpenSource && <button onClick={onOpenSource}>{copy.source}</button>}
            <button onClick={onShowAll}>{copy.showAll(label)}</button>
          </div>
        </>}
      </div>
    </section>
  );
}
