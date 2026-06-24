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

export async function GET(request: NextRequest) {
  const apiKey = request.headers.get("x-api-key");
  const baseURL = request.headers.get("x-base-url");
  const proxyUrl = request.headers.get("x-proxy-url") || "";

  if (!apiKey) {
    return NextResponse.json({
      models: [{
        id: "gpt-image-2",
        name: "GPT-Image2",
        costPerImage: 0,
        supportedSizes: ["auto", "1:1", "16:9", "9:16", "4:3", "3:4"],
      }],
    });
  }

  try {
    const url = `${baseURL || "https://api.openai.com/v1"}/models`;
    const res = await httpRequest(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      proxyUrl: proxyUrl || undefined,
    });

    if (res.status < 200 || res.status >= 300) {
      return NextResponse.json({
        models: [{
          id: "gpt-image-2",
          name: "GPT-Image2",
          costPerImage: 0,
          supportedSizes: ["auto", "1:1", "16:9", "9:16", "4:3", "3:4"],
        }],
      });
    }

    let data;
    try {
      data = JSON.parse(res.body);
    } catch {
      return NextResponse.json({
        models: [{
          id: "gpt-image-2",
          name: "GPT-Image2",
          costPerImage: 0,
          supportedSizes: ["auto", "1:1", "16:9", "9:16", "4:3", "3:4"],
        }],
      });
    }
    const allModels = data?.data || [];
    const imageModels = allModels.filter((m: { id: string }) => isImageModel(m.id));

    const toModelInfo = (m: { id: string }): ModelInfo => ({
      id: m.id,
      name: m.id,
      costPerImage: 0,
      supportedSizes: ["auto", "1:1", "16:9", "9:16", "4:3", "3:4"],
    });

    const models = imageModels.length > 0
      ? imageModels.map(toModelInfo)
      : allModels.map(toModelInfo);

    return NextResponse.json({ models });
  } catch {
    return NextResponse.json({
      models: [{
        id: "gpt-image-2",
        name: "GPT-Image2",
        costPerImage: 0,
        supportedSizes: ["auto", "1:1", "16:9", "9:16", "4:3", "3:4"],
      }],
    });
  }
}
