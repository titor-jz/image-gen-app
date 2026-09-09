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

import { useState, useEffect, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { Sun, Moon, Clock, CheckCircle2, Server, Check } from "lucide-react";
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

// useSyncExternalStore 的 no-op subscribe：模块级常量，避免每次渲染产生新引用
const EMPTY_SUBSCRIBE = () => () => {};

/** 节点快捷切换下拉（与 UnifiedInputCard 的 SelectChip 同款交互） */
function NodeSwitcher() {
  const { profiles, activeId, setActiveId } = useApiConfig();
  const [open, setOpen] = useState(false);
  // hydration 安全：服务端与客户端首帧渲染中性占位。
  // 用 useSyncExternalStore 表达"已挂载"，避免 effect 内同步 setState
  const mounted = useSyncExternalStore(
    EMPTY_SUBSCRIBE,
    () => true,
    () => false
  );

  if (!mounted) {
    return (
      <Button variant="ghost" size="sm" className="gap-1.5 press" aria-label="API 节点">
        <Server className="w-4 h-4" />
      </Button>
    );
  }

  const active = profiles.find((p) => p.id === activeId);

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 press max-w-44"
        onClick={() => setOpen((p) => !p)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="切换 API 节点"
      >
        <Server className="w-4 h-4 shrink-0" />
        {active && (
          <span className="text-sm truncate">{active.name || "未命名节点"}</span>
        )}
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            className="absolute right-0 top-full mt-1 min-w-48 bg-popover border border-border rounded-xl shadow-xl py-1 z-50 animate-fade-up"
            role="listbox"
            aria-label="API 节点列表"
          >
            {profiles.length === 0 && (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                尚未配置节点，请在设置中添加
              </p>
            )}
            {profiles.map((p) => (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={p.id === activeId}
                onClick={() => {
                  setActiveId(p.id);
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-base hover:bg-accent/60 ${
                  p.id === activeId ? "text-primary" : "text-foreground"
                }`}
              >
                <span className="flex-1 text-left truncate">{p.name || "未命名节点"}</span>
                {p.id === activeId && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
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
