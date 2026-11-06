"use client";

/**
 * ResultCard / FadeInImage - 单张结果图卡（桌面网格与移动结果网格共用）
 *
 * 从 ResultGrid 抽出（纯搬移）。
 */

import { useEffect, useRef, useState } from "react";
import { Download, FolderDown, ImageOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { aspectOf } from "@/lib/aspect";
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
  onRatio,
}: {
  src: string;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
  /** 图片解码后回报自然宽高比（用于「画幅未知」的结果按真实比例排版） */
  onRatio?: (ratio: number) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  // onRatio 每次渲染都是新函数；用 ref 存住，供挂载补检使用
  const ratioRef = useRef(onRatio);
  useEffect(() => {
    ratioRef.current = onRatio;
  }, [onRatio]);

  // 水合竞态兜底：图片可能在本组件的 onLoad 挂上之前就已加载完成
  // （SSR 出来的 <img> 由浏览器先解码）。此时 onLoad 永不触发，
  // 会导致 opacity 一直 0（图看不见）、自然比例也拿不到。挂载后补检一次。
  useEffect(() => {
    const img = imgRef.current;
    if (!img || !img.complete) return;
    if (img.naturalWidth > 0) {
      setLoaded(true);
      ratioRef.current?.(img.naturalWidth / img.naturalHeight);
    } else if (img.currentSrc || img.src) {
      setFailed(true);
    }
  }, []);
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
      ref={imgRef}
      src={src}
      alt={alt}
      loading="lazy"
      onLoad={(e) => {
        setLoaded(true);
        const img = e.currentTarget;
        if (onRatio && img.naturalWidth > 0 && img.naturalHeight > 0) {
          onRatio(img.naturalWidth / img.naturalHeight);
        }
      }}
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
  className = "",
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
  /** 外层附加类（调用方可追加阴影/圆角等，默认不传） */
  className?: string;
}) {
  // 画幅：优先用生成时记录的尺寸；「自动」等未知情况退到图片自然比例，
  // 解码前先用 1:1 占位（避免 0 高度闪一下）。
  const knownRatio = aspectOf(result.size);
  const [naturalRatio, setNaturalRatio] = useState<number | null>(null);
  const ratio = knownRatio ?? naturalRatio ?? 1;

  return (
    <div
      className={`result-card group relative rounded-xl overflow-hidden bg-muted cursor-pointer ring-1 ring-border/50 press-sm animate-fade-up ${className}`}
      style={{ animationDelay: `${Math.min(index, 8) * 60}ms`, aspectRatio: String(ratio) }}
      onClick={() => onExpand(index)}
    >
      <FadeInImage
        src={getImageSrc(result)}
        alt={result.prompt}
        onRatio={knownRatio ? undefined : setNaturalRatio}
        // object-contain：卡片比例与图一致时等同铺满；万一上游尺寸没按请求返回，
        // 也只留边、不裁掉画面内容
        className="w-full h-full object-contain transition-slow group-hover:scale-105"
      />
      {/* 生成渠道信息：常驻显示（触屏没有 hover，之前只在对比组/鼠标悬停时可见）。
          pointer-events-none 避免挡住整卡点击。 */}
      <span className="result-card-tag pointer-events-none absolute bottom-1 left-1 max-w-[calc(100%-0.5rem)] truncate text-[10px] leading-4 px-1.5 rounded bg-black/60 text-white/90">
        {result.nodeName ? `${result.nodeName} · ${result.model}` : result.model}
      </span>
      {/* 卡片操作钮。
          触屏（<sm）没有 hover：遮罩改成不吃点击的透明层，操作钮缩到右上角，
          其余整块留给「点开看图」——否则居中的按钮会把点击吞掉，图点不开。
          桌面（≥sm）保持原来的居中遮罩 + hover 显隐。
          APP 环境 a[download] 无效 → 同一位置换成原生「保存到相册」 */}
      <div className="pointer-events-none absolute inset-0 transition-base sm:flex sm:items-center sm:justify-center sm:bg-black/0 sm:opacity-0 sm:group-hover:bg-black/40 sm:group-hover:opacity-100">
        {appMode ? (
          <Button
            variant="secondary"
            size="icon"
            className="pointer-events-auto absolute top-2 right-2 h-9 w-9 press sm:static sm:h-8 sm:w-8"
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
            className="pointer-events-auto absolute top-2 right-2 h-9 w-9 press sm:static sm:h-8 sm:w-8"
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
