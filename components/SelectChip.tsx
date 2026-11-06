"use client";

/**
 * SelectChip - 圆角参数选择 chip（工具栏/参数面板共用）
 *
 * 从 UnifiedInputCard 抽出（纯搬移，桌面行为不变）。
 * 点击展开弹出选项列表；Esc / 点击外部关闭。
 *
 * 弹层用 portal + fixed 定位：原先是 `absolute bottom-full`（永远向上开），
 * 参数区被重排到卡片中上部后，向上的空间不够，弹层会被 .input-card 的
 * overflow-hidden 裁掉、甚至跑到视口外。现在按可用空间自动决定向上还是向下，
 * 并挂到 body 上，任何祖先的裁剪都影响不到它。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check } from "lucide-react";

/** 单个选项的估算高度（py-1.5 + text-sm），用于判断向上还是向下开 */
const ITEM_H = 32;
/** 弹层最大高度，与原 max-h-60 一致 */
const MAX_H = 240;
/** 与触发按钮之间的间隙 */
const GAP = 6;

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
  const [pos, setPos] = useState<{
    left: number;
    top: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  /** 量触发按钮位置，决定弹层贴在哪、朝哪开 */
  const place = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const wanted = Math.min(options.length * ITEM_H + 10, MAX_H);
    const spaceBelow = window.innerHeight - r.bottom - GAP;
    const spaceAbove = r.top - GAP;
    // 下方放得下就往下（更符合阅读顺序），否则上方空间更大就往上
    const openDown = spaceBelow >= wanted || spaceBelow >= spaceAbove;
    const maxHeight = Math.max(96, Math.min(wanted, openDown ? spaceBelow : spaceAbove));
    setPos({
      left: Math.min(r.left, window.innerWidth - Math.max(r.width, 168) - 8),
      top: openDown ? r.bottom + GAP : r.top - GAP - Math.min(wanted, maxHeight),
      width: Math.max(r.width, 168),
      maxHeight,
    });
  }, [options.length]);

  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(place);
    const onScroll = () => place();
    window.addEventListener("resize", onScroll);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, place]);

  // 关闭时一并清掉定位：下一次打开会在 rAF 里重新量，不会闪到旧位置
  const close = useCallback(() => {
    setOpen(false);
    setPos(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return;
      close();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, close]);

  return (
    <div className={`relative ${className}`}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        className={`toolbar-chip ${open ? "border-border bg-accent/60" : ""}`}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className={displayLabel ? "text-muted-foreground" : ""}>{displayLabel ?? current?.label}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-base ${open ? "rotate-180" : ""}`} />
      </button>
      {open && pos && createPortal(
        <div
          ref={popRef}
          className="fixed z-[60] overflow-y-auto overscroll-contain rounded-[3px] border border-border bg-popover py-1 shadow-xl scrollbar-thin animate-fade-up"
          style={{ left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxHeight }}
          role="listbox"
        >
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); close(); }}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-base hover:bg-accent/60 ${opt.value === value ? "text-primary" : "text-foreground"}`}
              role="option"
              aria-selected={opt.value === value}
            >
              <span className="flex-1 text-left whitespace-nowrap truncate">{opt.label}</span>
              {opt.value === value && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}