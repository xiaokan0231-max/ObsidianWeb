import { resolveUiMotion, UI_MOTION_KEY, UI_THEME_EVENT, type UiMotion } from "./ui-theme.ts";

/*
 * 减弱动效的唯一判定。
 *
 * CSS 那边有两道兜底：系统 prefers-reduced-motion（base.css 末尾）和设置里的「总是减弱」
 * （<html data-motion="reduce">，motion.css）。但 JS 里显式写的 smooth 滚动、rAF 数字滚动、
 * 退场计时器都绕过 CSS，只能自己问——原来各处各写一遍 matchMedia，只认系统设置，
 * 设置中心的「总是减弱」管不到它们。这里把两个来源合成一句。
 *
 * 只看 DOM 属性、不读 localStorage：属性由 layout 的首帧脚本按本机存储恢复，切换时直接改属性，
 * 所以它就是这一页的唯一真相；存储被禁用时本次切换也照样生效。
 * SSR 与 node:test 里没有 document：一律回落为「不减弱」，首帧不会因此和客户端对不上。
 */

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
export const MOTION_ATTRIBUTE = "data-motion";

/** 只取判定需要的那几个字段，测试可以传假的 scope 进来。 */
export type MotionScope = {
  document?: { documentElement?: { dataset?: Record<string, string | undefined> } };
  matchMedia?: (query: string) => { matches: boolean };
};

/** 纯函数版：给定一个环境，算出「此刻要不要减弱动效」。 */
export function reducedMotionFrom(scope: MotionScope | null | undefined): boolean {
  if (!scope) return false;
  if (scope.document?.documentElement?.dataset?.motion === "reduce") return true;
  try {
    return Boolean(scope.matchMedia?.(REDUCED_MOTION_QUERY).matches);
  } catch {
    return false;
  }
}

/**
 * 「总是减弱」或系统要求减弱时为真。不带参数：常被直接当回调传（canStartViewTransition、
 * createExitController 的 reducedMotion），带可选参数会被调用方意外塞进实参。
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  return reducedMotionFrom(window as unknown as MotionScope);
}

/** 本页当前的偏好（不是最终判定）：只认 <html data-motion>。 */
export function readMotionPreference(): UiMotion {
  if (typeof document === "undefined") return resolveUiMotion(undefined);
  return resolveUiMotion(document.documentElement.dataset.motion);
}

function applyMotionAttribute(motion: UiMotion) {
  const root = document.documentElement;
  if (motion === "reduce") root.dataset.motion = "reduce";
  else delete root.dataset.motion;
}

/**
 * 切换偏好：先改 <html> 属性（立即生效、不刷新），再尽力写本机存储，最后派发主题事件，
 * 让自己取色或自己跑动画的 canvas 有机会重设。
 */
export function writeMotionPreference(next: UiMotion): void {
  if (typeof document === "undefined") return;
  const motion = resolveUiMotion(next);
  applyMotionAttribute(motion);
  try {
    window.localStorage.setItem(UI_MOTION_KEY, motion);
  } catch {
    // 私密窗口等禁止持久化时，本次打开仍然生效，只是下次回到默认。
  }
  window.dispatchEvent(new Event(UI_THEME_EVENT));
}

/**
 * 订阅「判定可能变了」：系统设置变化、本页切换（主题事件）、其他标签页改了同一个键。
 * 其他标签页的改动只通过 storage 事件到达，这里顺手把本页属性同步过来，两页不会各说各话。
 * 给 useSyncExternalStore 用；返回取消订阅。
 */
export function subscribeMotion(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    // key 为 null 是整个存储被清空：回到默认「跟随系统」。
    if (event.key !== null && event.key !== UI_MOTION_KEY) return;
    applyMotionAttribute(resolveUiMotion(event.key === null ? null : event.newValue));
    callback();
  };
  let media: MediaQueryList | null = null;
  try {
    media = window.matchMedia?.(REDUCED_MOTION_QUERY) ?? null;
  } catch {
    media = null;
  }
  media?.addEventListener?.("change", callback);
  window.addEventListener(UI_THEME_EVENT, callback);
  window.addEventListener("storage", onStorage);
  return () => {
    media?.removeEventListener?.("change", callback);
    window.removeEventListener(UI_THEME_EVENT, callback);
    window.removeEventListener("storage", onStorage);
  };
}
