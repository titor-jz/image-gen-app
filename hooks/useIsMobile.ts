"use client";

/**
 * useIsMobile - 判断是否移动端布局（<640px，sm 断点以下）
 *
 * 用 useSyncExternalStore 订阅 matchMedia：SSR 返回 false（渲染桌面结构），
 * 客户端 hydration 后按实际宽度切换（与 Header 的 mounted 门控同款思路）。
 */
import { useSyncExternalStore } from "react";

const QUERY = "(max-width: 639px)";

function subscribe(callback: () => void): () => void {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false
  );
}
