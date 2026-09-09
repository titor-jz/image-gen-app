import { NextRequest, NextResponse } from "next/server";
import { httpRequest } from "@/lib/http-client";
import type { ModelInfo } from "@/lib/types";

const IMAGE_MODEL_KEYWORDS = [
  "image", "dall", "gpt-image", "midjourney",
  "stable-diffusion", "sd-", "flux", "nano-banana", "banana",
];

function isImageModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return IMAGE_MODEL_KEYWORDS.some((kw) => lower.includes(kw));
}

/** 兜底模型（接口失败/未配置 Key 时返回） */
const FALLBACK_MODELS: ModelInfo[] = [
  {
    id: "gpt-image-2",
    name: "GPT-Image2",
    supportedSizes: ["auto", "1:1", "16:9", "9:16", "4:3", "3:4"],
  },
];

export async function GET(request: NextRequest) {
  const apiKey = request.headers.get("x-api-key");
  // 与 generate/task 路由保持一致的 baseURL 回退链：header → 环境变量 → 官方
  const baseURL =
    request.headers.get("x-base-url") || process.env.OPENAI_BASE_URL;
  const proxyUrl = request.headers.get("x-proxy-url") || "";

  if (!apiKey) {
    return NextResponse.json({ models: FALLBACK_MODELS });
  }

  try {
    const url = `${baseURL || "https://api.openai.com/v1"}/models`;
    const res = await httpRequest(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      proxyUrl: proxyUrl || undefined,
    });

    if (res.status < 200 || res.status >= 300) {
      return NextResponse.json({ models: FALLBACK_MODELS });
    }

    let data;
    try {
      data = JSON.parse(res.body);
    } catch {
      return NextResponse.json({ models: FALLBACK_MODELS });
    }
    const allModels = data?.data || [];

    // 生图模型 = 「端点能力声明支持 image」∪「id 命中图像关键字」。
    // 两者必须取并集而不是二选一：
    //  - 不少中转把图像模型挂在 /v1/chat/completions 上（如 gpt-image-2.5-flare、
    //    gemini-image 系列），其 supported_endpoint_types 不含 image，
    //    若只用端点筛选会被漏掉；
    //  - 反过来，部分上游不返回 supported_endpoint_types，只能靠关键字兜底。
    const endpointImageModels = allModels.filter(
      (m: { supported_endpoint_types?: string[] }) =>
        Array.isArray(m.supported_endpoint_types) &&
        m.supported_endpoint_types.some((t: string) => t.includes("image"))
    );
    const keywordImageModels = allModels.filter((m: { id: string }) =>
      isImageModel(m.id)
    );
    const dedup = new Map<string, { id: string }>();
    for (const m of [...endpointImageModels, ...keywordImageModels]) {
      dedup.set(m.id, m);
    }
    const imageModels = [...dedup.values()];

    const toModelInfo = (m: { id: string }): ModelInfo => ({
      id: m.id,
      name: m.id,
      supportedSizes: ["auto", "1:1", "16:9", "9:16", "4:3", "3:4"],
    });

    // 关键字/端点能力都没匹配到时，不回退返回「全部模型」——
    // 用户选中纯对话模型后调用生图接口必然失败，只暴露兜底模型更安全
    const models = imageModels.map(toModelInfo);
    if (models.length === 0) {
      return NextResponse.json({ models: FALLBACK_MODELS });
    }

    return NextResponse.json({ models });
  } catch {
    return NextResponse.json({ models: FALLBACK_MODELS });
  }
}
