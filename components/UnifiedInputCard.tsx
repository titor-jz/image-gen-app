"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Image as ImageIcon, Eraser, AtSign, Server, Wand2, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SelectChip } from "@/components/SelectChip";
import { PromptGuide } from "@/components/PromptGuide";
import { MAX_PROMPT_CHARS } from "@/lib/prompt-rules";
import { ACCEPTED_TYPES, validateAndCompress, toVerifiedDataUrl, type RefQuality } from "@/lib/reference-image";
import { useNodeBModels } from "@/hooks/useNodeBModels";
import { useAutoGrowTextarea } from "@/hooks/useAutoGrowTextarea";
import { TaskList } from "@/components/TaskList";
import type { AspectRatio, GenTask, ModelInfo, OutputFormat } from "@/lib/types";
import type { ApiProfile } from "@/lib/api-config-context";

export interface ReferenceImage {
  id: string;
  name: string;
  base64: string;
  mimeType: string;
}

export type Quality = "1k" | "2k" | "4k";

export type { RefQuality } from "@/lib/reference-image";

interface UnifiedInputCardProps {
  prompt: string;
  onPromptChange: (v: string) => void;
  referenceImages: ReferenceImage[];
  /** 输出格式（static=静图 / gif=动图）；gif 时仅列出支持动图的模型，且服务端注入动图指令 */
  outputFormat: OutputFormat;
  onOutputFormatChange: (f: OutputFormat) => void;
  /** 参考图清晰度模式：自动压缩 / 高清压缩 / 原图直传（选择持久化） */
  refQuality: RefQuality;
  onRefQualityChange: (q: RefQuality) => void;
  /** 支持直接传新数组或函数式更新（批量上传并发追加时必须用函数式，避免旧闭包互相覆盖） */
  onReferenceImagesChange: React.Dispatch<React.SetStateAction<ReferenceImage[]>>;
  /** 节点切换后新模型列表加载中（chip 显示加载提示，避免误以为旧列表可用） */
  modelsLoading?: boolean;
  /** 模型列表拉取失败原因（null=成功）；失败时 UI 显示兜底列表+重试入口 */
  modelsError?: string | null;
  /** 重拉模型列表（设置弹窗改完 Key 后也可用） */
  onReloadModels?: () => void;
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
  /** 超时任务续一轮轮询 */
  onResumeTask: (id: string) => void;
  /** 移除超时/残留任务行 */
  onDismissTask: (id: string) => void;
  onGenerate: () => void;
  /** 优化提示词：走节点上游的对话模型改写，结果回填输入框（见 app/api/optimize） */
  onOptimizePrompt: () => void;
  /** 改写请求进行中（按钮转 loading，防连点） */
  optimizeLoading?: boolean;
}

export const SIZES: { value: AspectRatio; label: string }[] = [
  { value: "auto", label: "自动" },
  { value: "1:1", label: "1:1" },
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
];

/** 输出格式选项：动图仅 gpt-image ≥2.6 支持（服务端会注入动图指令） */
export const OUTPUT_FORMATS: { value: OutputFormat; label: string }[] = [
  { value: "static", label: "静图" },
  { value: "gif", label: "GIF 动图" },
  { value: "svg", label: "SVG 矢量图" },
];

/** SVG 导出为 2.6 全家族能力（基础版/flare 实测均出真矢量），≥2.6 即可 */
function supportsSvg(modelId: string): boolean {
  const m = /gpt-image-(\d+)(?:\.(\d+))?/i.exec(modelId);
  if (!m) return false;
  return Number(m[1]) > 2 || (Number(m[1]) === 2 && Number(m[2] ?? 0) >= 6);
}

/** gpt-image ≥2.6 才可能支持动图输出；2.6 系里实测仅 flare/sunburst 变体出动画
 *  （基础版 2.6 同提示词实测只出静图），非 gpt-image 系一律按静图处理 */
function supportsAnimation(modelId: string): boolean {
  const m = /gpt-image-(\d+)(?:\.(\d+))?(?:-(flare|sunburst))?$/i.exec(modelId);
  if (!m) return false;
  const major = Number(m[1]);
  const minor = Number(m[2] ?? 0);
  if (major > 2 || (major === 2 && minor > 6)) return true; // 2.7+ 假定继承能力
  if (major === 2 && minor === 6) return Boolean(m[3]); // 基础版 2.6 实测静图，变体才动
  return false;
}
export const QUALITIES: { value: Quality; label: string }[] = [
  { value: "1k", label: "1K" },
  { value: "2k", label: "2K" },
  { value: "4k", label: "4K" },
];
/** 单次生成图片数量选项。值用 string 是为了复用 SelectChip<string> */
export const COUNTS: { value: string; label: string }[] = [
  { value: "1", label: "1张" },
  { value: "2", label: "2张" },
  { value: "3", label: "3张" },
  { value: "4", label: "4张" },
];

