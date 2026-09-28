"use client";

/**
 * FullscreenPreview - 全屏图片预览（移动端）
 *
 * - 左右滑切换上/下一张；下滑关闭；也提供可见的切换按钮（gesture-alternative）
 * - 顶部栏按环境显示「保存到相册」（APP）或「下载」（浏览器/PWA）
 */

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, ChevronLeft, ChevronRight, Download, FolderDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FadeInImage } from "@/components/ResultCard";
import { getResultImageSrc, downloadResult, saveResultToGallery } from "@/lib/image-actions";
import type { GenerateResult } from "@/lib/types";

const SWIPE_X = 60;
const DISMISS_Y = 90;

export function FullscreenPreview({
  results,
  index,
  onIndexChange,
  onClose,
  appMode,
}: {
  results: GenerateResult[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  /** Capacitor 壳内：保存到相册（a[download] 无效） */
  appMode: boolean;
}) {
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const result = results[index];
  if (!result || typeof document === "undefined") return null;

  const prev = () => index > 0 && onIndexChange(index - 1);
  const next = () => index < results.length - 1 && onIndexChange(index + 1);

  return createPortal(
    <div
      className="fixed inset-0 z-[70] bg-black/95 flex flex-col animate-fade-in select-none"
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
      onTouchStart={(e) => {
        start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }}
      onTouchMove={(e) => {
        if (!start.current) return;
        const dx = e.touches[0].clientX - start.current.x;
        const dy = e.touches[0].clientY - start.current.y;
        setOffset(dy > 0 && Math.abs(dy) > Math.abs(dx) ? { x: 0, y: dy } : { x: dx, y: 0 });
      }}
      onTouchEnd={() => {
        const o = offset ?? { x: 0, y: 0 };
        if (o.y > DISMISS_Y) onClose();
        else if (o.x < -SWIPE_X) next();
        else if (o.x > SWIPE_X) prev();
        setOffset(null);
        start.current = null;
      }}
    >
      {/* 顶栏 */}
      <div className="shrink-0 flex items-center justify-between px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="text-white hover:bg-white/10 press"
          aria-label="关闭"
        >
          <X className="w-5 h-5" />
        </Button>
        <span className="text-white/80 text-sm tabular-nums">
          {index + 1} / {results.length}
        </span>
        {appMode ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void saveResultToGallery(result)}
            className="text-white hover:bg-white/10 press"
          >
            <FolderDown className="w-4 h-4 mr-1.5" />
            保存
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void downloadResult(result)}
            className="text-white hover:bg-white/10 press"
          >
            <Download className="w-4 h-4 mr-1.5" />
            下载
          </Button>
        )}
      </div>

      {/* 图片区（手势区） */}
      <div className="flex-1 min-h-0 flex items-center justify-center px-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <FadeInImage
          src={getResultImageSrc(result)}
          alt={result.prompt}
          className="max-w-full max-h-full object-contain transition-slow"
          style={
            offset
              ? {
                  transform: `translate(${offset.x * 0.6}px, ${offset.y * 0.6}px)`,
                  opacity: offset.y > 0 ? Math.max(0.4, 1 - offset.y / 300) : 1,
                }
              : undefined
          }
        />
      </div>

      {/* 可见切换控件（不依赖手势） */}
      <div className="shrink-0 flex items-center justify-center gap-8 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Button
          variant="ghost"
          size="icon"
          onClick={prev}
          disabled={index === 0}
          className="text-white hover:bg-white/10 press disabled:opacity-30"
          aria-label="上一张"
        >
          <ChevronLeft className="w-6 h-6" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={next}
          disabled={index === results.length - 1}
          className="text-white hover:bg-white/10 press disabled:opacity-30"
          aria-label="下一张"
        >
          <ChevronRight className="w-6 h-6" />
        </Button>
      </div>
    </div>,
    document.body
  );
}
