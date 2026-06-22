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
      <div className="grid grid-cols-2 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="aspect-square rounded-xl bg-muted animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
          <Heart className="w-8 h-8 text-primary" />
        </div>
        <p className="text-lg font-medium">开始创作</p>
        <p className="text-sm mt-1">在左侧输入提示词，点击生成按钮创造独特的图像</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          输出图库 ({results.length})
        </span>
        {results.length > 1 && (
          <Button variant="ghost" size="sm" onClick={handleDownloadAll}>
            <Download className="w-4 h-4 mr-2" />
            全部下载
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {results.map((result, index) => (
          <div
            key={result.id}
            className="group relative aspect-square rounded-xl overflow-hidden bg-muted cursor-pointer"
            onClick={() => {
              setExpandedIndex(expandedIndex === index ? null : index);
              setZoom(1);
            }}
          >
            <img
              src={getDataUrl(result)}
              alt=""
              className="w-full h-full object-cover transition-transform group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
              <Button
                variant="secondary"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDownload(result);
                }}
              >
                <Download className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* 展开的完整预览 */}
      {expandedIndex !== null && (
        <div className="rounded-xl border border-border bg-card/50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="w-7 h-7"
                onClick={() => {
                  if (expandedIndex > 0) {
                    setExpandedIndex(expandedIndex - 1);
                    setZoom(1);
                  }
                }}
                disabled={expandedIndex === 0}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-sm text-muted-foreground">
                {expandedIndex + 1} / {results.length}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="w-7 h-7"
                onClick={() => {
                  if (expandedIndex < results.length - 1) {
                    setExpandedIndex(expandedIndex + 1);
                    setZoom(1);
                  }
                }}
                disabled={expandedIndex === results.length - 1}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="w-7 h-7"
                  onClick={() => setZoom((z) => Math.max(z - 0.25, 0.25))}
                >
                  <ZoomOut className="w-4 h-4" />
                </Button>
                <span className="text-xs text-muted-foreground w-10 text-center">
                  {Math.round(zoom * 100)}%
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="w-7 h-7"
                  onClick={() => setZoom((z) => Math.min(z + 0.25, 3))}
                >
                  <ZoomIn className="w-4 h-4" />
                </Button>
              </div>

              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleDownload(results[expandedIndex])}
              >
                <Download className="w-4 h-4 mr-2" />
                下载
              </Button>

              <Button
                variant="ghost"
                size="icon"
                className="w-7 h-7"
                onClick={() => setExpandedIndex(null)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-center p-4 overflow-auto max-h-[70vh]">
            <img
              src={getDataUrl(results[expandedIndex])}
              alt=""
              className="transition-transform duration-200"
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
