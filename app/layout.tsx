import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { ApiConfigProvider } from "@/lib/api-config-context";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AI Image Gen",
  description: "Personal AI image generation tool powered by GPT-Image2",
  appleWebApp: {
    capable: true,
    title: "AI 生图",
    statusBarStyle: "default",
  },
};

// viewportFit cover：PWA standalone 模式下内容延伸到状态栏/手势条，
// 配合组件内 env(safe-area-inset-*) 留白
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b121a" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      // 主题属性（dark class / data-theme）天然会在 SSR/CSR 间不一致：
      //  - Header 在 useEffect 里才改 classList（hydration 之后）
      //  - 浏览器扩展可能在 hydration 前注入 data-theme
      // 官方做法：在 <html> 上 suppressHydrationWarning，只抑制这一层的属性差异警告，
      // 不影响子树。否则首屏会刷 hydration mismatch 红字（不影响功能，但噪音大）。
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* ApiConfigProvider 包裹整个应用：让 Header / SettingsDialog /
            useImageGeneration 等组件共享 API Key / Base URL / Proxy URL 状态。 */}
        <ApiConfigProvider>
          {children}
          <Toaster richColors closeButton />
        </ApiConfigProvider>
      </body>
    </html>
  );
}
