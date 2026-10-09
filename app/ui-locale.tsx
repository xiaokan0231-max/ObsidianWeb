"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { UI_LOCALE_COOKIE, type UiLocale } from "@/lib/ui-locale";

type UiLocaleContextValue = { locale: UiLocale; setLocale: (locale: UiLocale) => void };

const UiLocaleContext = createContext<UiLocaleContextValue>({ locale: "zh-CN", setLocale: () => {} });

export function UiLocaleProvider({ initialLocale, children }: { initialLocale: UiLocale; children: ReactNode }) {
  // 服务端也读同一枚 cookie，刷新后第一帧就是所选语言，避免 hydration 时闪回中文。
  const [locale, updateLocale] = useState(initialLocale);
  const setLocale = useCallback((next: UiLocale) => {
    updateLocale(next);
    try {
      document.cookie = `${UI_LOCALE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    } catch {
      // 浏览器禁止持久化时，本次打开仍可切换。
    }
  }, []);

  useEffect(() => { document.documentElement.lang = locale; }, [locale]);

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  return <UiLocaleContext.Provider value={value}>{children}</UiLocaleContext.Provider>;
}

export function useUiLocale() {
  return useContext(UiLocaleContext);
}

export function LanguageSwitch() {
  const { locale, setLocale } = useUiLocale();
  return (
    <div className="language-switch" role="group" aria-label={locale === "ja" ? "表示言語" : "界面语言"}>
      <button type="button" lang="zh-CN" aria-pressed={locale === "zh-CN"} onClick={() => setLocale("zh-CN")}>中文</button>
      <button type="button" lang="ja" aria-pressed={locale === "ja"} onClick={() => setLocale("ja")}>日本語</button>
    </div>
  );
}
