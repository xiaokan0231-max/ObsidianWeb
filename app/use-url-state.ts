"use client";

import { useEffect, useEffectEvent, useState, type SetStateAction } from "react";

/*
 * 页内状态（标签・筛选・选中项）放进 URL。
 *
 * 为什么：刷新、从别页返回、把链接留给自己时，页内的筛选全丢，每次都要重新点一遍。
 * 为什么用 replaceState：切标签不是「去了新地方」。每点一次就多一条历史的话，
 *   返回键会先在同一页里倒带半天，才回到上一页。
 * 为什么键名由调用方给：外壳已占用 note / section / q / group / review / prep / context / company / case …，
 *   这里不猜。各视图用的键名集中在 URL_STATE_KEYS，由测试检查不与外壳撞名。
 */

export type UrlStateCodec<T> = {
  /** URL 里的原始字符串 → 值。认不出就返回 null（落回默认值），不要抛。 */
  parse: (raw: string) => T | null;
  /** 值 → URL 字符串。省略时用 String(value)。 */
  serialize?: (value: T) => string;
};

/** 枚举型字符串：只接受白名单里的值，手改 URL 写错时静默落回默认。 */
export function enumCodec<T extends string>(allowed: readonly T[]): UrlStateCodec<T> {
  return { parse: (raw) => (allowed.includes(raw as T) ? (raw as T) : null) };
}

/** 任意字符串（检索词、选中项 id）。空串等同默认。 */
export const textCodec: UrlStateCodec<string> = { parse: (raw) => raw };

/** 外壳（app/memory-atlas.tsx）自己读写的键。视图的键不得与之同名，否则两边互相覆盖。 */
export const SHELL_URL_KEYS = [
  "note", "section", "q", "group", "review", "prep", "context", "company", "case",
  "panel", "block", "sentence", "event", "date", "round", "time",
] as const;

/**
 * 外壳用 pushState 换地址时发的事件（pushState 本身不触发 popstate）。
 * 典型场景：在「岗位机会」页再点一次左栏的「岗位机会」——地址变回不带参数的 /jobs，
 * 页面却还停在刚才的筛选上；刷新或复制链接时看到的就和屏幕上不一样。收到它就按新地址重读。
 */
export const URL_CHANGE_EVENT = "echo:urlchange";

export function notifyUrlChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(URL_CHANGE_EVENT));
}

export function readUrlParam(key: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(key);
}

/** 只改一个键，其它参数与 history.state（外壳的 __echoAppView / __echoNote）原样保留。 */
export function writeUrlParam(key: string, value: string | null) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (value === null || value === "") params.delete(key);
  else params.set(key, value);
  const query = params.toString();
  const next = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next !== current) window.history.replaceState(window.history.state, "", next);
}

/**
 * 与 useState 同形，但值同步到 `?key=`。等于默认值时从 URL 删掉，保持链接短。
 *
 * `enabled: false` 用于同一个组件还被嵌在浮层里的场合（例如回答库既是独立页，
 * 也在本场面试上以浮层打开）：浮层不该改写底下那一页的 URL。
 */
export function useUrlState<T>(
  key: string,
  fallback: T,
  codec: UrlStateCodec<T>,
  { enabled = true }: { enabled?: boolean } = {},
): [T, (next: SetStateAction<T>) => void] {
  const serialize = codec.serialize ?? ((value: T) => String(value));
  const readFromUrl = (): T => {
    const raw = readUrlParam(key);
    if (raw === null) return fallback;
    return codec.parse(raw) ?? fallback;
  };
  const [value, setValue] = useState<T>(() => (enabled ? readFromUrl() : fallback));

  // 依赖用序列化后的字符串：调用方的 fallback / codec 常是内联字面量，按引用比较会每次渲染都写一遍 URL。
  const encoded = serialize(value);
  const encodedFallback = serialize(fallback);
  useEffect(() => {
    if (!enabled) return;
    writeUrlParam(key, encoded === encodedFallback ? null : encoded);
  }, [enabled, key, encoded, encodedFallback]);

  // 同一页内的前进／后退（例如关掉原笔记 drawer 时 history.back）会换回旧的查询串，值要跟着 URL 走；
  // 外壳在同一页上 pushState（再点一次当前页的导航）时也一样。
  const syncFromUrl = useEffectEvent(() => setValue(readFromUrl()));
  useEffect(() => {
    if (!enabled) return;
    const pathname = window.location.pathname;
    const onPopState = () => {
      // 返回到别的视图时，本组件马上就会被卸载；别把对方页面的同名参数读进来。
      if (window.location.pathname === pathname) syncFromUrl();
    };
    window.addEventListener("popstate", onPopState);
    window.addEventListener(URL_CHANGE_EVENT, onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener(URL_CHANGE_EVENT, onPopState);
    };
  }, [enabled]);

  return [value, setValue];
}
