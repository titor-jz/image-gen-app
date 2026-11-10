"use client";

import { useEffect, useState } from "react";
import { Download, X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, FolderDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FadeInImage, ResultCard } from "@/components/ResultCard";
import { isCapacitor } from "@/lib/capacitor-env";
import { aspectOf } from "@/lib/aspect";
import { buildResultRenderItems } from "@/lib/result-groups";
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
  /**
   * 点图的处理。触屏上传入本回调走全屏预览（可左右滑、Capacitor 内直接存相册）；
   * 不传则用内置的展开预览（桌面）。
   */
  onPreviewRequest?: (index: number) => void;
  /** 从图库移除某一项；不传则结果卡上不显示叉号 */
  onRemove?: (result: GenerateResult) => void;
}

export function ResultGrid({ results, hasRunning, onPreviewRequest, onRemove }: ResultGridProps) {
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
      <div className="animate-fade-up rounded-[3px] border border-dashed border-[color:var(--inst-line-2)] px-6 py-16">
        <div className="mx-auto flex max-w-md flex-col items-center text-center">
          <span className="inst-label">{hasRunning ? "生成中" : "空图库"}</span>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {hasRunning
              ? "任务进行中，完成后将在此展示"
              : "写入提示词并点生成，结果会一张张落到这里"}
          </p>
        </div>
      </div>
    );
  }

  // 按 compareGroup 聚合:同组两项并排成对比组,无组单独成项
  const renderItems = buildResultRenderItems(results);

  const handleExpand = (i: number) => {
    if (onPreviewRequest) {
      onPreviewRequest(i);
      return;
    }
    setExpandedIndex(expandedIndex === i ? null : i);
    setZoom(1);
  };

  // 展开预览的对象：results 可能因为「历史回填 / 单张移除」而变短或整体换掉，
  // 此时 expandedIndex 可能越界 —— 直接读 expanded.xxx 会抛错白屏，
  // 所以统一走这个派生值，取不到就不渲染展开块。
  const expanded = expandedIndex !== null ? results[expandedIndex] ?? null : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 border-b border-border/70 pb-2">
        <span className="inst-label">输出图库</span>
        <span className="inst-mono text-[12px] text-foreground">{results.length}</span>
        {results.length > 1 && (
          // APP 环境 `a[download]` 无处理器（点了没反应）→ 换成原生保存；
          // 浏览器/PWA 保持下载
          <Button
            variant="ghost"
            size="sm"
            onClick={canSaveToGallery ? handleSaveAll : handleDownloadAll}
            className="inst-label ml-auto h-8 px-2 transition-colors hover:text-foreground"
          >
            {canSaveToGallery ? (
              <FolderDown className="w-3.5 h-3.5 mr-1.5" />
            ) : (
              <Download className="w-3.5 h-3.5 mr-1.5" />
            )}
            {canSaveToGallery ? "全部保存" : "全部下载"}
          </Button>
        )}
      </div>

      {/* 列数随数量自适应：1 张居中大图，2–3 张平铺，4 张在宽屏一行四列（仪器面板的读数行） */}
      {(() => {
        const gridCols =
          results.length === 1
            ? "grid-cols-1 max-w-2xl mx-auto"
            : results.length === 2
              ? "grid-cols-2 max-w-3xl mx-auto"
              : results.length === 3
                ? "grid-cols-2 lg:grid-cols-3"
                : "grid-cols-2 xl:grid-cols-4";
        // 单张时按画幅反推最大宽度：竖图不能被拉到超出视口，
        // 宽度上限 = 68dvh × 宽高比，图仍然是原比例、不裁切
        const singleMaxW =
          results.length === 1
            ? `min(42rem, calc(68dvh * ${aspectOf(results[0].size) ?? 1}))`
            : undefined;
        return (
          <div
            className={`grid items-start gap-3 ${gridCols}`}
            style={singleMaxW ? { maxWidth: singleMaxW } : undefined}
          >
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
                <div className="grid grid-cols-2 items-start gap-3">
                  <ResultCard
                    result={item.a}
                    index={item.indexA}
                    onExpand={handleExpand}
                    onDownload={handleDownload}
                    onRemove={onRemove}
                    onSaveToGallery={handleSaveToGallery}
                    appMode={canSaveToGallery}
                    getImageSrc={getImageSrc}
                  />
                  <ResultCard
                    result={item.b}
                    index={item.indexB}
                    onExpand={handleExpand}
                    onDownload={handleDownload}
                    onRemove={onRemove}
                    onSaveToGallery={handleSaveToGallery}
                    appMode={canSaveToGallery}
                    getImageSrc={getImageSrc}
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
              onRemove={onRemove}
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
      {expanded && expandedIndex !== null && (
        <div className="rounded-[3px] border border-border bg-card overflow-hidden animate-scale-in">
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
              <span className="inst-mono text-[12px] text-muted-foreground tabular-nums">
                {String(expandedIndex + 1).padStart(2, "0")} / {String(results.length).padStart(2, "0")}
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
              {/* 生成渠道信息：与结果卡/移动端全屏保持一致 */}
              <span className="inst-mono ml-1 max-w-64 truncate text-[12px] text-muted-foreground">
                {expanded.nodeName ? `${expanded.nodeName} · ` : ""}
                {expanded.model}
                {expanded.size && expanded.size !== "auto"
                  ? ` · ${expanded.size}`
                  : ""}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 bg-[color:var(--inst-sunken)] rounded-[2px] p-1">
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
                  onClick={() => handleDownload(expanded)}
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
                  onClick={() => handleSaveToGallery(expanded)}
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
              src={getImageSrc(expanded)}
              alt={expanded.prompt}
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
