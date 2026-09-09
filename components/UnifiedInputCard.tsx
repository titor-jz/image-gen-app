"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { Upload, X, Image as ImageIcon, Eraser, AtSign, Sparkles, ChevronDown, Check, CheckCircle2, XCircle, Ban, Loader2, GitCompare, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildApiHeaders } from "@/lib/api-headers";
import type { AspectRatio, GenTask, ModelInfo } from "@/lib/types";
import type { ApiProfile } from "@/lib/api-config-context";

export interface ReferenceImage {
  id: string;
  name: string;
  base64: string;
  mimeType: string;
}

export type Quality = "1k" | "2k" | "4k";

interface UnifiedInputCardProps {
  prompt: string;
  onPromptChange: (v: string) => void;
  referenceImages: ReferenceImage[];
  /** 支持直接传新数组或函数式更新（批量上传并发追加时必须用函数式，避免旧闭包互相覆盖） */
  onReferenceImagesChange: React.Dispatch<React.SetStateAction<ReferenceImage[]>>;
  models: ModelInfo[];
  selectedModel: string;
  onModelChange: (m: string) => void;
  selectedSize: AspectRatio;
  onSizeChange: (s: AspectRatio) => void;
  selectedQuality: Quality;
  onQualityChange: (q: Quality) => void;
  selectedN: 1 | 2 | 3 | 4;
  onNChange: (n: 1 | 2 | 3 | 4) => void;
  /** 对比模式开关 */
  compareMode: boolean;
  onCompareModeChange: (on: boolean) => void;
  /** 对比模式第二个模型 */
  modelB: string;
  onModelBChange: (m: string) => void;
  /** 全部 API 节点配置与当前激活 id（对比模式选 B 侧线路用） */
  profiles: ApiProfile[];
  activeNodeId: string;
  /** 对比模式 B 侧节点 id（null = 跟随当前节点） */
  nodeBId: string | null;
  onNodeBChange: (id: string | null) => void;
  /** 全部会话任务（进行中 + 终态淡出期），用于渲染进度列表 */
  tasks: GenTask[];
  /** 取消单个任务 */
  onCancelTask: (id: string) => void;
  onGenerate: () => void;
}

const SIZES: { value: AspectRatio; label: string }[] = [
  { value: "auto", label: "自动" },
  { value: "1:1", label: "1:1" },
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
];
const QUALITIES: { value: Quality; label: string }[] = [
  { value: "1k", label: "1K" },
  { value: "2k", label: "2K" },
  { value: "4k", label: "4K" },
];
/** 单次生成图片数量选项。值用 string 是为了复用 SelectChip<string> */
const COUNTS: { value: string; label: string }[] = [
  { value: "1", label: "1张" },
  { value: "2", label: "2张" },
  { value: "3", label: "3张" },
  { value: "4", label: "4张" },
];

const MAX_IMG_SIZE = 8 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const MAX_COUNT = 8;
const COMPRESS_THRESHOLD = 1024 * 1024;
const COMPRESS_MAX_EDGE = 1024;
const COMPRESS_QUALITY = 0.85;

async function compressImage(file: File): Promise<{ blob: Blob; mime: string }> {
  if (file.size < COMPRESS_THRESHOLD || !file.type.startsWith("image/")) {
    return { blob: file, mime: file.type };
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, COMPRESS_MAX_EDGE / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve({ blob: file, mime: file.type }); return; }
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          if (!blob || blob.size >= file.size) { resolve({ blob: file, mime: file.type }); return; }
          resolve({ blob, mime: "image/jpeg" });
        },
        "image/jpeg",
        COMPRESS_QUALITY
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve({ blob: file, mime: file.type }); };
    img.src = url;
  });
}

