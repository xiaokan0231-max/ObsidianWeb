"use client";

import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  DEFAULT_UI_MOTION,
  DEFAULT_UI_SKIN,
  DEFAULT_UI_THEME,
  resolveUiSkin,
  UI_SKIN_COOKIE,
  UI_THEME_COOKIE,
  UI_THEME_EVENT,
  type UiMotion,
  type UiSkin,
  type UiTheme,
} from "@/lib/ui-theme";
import { prefersReducedMotion, readMotionPreference, subscribeMotion, writeMotionPreference } from "@/lib/motion";
import { useUiLocale } from "./ui-locale";

/*
 * 和界面语言分开放：六个 UI 测试会用 stub 整个替换 "./ui-locale"，
 * 主题塞进那个模块的话，被测组件会拿到 undefined。
 * 皮肤与动效各用各的 context：useUiTheme 的返回形状是既有契约，不往里塞字段。
 */
type UiThemeContextValue = { theme: UiTheme; setTheme: (theme: UiTheme) => void };
type UiSkinContextValue = { skin: UiSkin; setSkin: (next: UiSkin) => void };

const UiThemeContext = createContext<UiThemeContextValue>({ theme: DEFAULT_UI_THEME, setTheme: () => {} });
const UiSkinContext = createContext<UiSkinContextValue>({ skin: DEFAULT_UI_SKIN, setSkin: () => {} });
// 只放「服务端渲染时的动效偏好」：真正的值在 <html data-motion> 上，挂载后由 useSyncExternalStore 接管。
const UiMotionServerContext = createContext<UiMotion>(DEFAULT_UI_MOTION);

const ONE_YEAR = 31536000;

function writeCookie(name: string, value: string) {
  try {
    document.cookie = `${name}=${value}; Path=/; Max-Age=${ONE_YEAR}; SameSite=Lax`;
  } catch {
    // 浏览器禁止持久化时，本次打开仍可切换。
  }
}

export function UiThemeProvider({
  initialTheme,
  initialSkin = DEFAULT_UI_SKIN,
  initialMotion = DEFAULT_UI_MOTION,
  children,
}: {
  initialTheme: UiTheme;
  initialSkin?: UiSkin;
  /** 服务端拿不到 localStorage，通常不传；只用作水合前那一帧的快照，避免服务端与客户端首帧不一致。 */
  initialMotion?: UiMotion;
  children: ReactNode;
}) {
  // 服务端按同一枚 cookie 渲染出 <html data-theme>，第一帧就是所选主题，不需要再加首帧脚本。
  const [theme, updateTheme] = useState(initialTheme);
  const setTheme = useCallback((next: UiTheme) => {
    updateTheme(next);
    // 直接改 DOM 而不是等 React：<html> 不归任何组件管，切换要立即生效、不刷新页面。
    const root = document.documentElement;
    root.dataset.theme = next;
    root.style.colorScheme = next;
    writeCookie(UI_THEME_COOKIE, next);
    window.dispatchEvent(new Event(UI_THEME_EVENT));
  }, []);

  // 皮肤同主题：cookie + 服务端写 <html data-skin>，首帧就对。
  const [skin, updateSkin] = useState(initialSkin);
  const setSkin = useCallback((requested: UiSkin) => {
    const next = resolveUiSkin(requested);
    updateSkin(next);
    const root = document.documentElement;
    // 默认皮肤不留属性：skins.css 的公共派生前导挂在 [data-skin] 上，留个 "default" 会让默认外观也被改写。
    if (next === DEFAULT_UI_SKIN) delete root.dataset.skin;
    else root.dataset.skin = next;
    writeCookie(UI_SKIN_COOKIE, next);
    window.dispatchEvent(new Event(UI_THEME_EVENT));
  }, []);

  const themeValue = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  const skinValue = useMemo(() => ({ skin, setSkin }), [skin, setSkin]);
  return (
    <UiThemeContext.Provider value={themeValue}>
      <UiSkinContext.Provider value={skinValue}>
        <UiMotionServerContext.Provider value={initialMotion}>{children}</UiMotionServerContext.Provider>
      </UiSkinContext.Provider>
    </UiThemeContext.Provider>
  );
}

export function useUiTheme() {
  return useContext(UiThemeContext);
}

export function useUiSkin(): UiSkinContextValue {
  return useContext(UiSkinContext);
}

/**
 * 动效偏好（跟随系统 / 总是减弱）。存在 localStorage，服务端不知道，所以不能像主题那样 useState(初值)：
 * 水合那一帧用服务端快照，之后读 <html data-motion>（首帧脚本已按本机存储写好），两边不会对不上。
 */
export function useUiMotion(): { motion: UiMotion; setMotion: (next: UiMotion) => void } {
  const serverMotion = useContext(UiMotionServerContext);
  const motion = useSyncExternalStore(subscribeMotion, readMotionPreference, () => serverMotion);
  return useMemo(() => ({ motion, setMotion: writeMotionPreference }), [motion]);
}

/** 最终判定（「总是减弱」或系统要求减弱）。要随设置即时变化的组件用它；一次性判断直接调 prefersReducedMotion()。 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeMotion, prefersReducedMotion, () => false);
}

const THEME_COPY = {
  "zh-CN": { group: "界面主题", dark: "暗色", light: "浅色" },
  ja: { group: "表示テーマ", dark: "ダーク", light: "ライト" },
} as const;

/** 顶栏开关。按钮不带 lang 属性：首屏测试按 lang="ja" aria-pressed 认语言开关。 */
export function ThemeSwitch() {
  const { theme, setTheme } = useUiTheme();
  const { locale } = useUiLocale();
  const copy = THEME_COPY[locale];
  return (
    <div className="theme-switch" role="group" aria-label={copy.group}>
      <button type="button" aria-pressed={theme === "dark"} onClick={() => setTheme("dark")} title={copy.dark}>
        <span aria-hidden="true">☾</span>
        <span className="sr-only">{copy.dark}</span>
      </button>
      <button type="button" aria-pressed={theme === "light"} onClick={() => setTheme("light")} title={copy.light}>
        <span aria-hidden="true">☀</span>
        <span className="sr-only">{copy.light}</span>
      </button>
    </div>
  );
}
