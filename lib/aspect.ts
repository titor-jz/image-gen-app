import type { AspectRatio } from "./types";

/**
 * 画幅字符串 → 宽高比数值
 *
 * "16:9" → 1.777…；"auto" 或非法值 → undefined（交给图片自然尺寸决定）。
 * 结果卡按这个比例排，图按同一比例 contain —— 两边一致就不会裁切。
 */
export function aspectOf(size?: AspectRatio | string): number | undefined {
  if (!size || size === "auto") return undefined;
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(size);
  if (!m) return undefined;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!w || !h) return undefined;
  return w / h;
}
