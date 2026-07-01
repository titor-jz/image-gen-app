"use client";

import { useState, useRef, useCallback } from "react";
import { Upload, X, Image as ImageIcon, Eraser, AtSign, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AspectRatio, ModelInfo } from "@/lib/types";

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
  onReferenceImagesChange: (imgs: ReferenceImage[]) => void;
  models: ModelInfo[];
  selectedModel: string;
  onModelChange: (m: string) => void;
  selectedSize: AspectRatio;
  onSizeChange: (s: AspectRatio) => void;
  selectedQuality: Quality;
  onQualityChange: (q: Quality) => void;
  onGenerate: () => void;
  loading: boolean;
  pollProgress: number;
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

const MAX_IMG_SIZE = 8 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const MAX_COUNT = 8;

export function UnifiedInputCard({
  prompt, onPromptChange, referenceImages, onReferenceImagesChange,
  models, selectedModel, onModelChange, selectedSize, onSizeChange,
  selectedQuality, onQualityChange, onGenerate, loading, pollProgress,
}: UnifiedInputCardProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [imgError, setImgError] = useState<string | null>(null);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionPos, setMentionPos] = useState(0);
  const [selectedMentionIdx, setSelectedMentionIdx] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const processFile = useCallback((file: File) => {
    setImgError(null);
    if (!ACCEPTED_TYPES.includes(file.type)) { setImgError("仅支持 JPG, PNG, WEBP"); return; }
    if (file.size > MAX_IMG_SIZE) { setImgError("文件不能超过 8MB"); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      onReferenceImagesChange([...referenceImages, {
        id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: file.name, base64: result, mimeType: file.type,
      }]);
    };
    reader.readAsDataURL(file);
  }, [referenceImages, onReferenceImagesChange]);

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
    <div className="input-card p-0 overflow-hidden">
      {/* 上半部分：提示词输入 + 参考图 */}
      <div className="p-5 pb-3">
        {/* 参考图缩略图行 */}
        {referenceImages.length > 0 && (
          <div className="flex flex-wrap gap-3 mb-3">
            {referenceImages.map((img) => (
              <div key={img.id} className="flex flex-col items-center gap-1">
                <div className="relative group w-14 h-14 rounded-lg overflow-hidden border border-border/50">
                  <img src={img.base64} alt={img.name} className="w-full h-full object-cover" />
                  <Button variant="ghost" size="icon"
                    className="absolute -top-1 -right-1 w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity bg-destructive text-white rounded-full"
                    onClick={() => removeImage(img.id)}>
                    <X className="w-2.5 h-2.5" />
                  </Button>
                </div>
                <span className="text-xs text-muted-foreground truncate max-w-14" title={img.name}>{img.name}</span>
              </div>
            ))}
            {!isFull && (
              <div onDrop={handleDrop} onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
                onPaste={handlePaste} tabIndex={0}
                className={`w-14 h-14 rounded-lg border-2 border-dashed flex items-center justify-center cursor-pointer transition-all
                  ${isDragging ? "border-primary bg-primary/5" : "border-border/50 hover:border-primary/50"}`}
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
            className="w-full min-h-[100px] resize-none bg-transparent text-foreground text-base placeholder:text-muted-foreground/60 outline-none"
            rows={4}
          />
          {prompt && (
            <Button variant="ghost" size="icon" className="absolute top-0 right-0 w-7 h-7" onClick={() => onPromptChange("")}>
              <Eraser className="w-3.5 h-3.5 text-muted-foreground" />
            </Button>
          )}
        </div>

        {/* @ 提及建议 */}
        {showMentions && filteredMentions.length > 0 && (
          <div className="absolute z-50 mt-1 w-56 rounded-lg border border-border bg-popover shadow-lg overflow-hidden">
            <div className="px-3 py-1.5 text-xs text-muted-foreground border-b border-border flex items-center gap-1.5">
              <AtSign className="w-3 h-3" /> 选择参考图片
            </div>
            <div className="max-h-40 overflow-y-auto">
              {filteredMentions.map((img, idx) => (
                <button key={img.id}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${idx === selectedMentionIdx ? "bg-accent" : "hover:bg-accent"}`}
                  onClick={() => insertMention(img)} onMouseEnter={() => setSelectedMentionIdx(idx)}>
                  <img src={img.base64} alt={img.name} className="w-7 h-7 rounded object-cover flex-shrink-0" />
                  <span className="truncate">{img.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {imgError && <p className="text-xs text-destructive mt-1">{imgError}</p>}
      </div>

      {/* 下半部分：参数工具栏 */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-border/50 bg-background/30">
        <div className="flex items-center gap-2 flex-wrap">
          {/* 添加图片按钮 */}
          {!isFull && (
            <Button variant="ghost" size="icon" className="w-8 h-8 rounded-full" onClick={() => fileInputRef.current?.click()}>
              <Upload className="w-4 h-4" />
            </Button>
          )}
          <input ref={fileInputRef} type="file" accept={ACCEPTED_TYPES.join(",")} multiple className="hidden"
            onChange={(e) => { const files = Array.from(e.target.files || []); const remaining = MAX_COUNT - referenceImages.length; for (const file of files.slice(0, remaining)) processFile(file); e.target.value = ""; }} />

          {/* 模型选择 */}
          <select value={selectedModel} onChange={(e) => e.target.value && onModelChange(e.target.value)}
            className="toolbar-chip appearance-none bg-transparent outline-none cursor-pointer text-foreground">
            {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>

          {/* 比例选择 */}
          <select value={selectedSize} onChange={(e) => e.target.value && onSizeChange(e.target.value as AspectRatio)}
            className="toolbar-chip appearance-none bg-transparent outline-none cursor-pointer text-foreground">
            {SIZES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>

          {/* 清晰度 */}
          <select value={selectedQuality} onChange={(e) => e.target.value && onQualityChange(e.target.value as Quality)}
            className="toolbar-chip appearance-none bg-transparent outline-none cursor-pointer text-foreground">
            {QUALITIES.map((q) => <option key={q.value} value={q.value}>{q.label}</option>)}
          </select>
        </div>

        {/* 右侧：生成按钮 */}
        <Button onClick={onGenerate} disabled={!prompt.trim() || loading}
          className="h-9 px-5 gap-2 rounded-full bg-primary text-primary-foreground hover:bg-primary/80">
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {pollProgress ? `${pollProgress * 3}s` : "提交中..."}
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              生成
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
