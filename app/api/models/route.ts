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

    // 优先按上游声明的端点能力筛选：supported_endpoint_types 含 image* 的
    // 模型才真正支持生图接口，与服务商模型页的「图像」分类一致；
    // 若把仅支持对话接口的模型（如 nano-banana 系列误匹配 keyword）放进去，
    // 用户选中后调用 /images/generations/async 必然失败。
    // 上游不返回该字段时（如 OpenAI 官方 /v1/models），回退到 id 关键字匹配。
    const endpointImageModels = allModels.filter(
      (m: { supported_endpoint_types?: string[] }) =>
        Array.isArray(m.supported_endpoint_types) &&
        m.supported_endpoint_types.some((t: string) => t.includes("image"))
    );
    const imageModels = endpointImageModels.length > 0
      ? endpointImageModels
      : allModels.filter((m: { id: string }) => isImageModel(m.id));

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
