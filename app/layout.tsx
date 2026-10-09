import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies, headers } from "next/headers";
import { APP_BRANDING, resolveUiLocale, UI_LOCALE_COOKIE } from "@/lib/ui-locale";
import { DEFAULT_UI_SKIN, resolveUiSkin, resolveUiTheme, UI_MOTION_KEY, UI_SKIN_COOKIE, UI_THEME_COOKIE } from "@/lib/ui-theme";
import { UiLocaleProvider } from "./ui-locale";
import { UiThemeProvider } from "./ui-theme";
import "./globals.css";
/*
 * 皮肤与减弱动效是挂在 <html> 属性上的外观层，和写这些属性的 layout 放在一起引入，紧跟 globals.css。
 * 两个文件都不依赖打包后的先后：皮肤块的选择器特异性都是 (0,3,0)，压过 base.css 的 (0,1,0)/(0,2,0)；
 * motion.css 和 base.css 的系统兜底写的是同一组 !important 值。
 */
import "./styles/skins.css";
import "./styles/motion.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const locale = resolveUiLocale((await cookies()).get(UI_LOCALE_COOKIE)?.value);
  const { name: title, description } = APP_BRANDING[locale];

  return {
    title,
    description,
    icons: {
      icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
      apple: "/favicon.svg",
    },
    openGraph: {
      title,
      description,
      type: "website",
      locale: locale === "ja" ? "ja_JP" : "zh_CN",
      images: [{ url: `${origin}/og.jpg`, width: 1200, height: 675, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${origin}/og.jpg`],
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const locale = resolveUiLocale(cookieStore.get(UI_LOCALE_COOKIE)?.value);
  // 主题和语言一样由服务端按 cookie 定好：第一帧就是对的颜色，没有先亮后暗的闪烁。
  const theme = resolveUiTheme(cookieStore.get(UI_THEME_COOKIE)?.value);
  // 皮肤同理。默认皮肤不写 data-skin：skins.css 的公共派生挂在 [data-skin] 上，默认外观必须与引入皮肤前逐位一致。
  const skin = resolveUiSkin(cookieStore.get(UI_SKIN_COOKIE)?.value);
  // suppressHydrationWarning：下面的内联脚本会在 hydration 前给 <html> 加 data-rail / data-motion，属性差异是预期内的。
  return (
    <html
      lang={locale}
      data-theme={theme}
      data-skin={skin === DEFAULT_UI_SKIN ? undefined : skin}
      style={{ colorScheme: theme }}
      suppressHydrationWarning
    >
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {process.env.OBSIDIAN_DATA_SOURCE === "published" && (
          <aside style={{ position: "fixed", bottom: 12, right: 16, zIndex: 1000, padding: "6px 12px", borderRadius: 8, background: "var(--color-bg, #fff)", color: "var(--color-text, #222)", border: "1px solid var(--color-border, #ddd)", fontSize: 14 }}>
            {locale === "ja" ? "公開済みの内容 · 閲覧専用" : "已发布内容 · 仅供浏览"}
          </aside>
        )}
        {/*
          首帧前恢复只存在本机的界面偏好：侧栏折叠态（否则每次刷新都会看到侧栏先展开再收起），
          以及「总是减弱动效」（否则首屏入场动画会先播一遍）。服务端读不到 localStorage，只能在这里补。
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var r=document.documentElement;if(localStorage.getItem("echo:rail")==="collapsed"){r.dataset.rail="collapsed"}if(localStorage.getItem(${JSON.stringify(UI_MOTION_KEY)})==="reduce"){r.dataset.motion="reduce"}}catch(e){}`,
          }}
        />
        <UiLocaleProvider initialLocale={locale}>
          <UiThemeProvider initialTheme={theme} initialSkin={skin}>{children}</UiThemeProvider>
        </UiLocaleProvider>
      </body>
    </html>
  );
}
