"use client";

/**
 * ResultCard / FadeInImage - 单张结果图卡（桌面网格与移动结果网格共用）
 *
 * 从 ResultGrid 抽出（纯搬移）。
 */

import { useState } from "react";
import { Download, FolderDown, ImageOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GenerateResult } from "@/lib/types";

/**
 * 图片加载占位组件：默认透明，onLoad 后 fade-in 显形。
 * 容器需自带 bg-muted 作占位底色，避免大图白屏闪烁。
 * alt 填提示词摘要，供屏幕阅读器与图片加载失败时兜底。
 * onError 时显示占位图标：blob URL 失效等裂图场景不再渲染成永久透明的空块。
 */
export function FadeInImage({
  src,
  alt,
  className,
  style,
}: {
  src: string;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div
        className={`${className} flex items-center justify-center text-muted-foreground`}
        title={alt}
        role="img"
        aria-label={`${alt}（图片加载失败）`}
      >
        <ImageOff className="w-6 h-6" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
      style={style}
      className={`${className} transition-opacity duration-300 ${
        loaded ? "opacity-100" : "opacity-0"
      }`}
    />
  );
}

/** 单张结果图卡(对比组与单项共用) */
export function ResultCard({
  result,
  index,
  onExpand,
  onDownload,
  onSaveToGallery,
  appMode = false,
  getImageSrc,
  showModelAlways = false,
}: {
  result: GenerateResult;
  index: number;
  onExpand: (index: number) => void;
  onDownload: (r: GenerateResult) => void;
  /** APP 环境下的保存到相册动作（appMode 为真时替代下载） */
  onSaveToGallery?: (r: GenerateResult) => void;
  /** Capacitor 壳内：卡片操作钮换成保存到相册 */
  appMode?: boolean;
  getImageSrc: (r: GenerateResult) => string;
  /** 对比组内常驻显示模型名,非对比组仅 hover 显示 */
  showModelAlways?: boolean;
}) {
  return (
    <div
      className="group relative aspect-square rounded-xl overflow-hidden bg-muted cursor-pointer ring-1 ring-border/50 press-sm animate-fade-up"
      style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }}
      onClick={() => onExpand(index)}
    >
      <FadeInImage
        src={getImageSrc(result)}
        alt={result.prompt}
        className="w-full h-full object-cover transition-slow group-hover:scale-105"
      />
      {/* 模型名+节点标签:对比组常驻,非对比组仅 hover */}
      <span
        className={`absolute bottom-1 right-1 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-white/90 transition-base ${
          showModelAlways ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
      >
        {result.nodeName ? `${result.nodeName} · ${result.model}` : result.model}
      </span>
      {/* 卡片操作钮：触屏无 hover，移动端常驻；桌面保留 hover 显隐。
          APP 环境 a[download] 无效 → 同一位置换成原生「保存到相册」 */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-base flex items-center justify-center gap-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
        {appMode ? (
          <Button
            variant="secondary"
            size="icon"
            className="press"
            onClick={(e) => {
              e.stopPropagation();
              onSaveToGallery?.(result);
            }}
            aria-label="保存到相册"
          >
            <FolderDown className="w-4 h-4" />
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="icon"
            className="press"
            onClick={(e) => {
              e.stopPropagation();
              onDownload(result);
            }}
            aria-label="下载"
          >
            <Download className="w-4 h-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
