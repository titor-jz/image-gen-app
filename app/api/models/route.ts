import { NextRequest, NextResponse } from "next/server";
import { httpRequest } from "@/lib/http-client";
import { resolveUpstream } from "@/lib/upstream-config";
import { isChatModel } from "@/lib/prompt-optimizer";
import { parseModelEntries } from "@/lib/model-list";
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
  // ?type=chat：给「优化模型」下拉用——只返回对话模型，且失败时返回空列表
  // （绝不能像图像分支那样回退到兜底模型：那会让用户选到一个不存在的对话模型）
  const wantChat = request.nextUrl.searchParams.get("type") === "chat";

  const upstream = resolveUpstream(request);
  // 安全校验未过 / 服务端 Key 模式（env Key 不用于代拉模型列表，与原行为一致）/
  // 无 Key：图像分支返回兜底模型列表，对话分支返回空
  if (!upstream.ok || upstream.usingServerKey || !upstream.apiKey) {
    if (!upstream.ok) {
      console.warn("[models] 上游地址未通过安全校验:", upstream.reason);
    }
    return NextResponse.json({ models: wantChat ? [] : FALLBACK_MODELS });
  }
  const { apiKey, baseURL, proxyUrl } = upstream;

  try {
    const url = `${baseURL}/models`;
    const res = await httpRequest(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      proxyUrl: proxyUrl || undefined,
    });

    if (res.status < 200 || res.status >= 300) {
      return NextResponse.json({ models: wantChat ? [] : FALLBACK_MODELS });
    }

    let data;
    try {
      data = JSON.parse(res.body);
    } catch {
      return NextResponse.json({ models: wantChat ? [] : FALLBACK_MODELS });
    }
    // 兼容 OpenAI 的 {data:[...]}、裸数组、Google 风格的 {models:[{name}]}
    const entries = parseModelEntries(data) ?? [];

    // 对话模型分支：只按"不像图像/向量/语音"筛，返回原始 id 供下拉选择
    if (wantChat) {
      const chatIds = entries.map((e) => e.id).filter((id) => isChatModel(id));
      return NextResponse.json({ models: chatIds.map((id) => ({ id, name: id })) });
    }

    // 生图模型 = 「端点能力声明支持 image」∪「id 命中图像关键字」。
    // 两者必须取并集而不是二选一：
    //  - 不少中转把图像模型挂在 /v1/chat/completions 上（如 gpt-image-2.5-flare、
    //    gemini-image 系列），其 supported_endpoint_types 不含 image，
    //    若只用端点筛选会被漏掉；
    //  - 反过来，部分上游不返回 supported_endpoint_types，只能靠关键字兜底。
    const endpointImageIds = entries
      .filter((e) => e.endpointTypes.some((t) => t.includes("image")))
      .map((e) => e.id);
    const keywordImageIds = entries.filter((e) => isImageModel(e.id)).map((e) => e.id);
    // 端点能力优先，关键字补充（去重保持顺序）
    const imageIds = [...new Set([...endpointImageIds, ...keywordImageIds])];

    const toModelInfo = (id: string): ModelInfo => ({
      id,
      name: id,
      supportedSizes: ["auto", "1:1", "16:9", "9:16", "4:3", "3:4"],
    });

    // 关键字/端点能力都没匹配到时，不回退返回「全部模型」——
    // 用户选中纯对话模型后调用生图接口必然失败，只暴露兜底模型更安全
    const models = imageIds.map(toModelInfo);
    if (models.length === 0) {
      return NextResponse.json({ models: FALLBACK_MODELS });
    }

    return NextResponse.json({ models });
  } catch {
    return NextResponse.json({ models: wantChat ? [] : FALLBACK_MODELS });
  }
}
