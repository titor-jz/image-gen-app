"use client";

/**
 * BottomSheet - 移动端底部弹层原语（自绘，无第三方依赖）
 *
 * - 遮罩点击 / Esc / 顶部把手下拉 均可关闭
 * - 面板最高 85dvh，内容区滚动；底部留 safe-area
 * - 入场动画 animate-sheet-up（globals.css）
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function BottomSheet({
  open,
  onClose,
  title,
  children,
  /** 内容区额外类（如 padding） */
  contentClassName = "",
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  contentClassName?: string;
}) {
  const [mounted, setMounted] = useState(false);
  const [dragY, setDragY] = useState(0);
  const startY = useRef<number | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 客户端挂载门控（portal 需要 document）
    setMounted(true);
  }, []);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-50 bg-black/60 animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] flex flex-col bg-card border-t border-border rounded-t-[28px] shadow-2xl animate-sheet-up"
        style={dragY ? { transform: `translateY(${dragY}px)`, transition: "none" } : undefined}
      >
        {/* 把手 / 头部：仅此区域接管下滑关闭，避免与内容滚动冲突 */}
        <div
          onTouchStart={(e) => { startY.current = e.touches[0].clientY; }}
          onTouchMove={(e) => {
            if (startY.current == null) return;
            const d = e.touches[0].clientY - startY.current;
            if (d > 0) setDragY(d);
          }}
          onTouchEnd={() => {
            if (dragY > 90) onClose();
            setDragY(0);
            startY.current = null;
          }}
          className="shrink-0 pt-2.5 pb-2 px-4 border-b border-border"
        >
          <div className="w-10 h-1.5 rounded-full bg-foreground/15 mx-auto mb-2.5" aria-hidden="true" />
          <div className="flex items-center justify-between gap-3">
            <span className="flex-1 min-w-0 truncate text-[15px] font-semibold text-foreground tracking-wide">{title}</span>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="press hover:bg-accent/60"
              aria-label="关闭"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
        <div className={`flex-1 overflow-y-auto scrollbar-thin ${contentClassName}`}>
          {children}
        </div>
      </div>
    </>,
    document.body
  );
}
