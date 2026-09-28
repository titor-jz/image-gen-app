"use client";

import { useEffect, useState } from "react";
import { Download, Heart, X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Sparkles, FolderDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FadeInImage, ResultCard } from "@/components/ResultCard";
import { isCapacitor } from "@/lib/capacitor-env";
import {
  downloadAllResults,
  downloadResult,
  getResultImageSrc,
  saveAllResultsToGallery,
  saveResultToGallery,
} from "@/lib/image-actions";
import type { GenerateResult } from "@/lib/types";

interface ResultGridProps {
  results: GenerateResult[];
  /** 是否有任务在跑（仅用于空态时显示"生成中…"） */
  hasRunning?: boolean;
}

export function ResultGrid({ results, hasRunning }: ResultGridProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  // 仅 Capacitor 壳内显示「保存到相册」（effect 后置检测，避免 hydration 不一致）
  const [canSaveToGallery, setCanSaveToGallery] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 挂载后检测原生环境（SSR 首帧无 window.Capacitor）
    setCanSaveToGallery(isCapacitor());
  }, []);

  /**
   * 优先使用 blob URL（避免 base64 转 dataURL 的解码开销）
   * 历史记录等无 imageUrl 的数据回退到 dataURL
   */
  const getImageSrc = getResultImageSrc;

  const handleSaveToGallery = saveResultToGallery;

  const handleDownload = downloadResult;

  const handleDownloadAll = () => downloadAllResults(results);

  const handleSaveAll = () => saveAllResultsToGallery(results);

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
          // APP 环境 `a[download]` 无处理器（点了没反应）→ 换成原生保存；
          // 浏览器/PWA 保持下载
          <Button
            variant="ghost"
            size="sm"
            onClick={canSaveToGallery ? handleSaveAll : handleDownloadAll}
            className="press transition-base hover:bg-accent/60"
          >
            {canSaveToGallery ? (
              <FolderDown className="w-4 h-4 mr-2" />
            ) : (
              <Download className="w-4 h-4 mr-2" />
            )}
            {canSaveToGallery ? "全部保存" : "全部下载"}
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
                  {item.a.model === item.b.model && item.a.nodeName && item.b.nodeName
                    ? `线路对比 · ${item.a.nodeName} vs ${item.b.nodeName}`
                    : `模型对比 · ${item.a.model} vs ${item.b.model}`}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <ResultCard
                    result={item.a}
                    index={item.indexA}
                    onExpand={handleExpand}
                    onDownload={handleDownload}
                    onSaveToGallery={handleSaveToGallery}
                    appMode={canSaveToGallery}
                    getImageSrc={getImageSrc}
                    showModelAlways
                  />
                  <ResultCard
                    result={item.b}
                    index={item.indexB}
                    onExpand={handleExpand}
                    onDownload={handleDownload}
                    onSaveToGallery={handleSaveToGallery}
                    appMode={canSaveToGallery}
                    getImageSrc={getImageSrc}
                    showModelAlways
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
              onSaveToGallery={handleSaveToGallery}
              appMode={canSaveToGallery}
              getImageSrc={getImageSrc}
            />
          );
        })}
          </div>
        );
      })()}

      {/* 展开的完整预览 */}
      {expandedIndex !== null && (
        <div className="rounded-xl border border-border bg-card/50 overflow-hidden animate-scale-in">
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:px-4 sm:py-3 border-b border-border">
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

              {/* 下载：仅浏览器/PWA（APP 环境 a[download] 无效，由「保存到相册」替代） */}
              {!canSaveToGallery && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleDownload(results[expandedIndex])}
                  className="press"
                >
                  <Download className="w-4 h-4 mr-2" />
                  下载
                </Button>
              )}

              {/* 保存到系统相册：仅 Capacitor 壳内显示 */}
              {canSaveToGallery && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleSaveToGallery(results[expandedIndex])}
                  className="press"
                >
                  <FolderDown className="w-4 h-4 mr-2" />
                  保存到相册
                </Button>
              )}

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

          <div className="flex items-center justify-center p-2 sm:p-4 overflow-auto max-h-[70dvh]">
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
