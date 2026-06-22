import { NextRequest, NextResponse } from "next/server";
import { httpRequest, httpFormDataRequest } from "@/lib/http-client";

// gpt-image-2 支持的尺寸
const SIZE_MAP: Record<string, string> = {
  "1:1": "1024x1024",
  "16:9": "2048x1152",
  "9:16": "2160x3840",
  "4:3": "2048x1536",
  "3:4": "1536x2048",
  "3:2": "1536x1024",
  "2:3": "1024x1536",
  "21:9": "3696x1584",
  "3:1": "3840x1280",
  auto: "auto",
};

// 清晰度 → quality 参数
const QUALITY_MAP: Record<string, string> = {
  "1k": "low",
  "2k": "medium",
  "4k": "high",
};

function base64ToFile(base64DataUrl: string, index: number): File | null {
  const match = base64DataUrl.match(/^data:(.+?);base64,(.+)$/);
  if (!match) return null;
  const [, mimeType, base64Data] = match;
  const buf = Buffer.from(base64Data, "base64");
  const ext = mimeType.split("/")[1] || "png";
  return new File([buf], `input_${index}.${ext}`, { type: mimeType });
}

export async function POST(request: NextRequest) {
  try {
    const apiKey =
      request.headers.get("x-api-key") || process.env.OPENAI_API_KEY;
    const baseURL =
      request.headers.get("x-base-url") ||
      process.env.OPENAI_BASE_URL ||
      "https://api.openai.com/v1";
    const proxyUrl = request.headers.get("x-proxy-url") || "";

    if (!apiKey) {
      return NextResponse.json(
        { error: "API Key is required. Set it in settings or OPENAI_API_KEY env." },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { prompt, model, size, quality, images, n } = body;

    if (!prompt) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    const url = `${baseURL}/images/generations`;

    const form = new FormData();
    form.append("model", model || "gpt-image-2");
    form.append("prompt", prompt);
    form.append("size", SIZE_MAP[size || "auto"] || "auto");
    form.append("quality", QUALITY_MAP[quality || "1k"] || "low");
    form.append("response_format", "b64_json"); // 改为 base64 格式

    // 添加多图参考
    if (images && Array.isArray(images) && images.length > 0) {
      for (let i = 0; i < images.length; i++) {
        const file = base64ToFile(images[i], i);
        if (file) {
          form.append("image", file);
        }
      }
    }

    const res = await httpFormDataRequest(url, form, {
      Authorization: `Bearer ${apiKey}`,
    }, proxyUrl || undefined);

    if (res.status < 200 || res.status >= 300) {
      let errMsg = "Unknown error";
      try {
        const errData = JSON.parse(res.body);
        errMsg = errData.error?.message || errData.message || errMsg;
      } catch { /* ignore */ }
      return NextResponse.json({ error: `生成失败 (${res.status}): ${errMsg}` }, { status: 500 });
    }

    const data = JSON.parse(res.body);
    const resultImages: { b64_json: string; mime: string }[] = [];

    // 从 data.data 数组中提取图片 base64 数据
    if (data?.data && Array.isArray(data.data)) {
      for (let i = 0; i < data.data.length; i++) {
        const item = data.data[i];
        if (item.b64_json) {
          resultImages.push({
            b64_json: item.b64_json,
            mime: item.mime_type || "image/png",
          });
        } else if (item.url) {
          // 如果返回的是 URL，下载并转换为 base64
          const imgRes = await httpRequest(item.url, { proxyUrl: proxyUrl || undefined });
          if (imgRes.status >= 200 && imgRes.status < 300) {
            const buf = imgRes.bodyBuffer || Buffer.from(imgRes.body, "binary");
            const b64 = buf.toString("base64");
            resultImages.push({
              b64_json: b64,
              mime: "image/png",
            });
          }
        }
      }
    }

    if (resultImages.length === 0) {
      return NextResponse.json({ error: "生成成功但未返回图片" }, { status: 500 });
    }

    return NextResponse.json({
      images: resultImages,
      revised_prompt: data?.data?.[0]?.revised_prompt,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
