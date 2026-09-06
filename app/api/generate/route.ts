import { NextRequest, NextResponse } from "next/server";
import { FormData as UndiciFormData } from "undici";
import { httpFormDataRequest } from "@/lib/http-client";
import { errorResponse } from "@/lib/error-messages";

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

// 4K 档:边长 ≤ 3840px
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

const QUALITY_MAP: Record<string, string> = {
  "1k": "low",
  "2k": "medium",
  "4k": "high",
};

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
      const { body, status } = errorResponse("AUTH_MISSING_KEY");
      return NextResponse.json({ error: body }, { status });
    }

    // 请求体大小
    const contentLength = request.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > 20 * 1024 * 1024) {
      const { body, status } = errorResponse("REQ_BODY_TOO_LARGE");
      return NextResponse.json({ error: body }, { status });
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      const { body, status } = errorResponse("REQ_BAD_FORMAT");
      return NextResponse.json({ error: body }, { status });
    }

    const prompt = formData.get("prompt") as string;
    const model = (formData.get("model") as string) || "gpt-image-2";
    const size = (formData.get("size") as string) || "auto";
    const quality = (formData.get("quality") as string) || "1k";
    const imageFiles = formData.getAll("images") as (File | Blob)[];

    if (!prompt) {
      const { body, status } = errorResponse("REQ_MISSING_PROMPT");
      return NextResponse.json({ error: body }, { status });
    }

    const url = `${baseURL}/images/generations/async`;
    // 用 undici 的 FormData（与 http-client 的 RequestInit 类型对齐）
    const form = new UndiciFormData();
    form.append("model", model);
    form.append("prompt", prompt);
    const sizeMap = quality === "4k" ? SIZE_4K_MAP : SIZE_MAP;
    form.append("size", sizeMap[size] || "auto");
    form.append("quality", QUALITY_MAP[quality] || "low");
    form.append("response_format", "url");

    for (let i = 0; i < imageFiles.length; i++) {
      const file = imageFiles[i];
      if (file instanceof Blob) {
        const name = (file as File).name || `input_${i}.png`;
        form.append("image", file, name);
      }
    }

    let res;
    try {
      res = await httpFormDataRequest(
        url,
        form,
        { Authorization: `Bearer ${apiKey}` },
        proxyUrl
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "网络请求失败";
      console.error("[generate] 请求上游 API 失败:", msg, err);
      const { body, status } = errorResponse("GEN_UPSTREAM_NETWORK", msg);
      return NextResponse.json({ error: body }, { status });
    }

    if (res.status === 401 || res.status === 403) {
      const { body, status } = errorResponse(
        res.status === 401 ? "AUTH_INVALID_KEY" : "AUTH_FORBIDDEN"
      );
      return NextResponse.json({ error: body }, { status });
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
      const { body, status } = errorResponse("GEN_UPSTREAM_FAILED", `${res.status} ${errMsg}`);
      return NextResponse.json({ error: body }, { status });
    }

    let data;
    try {
      data = JSON.parse(res.body);
    } catch {
      console.error("[generate] 解析上游响应失败:", res.body);
      const { body, status } = errorResponse("GEN_UPSTREAM_BAD_RESPONSE");
      return NextResponse.json({ error: body }, { status });
    }

    const taskId = data?.data?.task_id || data?.task_id;
    if (!taskId) {
      console.error("[generate] 上游响应中未找到 task_id:", data);
      const { body, status } = errorResponse("GEN_UPSTREAM_NO_TASK_ID");
      return NextResponse.json({ error: body }, { status });
    }

    return NextResponse.json({
      task_id: taskId,
      status: "PENDING",
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "未知错误";
    console.error("[generate] 未知异常:", error);
    const { body, status } = errorResponse("UNKNOWN", message);
    return NextResponse.json({ error: body }, { status });
  }
}
