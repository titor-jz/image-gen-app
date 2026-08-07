"use client";

/**
 * Header - 顶部导航栏
 *
 * 显示历史记录按钮、主题切换、设置入口。
 * 主题状态：
 *  - 默认白天（无 localStorage 时）
 *  - 切换时写入 localStorage（image-gen-theme: light | dark）
 *  - 初始化时立即读取，避免首屏闪烁
 * API Key 状态来自 ApiConfigContext（响应式）。
 */

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { Sun, Moon, Clock, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApiConfig } from "@/lib/api-config-context";
import { SettingsDialogSkeleton } from "./settings-dialog-skeleton";

const SettingsDialog = dynamic(
  () => import("./SettingsDialog").then((m) => m.SettingsDialog),
  {
    ssr: false,
    loading: () => <SettingsDialogSkeleton />,
  }
);

const THEME_STORAGE_KEY = "image-gen-theme";
type Theme = "light" | "dark";

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return "light";
}

function applyTheme(theme: Theme) {
  const html = document.documentElement;
  if (theme === "dark") html.classList.add("dark");
  else html.classList.remove("dark");
}

interface HeaderProps {
  onShowHistory: () => void;
}

export function Header({ onShowHistory }: HeaderProps) {
  const { apiKey } = useApiConfig();
  const hasKey = !!apiKey;
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

  return (
    <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-md border-b border-border/50">
      <div className="flex items-center justify-between px-6 py-4 max-w-3xl mx-auto">
      <Button
        variant="ghost"
        size="sm"
        className="gap-2 press"
        onClick={onShowHistory}
      >
        <Clock className="w-4 h-4" />
        <span className="text-sm">对话列表</span>
      </Button>

      <div className="flex items-center gap-1">
        {hasKey && (
          <div
            className="flex items-center gap-1 text-xs text-green-500 px-2 animate-fade-in"
            title="API Key 已配置"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
          </div>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="press transition-base hover:bg-accent/60"
          onClick={toggleTheme}
          aria-label="切换主题"
        >
          <span key={isDark ? "sun" : "moon"} className="block animate-fade-in">
            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </span>
        </Button>
        <SettingsDialog />
      </div>
      </div>
    </header>
  );
}
