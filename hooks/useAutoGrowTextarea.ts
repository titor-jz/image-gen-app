"use client";

/**
 * useAutoGrowTextarea - 让 textarea 高度随内容增长（到 maxHeight 后转为内部滚动）
 *
 * 为什么需要：输入框原本是固定 4 行高（rows=4 + min-h），而「优化提示词」会把文本变长
 * 2~4 倍，移动端窄栏下必被裁掉——用户点了优化却看不到后半句。短文本仍保持原有最小高度，
 * 只有超出时才长高，所以对既有输入行为零影响。
 */

import { useEffect, type RefObject } from "react";

export function useAutoGrowTextarea(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  maxHeight: number
) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 先归零再量，否则 scrollHeight 会被上一次设定的高度顶住，越缩越小只能涨
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [ref, value, maxHeight]);
}
