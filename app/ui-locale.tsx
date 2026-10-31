"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
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

/** 发布提示也订阅语言，切换后无需刷新整页。 */
export function PublishedReadOnlyNotice() {
  const { locale } = useUiLocale();
  const pathname = usePathname();
  // 老师页面已有独立日文说明，避免主站语言的浮条遮挡批注或造成混合文案。
  if (/^\/(consultation|feedback)(\/|$)/.test(pathname ?? "")) return null;
  return <aside style={{ position: "fixed", bottom: 12, right: 16, zIndex: 1000, padding: "6px 12px", borderRadius: 8, background: "var(--color-bg, #fff)", color: "var(--color-text, #222)", border: "1px solid var(--color-border, #ddd)", fontSize: 14 }}>
    {locale === "ja" ? "資料は閲覧専用 · コメントできます" : "资料仅供浏览 · 可留言交流"}
    <form method="post" action="/_site-access/logout" style={{ display: "inline", marginLeft: 12 }}><button type="submit" style={{ border: 0, padding: 0, color: "inherit", background: "transparent", font: "inherit", textDecoration: "underline", cursor: "pointer" }}>{locale === "ja" ? "アクセスを終了" : "退出访问"}</button></form>
  </aside>;
}
