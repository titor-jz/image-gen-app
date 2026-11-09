/**
 * 探测某节点/Key 最高能出到哪一档清晰度
 *
 * 为什么要真跑：4K 能不能出只有让上游真出一张才知道，没有免费接口。
 * 所以从高到低试，**遇到能用的就停**（最坏 3 次生成，通常 1~2 次）。
 *
 * 判定依据与正式生成一致：解码量真实像素，明显小于该档应有尺寸算「不可用」。
 * 结果写入 node-size-capability，质量下拉的 ✓/△/✗ 标记随之更新。
 */

import { buildApiHeaders } from "@/lib/api-headers";
import { pixelSizeFor } from "@/lib/size-map";
import { imageDimsFromB64 } from "@/lib/image-dims";
import { recordSizeOutcome, type SizeTier } from "@/lib/node-size-capability";

const TIERS: SizeTier[] = ["4k", "2k", "1k"];
const PROBE_PROMPT = "白色背景正中央一个红色圆点";

export interface ProbeStepResult {
  tier: SizeTier;
  ok: boolean;
  width?: number;
  height?: number;
  error?: string;
}

/**
 * 从最高档往下试，返回第一个可用档位（全失败返回 null）。
 * onStep：每试完一档回调一次，供界面显示进度。
 */
export async function probeMaxTier(opts: {
  nodeId: string;
  apiKey: string;
  baseUrl: string;
  proxyUrl?: string;
  model: string;
  onStep?: (r: ProbeStepResult) => void;
}): Promise<ProbeStepResult | null> {
  const { nodeId, apiKey, baseUrl, proxyUrl, model, onStep } = opts;

  for (const tier of TIERS) {
    const fd = new FormData();
    fd.append("prompt", PROBE_PROMPT);
    fd.append("model", model);
    fd.append("size", "1:1");
    fd.append("quality", tier);
    fd.append("format", "static");
    // 直接走同步流式分支，省掉 async 探测往返
    fd.append("asyncMode", "skip");

    let step: ProbeStepResult;
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: buildApiHeaders({ apiKey, baseUrl, proxyUrl: proxyUrl ?? "" }),
        body: fd,
      });
      if (!res.ok) {
        step = { tier, ok: false, error: `HTTP ${res.status}` };
      } else {
        // 同步分支是 ndjson：心跳行忽略，取 result/error 行
        const text = await res.text();
        type NdjsonMsg = {
          type: string;
          images?: Array<{ b64_json: string; mime: string }>;
          error?: string;
        };
        let payload: NdjsonMsg | null = null;
        for (const line of text.split("\n")) {
          const s = line.trim();
          if (!s) continue;
          try {
            const msg = JSON.parse(s) as NdjsonMsg;
            if (msg.type === "result" || msg.type === "error") payload = msg;
          } catch {
            // 非 JSON 行忽略
          }
        }
        const img = payload?.images?.[0];
        const want = pixelSizeFor("1:1", tier);
        if (!img) {
          step = { tier, ok: false, error: payload?.error ?? "无返回图片" };
        } else {
          const dims = await imageDimsFromB64(img.b64_json, img.mime);
          const ok =
            !!dims && !!want && dims.width >= want.width * 0.9 && dims.height >= want.height * 0.9;
          step = { tier, ok, width: dims?.width, height: dims?.height };
        }
      }
    } catch (err) {
      step = { tier, ok: false, error: err instanceof Error ? err.message : "网络请求失败" };
    }

    recordSizeOutcome(nodeId, tier, step.ok ? "supported" : "unsupported", step.width && step.height ? { width: step.width, height: step.height } : undefined);
    onStep?.(step);
    if (step.ok) return step;
  }
  return null;
}
