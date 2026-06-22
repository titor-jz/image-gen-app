"use client";

import { useState, useCallback, useRef } from "react";
import { Upload, X, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ReferenceImage {
  id: string;
  name: string;
  base64: string;
  mimeType: string;
}

interface ReferenceImagesProps {
  images: ReferenceImage[];
  onChange: (images: ReferenceImage[]) => void;
}

const MAX_SIZE = 8 * 1024 * 1024; // 8MB
const ACCEPTED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const MAX_COUNT = 8;

export function ReferenceImages({ images, onChange }: ReferenceImagesProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(
    (file: File) => {
      setError(null);

      if (!ACCEPTED_TYPES.includes(file.type)) {
        setError("仅支持 JPG, JPEG, PNG, WEBP 格式");
        return;
      }

      if (file.size > MAX_SIZE) {
        setError("文件大小不能超过 8MB");
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        const newImg: ReferenceImage = {
          id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: file.name,
          base64: result,
          mimeType: file.type,
        };
        onChange([...images, newImg]);
      };
      reader.readAsDataURL(file);
    },
    [images, onChange]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const files = Array.from(e.dataTransfer.files);
      const remaining = MAX_COUNT - images.length;
      for (const file of files.slice(0, remaining)) {
        processFile(file);
      }
      if (files.length > remaining) {
        setError(`最多上传 ${MAX_COUNT} 张图片`);
      }
    },
    [images.length, processFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData.items;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) processFile(file);
          break;
        }
      }
    },
    [processFile]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      const remaining = MAX_COUNT - images.length;
      for (const file of files.slice(0, remaining)) {
        processFile(file);
      }
      if (files.length > remaining) {
        setError(`最多上传 ${MAX_COUNT} 张图片`);
      }
      e.target.value = "";
    },
    [images.length, processFile]
  );

  const removeImage = useCallback(
    (id: string) => {
      onChange(images.filter((img) => img.id !== id));
    },
    [images, onChange]
  );

  const isFull = images.length >= MAX_COUNT;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm text-muted-foreground">参考图片（最多 {MAX_COUNT} 张）</label>
        {!isFull && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground h-7"
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="w-3.5 h-3.5 mr-1.5" />
            添加图片
          </Button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(",")}
        multiple
        className="hidden"
        onChange={handleFileInput}
      />

      {images.length > 0 ? (
        <div className="flex flex-wrap gap-3">
          {images.map((img) => (
            <div
              key={img.id}
              className="relative group w-20 h-20 rounded-lg overflow-hidden border border-border/50 bg-card"
            >
              <img
                src={img.base64}
                alt={img.name}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors" />
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-0.5 right-0.5 w-5 h-5 opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 hover:bg-black/70 text-white rounded"
                onClick={() => removeImage(img.id)}
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
          ))}

          {!isFull && (
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onPaste={handlePaste}
              tabIndex={0}
              className={`w-20 h-20 rounded-lg border-2 border-dashed flex items-center justify-center cursor-pointer transition-all
                ${isDragging ? "border-primary bg-primary/5" : "border-border/50 hover:border-primary/50"}
              `}
              onClick={() => inputRef.current?.click()}
            >
              <ImageIcon className="w-5 h-5 text-muted-foreground" />
            </div>
          )}
        </div>
      ) : (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onPaste={handlePaste}
          tabIndex={0}
          className={`rounded-xl border-2 border-dashed p-6 text-center transition-all cursor-pointer
            ${isDragging ? "border-primary bg-primary/5 scale-[1.01]" : "border-border/50 hover:border-primary/50"}
          `}
          onClick={() => inputRef.current?.click()}
        >
          <div className="flex flex-col items-center gap-2">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Upload className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">点击、拖放或粘贴图片</p>
              <p className="text-xs text-muted-foreground/60 mt-0.5">
                支持 JPG, PNG, WEBP · 最大 8MB · 最多 {MAX_COUNT} 张
              </p>
            </div>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
