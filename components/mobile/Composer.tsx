"use client";

/**
 * Composer - 移动端输入态（首屏）
 *
 * 视觉：输入是唯一主角——提示词放大字置于"舞台"容器（m-stage，品牌色柔和投影），
 * 参考图收进舞台内的横向缩略图轨；底部操作坞（m-dock）悬浮，梯度品牌色 CTA
 * 是整屏唯一的浓烈时刻。
 *
 * 与桌面 UnifiedInputCard 的差异（有意裁剪）：无大标题；不支持 @提及
 * （触屏下参考图轨直接可见；生成时默认携带全部参考图，与桌面兜底路径一致）。
 */

import { useState, useRef, useCallback } from "react";
import { Upload, X, ImagePlus, Sparkles, ChevronDown, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { validateAndCompress, type RefQuality } from "@/lib/reference-image";
import type { ReferenceImage } from "@/components/UnifiedInputCard";
import type { HistoryRecord } from "@/lib/types";

/**
 * 灵感提示词池（仅在提示词为空时展示，点选可直接编辑）
 * 每次打开随机取 6 条，配「换一批」手动重掷——固定几条很快会腻。
 */
const SUGGESTION_POOL = [
  // 摄影 / 写实氛围
  "赛博朋克城市夜景",
  "雨夜霓虹街拍",
  "晨雾山间公路",
  "老上海弄堂黄昏",
  "雪夜小镇街灯",
  "海边黄昏剪影",
  "深夜书桌台灯光",
  "治愈系咖啡馆一角",
  // 插画 / 风格
  "水彩风动物插画",
  "吉卜力风童年夏天",
  "国风水墨山水",
  "像素艺术场景",
  "蒸汽朋克机械鸟",
  "梦境超现实场景",
  "未来城市概念设计",
  "太空电梯概念图",
  // 人物
  "电影感人物特写",
  "复古胶片人像",
  "汉服写真",
  "街头潮流人像",
  // 产品 / 商业
  "极简产品海报",
  "咖啡杯电商主图",
  "香水广告概念图",
  "甜品店菜单插画",
  // 实用向
  "手机壁纸 · 极简渐变",
  "头像 · 柔和插画风",
  "宠物头像 · 卡通化",
  "书封设计概念",
];

/** 从池中随机取 n 条（尽量与 exclude 不同，避免"点了没变化"） */
function pickSuggestions(pool: string[], n: number, exclude: string[] = []): string[] {
  const excludeSet = new Set(exclude);
  for (let attempt = 0; attempt < 4; attempt++) {
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    const picked = shuffled.slice(0, n);
    if (!picked.every((p) => excludeSet.has(p))) return picked;
  }
  return [...pool].sort(() => Math.random() - 0.5).slice(0, n);
}

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
  recentRecords,
  onOpenRecent,
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
  /** 最近历史（缩略图轨，点开直接看那组图） */
  recentRecords: HistoryRecord[];
  onOpenRecent: (record: HistoryRecord) => void;
}) {
  const [imgError, setImgError] = useState<string | null>(null);
  // 灵感池随机抽样：打开随机一批，「换一批」重掷（key 变化触发入场动画）
  const [suggestions, setSuggestions] = useState<string[]>(() => pickSuggestions(SUGGESTION_POOL, 6));
  const [suggestRoll, setSuggestRoll] = useState(0);
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
      <div className="flex-1 overflow-y-auto px-4 pt-5">
        {/* 微标签：小号加字距，与下方 17px 正文拉开层级 */}
        <div className="flex items-center gap-1.5 mb-2.5 animate-fade-up">
          <Sparkles className="w-3.5 h-3.5 text-primary" />
          <span className="m-micro text-primary/90">描述你的画面</span>
        </div>

        {/* 主角舞台 */}
        <div className="m-stage p-6 animate-fade-up [animation-delay:40ms]">
          <textarea
            value={prompt}
            onChange={(e) => onPromptChange(e.target.value)}
            placeholder="例如：雨夜霓虹下的赛博朋克街道，电影感广角…"
            className="w-full min-h-[120px] resize-none bg-transparent text-foreground text-[17px] leading-relaxed placeholder:text-muted-foreground/62 outline-none"
            rows={4}
          />
          {imgError && <p className="text-xs text-destructive mt-1 animate-fade-in">{imgError}</p>}

          {/* 参考图轨（舞台内） */}
          {(referenceImages.length > 0 || !isFull) && (
            <div className="mt-4 flex items-center gap-3 overflow-x-auto pb-0.5">
              {referenceImages.map((img, i) => (
                <div
                  key={img.id}
                  className="relative shrink-0 animate-fade-up"
                  style={{ animationDelay: `${i * 40}ms` }}
                >
                  <div className="w-16 h-16 rounded-2xl overflow-hidden ring-1 ring-border/50">
                    <img src={img.base64} alt={img.name} className="w-full h-full object-cover" />
                  </div>
                  <button
                    type="button"
                    className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-foreground/85 text-background flex items-center justify-center shadow-md press-sm"
                    onClick={() => removeImage(img.id)}
                    aria-label={`删除 ${img.name}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {!isFull && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-16 h-16 shrink-0 rounded-2xl border border-dashed border-border flex items-center justify-center text-muted-foreground press-sm active:bg-accent/40"
                  aria-label="添加参考图"
                >
                  <ImagePlus className="w-5 h-5" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* 无参考图时的引导动作（弱存在感，不与主角竞争） */}
        {referenceImages.length === 0 && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="mt-4 inline-flex items-center gap-2 text-sm text-muted-foreground press py-1.5 animate-fade-up [animation-delay:80ms]"
          >
            <Upload className="w-4 h-4" />
            添加参考图（可选）
          </button>
        )}

        {/* 灵感建议（提示词为空时，随机一批 + 手动换一批） */}
        {!prompt.trim() && (
          <div className="mt-5 animate-fade-up">
            <div className="mb-2.5 flex items-center justify-between">
              <span className="m-micro text-muted-foreground/80">灵感</span>
              <button
                type="button"
                onClick={() => {
                  setSuggestions((prev) => pickSuggestions(SUGGESTION_POOL, 6, prev));
                  setSuggestRoll((r) => r + 1);
                }}
                className="flex items-center gap-1 text-xs text-muted-foreground press py-1 -my-1"
                aria-label="换一批灵感"
              >
                <RefreshCw className="w-3 h-3" />
                换一批
              </button>
            </div>
            <div key={suggestRoll} className="flex flex-wrap gap-2">
              {suggestions.map((t, i) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => onPromptChange(t)}
                  className="m-pill h-9 px-3.5 text-[13px] text-foreground/80 press active:text-primary animate-fade-up"
                  style={{ animationDelay: `${i * 25}ms` }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 最近生成（点击直接看那组图） */}
        {recentRecords.length > 0 && (
          <div className="mt-6 animate-fade-up">
            <div className="mb-2.5">
              <span className="m-micro text-muted-foreground/80">最近生成</span>
            </div>
            <div className="flex items-center gap-3 overflow-x-auto pb-0.5">
              {recentRecords.slice(0, 12).map((r) => {
                const first = r.results[0];
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => onOpenRecent(r)}
                    className="w-16 h-16 shrink-0 rounded-2xl overflow-hidden bg-muted m-shot press-sm"
                    aria-label={"查看生成记录：" + r.params.prompt.slice(0, 12)}
                  >
                    {first?.b64_json && (
                      <img
                        src={"data:" + first.mime + ";base64," + first.b64_json}
                        alt={r.params.prompt}
                        className="w-full h-full object-cover"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
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

      {/* 底部操作坞（悬浮，非贴边） */}
      <div className="shrink-0 px-4 pt-2 pb-[max(0.9rem,env(safe-area-inset-bottom))]">
        <div className="m-dock p-3 space-y-2.5 animate-fade-up [animation-delay:120ms]">
          {/* 参数摘要 → ParamSheet */}
          <button
            type="button"
            onClick={onOpenParams}
            className="w-full h-10 flex items-center justify-between gap-2 px-2 press rounded-xl"
            aria-label="生成参数"
          >
            <span className="text-[13px] text-muted-foreground truncate">{paramSummary}</span>
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

          {/* 生成（唯一浓烈时刻） */}
          <Button
            onClick={onGenerate}
            disabled={!canGenerate}
            className="w-full h-[52px] gap-2 rounded-[20px] cta-brand text-base font-medium tracking-wide"
          >
            <Sparkles className="w-[18px] h-[18px]" />
            生成
          </Button>
        </div>
      </div>
    </div>
  );
}
