/**
 * 结果图片动作（下载 / 保存到相册）——桌面 ResultGrid 与移动全屏预览共用
 *
 * 从 ResultGrid 抽出（纯搬移）。
 * - 浏览器/PWA：`<a download>` 触发下载到系统下载目录
 * - Capacitor APP：`a[download]` 无处理器，改用原生 Media 插件写入相册
 *   （albumIdentifier 为 Android 必填：先查/建「AI 生图」相册；createAlbum 无返回值，
 *   创建后需重新 getAlbums 取 identifier）
 */

import { toast } from "sonner";
import type { GenerateResult } from "@/lib/types";

/** 优先 blob URL（避免 base64 解码开销）；历史记录等无 imageUrl 的走 dataURL */
export function getResultImageSrc(result: GenerateResult): string {
  return result.imageUrl || `data:${result.mime};base64,${result.b64_json}`;
}

/** 下载单张（浏览器/PWA） */
export async function downloadResult(result: GenerateResult): Promise<void> {
  try {
    // 已有 blob URL 直接使用，零额外转换；否则从 dataURL 走一次 fetch 转 blob
    let downloadUrl: string | undefined = result.imageUrl;
    let needsRevoke = false;
    if (!downloadUrl) {
      const dataUrl = `data:${result.mime};base64,${result.b64_json}`;
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      downloadUrl = URL.createObjectURL(blob);
      needsRevoke = true;
    }
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = `generated-${Date.now()}.${result.mime.split("/")[1] || "png"}`;
    link.click();
    // 仅在本次新建的 URL 上 revoke，复用的 imageUrl 不能动
    if (needsRevoke && downloadUrl) {
      const urlToRevoke = downloadUrl;
      setTimeout(() => URL.revokeObjectURL(urlToRevoke), 1000);
    }
  } catch (e) {
    console.error("Download failed:", e);
  }
}

/** 保存单张到系统相册（仅 APP 环境；离线可用，数据来自本地 b64） */
export async function saveResultToGallery(result: GenerateResult): Promise<void> {
  try {
    const { Media } = await import("@capacitor-community/media");
    const ALBUM_NAME = "AI 生图";
    const findAlbum = async () =>
      (await Media.getAlbums()).albums.find((a) => a.name === ALBUM_NAME);
    let album = await findAlbum();
    if (!album) {
      await Media.createAlbum({ name: ALBUM_NAME });
      album = await findAlbum();
    }
    if (!album) {
      throw new Error("相册创建失败");
    }
    await Media.savePhoto({
      path: `data:${result.mime};base64,${result.b64_json}`,
      albumIdentifier: album.identifier,
    });
    toast.success("已保存到相册");
  } catch (e) {
    // 插件原文是英文（如 "Album identifier required"），不直接抛给用户
    console.error("[gallery] 保存失败:", e);
    toast.error("保存到相册失败", {
      description: "请检查相册权限后重试",
    });
  }
}

/** 全部下载（浏览器/PWA，间隔触发避免浏览器拦截连续下载） */
export function downloadAllResults(results: GenerateResult[]): void {
  results.forEach((result, i) => {
    setTimeout(() => void downloadResult(result), i * 500);
  });
}

/** 全部保存到相册（APP 环境；顺序执行避免并发写 MediaStore） */
export async function saveAllResultsToGallery(results: GenerateResult[]): Promise<void> {
  for (const result of results) {
    await saveResultToGallery(result);
  }
}
