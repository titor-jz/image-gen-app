// 临时 Header.tsx
"use client";

/**
 * Header - 顶部导航栏
 *
 * 显示历史记录按钮、主题切换、设置入口。
 * API Key 是否配置的绿勾来自 ApiConfigContext（响应式）：
 *  - 修改 Key 后绿勾自动出现/消失
 *  - 不再需要 useState + useEffect + getApiKey() 同步
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

interface HeaderProps {
  onShowHistory: () => void;
}

export function Header({ onShowHistory }: HeaderProps) {
  // API Key 状态从 Context 读取（响应式：SettingsDialog 修改后自动更新）
  const { apiKey } = useApiConfig();
  const hasKey = !!apiKey;

  // 主题状态：来自 DOM（document.documentElement.classList），
  // 这是「与外部 DOM 同步」的标准 useEffect 用途（React 19 推荐）。
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggleTheme = () => {
    const html = document.documentElement;
    if (html.classList.contains("dark")) {
      html.classList.remove("dark");
      setIsDark(false);
    } else {
      html.classList.add("dark");
      setIsDark(true);
    }
  };

  return (
    <header className="flex items-center justify-between px-6 py-4">
      {/* 左侧：历史记录按钮 */}
      <Button
        variant="ghost"
        size="sm"
        className="gap-2 press"
        onClick={onShowHistory}
      >
        <Clock className="w-4 h-4" />
        <span className="text-sm">对话列表</span>
      </Button>

      {/* 右侧：主题 + 设置 */}
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
    </header>
  );
}
