import type { ReferenceImage } from "@/components/UnifiedInputCard";

export async function hashString(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const buffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface CacheKeyInput {
  prompt: string;
  model: string;
  size: string;
  quality: string;
  referenceImages: ReferenceImage[];
  /** 节点标识（baseURL）：同提示词同模型在不同节点间不共享缓存 */
  nodeKey?: string;
}

export async function buildCacheKey(input: CacheKeyInput): Promise<string> {
  // 对参考图完整 base64 求 SHA-256。
  // 旧实现用「长度 + 前 64 字符」做指纹，但 data URL 前 64 字符几乎全是
  // MIME 头 + 标准文件头（JFIF/IHDR），同类型同尺寸的不同图片必然碰撞，
  // 导致 60s 缓存窗口内换图重新生成会静默返回旧参考图的结果。
  const imageHashes = await Promise.all(
    input.referenceImages.map((img) => hashString(img.base64))
  );
  const composite = [
    input.prompt.trim(),
    input.model,
    input.size,
    input.quality,
    input.nodeKey ?? "",
    imageHashes.join("|"),
  ].join("\u0001");
  return hashString(composite);
}
