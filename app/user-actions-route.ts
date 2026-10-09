import { USER_ACTION_CATEGORIES, type UserActionCategory } from "../lib/user-actions.ts";

export type UserActionsRoute = { category: UserActionCategory; actionPath: string | null };
export type UserActionsListPosition = { category: UserActionCategory; path: string; scrollY: number };

function category(value: string | null): UserActionCategory {
  return USER_ACTION_CATEGORIES.includes(value as UserActionCategory) ? value as UserActionCategory : "current";
}

/** 完整 TODO 路径是详情身份；同名公司与同名事项不能替代它。 */
export function userActionsRoute(search = ""): UserActionsRoute {
  const params = new URLSearchParams(search);
  return { category: category(params.get("category")), actionPath: params.get("action") || null };
}

export function userActionsHref(route: UserActionsRoute): string {
  const params = new URLSearchParams();
  if (route.category !== "current") params.set("category", route.category);
  if (route.actionPath) params.set("action", route.actionPath);
  const query = params.toString();
  return `/actions${query ? `?${query}` : ""}`;
}

/** 只恢复本列表自己的位置，不解释外壳或其他模块的 history 字段。 */
export function userActionsListPosition(state: unknown): UserActionsListPosition | null {
  if (!state || typeof state !== "object") return null;
  const saved = (state as Record<string, unknown>).__echoActionsList;
  if (!saved || typeof saved !== "object") return null;
  const value = saved as Record<string, unknown>;
  if (!USER_ACTION_CATEGORIES.includes(value.category as UserActionCategory) || typeof value.path !== "string"
    || typeof value.scrollY !== "number" || !Number.isFinite(value.scrollY) || value.scrollY < 0) return null;
  return { category: value.category as UserActionCategory, path: value.path, scrollY: value.scrollY };
}
