"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { Sun, Moon, Clock, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getApiKey } from "@/lib/api-key";
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
  const [hasKey, setHasKey] = useState(false);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setHasKey(!!getApiKey());
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
