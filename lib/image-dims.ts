/**
 * 读取图片的真实像素尺寸（base64 → 宽高）
 *
 * 为什么需要：上游/中转可能悄悄不按请求尺寸出图（key 或节点不支持高分辨率档时
 * 常见），而结果里只记了「请求的画幅比例」。不测实际像素的话，界面会拿 1K 冒充 4K。
 */
export async function imageDimsFromB64(
  b64: string,
  mime: string
): Promise<{ width: number; height: number } | null> {
  if (typeof document === "undefined") return null;
  // SVG 是文本，naturalWidth 拿不到有效像素
  if (mime === "image/svg+xml") return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      resolve(
        img.naturalWidth > 0 && img.naturalHeight > 0
          ? { width: img.naturalWidth, height: img.naturalHeight }
          : null
      );
    };
    img.onerror = () => resolve(null);
    img.src = `data:${mime || "image/png"};base64,${b64}`;
  });
}
