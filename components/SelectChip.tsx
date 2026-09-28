"use client";

/**
 * SelectChip - 圆角参数选择 chip（工具栏/参数面板共用）
 *
 * 从 UnifiedInputCard 抽出（纯搬移，桌面行为不变）。
 * 点击展开向上弹出选项列表；Esc / 点击外部关闭。
 */

import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";

export function SelectChip<T extends string>({
  value,
  onChange,
  options,
  className = "",
  displayLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  className?: string;
  /** 覆盖触发按钮文案（如列表加载中时显示「模型加载中…」） */
  displayLabel?: string;
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
        <span className={displayLabel ? "text-muted-foreground" : ""}>{displayLabel ?? current?.label}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-base ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute bottom-full mb-2 left-0 min-w-full max-w-[calc(100vw-3rem)] bg-popover border border-border rounded-xl shadow-xl py-1 z-50 animate-fade-up max-h-60 overflow-y-auto scrollbar-thin">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-base hover:bg-accent/60 ${opt.value === value ? "text-primary" : "text-foreground"}`}
              role="option"
              aria-selected={opt.value === value}
            >
              <span className="flex-1 text-left whitespace-nowrap truncate">{opt.label}</span>
              {opt.value === value && <Check className="w-3.5 h-3.5 text-primary" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
