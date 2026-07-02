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
}

export async function buildCacheKey(input: CacheKeyInput): Promise<string> {
  const imageFingerprint = input.referenceImages
    .map((img) => `${img.base64.length}:${img.base64.slice(0, 64)}`)
    .join("|");
  const composite = [
    input.prompt.trim(),
    input.model,
    input.size,
    input.quality,
    imageFingerprint,
  ].join("\u0001");
  return hashString(composite);
}
