"use client";

/**
 * Header - 顶部导航栏
 *
 * 显示 API 节点快捷切换、历史记录按钮、主题切换、设置入口。
 * 节点状态来自 ApiConfigContext（多套配置，单选激活）。
 * 主题状态：
 *  - 默认白天（无 localStorage 时）
 *  - 切换时写入 localStorage（image-gen-theme: light | dark）
 *  - 初始化时立即读取，避免首屏闪烁
 */

import dynamic from "next/dynamic";
import { Sun, Moon, Clock, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApiConfig } from "@/lib/api-config-context";
import { NodeSwitcher } from "@/components/NodeSwitcher";
import { useTheme } from "@/hooks/useTheme";
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
  const { apiKey } = useApiConfig();
  const hasKey = !!apiKey;
  const { isDark, toggleTheme } = useTheme();

  return (
    <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-md border-b border-border/50">
      <div className="flex items-center justify-between px-4 sm:px-6 pt-[max(1rem,env(safe-area-inset-top))] pb-4 max-w-3xl mx-auto">
      <Button
        variant="ghost"
        size="sm"
        className="gap-2 press"
        onClick={onShowHistory}
        aria-label="历史记录"
      >
        <Clock className="w-4 h-4" />
        <span className="text-sm hidden sm:inline">对话列表</span>
      </Button>

      <div className="flex items-center gap-1">
        <NodeSwitcher />
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