const MAX_COUNT = 8;

export function UnifiedInputCard({
  prompt, onPromptChange, referenceImages, onReferenceImagesChange,
  models, modelsLoading, modelsError, onReloadModels, selectedModel, onModelChange, selectedSize, onSizeChange,
  selectedQuality, onQualityChange, selectedN, onNChange,
  compareMode, onCompareModeChange, modelB, onModelBChange,
  outputFormat, onOutputFormatChange,
  profiles, activeNodeId, nodeBId, onNodeBChange,
  refQuality, onRefQualityChange,
  tasks, onCancelTask, onResumeTask, onDismissTask,
  onGenerate, onOptimizePrompt, optimizeLoading,
}: UnifiedInputCardProps) {
  const [isDragging, setIsDragging] = useState(false);
  /** 整卡拖放：拖文件悬停在卡片任意位置时高亮（区别于小虚线框的 isDragging） */
  const [cardDragOver, setCardDragOver] = useState(false);
  const [imgError, setImgError] = useState<string | null>(null);
  /** 创作须知展开态（写什么/长度/禁止内容） */
  const [showGuide, setShowGuide] = useState(false);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionPos, setMentionPos] = useState(0);
  const [selectedMentionIdx, setSelectedMentionIdx] = useState(0);
  /** @ 弹窗用 portal + fixed 渲染，避免被卡片 overflow-hidden 裁剪 */
  const [mentionRect, setMentionRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // 优化后文本会变长，输入框跟着长高（超过 240px 转内部滚动）
  useAutoGrowTextarea(textareaRef, prompt, 240);

  // 对比模式跨节点：B 侧节点的模型列表按需拉取（hook 抽取，便于单独复用）
  const nodeBProfile = profiles.find((p) => p.id === nodeBId) ?? null;
  const { modelsB, isCrossNode } = useNodeBModels({
    compareMode,
    nodeBProfile,
    activeNodeId,
    modelB,
    onModelBChange,
  });
  const modelBOptions = isCrossNode && modelsB ? modelsB : models;

  // 按输出格式过滤模型：GIF 仅 flare/sunburst（基础版 2.6 实测静图）；
  // SVG 需 ≥2.6（全家族实测）；静图不限。无匹配型号时回退全量（避免死下拉）
  const requiredCapable =
    outputFormat === "gif" ? supportsAnimation : outputFormat === "svg" ? supportsSvg : null;
  const capableModels = requiredCapable ? models.filter((m) => requiredCapable(m.id)) : models;
  const selectableModels = capableModels.length > 0 ? capableModels : models;
  const capableModelB = requiredCapable ? modelBOptions.filter((m) => requiredCapable(m.id)) : modelBOptions;
  const selectableModelB = capableModelB.length > 0 ? capableModelB : modelBOptions;

  // 切换格式后当前模型不支持时，自动切到第一个支持的型号
  useEffect(() => {
    if (!requiredCapable) return;
    if (selectableModels.some((m) => m.id === selectedModel)) return;
    if (modelsLoading && models.length === 0) return;
    if (selectableModels.length) onModelChange(selectableModels[0].id);
  }, [requiredCapable, selectableModels, selectedModel, onModelChange, modelsLoading, models.length]);

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
    const result = await validateAndCompress(file, refQuality);
    if ("error" in result) { setImgError(result.error); return; }
    const dataUrl = await toVerifiedDataUrl(result.blob);
    if (!dataUrl) {
      // 解码失败（如 MIME 谎报的 HEIC）：直接拒收，避免列表里出现空白缩略图
      setImgError("无法读取这张图片，请换一张 JPG / PNG / WEBP");
      return;
    }
    // 函数式更新:批量多张并发处理时,闭包里的 referenceImages 是旧值,
    // 直接展开会互相覆盖,只留最后一张
    onReferenceImagesChange((prev) => [...prev, {
      id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: file.name, base64: dataUrl, mimeType: result.mime,
    }]);
  }, [onReferenceImagesChange, refQuality]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false); setCardDragOver(false);
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

  const sizeLabel = SIZES.find((s) => s.value === selectedSize)?.label ?? selectedSize;

  return (
    <div
      className={`input-card relative overflow-hidden transition-slow ${cardDragOver ? "ring-2 ring-[color:var(--inst-accent)]" : ""}`}
      // 整卡拖放：只接管文件拖拽（types 含 Files），文字拖入文本框不受影响
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setCardDragOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        // 在卡片内部子元素间移动会冒泡 dragleave，只有真正离开卡片才取消高亮
        if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget as Node)) return;
        setCardDragOver(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        handleDrop(e);
      }}
    >
      {cardDragOver && (
        <div className="absolute inset-x-0 top-0 z-30 bg-[color:var(--inst-accent)] text-white text-xs text-center py-1.5 pointer-events-none animate-fade-in">
          松开鼠标，添加为参考图
        </div>
      )}

      {/* 三栏控制台：提示词 | 参数 | 生成。窄屏纵向堆叠。 */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_396px_172px]">

        {/* ── 1 · 提示词 ── */}
        <div className="p-5">
          <div className="mb-2 flex items-baseline gap-2.5">
            <span className="inst-label">提示词</span>
            <span
              className={`inst-mono text-[12px] ${
                prompt.length > MAX_PROMPT_CHARS * 0.9 ? "text-amber-600" : "text-muted-foreground"
              }`}
            >
              {prompt.length} / {MAX_PROMPT_CHARS}
            </span>
            {/* 提示词优化：走节点上游的对话模型改写（消耗少量额度）；连点可换一版，撤销在 toast 里 */}
            <button
              type="button"
              onClick={onOptimizePrompt}
              disabled={!prompt.trim() || optimizeLoading}
              title="用节点上游的对话模型改写提示词（消耗少量额度）"
              className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-[2px] px-1 font-[family-name:var(--inst-mono)] text-[12px] tracking-[0.08em] text-[color:var(--inst-accent)] transition-colors hover:text-foreground disabled:opacity-40 disabled:hover:text-[color:var(--inst-accent)]"
            >
              {optimizeLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Wand2 className="w-3.5 h-3.5" />
              )}
              {optimizeLoading ? "优化中…" : "优化提示词"}
            </button>
          </div>

          {/* 提示词输入 */}
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={handlePromptChange}
              onKeyDown={handlePromptKeyDown}
              onPaste={handlePaste}
              placeholder="在此处拖入图片，并写入提示词"
              /* pr-7 给右上角「清空」按钮留位：优化后的长文本首行会跑到它下面 */
              className="w-full min-h-[100px] resize-none bg-transparent text-foreground text-base placeholder:text-muted-foreground/60 outline-none leading-relaxed pr-7"
              maxLength={MAX_PROMPT_CHARS}
              rows={4}
            />
            {prompt && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-0 right-0 w-7 h-7 press transition-base"
                onClick={() => onPromptChange("")}
                aria-label="清空"
              >
                <Eraser className="w-3.5 h-3.5 text-muted-foreground" />
              </Button>
            )}
          </div>

          {/* 参考图行：缩略图 + 添加入口 + 压缩档位（从工具栏移到这里，语义归位） */}
          <div className="mt-3 flex flex-wrap items-center gap-2.5 border-t border-dashed border-border/70 pt-3">
            {referenceImages.map((img, i) => (
              <div
                key={img.id}
                className="animate-fade-up flex flex-col items-center gap-1"
                style={{ animationDelay: `${i * 30}ms` }}
              >
                {/* 外层不裁剪，删除按钮悬浮在缩略图右上角才能完整显示 */}
                <div className="relative group">
                  <div className="h-14 w-11 overflow-hidden rounded-[2px] border border-[color:var(--inst-line-2)] transition-base hover:border-foreground">
                    <img
                      src={img.base64}
                      alt={img.name}
                      className="h-full w-full object-cover transition-slow group-hover:scale-110"
                    />
                  </div>
                  <button
                    type="button"
                    className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-white shadow-md ring-2 ring-background transition-base hover:bg-destructive/90 sm:-top-1.5 sm:-right-1.5"
                    onClick={() => removeImage(img.id)}
                    aria-label={`删除 ${img.name}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
                <span className="max-w-14 truncate text-xs text-muted-foreground" title={img.name}>
                  {img.name}
                </span>
              </div>
            ))}

            {!isFull && (
              <>
                <button
                  type="button"
                  onDrop={handleDrop}
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
                  onPaste={handlePaste}
                  className={`flex h-14 w-11 items-center justify-center rounded-[2px] border border-dashed transition-base ${
                    isDragging
                      ? "border-[color:var(--inst-accent)] bg-[color:var(--inst-accent-weak)]"
                      : "border-[color:var(--inst-line-2)] hover:border-foreground"
                  }`}
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="添加参考图"
                >
                  <ImageIcon className="w-4 h-4 text-muted-foreground" />
                </button>
              </>
            )}

            {/* 参考图清晰度：自动/高清/原图（选择持久化到用户设置） */}
            <SelectChip
              value={refQuality}
              onChange={onRefQualityChange}
              options={[
                { value: "auto", label: "自动压缩" },
                { value: "hd", label: "高清压缩" },
                { value: "original", label: "原图直传" },
              ]}
            />

            <span className="inst-label ml-auto hidden xl:inline">
              {referenceImages.length > 0
                ? `${referenceImages.length} / ${MAX_COUNT} 张参考`
                : "拖入或 ⌘V 粘贴"}
            </span>
          </div>

          {imgError && <p className="text-xs text-destructive mt-1 animate-fade-in">{imgError}</p>}
        </div>

        {/* ── 2 · 参数 ── */}
        <div className="border-t border-border/70 p-5 lg:border-t-0 lg:border-l">
          <div className="flex flex-col gap-3.5">
            {/* 张数：四个刻度位，当前值点亮仪器橙 */}
            <div className="flex items-center gap-3">
              <span className="inst-label w-9 shrink-0">张数</span>
              <div className="flex gap-2">
                {COUNTS.map((c) => {
                  const n = Number(c.value) as 1 | 2 | 3 | 4;
                  const on = !compareMode && selectedN === n;
                  return (
                    <button
                      key={c.value}
                      type="button"
                      className="inst-dot"
                      data-on={on}
                      disabled={compareMode}
                      onClick={() => onNChange(n)}
                      aria-pressed={on}
                      title={compareMode ? "对比模式下每个模型固定 1 张" : `${n} 张`}
                    >
                      {c.value}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 画幅 + 质量：GIF 模式下画幅禁用（上游动图管线挑剔尺寸，统一 1024x1024，
                输出画幅由模型自定），质量不受限（实测 low/high 均可动画） */}
            <div className="flex items-center gap-3">
              <span className="inst-label w-9 shrink-0">画幅</span>
              <SelectChip
                value={selectedSize}
                onChange={onSizeChange}
                options={SIZES}
                disabled={outputFormat === "gif"}
                disabledTitle="动图尺寸由模型自定"
              />
              <span className="inst-label shrink-0">质量</span>
              <SelectChip value={selectedQuality} onChange={onQualityChange} options={QUALITIES} />
            </div>

            {/* 输出格式：动图仅 2.6 系支持，选中后模型下拉只留可动图的型号 */}
            <div className="flex items-center gap-3">
              <span className="inst-label w-9 shrink-0">格式</span>
              <SelectChip value={outputFormat} onChange={onOutputFormatChange} options={OUTPUT_FORMATS} />
              {outputFormat === "gif" && (
                <span
                  className="inst-label text-muted-foreground"
                  title="服务端会自动在提示词前后加动图与循环动作指令，历史里仍保留你的原文。注意：写实人像题材上游不支持生成动图（会得到静图），建议卡通/插画/动物等题材"
                >
                  已自动加动图与循环动作指令 · 写实人像不支持
                </span>
              )}
              {outputFormat === "svg" && (
                <span
                  className="inst-label text-muted-foreground"
                  title="已透传 SVG 输出参数，画幅即画布比例（viewBox）。适合图标/Logo/扁平插画。注意：官方模型仅支持纯文字生成 SVG（图生图端点不支持 SVG、不接受参考图），写实照片类内容也不适合矢量风格"
                >
                  已透传 SVG 输出 · 画幅即画布比例 · 仅纯文字
                </span>
              )}
            </div>

            {/* 模型 */}
            <div className="flex items-center gap-3">
              <span className="inst-label w-9 shrink-0">模型</span>
              <div className="min-w-0 flex-1">
                {/* 节点切换后加载中显示提示，避免误用旧节点模型列表 */}
                <SelectChip
                  value={selectedModel}
                  onChange={onModelChange}
                  options={selectableModels.map((m) => ({ value: m.id, label: m.name }))}
                  displayLabel={modelsLoading && models.length === 0 ? "模型加载中…" : undefined}
                />
              </div>
            </div>

            {/* 模型列表拉取失败：不再静默吞掉，给出原因与重试入口 */}
            {modelsError && !modelsLoading && (
              <button
                type="button"
                onClick={onReloadModels}
                className="self-start inline-flex items-center gap-1.5 pl-12 text-xs text-destructive transition-colors hover:text-foreground"
                title={modelsError}
              >
                <RotateCcw className="h-3 w-3" />
                模型列表获取失败：{modelsError}（点按重试）
              </button>
            )}

            {/* 对比开关 */}
            <div className="flex items-center gap-3">
              <span className="inst-label w-9 shrink-0">对比</span>
              <button
                type="button"
                className="inst-toggle"
                data-on={compareMode}
                onClick={() => onCompareModeChange(!compareMode)}
                aria-pressed={compareMode}
              >
                <i className="pip" />
                {compareMode ? "已开启" : "关闭"}
              </button>

              {/* 跨节点对比时的提示徽标：B 侧走独立线路 */}
              {compareMode && isCrossNode && nodeBProfile && (
                <span
                  className="inst-label flex min-w-0 items-center gap-1 text-foreground"
                  title={`对比线路 B：${nodeBProfile.baseUrl}`}
                >
                  <Server className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{nodeBProfile.name || "未命名节点"}</span>
                </span>
              )}
            </div>

            {/* 对比模式：B 模型 / B 节点（跨线路对比） */}
            {compareMode && (
              <div className="flex flex-col gap-3 border-t border-dashed border-border/70 pt-3">
                <div className="flex items-center gap-3">
                  <span className="inst-label w-9 shrink-0">B 模型</span>
                  <div className="min-w-0 flex-1">
                    {/* 跨节点时列表来自节点 B 的 /api/models */}
                    <SelectChip
                      value={modelBOptions.some((m) => m.id === modelB) ? modelB : (modelBOptions[0]?.id ?? "")}
                      onChange={onModelBChange}
                      options={selectableModelB.map((m) => ({ value: m.id, label: m.name }))}
                    />
                  </div>
                </div>
                {profiles.length > 1 && (
                  <div className="flex items-center gap-3">
                    <span className="inst-label w-9 shrink-0">B 线路</span>
                    <div className="min-w-0 flex-1">
                      <SelectChip
                        value={nodeBId ?? activeNodeId}
                        onChange={(id) => onNodeBChange(id === activeNodeId ? null : id)}
                        options={[
                          { value: activeNodeId, label: "同当前节点" },
                          ...profiles
                            .filter((p) => p.id !== activeNodeId)
                            .map((p) => ({ value: p.id, label: p.name || "未命名节点" })),
                        ]}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── 3 · 生成 ── */}
        <div className="flex flex-col justify-between gap-4 border-t border-border/70 bg-[color:var(--inst-sunken)] p-5 lg:border-t-0 lg:border-l">
          <div>
            <div className="inst-label">本次</div>
            <div className="mt-1.5 inst-mono text-[15px] leading-relaxed text-foreground">
              {compareMode ? "2 张（对比）" : `${selectedN} 张`}
            </div>
            <div className="mt-0.5 inst-mono text-[12px] text-muted-foreground">
              {selectedQuality.toUpperCase()} · {sizeLabel}
            </div>
          </div>

          <div>
            <button
              type="button"
              onClick={onGenerate}
              disabled={!prompt.trim()}
              className="btn-go"
            >
              生成
            </button>
            <button
              type="button"
              onClick={() => setShowGuide((v) => !v)}
              className="inst-label mt-2 flex h-8 w-full items-center justify-center transition-colors hover:text-foreground"
              aria-expanded={showGuide}
            >
              {showGuide ? "收起须知" : "创作须知"}
            </button>
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(",")}
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          const remaining = MAX_COUNT - referenceImages.length;
          for (const file of files.slice(0, remaining)) processFile(file);
          e.target.value = "";
        }}
      />

      {/* 创作须知：展开后横跨整块面板 */}
      {showGuide && (
        <div className="animate-fade-in border-t border-border/70 px-5 py-4">
          <PromptGuide />
        </div>
      )}

      {/* @ 提及建议：portal 到 body + fixed 定位，避免被卡片 overflow-hidden 裁剪导致图片多时看不到 */}
      {showMentions && filteredMentions.length > 0 && mentionRect && createPortal(
        <div
          className="fixed z-[60] overflow-hidden rounded-[3px] border border-border bg-popover shadow-xl animate-fade-up"
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
                <img src={img.base64} alt={img.name} className="w-9 h-9 rounded-[2px] object-cover flex-shrink-0 border border-border/60" />
                <span className="truncate flex-1">{img.name}</span>
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}

      <TaskList
        tasks={tasks}
        onCancelTask={onCancelTask}
        onResumeTask={onResumeTask}
        onDismissTask={onDismissTask}
        className="border-t border-border/70 px-5 py-3"
      />

    </div>
  );
}
