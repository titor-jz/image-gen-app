import { NextRequest, NextResponse } from "next/server";
import { httpRequest, httpFormDataRequest } from "@/lib/http-client";

// gpt-image-2 支持的尺寸
const SIZE_MAP: Record<string, string> = {
  "1:1": "1024x1024",
  "16:9": "2048x1152",
  "9:16": "1152x2048",
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

// Vercel Serverless 响应限制约 4.5MB，base64 膨胀 33%
// 安全阈值：响应体不超过 4MB
const MAX_RESPONSE_SIZE = 4 * 1024 * 1024;

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
        { error: "请先在设置中配置 API Key" },
        { status: 401 }
      );
    }

    // 检查请求体大小
    const contentLength = request.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > 20 * 1024 * 1024) {
      return NextResponse.json(
        { error: "请求体过大（>20MB），请减小参考图尺寸或使用更低清晰度" },
        { status: 413 }
      );
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json(
        { error: "请求格式错误，请刷新页面重试" },
        { status: 400 }
      );
    }

    const prompt = formData.get("prompt") as string;
    const model = (formData.get("model") as string) || "gpt-image-2";
    const size = (formData.get("size") as string) || "auto";
    const quality = (formData.get("quality") as string) || "1k";
    const imageFiles = formData.getAll("images") as (File | Blob)[];

    if (!prompt) {
      return NextResponse.json({ error: "请输入提示词" }, { status: 400 });
    }

    const url = `${baseURL}/images/generations`;

    const form = new FormData();
    form.append("model", model);
    form.append("prompt", prompt);
    form.append("size", SIZE_MAP[size] || "auto");
    form.append("quality", QUALITY_MAP[quality] || "low");
    form.append("response_format", "b64_json");

    // 添加多图参考
    for (let i = 0; i < imageFiles.length; i++) {
      const file = imageFiles[i];
      if (file instanceof Blob) {
        const name = (file as File).name || `input_${i}.png`;
        form.append("image", file, name);
      }
    }

    let res;
    try {
      res = await httpFormDataRequest(url, form, {
        Authorization: `Bearer ${apiKey}`,
      }, proxyUrl || undefined);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "网络请求失败";
      return NextResponse.json(
        { error: `请求上游 API 失败: ${msg}。请检查 API Key 和网络连接。` },
        { status: 502 }
      );
    }

    if (res.status < 200 || res.status >= 300) {
      let errMsg = "未知错误";
      try {
        const errData = JSON.parse(res.body);
        errMsg = errData.error?.message || errData.message || errMsg;
      } catch {
        // 响应不是 JSON，可能是 HTML 错误页
        errMsg = `上游服务返回错误 (${res.status})`;
      }
      return NextResponse.json(
        { error: `生成失败 (${res.status}): ${errMsg}` },
        { status: 500 }
      );
    }

    // 检查响应体大小
    if (res.body.length > MAX_RESPONSE_SIZE) {
      return NextResponse.json(
        {
          error: `生成图片过大（${Math.round(res.body.length / 1024 / 1024 * 100) / 100}MB），超出平台限制。请尝试降低清晰度（4k→2k→1k）或选择更小的比例。`,
        },
        { status: 413 }
      );
    }

    let data;
    try {
      data = JSON.parse(res.body);
    } catch {
      return NextResponse.json(
        { error: "上游服务返回了无效响应，请稍后重试" },
        { status: 502 }
      );
    }

    const resultImages: { b64_json: string; mime: string }[] = [];

    if (data?.data && Array.isArray(data.data)) {
      for (let i = 0; i < data.data.length; i++) {
        const item = data.data[i];
        if (item.b64_json) {
          resultImages.push({
            b64_json: item.b64_json,
            mime: item.mime_type || "image/png",
          });
        } else if (item.url) {
          try {
            const imgRes = await httpRequest(item.url, {
              proxyUrl: proxyUrl || undefined,
            });
            if (imgRes.status >= 200 && imgRes.status < 300) {
              const buf = imgRes.bodyBuffer || Buffer.from(imgRes.body, "binary");
              resultImages.push({
                b64_json: buf.toString("base64"),
                mime: "image/png",
              });
            }
          } catch {
            // 跳过下载失败的图片
          }
        }
      }
    }

    if (resultImages.length === 0) {
      return NextResponse.json(
        { error: "生成成功但未返回图片数据" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      images: resultImages,
      revised_prompt: data?.data?.[0]?.revised_prompt,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "未知错误";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
