import type { CalendarInterviewTarget } from "@/lib/calendar-interview";

export default function CalendarInterviewState({ target, loading, onOpenSource, onShowAll }: {
  target: CalendarInterviewTarget;
  loading: boolean;
  onOpenSource?: () => void;
  onShowAll: () => void;
}) {
  const label = target.view === "session" ? "面试准备" : "面试复盘";
  return (
    <section className="prep-view interview-route-state" aria-busy={loading}>
      <div className="prep-empty">
        <span>{label} · {target.date} · {target.label}</span>
        <h1>{target.company}</h1>
        {loading ? <p role="status">正在定位本场面试…</p> : <>
          <h2>本场{target.view === "session" ? "准备资料" : "复盘资料"}待补充</h2>
          <p>{target.view === "session"
            ? "还没有找到与本场日期、轮次对应的准备稿。补充后可从日历直接进入。"
            : "还没有找到与本场日期、轮次对应的面试整理稿。补充后可在这里阅读与复盘。"}</p>
          <div className="interview-route-actions">
            {onOpenSource && <button onClick={onOpenSource}>查看原始记录</button>}
            <button onClick={onShowAll}>查看全部{label}</button>
          </div>
        </>}
      </div>
    </section>
  );
}
