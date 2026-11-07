"use client";

/**
 * Header - 顶部导航栏（仪器面板版）
 *
 * 显示 API 节点快捷切换、历史记录按钮、主题切换、设置入口。
 * 节点状态来自 ApiConfigContext（多套配置，单选激活）。
 * 主题状态：
 *  - 默认白天（无 localStorage 时）
 *  - 切换时写入 localStorage（image-gen-theme: light | dark）
 *  - 初始化时立即读取，避免首屏闪烁
 *
 * 视觉：左侧等宽字标承担原来的大标题职责，右侧是仪器刻度式的小控件。
 * 控件外观统一由 globals.css 的 `.ui-instrument .inst-bar [data-slot="button"]`
 * 规则给到，因此 NodeSwitcher / SettingsDialog 的触发器不需要改内部实现
 * （它们在移动端顶栏也复用，不走 .ui-instrument 作用域，外观不变）。
 */

import dynamic from "next/dynamic";
import { Sun, Moon, Clock } from "lucide-react";
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
    <header className="inst-bar sticky top-0 z-40 bg-background/85 backdrop-blur-md border-b border-border/60 pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex h-[60px] w-full max-w-[1320px] items-center gap-0.5 px-6 lg:px-10">
        <div className="inst-mono shrink-0 text-[12px] font-semibold tracking-[0.2em] text-foreground">
          AI&nbsp;IMAGE&nbsp;GEN
          <span className="ml-3 hidden font-normal tracking-[0.14em] text-muted-foreground sm:inline">
            智能生图
          </span>
        </div>

        <div className="flex-1" />

        <Button
          variant="ghost"
          size="sm"
          className="gap-2"
          onClick={onShowHistory}
          aria-label="历史记录"
        >
          <Clock className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">历史</span>
        </Button>

        <NodeSwitcher />

        {hasKey && (
          <span
            className="inst-label hidden items-center gap-1.5 px-2 md:inline-flex"
            title="API Key 已配置"
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-foreground" />
            KEY 就绪
          </span>
        )}

        <Button
          variant="ghost"
          size="icon"
          className="press transition-base"
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
