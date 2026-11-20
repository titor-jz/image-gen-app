"use client";

/**
 * ImageViewer - 窗口级图片查看器（桌面与移动端共用）
 *
 * 点结果卡后盖住整个窗口查看，不再在图库下方挤出一块展开区：
 * - 键盘：Esc 关闭 · ←/→ 切换 · +/− 缩放 · 0 复位
 * - 触屏：左右滑切换 · 下滑关闭（放大状态下手势让位给容器滚动平移）
 * - 1x 按窗口等比缩放且不放大超过原始像素；放大后图片可滚动查看细节
 *
 * 注意：portal 挂在 document.body 上，落在 .ui-instrument 作用域之外 ——
 * 仪器面板那套 CSS 变量在这里取不到，颜色一律写死（深色遮罩 + 白字）。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FolderDown,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { FadeInImage } from "@/components/ResultCard";
import { downloadResult, getResultImageSrc, saveResultToGallery } from "@/lib/image-actions";
import type { GenerateResult } from "@/lib/types";

/** 横向滑动超过多少像素算切换 */
const SWIPE_X = 60;
/** 下滑超过多少像素算关闭 */
const DISMISS_Y = 90;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.25;
/** 1x 时图片与窗口边缘的留白（px） */
const STAGE_PAD = 24;

const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));
const pad2 = (n: number) => String(n).padStart(2, "0");

