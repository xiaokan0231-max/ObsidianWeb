import type { ContextPickerGroup } from "@/lib/context-picker";
import type { InterviewCompareSummary } from "@/lib/interview-read-model";

const pages = new Map<string, Promise<unknown>>();

/** 大选择器只在打开时取目录；每页绑定同一资料版本，不预取任何笔记正文。 */
async function options<T>(revision: string, section: "picker" | "comparisons"): Promise<T[]> {
  const key = JSON.stringify([revision, section]);
  const cached = pages.get(key);
  if (cached) return cached as Promise<T[]>;
  const request = async (offset: number) => {
    const response = await fetch(`/api/interview/catalog?${new URLSearchParams({ revision, section, offset: String(offset) })}`, { cache: "no-store" });
    const result = await response.json() as { revision: string; groups?: T[]; items?: T[]; total: number; nextOffset: number | null; error?: string };
    if (!response.ok || result.revision !== revision) throw new Error(result.error || "选择目录读取失败，请刷新后重试");
    return result;
  };
  const pending = (async () => {
    const first = await request(0);
    if (first.nextOffset === null) return first.groups ?? first.items ?? [];
    const step = first.nextOffset;
    const rest = await Promise.all(Array.from({ length: Math.ceil(first.total / step) - 1 }, (_, index) => request(step * (index + 1))));
    return [first, ...rest].flatMap((page) => page.groups ?? page.items ?? []);
  })().catch((error) => { pages.delete(key); throw error; });
  pages.set(key, pending);
  // 目录小缓存保留最近三版，正文资源另由正文缓存管理。
  while (pages.size > 6) pages.delete(pages.keys().next().value!);
  return pending;
}

export async function loadInterviewPickerGroups(revision: string) {
  const result = await options<ContextPickerGroup>(revision, "picker");
  const merged = new Map<string, ContextPickerGroup>();
  for (const group of result) {
    const existing = merged.get(group.id);
    if (existing) existing.items.push(...group.items);
    else merged.set(group.id, { ...group, items: [...group.items] });
  }
  return [...merged.values()];
}
export function loadInterviewComparisons(revision: string) { return options<InterviewCompareSummary>(revision, "comparisons"); }
