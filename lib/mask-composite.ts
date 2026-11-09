/**
 * 局部重绘的客户端合成兜底
 *
 * 背景（实测，见 docs/inpaint/PLAN.md）：上游 /images/edits **接受 mask 参数但不按
 * mask 约束生成** —— 变化区域只跟提示词走，mask 被完全忽略。所以「只有涂过的地方变」
 * 这件事必须在本地保证：出图后把 mask 之外的像素用底图逐像素盖回来。
 *
 * mask 语义沿用 OpenAI：alpha=0（透明）的区域 = 使用上游像素（可重绘），
 * alpha=255 = 使用底图像素（保护）。导出时 mask 就是按这个语义生成的（MaskEditor）。
 *
 *   结果 = 底图 × (1 − maskA) + 上游 × maskA        （maskA = 1 − mask.alpha）
 *
 * 只用浏览器原生 canvas，不引依赖；SSR / Node 下不可调用。
 */

export interface CompositeMaskOptions {
  /** 上游返回的图（base64，不含 data: 前缀） */
  outputB64: string;
  /** 底图（与 mask 同尺寸的那张） */
  baseBlob: Blob;
  /** 蒙版 PNG：alpha=0 表示该区域可重绘 */
  maskBlob: Blob;
  /** 交界羽化半径（底图像素），默认 3px。0 = 硬边 */
  featherPx?: number;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error("读取图片失败"));
    fr.readAsDataURL(blob);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片解码失败"));
    img.src = src;
  });
}

/**
 * 把上游结果与底图按蒙版合成，返回新的图片 base64（PNG）。
 *
 * 尺寸策略：**以底图为准** —— 蒙版与底图是同尺寸生成的，只有按底图尺寸合成，
 * 蒙版才能逐像素对齐。上游若返回了不同尺寸，就缩放到底图尺寸（宁可轻微形变，
 * 也不让保护区和重绘区错位）。
 */
export async function compositeWithMask(opts: CompositeMaskOptions): Promise<string> {
  if (typeof document === "undefined") {
    throw new Error("合成需要在浏览器环境执行");
  }
  const { outputB64, baseBlob, maskBlob } = opts;
  const feather = Math.max(0, Math.round(opts.featherPx ?? 3));

  const [outputImg, baseImg, maskImg] = await Promise.all([
    loadImage(`data:image/png;base64,${outputB64}`),
    blobToDataUrl(baseBlob).then(loadImage),
    blobToDataUrl(maskBlob).then(loadImage),
  ]);

  const W = baseImg.naturalWidth;
  const H = baseImg.naturalHeight;
  if (!W || !H) throw new Error("底图尺寸无效");

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建画布");

  // 1) 先整幅铺上游结果
  ctx.drawImage(outputImg, 0, 0, W, H);

  // 2) 单独做一层「保护区」：底图 ∩ mask(不透明处)
  const keep = document.createElement("canvas");
  keep.width = W;
  keep.height = H;
  const kctx = keep.getContext("2d");
  if (!kctx) throw new Error("无法创建画布");
  kctx.drawImage(baseImg, 0, 0, W, H);
  // destination-in：只在 mask 不透明的地方保留底图像素 → 得到「只含保护区」的一层
  kctx.globalCompositeOperation = "destination-in";
  if (feather > 0 && "filter" in kctx) {
    // 羽化直接作用在 mask 的 alpha 上，交界处得到渐变过渡，避免硬接缝
    kctx.filter = `blur(${feather}px)`;
  }
  kctx.drawImage(maskImg, 0, 0, W, H);

  // 3) 把保护区盖回上游结果之上
  ctx.drawImage(keep, 0, 0);

  const dataUrl = canvas.toDataURL("image/png");
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}