export function ImageViewer({
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
  /** Capacitor 壳内：a[download] 无效，改为保存到相册 */
  appMode: boolean;
}) {
  const result = results[index];

  // 缩放与自然尺寸都按图片 id 记录：切到别的图时自然回到 1x、重新量尺寸，
  // 不必在 effect 里复位 state（少一轮渲染，也不触发 set-state-in-effect）
  const [zoomState, setZoomState] = useState<{ id: string; value: number } | null>(null);
  const [dimsState, setDimsState] = useState<{ id: string; w: number; h: number } | null>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const zoom = zoomState && result && zoomState.id === result.id ? zoomState.value : 1;

  const zoomTo = useCallback(
    (next: number) => {
      if (!result) return;
      setZoomState({ id: result.id, value: clampZoom(next) });
    },
    [result]
  );

  // 舞台尺寸（窗口/转屏变化时重新等比缩放）——ResizeObserver 观察后立即回调一次
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setStage({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 查看期间锁住背景页面滚动
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // 键盘：Esc 关闭 / ←→ 切换 / +− 缩放 / 0 复位
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          onClose();
          break;
        case "ArrowLeft":
          if (index > 0) onIndexChange(index - 1);
          break;
        case "ArrowRight":
          if (index < results.length - 1) onIndexChange(index + 1);
          break;
        case "+":
        case "=":
          zoomTo(zoom + ZOOM_STEP);
          break;
        case "-":
        case "_":
          zoomTo(zoom - ZOOM_STEP);
          break;
        case "0":
          zoomTo(1);
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [index, results.length, onClose, onIndexChange, zoom, zoomTo]);

  // 放大/换图后把可视区移到图片中心（否则永远停在左上角）
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
    el.scrollTop = (el.scrollHeight - el.clientHeight) / 2;
  }, [zoom, index]);

  if (!result || typeof document === "undefined") return null;

  const prev = () => {
    if (index > 0) onIndexChange(index - 1);
  };
  const next = () => {
    if (index < results.length - 1) onIndexChange(index + 1);
  };

  // 自然尺寸：优先用生成时记录的实际像素，缺失时等图片解码回报
  const natural =
    dimsState && dimsState.id === result.id
      ? dimsState
      : result.actualWidth && result.actualHeight
        ? { id: result.id, w: result.actualWidth, h: result.actualHeight }
        : null;
  // 1x = 等比缩放到窗口内（不放大超过原始像素，避免糊成一片）
  const fit =
    natural && stage.w > 0 && stage.h > 0
      ? Math.min(
          1,
          (stage.w - STAGE_PAD * 2) / natural.w,
          (stage.h - STAGE_PAD * 2) / natural.h
        )
      : null;
  const width = natural && fit ? Math.max(1, Math.round(natural.w * fit * zoom)) : undefined;
  const height = natural && fit ? Math.max(1, Math.round(natural.h * fit * zoom)) : undefined;

  const info = `${result.nodeName ? `${result.nodeName} · ` : ""}${result.model}${
    result.size && result.size !== "auto" ? ` · ${result.size}` : ""
  }`;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex animate-fade-in select-none flex-col bg-[#05070c]/94 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
    >
      {/* 顶栏：关闭 / 序号 / 渠道信息 / 缩放 / 保存 */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-white/10 px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 sm:gap-2 sm:px-3">
        <Button
          variant="ghost"
          size="icon"
          autoFocus
          onClick={onClose}
          className="press h-8 w-8 text-white hover:bg-white/10"
          aria-label="关闭"
          title="关闭（Esc）"
        >
          <X className="h-4.5 w-4.5" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          onClick={prev}
          disabled={index === 0}
          className="press hidden h-8 w-8 text-white hover:bg-white/10 disabled:opacity-30 sm:inline-flex"
          aria-label="上一张"
          title="上一张（←）"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="inst-mono shrink-0 text-[12px] tabular-nums text-white/70">
          {pad2(index + 1)} / {pad2(results.length)}
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={next}
          disabled={index === results.length - 1}
          className="press hidden h-8 w-8 text-white hover:bg-white/10 disabled:opacity-30 sm:inline-flex"
          aria-label="下一张"
          title="下一张（→）"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>

        {/* 生成渠道信息：全屏查看时也能确认这张图出自哪个节点/模型 */}
        <span className="ml-1 hidden min-w-0 truncate text-[12px] text-white/55 sm:block">
          {info}
        </span>

        <div className="ml-auto flex shrink-0 items-center gap-0.5 rounded-[3px] bg-white/10 p-0.5">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => zoomTo(zoom - ZOOM_STEP)}
            disabled={zoom <= ZOOM_MIN}
            className="press h-7 w-7 text-white hover:bg-white/15 disabled:opacity-30"
            aria-label="缩小"
            title="缩小（−）"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <button
            type="button"
            onClick={() => zoomTo(1)}
            className="w-11 tabular-nums text-[12px] text-white/75 transition-colors hover:text-white"
            aria-label="复位到 100%"
            title="复位（0）"
          >
            {Math.round(zoom * 100)}%
          </button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => zoomTo(zoom + ZOOM_STEP)}
            disabled={zoom >= ZOOM_MAX}
            className="press h-7 w-7 text-white hover:bg-white/15 disabled:opacity-30"
            aria-label="放大"
            title="放大（+）"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => void (appMode ? saveResultToGallery(result) : downloadResult(result))}
          className="press h-8 shrink-0 px-2 text-white hover:bg-white/10"
          aria-label={appMode ? "保存到相册" : "下载"}
          title={appMode ? "保存到相册" : "下载"}
        >
          {appMode ? <FolderDown className="h-4 w-4" /> : <Download className="h-4 w-4" />}
          <span className="ml-1.5 hidden sm:inline">{appMode ? "保存到相册" : "下载"}</span>
        </Button>
      </div>

      {/* 图片区：1x 居中，放大后容器内滚动平移 */}
      <div
        ref={stageRef}
        className="relative min-h-0 flex-1 overflow-auto overscroll-contain"
        // 放大后出现的原生滚动条在深色底上很扎眼，收细并压暗
        style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.22) transparent" }}
        onTouchStart={(e) => {
          // 放大状态下手势交给浏览器滚动，避免平移被误判成切图
          if (zoom > 1) return;
          start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }}
        onTouchMove={(e) => {
          if (!start.current) return;
          const dx = e.touches[0].clientX - start.current.x;
          const dy = e.touches[0].clientY - start.current.y;
          setOffset(dy > 0 && Math.abs(dy) > Math.abs(dx) ? { x: 0, y: dy } : { x: dx, y: 0 });
        }}
        onTouchEnd={() => {
          if (!start.current) return;
          const o = offset ?? { x: 0, y: 0 };
          if (o.y > DISMISS_Y) onClose();
          else if (o.x < -SWIPE_X) next();
          else if (o.x > SWIPE_X) prev();
          setOffset(null);
          start.current = null;
        }}
      >
        {/* w-max + min-w-full：比窗口窄时撑满居中，比窗口宽时按内容宽度滚动（左边缘可达） */}
        <div
          className="flex min-h-full w-max min-w-full items-center justify-center"
          onClick={(e) => {
            // 点空白处关闭（点图上不关，免得想放大时误关）
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <FadeInImage
            // key 让每张图换一个实例：FadeInImage 的 failed/loaded 不随 src 复位，
            // 复用同一实例时「某张加载失败后，滑到后面的每张都显示加载失败占位」
            // （旧 FullscreenPreview 就踩过这个坑，见 docs/review-2026-09/REVIEW-round2.md M3）
            key={result.id}
            src={getResultImageSrc(result)}
            alt={result.prompt}
            onNatural={(w, h) => setDimsState({ id: result.id, w, h })}
            className="select-none object-contain"
            style={
              width && height
                ? {
                    width,
                    height,
                    transform: offset
                      ? `translate(${offset.x * 0.6}px, ${offset.y * 0.6}px)`
                      : undefined,
                    opacity: offset && offset.y > 0 ? Math.max(0.4, 1 - offset.y / 300) : 1,
                  }
                : undefined
            }
          />
        </div>
      </div>

      {/* 移动端：信息行 + 大号切换按钮（不依赖手势） */}
      <div className="shrink-0 truncate px-4 pb-1 text-center text-[12px] text-white/55 sm:hidden">
        {info}
      </div>
      <div className="flex shrink-0 items-center justify-center gap-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:hidden">
        <Button
          variant="ghost"
          size="icon"
          onClick={prev}
          disabled={index === 0}
          className="press h-12 w-12 rounded-full bg-white/10 text-white backdrop-blur-sm disabled:opacity-30"
          aria-label="上一张"
        >
          <ChevronLeft className="h-6 w-6" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={next}
          disabled={index === results.length - 1}
          className="press h-12 w-12 rounded-full bg-white/10 text-white backdrop-blur-sm disabled:opacity-30"
          aria-label="下一张"
        >
          <ChevronRight className="h-6 w-6" />
        </Button>
      </div>
    </div>,
    document.body
  );
}