function SelectChip<T extends string>({
  value,
  onChange,
  options,
  className = "",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className={`toolbar-chip ${open ? "border-border bg-accent/60" : ""}`}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span>{current?.label}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-base ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute bottom-full mb-2 left-0 min-w-full bg-popover border border-border rounded-xl shadow-xl py-1 z-50 animate-fade-up max-h-60 overflow-y-auto scrollbar-thin">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-base hover:bg-accent/60 ${opt.value === value ? "text-primary" : "text-foreground"}`}
              role="option"
              aria-selected={opt.value === value}
            >
              <span className="flex-1 text-left whitespace-nowrap">{opt.label}</span>
              {opt.value === value && <Check className="w-3.5 h-3.5 text-primary" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function UnifiedInputCard({
  prompt, onPromptChange, referenceImages, onReferenceImagesChange,
  models, selectedModel, onModelChange, selectedSize, onSizeChange,
  selectedQuality, onQualityChange, selectedN, onNChange,
  compareMode, onCompareModeChange, modelB, onModelBChange,
  profiles, activeNodeId, nodeBId, onNodeBChange,
  tasks, onCancelTask,
  onGenerate,
}: UnifiedInputCardProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [imgError, setImgError] = useState<string | null>(null);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionPos, setMentionPos] = useState(0);
  const [selectedMentionIdx, setSelectedMentionIdx] = useState(0);
  /** @ 弹窗用 portal + fixed 渲染，避免被卡片 overflow-hidden 裁剪 */
  const [mentionRect, setMentionRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 对比模式跨节点：B 侧节点的模型列表按需拉取（选完节点 B 才拉，失败回退当前列表）
  const nodeBProfile = profiles.find((p) => p.id === nodeBId) ?? null;
  const isCrossNode = !!nodeBProfile && nodeBProfile.id !== activeNodeId;
  const [modelsB, setModelsB] = useState<ModelInfo[] | null>(null);
  useEffect(() => {
    if (!compareMode || !isCrossNode || !nodeBProfile) {
      // 撤销拉取结果（异步 IIFE 内重置,避免 effect 体同步 setState）
      void (async () => setModelsB(null))();
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/models", {
          headers: buildApiHeaders({
            apiKey: nodeBProfile.apiKey,
            baseUrl: nodeBProfile.baseUrl,
            proxyUrl: nodeBProfile.proxyUrl,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!cancelled && data?.models && Array.isArray(data.models) && data.models.length > 0) {
          setModelsB(data.models);
          // 节点 B 的模型列表与当前选择不同源:若 modelB 不在列表中，自动校正为第一个，
          // 避免下拉显示与实际生成用的模型不一致
          if (!data.models.some((m: ModelInfo) => m.id === modelB) && data.models[0]?.id) {
            onModelBChange(data.models[0].id);
          }
        } else if (!cancelled) {
          setModelsB(null);
        }
      } catch {
        if (!cancelled) setModelsB(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [compareMode, isCrossNode, nodeBProfile, modelB, onModelBChange]);
  const modelBOptions = isCrossNode && modelsB ? modelsB : models;

  // 弹窗打开时锚定到 textarea 下方；滚动/缩放窗口时跟随。
  // 初始定位/复位经 rAF 异步执行，避免在 effect 体内同步 setState（级联渲染）
  useEffect(() => {
    const update = () => {
      const ta = textareaRef.current;
      if (!ta) return;
      const rect = ta.getBoundingClientRect();
      setMentionRect({ top: rect.bottom + 6, left: rect.left, width: Math.max(224, rect.width) });
    };
    const raf = requestAnimationFrame(() => {
      if (showMentions) update();
      else setMentionRect(null);
    });
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [showMentions]);

  const processFile = useCallback(async (file: File) => {
    setImgError(null);
    if (!ACCEPTED_TYPES.includes(file.type)) { setImgError("仅支持 JPG, PNG, WEBP"); return; }
    if (file.size > MAX_IMG_SIZE) { setImgError("文件不能超过 8MB"); return; }
    try {
      const { blob, mime } = await compressImage(file);
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        // 函数式更新:批量多张并发处理时,闭包里的 referenceImages 是旧值,
        // 直接展开会互相覆盖,只留最后一张
        onReferenceImagesChange((prev) => [...prev, {
          id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: file.name, base64: result, mimeType: mime,
        }]);
      };
      reader.readAsDataURL(blob);
    } catch {
      setImgError("图片处理失败");
    }
  }, [onReferenceImagesChange]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    const remaining = MAX_COUNT - referenceImages.length;
    for (const file of files.slice(0, remaining)) processFile(file);
    if (files.length > remaining) setImgError(`最多上传 ${MAX_COUNT} 张`);
  }, [referenceImages.length, processFile]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    for (const item of e.clipboardData.items) {
      if (item.type.startsWith("image/")) { const file = item.getAsFile(); if (file) processFile(file); break; }
    }
  }, [processFile]);

  const removeImage = useCallback((id: string) => {
    onReferenceImagesChange(referenceImages.filter((img) => img.id !== id));
  }, [referenceImages, onReferenceImagesChange]);

  const filteredMentions = referenceImages.filter((img) =>
    img.name.toLowerCase().includes(mentionQuery.toLowerCase())
  );

  const insertMention = useCallback((img: ReferenceImage) => {
    const tag = `@${img.name} `;
    const textBefore = prompt.slice(0, mentionPos);
    const atIndex = textBefore.lastIndexOf("@");
    const beforeAt = atIndex >= 0 ? prompt.slice(0, atIndex) : prompt.slice(0, mentionPos);
    const afterCursor = prompt.slice(mentionPos);
    onPromptChange(beforeAt + tag + afterCursor);
    setShowMentions(false);
    setTimeout(() => { if (textareaRef.current) { const newPos = beforeAt.length + tag.length; textareaRef.current.focus(); textareaRef.current.setSelectionRange(newPos, newPos); } }, 0);
  }, [prompt, mentionPos, onPromptChange]);

  const handlePromptKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (showMentions && filteredMentions.length > 0) {
      if (e.key === "Escape") { setShowMentions(false); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setSelectedMentionIdx((p) => (p + 1) % filteredMentions.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSelectedMentionIdx((p) => (p - 1 + filteredMentions.length) % filteredMentions.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertMention(filteredMentions[selectedMentionIdx]); return; }
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onGenerate(); }
  }, [showMentions, filteredMentions, selectedMentionIdx, insertMention, onGenerate]);

  const handlePromptChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const cursorPos = e.target.selectionStart;
    const textBefore = newValue.slice(0, cursorPos);
    const atIndex = textBefore.lastIndexOf("@");
    if (atIndex !== -1) {
      const afterAt = textBefore.slice(atIndex + 1);
      if (!afterAt.includes(" ")) { setShowMentions(true); setMentionQuery(afterAt); setMentionPos(cursorPos); setSelectedMentionIdx(0); onPromptChange(newValue); return; }
    }
    setShowMentions(false);
    onPromptChange(newValue);
  }, [onPromptChange]);

  const isFull = referenceImages.length >= MAX_COUNT;

  return (
    <div className="input-card p-0 overflow-hidden transition-slow hover:shadow-xl">
      {/* 上半部分：提示词输入 + 参考图 */}
      <div className="p-5 pb-3">
        {/* 参考图缩略图行 */}
        {referenceImages.length > 0 && (
          <div className="flex flex-wrap gap-3 mb-3">
            {referenceImages.map((img, i) => (
              <div
                key={img.id}
                className="flex flex-col items-center gap-1 animate-fade-up"
                style={{ animationDelay: `${i * 30}ms` }}
              >
                {/* 外层不裁剪，删除按钮悬浮在缩略图右上角才能完整显示 */}
                <div className="relative group">
                  <div className="w-14 h-14 rounded-lg overflow-hidden border border-border/50 transition-base hover:border-border">
                    <img src={img.base64} alt={img.name} className="w-full h-full object-cover transition-slow group-hover:scale-110" />
                  </div>
                  {/* 常驻显示的删除按钮：深底白叉 + 背景色描边，任何图片上都清晰可见 */}
                  <button
                    type="button"
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-destructive text-white flex items-center justify-center shadow-md ring-2 ring-background press-sm transition-base hover:bg-destructive/90 hover:scale-110"
                    onClick={() => removeImage(img.id)}
                    aria-label={`删除 ${img.name}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
                <span className="text-xs text-muted-foreground truncate max-w-14" title={img.name}>{img.name}</span>
              </div>
            ))}
            {!isFull && (
              <div onDrop={handleDrop} onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
                onPaste={handlePaste} tabIndex={0}
                className={`w-14 h-14 rounded-lg border-2 border-dashed flex items-center justify-center cursor-pointer transition-base
                  ${isDragging ? "border-primary bg-primary/10 scale-105" : "border-border/50 hover:border-primary/50 hover:bg-accent/30"}`}
                onClick={() => fileInputRef.current?.click()}>
                <ImageIcon className="w-4 h-4 text-muted-foreground" />
              </div>
            )}
          </div>
        )}

        {/* 提示词输入 */}
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={handlePromptChange}
            onKeyDown={handlePromptKeyDown}
            onPaste={handlePaste}
            placeholder="在此处拖入图片，并写入提示词"
            className="w-full min-h-[100px] resize-none bg-transparent text-foreground text-base placeholder:text-muted-foreground/60 outline-none leading-relaxed"
            rows={4}
          />
          {prompt && (
            <Button variant="ghost" size="icon" className="absolute top-0 right-0 w-7 h-7 press transition-base hover:bg-accent/60" onClick={() => onPromptChange("")} aria-label="清空">
              <Eraser className="w-3.5 h-3.5 text-muted-foreground" />
            </Button>
          )}
        </div>

        {/* @ 提及建议：portal 到 body + fixed 定位，避免被卡片 overflow-hidden 裁剪导致图片多时看不到 */}
        {showMentions && filteredMentions.length > 0 && mentionRect && createPortal(
          <div
            className="fixed z-[60] rounded-xl border border-border bg-popover shadow-xl overflow-hidden animate-fade-up"
            style={{ top: mentionRect.top, left: mentionRect.left, width: mentionRect.width }}
          >
            <div className="px-3 py-1.5 text-xs text-muted-foreground border-b border-border flex items-center gap-1.5">
              <AtSign className="w-3 h-3" /> 选择参考图片（{filteredMentions.length} 张）
            </div>
            <div className="max-h-64 overflow-y-auto scrollbar-thin">
              {filteredMentions.map((img, idx) => (
                <button key={img.id}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-base ${idx === selectedMentionIdx ? "bg-accent" : "hover:bg-accent/60"}`}
                  onClick={() => insertMention(img)} onMouseEnter={() => setSelectedMentionIdx(idx)}>
                  <img src={img.base64} alt={img.name} className="w-9 h-9 rounded-md object-cover flex-shrink-0 border border-border/50" />
                  <span className="truncate flex-1">{img.name}</span>
                </button>
              ))}
            </div>
          </div>,
          document.body
        )}

        {imgError && <p className="text-xs text-destructive mt-1 animate-fade-in">{imgError}</p>}
      </div>

      {/* 下半部分：参数工具栏 */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-border/50 bg-background/30">
        <div className="flex items-center gap-2 flex-wrap">
          {/* 添加图片按钮 */}
          {!isFull && (
            <Button variant="ghost" size="icon" className="w-8 h-8 rounded-full press transition-base hover:bg-accent/60" onClick={() => fileInputRef.current?.click()} aria-label="添加图片">
              <Upload className="w-4 h-4" />
            </Button>
          )}
          <input ref={fileInputRef} type="file" accept={ACCEPTED_TYPES.join(",")} multiple className="hidden"
            onChange={(e) => { const files = Array.from(e.target.files || []); const remaining = MAX_COUNT - referenceImages.length; for (const file of files.slice(0, remaining)) processFile(file); e.target.value = ""; }} />

          {/* 模型选择 */}
          <SelectChip
            value={selectedModel}
            onChange={onModelChange}
            options={models.map((m) => ({ value: m.id, label: m.name }))}
          />

          {/* 对比开关:复用 toolbar-chip 保持圆角统一,激活态用 toolbar-chip-active */}
          <button
            type="button"
            className={`toolbar-chip press ${compareMode ? "toolbar-chip-active" : ""}`}
            onClick={() => onCompareModeChange(!compareMode)}
            aria-pressed={compareMode}
          >
            <GitCompare className="w-3.5 h-3.5" />
            对比
          </button>

          {/* 跨节点对比时的提示徽标:B 侧走独立线路 */}
          {compareMode && isCrossNode && nodeBProfile && (
            <span
              className="toolbar-chip toolbar-chip-active gap-1"
              title={`对比线路 B:${nodeBProfile.baseUrl}`}
            >
              <Server className="w-3.5 h-3.5" />
              {nodeBProfile.name || "未命名节点"}
            </span>
          )}

          {/* 模型 B 选择:仅对比模式显示,前缀 B 与结果横幅的 A vs B 对应;
              跨节点时列表来自节点 B 的 /api/models */}
          {compareMode && (
            <SelectChip
              value={modelBOptions.some((m) => m.id === modelB) ? modelB : (modelBOptions[0]?.id ?? "")}
              onChange={onModelBChange}
              options={modelBOptions.map((m) => ({ value: m.id, label: `B: ${m.name}` }))}
            />
          )}

          {/* 节点 B 选择:仅对比模式显示,选了不同节点即为跨线路对比;默认「同当前节点」 */}
          {compareMode && profiles.length > 1 && (
            <SelectChip
              value={nodeBId ?? activeNodeId}
              onChange={(id) => onNodeBChange(id === activeNodeId ? null : id)}
              options={[
                { value: activeNodeId, label: "B: 同当前节点" },
                ...profiles
                  .filter((p) => p.id !== activeNodeId)
                  .map((p) => ({ value: p.id, label: `B: ${p.name || "未命名节点"}` })),
              ]}
            />
          )}

          {/* 比例选择 */}
          <SelectChip value={selectedSize} onChange={onSizeChange} options={SIZES} />

          {/* 清晰度 */}
          <SelectChip value={selectedQuality} onChange={onQualityChange} options={QUALITIES} />

          {/* 生成数量：第 4 个 chip,对比模式隐藏(对比固定每模型1张) */}
          {!compareMode && (
            <SelectChip
              value={String(selectedN)}
              onChange={(v) => onNChange(Number(v) as 1 | 2 | 3 | 4)}
              options={COUNTS}
            />
          )}
        </div>

        {/* 右侧：生成按钮（常驻可用，不再因 loading 切换成取消） */}
        <Button
          onClick={onGenerate}
          disabled={!prompt.trim()}
          className="h-9 px-5 gap-2 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 press transition-base shadow-sm hover:shadow-md disabled:opacity-50 disabled:hover:bg-primary"
        >
          <span className="flex items-center gap-2">
            <Sparkles className="w-4 h-4" />
            生成
          </span>
        </Button>
      </div>

      {/* 任务进度列表：按 batchId 分组，每批一个微容器。
          - polling 用 shimmer 流光表示"工作中"，不显示假百分比爬行（motion-meaning）
          - 终态用状态图标 + 状态色（color-not-only：不只靠颜色传达状态）
          - 进行中/刚终态(淡出期)都显示；终态 1.5s 后由 hook 移除 */}
      {tasks.length > 0 && (
        <div className="px-4 pb-3 flex flex-col gap-2 animate-fade-in">
          {Object.entries(
            tasks.reduce<Record<string, GenTask[]>>((acc, t) => {
              (acc[t.batchId] ??= []).push(t);
              return acc;
            }, {})
          ).map(([batchId, group]) => (
            <div
              key={batchId}
              className="rounded-xl bg-muted/60 border border-border/60 px-3 py-2 flex flex-col gap-1.5"
            >
              {group.map((slot) => {
                const running =
                  slot.status === "submitting" || slot.status === "polling";
                // 状态图标 + 颜色（§1 color-not-only：图标辅助颜色传达状态）
                const Icon =
                  slot.status === "success"
                    ? CheckCircle2
                    : slot.status === "failed"
                    ? XCircle
                    : slot.status === "cancelled"
                    ? Ban
                    : Loader2;
                const iconColor =
                  slot.status === "success"
                    ? "text-emerald-500"
                    : slot.status === "failed"
                    ? "text-destructive"
                    : slot.status === "cancelled"
                    ? "text-muted-foreground/60"
                    : "text-primary";
                const barColor =
                  slot.status === "failed"
                    ? "bg-destructive"
                    : slot.status === "cancelled"
                    ? "bg-muted-foreground/40"
                    : slot.status === "success"
                    ? "bg-emerald-500"
                    : "bg-primary";
                const isTerminal =
                  slot.status === "success" ||
                  slot.status === "failed" ||
                  slot.status === "cancelled";
                const label = isTerminal
                  ? slot.status === "success"
                    ? "完成"
                    : slot.status === "failed"
                    ? "失败"
                    : "取消"
                  : slot.elapsedSec
                  ? `${slot.elapsedSec}s`
                  : "等待";
                return (
                  <div key={slot.id} className="flex items-center gap-2.5">
                    {/* 状态图标：polling 时旋转，终态静态 */}
                    <Icon
                      className={`w-4 h-4 shrink-0 ${iconColor} ${
                        slot.status === "submitting" || slot.status === "polling"
                          ? "animate-spin"
                          : ""
                      }`}
                    />
                    <span className="text-xs text-muted-foreground w-5 shrink-0 tabular-nums">
                      #{slot.slot + 1}
                    </span>
                    <div className="flex-1 h-1.5 bg-muted/60 rounded-full overflow-hidden relative">
                      {/* 进度填充：终态满格；submitting/polling 用低填充 + 流光表示工作中 */}
                      <div
                        className={`h-full transition-all duration-500 ease-soft ${barColor}`}
                        style={{
                          width: `${
                            isTerminal
                              ? 100
                              : slot.status === "submitting"
                              ? 15
                              : Math.min(90, Math.max(20, Math.round((slot.progress || 0.1) * 100)))
                          }%`,
                        }}
                      />
                      {/* polling 阶段叠加 shimmer 流光，传达"正在工作"（motion-meaning） */}
                      {running && (
                        <div className="absolute inset-0 animate-shimmer rounded-full" />
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground w-9 text-right shrink-0 tabular-nums">
                      {label}
                    </span>
                    {running ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="w-6 h-6 shrink-0 press hover:bg-accent/60"
                        onClick={() => onCancelTask(slot.id)}
                        aria-label={`取消第 ${slot.slot + 1} 张`}
                      >
                        <X className="w-3.5 h-3.5 text-muted-foreground" />
                      </Button>
                    ) : (
                      <span className="w-6 h-6 shrink-0" />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

    </div>
  );
}
