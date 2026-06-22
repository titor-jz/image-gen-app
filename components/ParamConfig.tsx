"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AspectRatio, ModelInfo } from "@/lib/types";

export type Quality = "1k" | "2k" | "4k";

interface ParamConfigProps {
  models: ModelInfo[];
  selectedModel: string;
  onModelChange: (model: string) => void;
  selectedSize: AspectRatio;
  onSizeChange: (size: AspectRatio) => void;
  selectedQuality: Quality;
  onQualityChange: (quality: Quality) => void;
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

// 比例示意图尺寸（最大边 16px）
function RatioIcon({ ratio }: { ratio: string }) {
  if (ratio === "auto") {
    return (
      <div className="flex gap-[2px]">
        <div className="w-2 h-2 rounded-[1px] bg-muted-foreground/60" />
        <div className="w-2 h-2 rounded-[1px] bg-muted-foreground/60" />
      </div>
    );
  }

  const [w, h] = ratio.split(":").map(Number);
  const max = 16;
  const scale = max / Math.max(w, h);
  const pxW = Math.round(w * scale);
  const pxH = Math.round(h * scale);

  return (
    <div
      className="rounded-[2px] border border-muted-foreground/40 bg-muted-foreground/10"
      style={{ width: pxW, height: pxH }}
    />
  );
}

export function ParamConfig({
  models,
  selectedModel,
  onModelChange,
  selectedSize,
  onSizeChange,
  selectedQuality,
  onQualityChange,
}: ParamConfigProps) {
  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm text-muted-foreground mb-2 block">模型</label>
        <Select value={selectedModel} onValueChange={(v) => v && onModelChange(v)}>
          <SelectTrigger className="bg-card border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-popover border-border">
            {models.map((model) => (
              <SelectItem key={model.id} value={model.id}>
                {model.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm text-muted-foreground mb-2 block">比例</label>
          <Select value={selectedSize} onValueChange={(v) => v && onSizeChange(v as AspectRatio)}>
            <SelectTrigger className="bg-card border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              {SIZES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  <div className="flex items-center gap-2.5">
                    <RatioIcon ratio={s.value} />
                    <span>{s.label}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="text-sm text-muted-foreground mb-2 block">清晰度</label>
          <Select value={selectedQuality} onValueChange={(v) => v && onQualityChange(v as Quality)}>
            <SelectTrigger className="bg-card border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              {QUALITIES.map((q) => (
                <SelectItem key={q.value} value={q.value}>
                  {q.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
