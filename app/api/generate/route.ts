import { NextRequest, NextResponse } from "next/server";
import { httpRequest, httpFormDataRequest } from "@/lib/http-client";

// gpt-image-2 支持的尺寸
// 2K 档(默认):适合快速出图
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

// 4K 档:quality="4k" 时使用,边长 ≤ 3840px,16 倍数,比例 ≤ 3:1
const SIZE_4K_MAP: Record<string, string> = {
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

    // 使用异步接口，避免 Vercel Serverless 超时
    const url = `${baseURL}/images/generations/async`;

    const form = new FormData();
    form.append("model", model);
    form.append("prompt", prompt);
    const sizeMap = quality === "4k" ? SIZE_4K_MAP : SIZE_MAP;
    form.append("size", sizeMap[size] || "auto");
    form.append("quality", QUALITY_MAP[quality] || "low");
    form.append("response_format", "url"); // 异步接口使用 url 格式，减少响应大小

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
      console.error("[generate] 请求上游 API 失败:", msg, err);
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
        console.error("[generate] 上游 API 返回错误:", res.status, errMsg, res.body);
      } catch {
        errMsg = `上游服务返回错误 (${res.status})`;
        console.error("[generate] 上游 API 返回非 JSON 错误:", res.status, res.body);
      }
      return NextResponse.json(
        { error: `生成失败 (${res.status}): ${errMsg}` },
        { status: 500 }
      );
    }

    let data;
    try {
      data = JSON.parse(res.body);
    } catch {
      console.error("[generate] 解析上游响应失败:", res.body);
      return NextResponse.json(
        { error: "上游服务返回了无效响应，请稍后重试" },
        { status: 502 }
      );
    }

    // 提取 task_id
    const taskId = data?.data?.task_id || data?.task_id;
    if (!taskId) {
      console.error("[generate] 上游响应中未找到 task_id:", data);
      return NextResponse.json(
        { error: "生成失败: 未返回任务 ID" },
        { status: 500 }
      );
    }

    // 立即返回 task_id，前端轮询获取结果
    return NextResponse.json({
      task_id: taskId,
      status: "PENDING",
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "未知错误";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
