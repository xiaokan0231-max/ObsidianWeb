import type { CalendarInterviewTarget } from "../lib/calendar-interview.ts";

export type AppView =
  | "overview"
  | "session"
  | "prep"
  | "review"
  | "practice"
  | "language"
  | "topics"
  | "jobs"
  | "analytics"
  | "todo"
  | "graph"
  | "calendar"
  | "timeline"
  | "library";

const VIEW_PATHS: Record<AppView, string> = {
  overview: "/",
  analytics: "/progress",
  jobs: "/jobs",
  calendar: "/calendar",
  session: "/interview",
  prep: "/interview/prep",
  review: "/interview/review",
  practice: "/interview/practice",
  language: "/training",
  topics: "/training/topics",
  library: "/library",
  timeline: "/timeline",
  graph: "/graph",
  todo: "/actions",
};

const PATH_VIEWS = new Map(
  Object.entries(VIEW_PATHS).map(([view, path]) => [path, view as AppView]),
);

function normalizedPath(pathname: string) {
  if (!pathname || pathname === "/") return "/";
  return pathname.replace(/\/+$/, "") || "/";
}

export function appViewFromPathname(pathname: string): AppView | null {
  return PATH_VIEWS.get(normalizedPath(pathname)) ?? null;
}

export function appViewHref(view: AppView, search?: URLSearchParams | string) {
  const query = typeof search === "string" ? search.replace(/^\?/, "") : search?.toString();
  return `${VIEW_PATHS[view]}${query ? `?${query}` : ""}`;
}

/** 公司画像也能独立于准备稿打开；始终保存真实案件或面谈路径。 */
export function companyOverviewSearch(company: string, contextPath: string, prepPath = "") {
  const params = new URLSearchParams();
  if (company) params.set("company", company);
  if (contextPath) params.set("context", contextPath);
  if (prepPath) params.set("prep", prepPath);
  return params;
}

/** 日历入口保留场次信息，材料尚未加载或尚未建立时也能恢复同一场面试。 */
export function calendarInterviewSearch(target: CalendarInterviewTarget) {
  const params = new URLSearchParams({
    company: target.company,
    date: target.date,
    round: target.label,
    event: target.sourcePath,
  });
  if (target.caseId) params.set("case", target.caseId);
  if (target.time) params.set("time", target.time);
  if (target.path) params.set(target.view === "session" ? "prep" : "review", target.path);
  return params;
}

export function calendarInterviewFromSearch(view: AppView, search: string): CalendarInterviewTarget | null {
  if (view !== "session" && view !== "review") return null;
  const params = new URLSearchParams(search);
  const sourcePath = params.get("event");
  const date = params.get("date") ?? "";
  if (!sourcePath || !/^20\d{2}-\d{2}-\d{2}$/.test(date)) return null;
  return {
    view,
    path: params.get(view === "session" ? "prep" : "review"),
    company: params.get("company") ?? "",
    date,
    label: params.get("round") ?? "面试",
    sourcePath,
    caseId: params.get("case") ?? "",
    time: params.get("time") || undefined,
  };
}
