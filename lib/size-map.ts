/**
 * 尺寸 / 质量档位映射（服务端路由与前端状态行共用，避免两边各说各话）
 *
 * 三档按「画质档」组织，每档给每个画幅一个明确像素尺寸：
 *   1K → 长边 1024~2048（历史沿用的档位，1:1 是 1024，非方形是 2048）
 *   2K → 长边约 2560
 *   4K → 长边 3840（方形受上游上限限制为 3072）
 *
 * 为什么要单独抽出来：此前 2K 档**和 1K 用的是同一张尺寸表**，用户选 2K 拿到的
 * 还是 1K 分辨率（只有 quality 从 low 变 medium），档位名与产出对不上。
 * 抽成共享模块后，界面能直接把「这一档实际会出多少像素」显示出来。
 */

/** 上游 quality 参数 */
export const QUALITY_MAP: Record<string, string> = {
  "1k": "low",
  "2k": "medium",
  "4k": "high",
};

/** 1K 档：1:1 是 1024，其余画幅沿用上游实测可用的 2048 级尺寸 */
export const SIZE_1K_MAP: Record<string, string> = {
  "1:1": "1024x1024",
  "16:9": "2048x1152",
  "9:16": "1152x2048",
  "4:3": "2048x1536",
  "3:4": "1536x2048",
  "3:2": "1536x1024",
  "2:3": "1024x1536",
  // 这两个原先是 3696x1584 / 3840x1280（已经超过 2K 档），归一成 2048 长边，
  // 否则 1K/2K/4K 三档在超宽画幅上不单调
  "21:9": "2048x878",
  "3:1": "2048x683",
  auto: "auto",
};

/** 2K 档：长边约 2560（实测中转接受 2560x1440、2048x2048 等任意尺寸） */
export const SIZE_2K_MAP: Record<string, string> = {
  "1:1": "2048x2048",
  "16:9": "2560x1440",
  "9:16": "1440x2560",
  "4:3": "2560x1920",
  "3:4": "1920x2560",
  "3:2": "2544x1696",
  "2:3": "1696x2544",
  "21:9": "2520x1080",
  "3:1": "2520x840",
  auto: "auto",
};

/** 4K 档：长边 3840；方形上游上限 3072 */
export const SIZE_4K_MAP: Record<string, string> = {
  "1:1": "3072x3072",
  "16:9": "3840x2160",
  "9:16": "2160x3840",
  "4:3": "3840x2880",
  "3:4": "2880x3840",
  "3:2": "3840x2560",
  "2:3": "2560x3840",
  "21:9": "3840x1646",
  "3:1": "3840x1280",
  auto: "auto",
};

/**
 * 解析最终送给上游的 size。
 *
 * GIF 模式一律 1024x1024：上游动图管线对尺寸挑剔，实测 "auto" 会静默回退静图
 * （见 AGENTS.md 的 GIF 矩阵），且动图输出画幅本就由模型自定。
 */
export function upstreamSizeFor(
  size: string,
  quality: string,
  outputFormat?: string
): string {
  if (outputFormat === "gif") return "1024x1024";
  const map =
    quality === "4k" ? SIZE_4K_MAP : quality === "2k" ? SIZE_2K_MAP : SIZE_1K_MAP;
  return map[size] || "auto";
}

/** 前端展示用：把档位解析出的像素尺寸摊平（auto / 未知返回 null） */
export function pixelSizeFor(
  size: string,
  quality: string
): { width: number; height: number } | null {
  const raw = upstreamSizeFor(size, quality, "static");
  const m = /^(\d+)x(\d+)$/.exec(raw);
  if (!m) return null;
  return { width: Number(m[1]), height: Number(m[2]) };
}
