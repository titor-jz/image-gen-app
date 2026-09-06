"use client";

import { useState } from "react";
import { Download, Heart, X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Sparkles, ImageOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GenerateResult } from "@/lib/types";

interface ResultGridProps {
  results: GenerateResult[];
  /** 是否有任务在跑（仅用于空态时显示"生成中…"） */
  hasRunning?: boolean;
  /** 模型 → 单张价格（元）映射，用于结果卡片显示花费；未知模型不显示 */
  modelPrices?: Record<string, number>;
}

/**
 * 图片加载占位组件：默认透明，onLoad 后 fade-in 显形。
 * 容器需自带 bg-muted 作占位底色，避免大图白屏闪烁（§7 loading-states / §3 content-jumping）。
 * alt 填提示词摘要，供屏幕阅读器与图片加载失败时兜底（§1 alt-text）。
 * onError 时显示占位图标：blob URL 失效等裂图场景不再渲染成永久透明的空块。
 */
function FadeInImage({
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

export function ResultGrid({ results, hasRunning, modelPrices }: ResultGridProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);

  /**
   * 优先使用 blob URL（避免 base64 转 dataURL 的解码开销）
   * 历史记录等无 imageUrl 的数据回退到 dataURL
   */
  const getImageSrc = (result: GenerateResult) =>
    result.imageUrl || `data:${result.mime};base64,${result.b64_json}`;

  const handleDownload = async (result: GenerateResult) => {
    try {
      // 已有 blob URL 直接使用，零额外转换
      // 否则从 dataURL 走一次 fetch 转 blob
      let downloadUrl: string | undefined = result.imageUrl;
      let needsRevoke = false;
      if (!downloadUrl) {
        const dataUrl = `data:${result.mime};base64,${result.b64_json}`;
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        downloadUrl = URL.createObjectURL(blob);
        needsRevoke = true;
      }
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `generated-${Date.now()}.${result.mime.split("/")[1] || "png"}`;
      link.click();
      // 仅在本次新建的 URL 上 revoke，复用的 imageUrl 不能动
      if (needsRevoke && downloadUrl) {
        const urlToRevoke = downloadUrl;
        setTimeout(() => URL.revokeObjectURL(urlToRevoke), 1000);
      }
    } catch (e) {
      console.error("Download failed:", e);
    }
  };

  const handleDownloadAll = () => {
    results.forEach((result, i) => {
      setTimeout(() => handleDownload(result), i * 500);
    });
  };

  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground animate-fade-up">
        <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-3">
          <Sparkles className="w-7 h-7 text-primary" />
        </div>
        <p className="text-base font-medium text-foreground">
          {hasRunning ? "生成中…" : "开始创作"}
        </p>
        <p className="text-xs mt-1 text-muted-foreground/80">
          {hasRunning ? "任务进行中，完成后将在此展示" : "在上方输入提示词，AI 将为你生成图像"}
        </p>
      </div>
    );
  }

  // 按 compareGroup 聚合:同组两项并排成对比组,无组单独成项
  type RenderItem =
    | { type: "single"; result: GenerateResult; index: number }
    | { type: "compare"; a: GenerateResult; b: GenerateResult; indexA: number; indexB: number };

  const renderItems: RenderItem[] = [];
  const consumed = new Set<number>();
  results.forEach((r, i) => {
    if (consumed.has(i)) return;
    if (r.compareGroup) {
      const pairIdx = results.findIndex(
        (r2, j) => j > i && r2.compareGroup === r.compareGroup
      );
      if (pairIdx > -1) {
        consumed.add(i);
        consumed.add(pairIdx);
        renderItems.push({
          type: "compare",
          a: r,
          b: results[pairIdx],
          indexA: i,
          indexB: pairIdx,
        });
        return;
      }
    }
    renderItems.push({ type: "single", result: r, index: i });
  });

  // 展开预览:点击已展开项可关闭(toggle)
  const handleExpand = (i: number) => {
    setExpandedIndex(expandedIndex === i ? null : i);
    setZoom(1);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          输出图库 <span className="text-foreground font-medium">{results.length}</span>
        </span>
        {results.length > 1 && (
          <Button variant="ghost" size="sm" onClick={handleDownloadAll} className="press transition-base hover:bg-accent/60">
            <Download className="w-4 h-4 mr-2" />
            全部下载
          </Button>
        )}
      </div>

      {/* 列数随数量自适应:1 张大图居中,2~4 张 2 列,5+ 张在宽屏铺 3/4 列 */}
      {(() => {
        const gridCols =
          results.length === 1
            ? "grid-cols-1 max-w-2xl mx-auto"
            : results.length <= 4
              ? "grid-cols-2"
              : "grid-cols-2 md:grid-cols-3 xl:grid-cols-4";
        return (
          <div className={`grid gap-3 ${gridCols}`}>
        {renderItems.map((item) => {
          if (item.type === "compare") {
            // 对比组:占整行两列,顶部横幅标 A vs B
            return (
              <div
                key={item.a.compareGroup}
                className="col-span-full space-y-1 animate-fade-up"
              >
                <div className="text-xs text-muted-foreground px-1">
                  模型对比 · {item.a.model} vs {item.b.model}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <ResultCard
                    result={item.a}
                    index={item.indexA}
                    onExpand={handleExpand}
                    onDownload={handleDownload}
                    getImageSrc={getImageSrc}
                    showModelAlways
                    modelPrices={modelPrices}
                  />
                  <ResultCard
                    result={item.b}
                    index={item.indexB}
                    onExpand={handleExpand}
                    onDownload={handleDownload}
                    getImageSrc={getImageSrc}
                    showModelAlways
                    modelPrices={modelPrices}
                  />
                </div>
              </div>
            );
          }
          return (
            <ResultCard
              key={item.result.id}
              result={item.result}
              index={item.index}
              onExpand={handleExpand}
              onDownload={handleDownload}
              getImageSrc={getImageSrc}
              modelPrices={modelPrices}
            />
          );
        })}
          </div>
        );
      })()}

      {/* 展开的完整预览 */}
      {expandedIndex !== null && (
        <div className="rounded-xl border border-border bg-card/50 overflow-hidden animate-scale-in">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="w-7 h-7 press transition-base hover:bg-accent/60"
                onClick={() => {
                  if (expandedIndex > 0) {
                    setExpandedIndex(expandedIndex - 1);
                    setZoom(1);
                  }
                }}
                disabled={expandedIndex === 0}
                aria-label="上一张"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-sm text-muted-foreground tabular-nums">
                {expandedIndex + 1} / {results.length}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="w-7 h-7 press transition-base hover:bg-accent/60"
                onClick={() => {
                  if (expandedIndex < results.length - 1) {
                    setExpandedIndex(expandedIndex + 1);
                    setZoom(1);
                  }
                }}
                disabled={expandedIndex === results.length - 1}
                aria-label="下一张"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="w-7 h-7 press"
                  onClick={() => setZoom((z) => Math.max(z - 0.25, 0.25))}
                  aria-label="缩小"
                >
                  <ZoomOut className="w-4 h-4" />
                </Button>
                <span className="text-xs text-muted-foreground w-10 text-center tabular-nums">
                  {Math.round(zoom * 100)}%
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="w-7 h-7 press"
                  onClick={() => setZoom((z) => Math.min(z + 0.25, 3))}
                  aria-label="放大"
                >
                  <ZoomIn className="w-4 h-4" />
                </Button>
              </div>

              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleDownload(results[expandedIndex])}
                className="press"
              >
                <Download className="w-4 h-4 mr-2" />
                下载
              </Button>

              <Button
                variant="ghost"
                size="icon"
                className="w-7 h-7 press transition-base hover:bg-accent/60"
                onClick={() => setExpandedIndex(null)}
                aria-label="关闭"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-center p-4 overflow-auto max-h-[70vh]">
            <FadeInImage
              src={getImageSrc(results[expandedIndex])}
              alt={results[expandedIndex].prompt}
              className="transition-slow"
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: "center center",
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** 单张结果图卡(对比组与单项共用) */
function ResultCard({
  result,
  index,
  onExpand,
  onDownload,
  getImageSrc,
  showModelAlways = false,
  modelPrices,
}: {
  result: GenerateResult;
  index: number;
  onExpand: (index: number) => void;
  onDownload: (r: GenerateResult) => void;
  getImageSrc: (r: GenerateResult) => string;
  /** 对比组内常驻显示模型名,非对比组仅 hover 显示 */
  showModelAlways?: boolean;
  /** 模型 → 单张价格映射,用于标签里显示该图花费 */
  modelPrices?: Record<string, number>;
}) {
  // 该模型单张价格;>0 才展示,避免给未收录模型显示"¥0.00"
  const price = modelPrices?.[result.model];
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
      {/* 模型名+价格标签:对比组常驻,非对比组仅 hover */}
      <span
        className={`absolute bottom-1 right-1 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-white/90 transition-base ${
          showModelAlways ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
      >
        {result.model}
        {price != null && price > 0 && (
          <span className="text-emerald-300 ml-1">¥{price.toFixed(2)}</span>
        )}
      </span>
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-base flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
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
      </div>
    </div>
  );
}
