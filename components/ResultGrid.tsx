"use client";

import { useEffect, useState } from "react";
import { Download, FolderDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResultCard } from "@/components/ResultCard";
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
   * 点图的处理：交给 Grid 之外的窗口级查看器（ImageViewer）。
   * 网格自己不再就地展开——下方突然长出一大块会把图库顶走。
   */
  onPreviewRequest: (index: number) => void;
  /** 从图库移除某一项；不传则结果卡上不显示叉号 */
  onRemove?: (result: GenerateResult) => void;
}

export function ResultGrid({ results, hasRunning, onPreviewRequest, onRemove }: ResultGridProps) {
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

  // 卡片上的单张动作（APP 内 a[download] 无处理器，改用原生保存到相册）
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

  const handleExpand = (i: number) => onPreviewRequest(i);

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

    </div>
  );
}
