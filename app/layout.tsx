import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies, headers } from "next/headers";
import { APP_BRANDING, resolveUiLocale, UI_LOCALE_COOKIE } from "@/lib/ui-locale";
import { resolveUiTheme, UI_THEME_COOKIE } from "@/lib/ui-theme";
import { UiLocaleProvider } from "./ui-locale";
import { UiThemeProvider } from "./ui-theme";
import "./globals.css";

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
  // suppressHydrationWarning：下面的内联脚本会在 hydration 前给 <html> 加 data-rail，属性差异是预期内的。
  return (
    <html lang={locale} data-theme={theme} style={{ colorScheme: theme }} suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {/* 首帧前恢复侧栏折叠态，否则每次刷新都会看到侧栏先展开再收起。 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem("echo:rail")==="collapsed"){document.documentElement.dataset.rail="collapsed"}}catch(e){}`,
          }}
        />
        <UiLocaleProvider initialLocale={locale}>
          <UiThemeProvider initialTheme={theme}>{children}</UiThemeProvider>
        </UiLocaleProvider>
      </body>
    </html>
  );
}
