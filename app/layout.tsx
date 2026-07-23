import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
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
  const title = "回声 · 求职作战室";
  const description = "以 Obsidian 为唯一数据源的求职指挥台：岗位、选考进度、面试证据与训练闭环。";

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
      images: [{ url: `${origin}/og.png`, width: 1672, height: 941, alt: "回声 求职作战室" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // suppressHydrationWarning：下面的内联脚本会在 hydration 前给 <html> 加 data-rail，属性差异是预期内的。
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {/* 首帧前恢复侧栏折叠态，否则每次刷新都会看到侧栏先展开再收起。 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem("echo:rail")==="collapsed"){document.documentElement.dataset.rail="collapsed"}}catch(e){}`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
