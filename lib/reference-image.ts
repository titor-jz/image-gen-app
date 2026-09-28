/**
 * 参考图校验与压缩（桌面输入卡与移动 Composer 共用）
 *
 * 从 UnifiedInputCard 抽出（纯搬移）。三档清晰度：
 * - auto：>512KB 压到 ≤1024px JPEG（可用 NEXT_PUBLIC_* 构建期变量覆盖）
 * - hd：>2MB 压到 ≤2048px JPEG q0.9
 * - original：不压缩，单文件上限 ORIGINAL_MAX_MB（对齐服务端体积上限）
 */

export type RefQuality = "auto" | "hd" | "original";

export const ACCEPTED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

// 「原图直传」单文件上限：默认对齐服务端 4MB 上限（Vercel 预设）。
// 本地/自托管放宽 GEN_MAX_BODY_MB 时，用构建期变量同步（NEXT_PUBLIC_ORIGINAL_MAX_MB）。
export const ORIGINAL_MAX_MB = Number(process.env.NEXT_PUBLIC_ORIGINAL_MAX_MB) || 4;

const COMPRESS_PRESETS: Record<
  Exclude<RefQuality, "original">,
  { threshold: number; edge: number; quality: number }
> = {
  auto: {
    threshold:
      (Number(process.env.NEXT_PUBLIC_REF_COMPRESS_THRESHOLD_KB) || 512) * 1024,
    edge: Number(process.env.NEXT_PUBLIC_REF_COMPRESS_MAX_EDGE) || 1024,
    quality: 0.85,
  },
  hd: { threshold: 2 * 1024 * 1024, edge: 2048, quality: 0.9 },
};

export type RefImageResult = { blob: Blob; mime: string } | { error: string };

/** 校验类型/大小并按档位压缩；失败返回 { error }（文案可直接展示） */
export async function validateAndCompress(
  file: File,
  mode: RefQuality
): Promise<RefImageResult> {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return { error: "仅支持 JPG, PNG, WEBP" };
  }
  // 大图不再直接拒收：自动/高清档一律压缩；仅原图直传档按服务端上限提示切档
  if (mode === "original" && file.size > ORIGINAL_MAX_MB * 1024 * 1024) {
    return { error: `原图超过 ${ORIGINAL_MAX_MB}MB，请改用「高清压缩」或「自动压缩」` };
  }
  if (mode === "original" || !file.type.startsWith("image/")) {
    return { blob: file, mime: file.type };
  }
  const preset = COMPRESS_PRESETS[mode];
  if (file.size < preset.threshold) {
    return { blob: file, mime: file.type };
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, preset.edge / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve({ blob: file, mime: file.type }); return; }
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          if (!blob || blob.size >= file.size) { resolve({ blob: file, mime: file.type }); return; }
          resolve({ blob, mime: "image/jpeg" });
        },
        "image/jpeg",
        preset.quality
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve({ blob: file, mime: file.type }); };
    img.src = url;
  });
}
