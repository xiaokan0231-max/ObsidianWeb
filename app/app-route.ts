export type AppView =
  | "overview"
  | "session"
  | "prep"
  | "review"
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

