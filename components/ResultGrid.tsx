"use client";

import { useState } from "react";
import { Download, Heart, X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GenerateResult } from "@/lib/types";

interface ResultGridProps {
  results: GenerateResult[];
  loading: boolean;
}

export function ResultGrid({ results, loading }: ResultGridProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);

  const getDataUrl = (result: GenerateResult) =>
    `data:${result.mime};base64,${result.b64_json}`;

  const handleDownload = async (result: GenerateResult) => {
    try {
      const dataUrl = getDataUrl(result);
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `generated-${Date.now()}.${result.mime.split("/")[1] || "png"}`;
      link.click();
      URL.revokeObjectURL(blobUrl);
    } catch (e) {
      console.error("Download failed:", e);
    }
  };

  const handleDownloadAll = () => {
    results.forEach((result, i) => {
      setTimeout(() => handleDownload(result), i * 500);
    });
  };

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="aspect-square rounded-xl bg-muted overflow-hidden relative"
          >
            <div className="absolute inset-0 animate-shimmer" />
          </div>
        ))}
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground animate-fade-up">
        <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-3">
          <Heart className="w-7 h-7 text-primary" />
        </div>
        <p className="text-base font-medium text-foreground">开始创作</p>
        <p className="text-xs mt-1 text-muted-foreground/80">在上方输入提示词，AI 将为你生成图像</p>
      </div>
    );
  }

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

      <div className="grid grid-cols-2 gap-3">
        {results.map((result, index) => (
          <div
            key={result.id}
            className="group relative aspect-square rounded-xl overflow-hidden bg-muted cursor-pointer ring-1 ring-border/50 press-sm animate-fade-up"
            style={{ animationDelay: `${index * 60}ms` }}
            onClick={() => {
              setExpandedIndex(expandedIndex === index ? null : index);
              setZoom(1);
            }}
          >
            <img
              src={getDataUrl(result)}
              alt=""
              className="w-full h-full object-cover transition-slow group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-base flex items-center justify-center opacity-0 group-hover:opacity-100">
              <Button
                variant="secondary"
                size="icon"
                className="press"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDownload(result);
                }}
                aria-label="下载"
              >
                <Download className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>

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
            <img
              src={getDataUrl(results[expandedIndex])}
              alt=""
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
