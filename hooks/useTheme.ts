"use client";

/**
 * useTheme - 明暗主题状态（桌面 Header 与移动顶栏共用）
 *
 * 从 Header 抽出（纯搬移）：
 *  - 默认白天（无 localStorage 时）
 *  - 切换时写入 localStorage（image-gen-theme: light | dark）
 *  - Capacitor 壳内同步状态栏颜色/图标明暗（浏览器/PWA 连 import 都不发生）
 */

import { useState, useEffect } from "react";
import { isCapacitor } from "@/lib/capacitor-env";

const THEME_STORAGE_KEY = "image-gen-theme";
type Theme = "light" | "dark";

export function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return "light";
}

export function applyTheme(theme: Theme) {
  const html = document.documentElement;
  if (theme === "dark") html.classList.add("dark");
  else html.classList.remove("dark");
  // Capacitor 壳内：系统状态栏颜色/图标明暗随主题同步。
  if (isCapacitor()) {
    void (async () => {
      try {
        const { StatusBar, Style } = await import("@capacitor/status-bar");
        await StatusBar.setStyle({
          style: theme === "dark" ? Style.Dark : Style.Light,
        });
        await StatusBar.setBackgroundColor({
          color: theme === "dark" ? "#0b121a" : "#ffffff",
        });
      } catch {
        // 插件调用失败（如 edge-to-edge 模式不支持设色）：不影响网页主题
      }
    })();
  }
}

export function useTheme(): { isDark: boolean; toggleTheme: () => void } {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const initial = getInitialTheme();
    applyTheme(initial);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 挂载时从 localStorage 同步主题，SSR 时代遗留写法（与 page.tsx 一致）
    setIsDark(initial === "dark");
  }, []);

  const toggleTheme = () => {
    const next: Theme = isDark ? "light" : "dark";
    applyTheme(next);
    setIsDark(next === "dark");
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // 隐私模式或 quota 满：忽略，不影响主题切换
    }
  };

  return { isDark, toggleTheme };
}
