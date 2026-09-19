/**
 * Capacitor 原生环境检测（SSR 安全）
 *
 * 仅在 APK 壳（Capacitor WebView）内运行时为 true；浏览器 / PWA 恒为 false。
 * 注意：检测读取 window.Capacitor，SSR 首帧不存在——渲染期直接调用会导致
 * hydration 不一致。渲染分支请用 useEffect + state 门控（见 ResultGrid 的
 * canSaveToGallery），事件监听/副作用场景可直接在 effect 内调用。
 */
export interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

export function isCapacitor(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as Window & { Capacitor?: CapacitorGlobal }).Capacitor;
  return !!cap?.isNativePlatform?.();
}
