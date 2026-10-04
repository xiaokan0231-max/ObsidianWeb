"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_UI_THEME, UI_THEME_COOKIE, UI_THEME_EVENT, type UiTheme } from "@/lib/ui-theme";
import { useUiLocale } from "./ui-locale";

/*
 * 和界面语言分开放：六个 UI 测试会用 stub 整个替换 "./ui-locale"，
 * 主题塞进那个模块的话，被测组件会拿到 undefined。
 */
type UiThemeContextValue = { theme: UiTheme; setTheme: (theme: UiTheme) => void };

const UiThemeContext = createContext<UiThemeContextValue>({ theme: DEFAULT_UI_THEME, setTheme: () => {} });

export function UiThemeProvider({ initialTheme, children }: { initialTheme: UiTheme; children: ReactNode }) {
  // 服务端按同一枚 cookie 渲染出 <html data-theme>，第一帧就是所选主题，不需要再加首帧脚本。
  const [theme, updateTheme] = useState(initialTheme);
  const setTheme = useCallback((next: UiTheme) => {
    updateTheme(next);
    // 直接改 DOM 而不是等 React：<html> 不归任何组件管，切换要立即生效、不刷新页面。
    const root = document.documentElement;
    root.dataset.theme = next;
    root.style.colorScheme = next;
    try {
      document.cookie = `${UI_THEME_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    } catch {
      // 浏览器禁止持久化时，本次打开仍可切换。
    }
    window.dispatchEvent(new Event(UI_THEME_EVENT));
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <UiThemeContext.Provider value={value}>{children}</UiThemeContext.Provider>;
}

export function useUiTheme() {
  return useContext(UiThemeContext);
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
