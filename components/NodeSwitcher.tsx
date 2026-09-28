"use client";

/**
 * NodeSwitcher - API 节点快捷切换下拉（桌面顶栏与移动顶栏共用）
 *
 * 从 Header 抽出（纯搬移）；与 UnifiedInputCard 的 SelectChip 同款交互。
 */

import { useState, useSyncExternalStore } from "react";
import { Server, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApiConfig } from "@/lib/api-config-context";

// useSyncExternalStore 的 no-op subscribe：模块级常量，避免每次渲染产生新引用
const EMPTY_SUBSCRIBE = () => () => {};

export function NodeSwitcher() {
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
        className="gap-1.5 press max-w-28 sm:max-w-44"
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
