"use client";

/**
 * PickerSheet - 二级选择面板（底部 Sheet 内的"点行→选择"模式）
 *
 * 在底部面板里避免再套浮动下拉（会浮出面板外/遮挡标题）：
 * 点参数行 → 本面板从下方滑出列出选项，选中打勾，点选即生效并关闭。
 */

import { Check } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";

export function PickerSheet<T extends string>({
  open,
  onClose,
  title,
  options,
  value,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  options: { value: T; label: string }[];
  value: T;
  onSelect: (v: T) => void;
}) {
  return (
    <BottomSheet open={open} onClose={onClose} title={title}>
      <div className="px-3 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-1">
        {options.map((opt) => {
          const selected = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onSelect(opt.value);
                onClose();
              }}
              className={`w-full flex items-center gap-3 px-3.5 py-3.5 rounded-2xl transition-base press ${
                selected ? "bg-primary/10 text-primary" : "hover:bg-accent/50 text-foreground"
              }`}
            >
              <span className="flex-1 min-w-0 text-left text-[15px] truncate">{opt.label}</span>
              {selected && <Check className="w-4 h-4 shrink-0" />}
            </button>
          );
        })}
      </div>
    </BottomSheet>
  );
}
