"use client";

/**
 * Composer - 移动端输入态（首屏）
 *
 * 结构：可滚动输入区（参考图 + 提示词）+ 底部固定区（参数摘要 / 迷你进度 / 生成按钮）。
 * 与桌面 UnifiedInputCard 的差异（有意裁剪）：
 *  - 无大标题（原生 App 不浪费首屏）
 *  - 不支持 @提及（触屏下参考图行直接可见；生成时默认携带全部参考图，行为与桌面兜底路径一致）
 *  - 参数移入 ParamSheet，此处仅保留一行摘要
 */

import { useState, useRef, useCallback } from "react";
import { Upload, X, Image as ImageIcon, Sparkles, ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { validateAndCompress, type RefQuality } from "@/lib/reference-image";
import type { ReferenceImage } from "@/components/UnifiedInputCard";

const MAX_COUNT = 8;

export function Composer({
  prompt, onPromptChange,
  referenceImages, onReferenceImagesChange,
  refQuality,
  paramSummary,
  runningCount,
  onOpenParams,
  onShowResults,
  onGenerate,
  canGenerate,
}: {
  prompt: string;
  onPromptChange: (v: string) => void;
  referenceImages: ReferenceImage[];
  onReferenceImagesChange: React.Dispatch<React.SetStateAction<ReferenceImage[]>>;
  refQuality: RefQuality;
  /** 参数摘要文案（如 "GPT-Image2 · 自动 · 1K · 1张"） */
  paramSummary: string;
  /** 进行中任务数（>0 时显示迷你进度条） */
  runningCount: number;
  onOpenParams: () => void;
  onShowResults: () => void;
  onGenerate: () => void;
  canGenerate: boolean;
}) {
  const [imgError, setImgError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(
    async (file: File) => {
      setImgError(null);
      const result = await validateAndCompress(file, refQuality);
      if ("error" in result) {
        setImgError(result.error);
        return;
      }
      const { blob, mime } = result;
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        // 函数式更新：批量并发追加时避免旧闭包互相覆盖
        onReferenceImagesChange((prev) => [
          ...prev,
          {
            id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            name: file.name,
            base64: dataUrl,
            mimeType: mime,
          },
        ]);
      };
      reader.readAsDataURL(blob);
    },
    [onReferenceImagesChange, refQuality]
  );

  const removeImage = useCallback(
    (id: string) => {
      onReferenceImagesChange(referenceImages.filter((img) => img.id !== id));
    },
    [referenceImages, onReferenceImagesChange]
  );

  const isFull = referenceImages.length >= MAX_COUNT;

  return (
    <div className="flex flex-col h-full">
      {/* 输入区（可滚动） */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 pt-4 pb-2">
          {/* 参考图行 */}
          {referenceImages.length > 0 && (
            <div className="flex flex-wrap gap-3 mb-4">
              {referenceImages.map((img, i) => (
                <div
                  key={img.id}
                  className="flex flex-col items-center gap-1 animate-fade-up"
                  style={{ animationDelay: `${i * 30}ms` }}
                >
                  <div className="relative group">
                    <div className="w-16 h-16 rounded-xl overflow-hidden border border-border/50">
                      <img src={img.base64} alt={img.name} className="w-full h-full object-cover" />
                    </div>
                    <button
                      type="button"
                      className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-destructive text-white flex items-center justify-center shadow-md ring-2 ring-background press-sm"
                      onClick={() => removeImage(img.id)}
                      aria-label={`删除 ${img.name}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
              {!isFull && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-16 h-16 rounded-xl border-2 border-dashed border-border/50 flex items-center justify-center press-sm active:border-primary/50 active:bg-accent/30"
                  aria-label="添加参考图"
                >
                  <ImageIcon className="w-5 h-5 text-muted-foreground" />
                </button>
              )}
            </div>
          )}

          {/* 提示词 */}
          <textarea
            value={prompt}
            onChange={(e) => onPromptChange(e.target.value)}
            placeholder="描述你想生成的画面…"
            className="w-full min-h-[128px] resize-none bg-transparent text-foreground text-base placeholder:text-muted-foreground/60 outline-none leading-relaxed"
            rows={5}
          />
          {imgError && <p className="text-xs text-destructive mt-1 animate-fade-in">{imgError}</p>}

          {/* 参考图添加钮（无参考图时以工具栏形式出现） */}
          {referenceImages.length === 0 && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="toolbar-chip press mt-1"
            >
              <Upload className="w-3.5 h-3.5" />
              添加参考图
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              const remaining = MAX_COUNT - referenceImages.length;
              for (const file of files.slice(0, remaining)) void processFile(file);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {/* 底部固定区 */}
      <div className="shrink-0 border-t border-border/50 bg-background/60 backdrop-blur-md px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] space-y-2.5">
        {/* 参数摘要 → ParamSheet */}
        <button
          type="button"
          onClick={onOpenParams}
          className="w-full h-11 flex items-center justify-between gap-2 rounded-xl border border-border/50 bg-background/50 px-3 press hover:bg-accent/40"
          aria-label="生成参数"
        >
          <span className="text-sm text-muted-foreground truncate">{paramSummary}</span>
          <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
        </button>

        {/* 迷你进度：进行中任务一键回结果态 */}
        {runningCount > 0 && (
          <button
            type="button"
            onClick={onShowResults}
            className="w-full h-10 flex items-center justify-center gap-2 rounded-xl bg-primary/10 text-primary text-sm press animate-fade-in"
          >
            <Loader2 className="w-4 h-4 animate-spin" />
            {runningCount} 个任务进行中 · 查看
          </button>
        )}

        {/* 生成（唯一主 CTA） */}
        <Button
          onClick={onGenerate}
          disabled={!canGenerate}
          className="w-full h-12 gap-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 press transition-base text-base disabled:opacity-50"
        >
          <Sparkles className="w-4 h-4" />
          生成
        </Button>
      </div>
    </div>
  );
}
