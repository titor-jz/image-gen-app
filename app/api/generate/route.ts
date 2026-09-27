import { NextRequest, NextResponse } from "next/server";
import { FormData as UndiciFormData } from "undici";
import { httpRequest, httpFormDataRequest, httpJsonPost } from "@/lib/http-client";
import { errorResponse } from "@/lib/error-messages";
import { resolveUpstream } from "@/lib/upstream-config";
import { upstreamUrlError } from "@/lib/url-guard";

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

// 请求体上限：默认 4MB，必须低于 Vercel 平台限制（约 4.5MB），否则平台先拒（413），
// 客户端只能拿到"未知错误"而不是 REQ_BODY_TOO_LARGE 的中文提示（评审 S-4）。
// 本地/自托管可用 GEN_MAX_BODY_MB 放宽（如 GEN_MAX_BODY_MB=20）。
const MAX_BODY_BYTES =
  (Number(process.env.GEN_MAX_BODY_MB) || 4) * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    // Key 与 BaseURL 同源：env Key 模式下忽略客户端 base/proxy（评审 S-1），
    // 客户端来源的 base/proxy 过 SSRF 基线校验（评审 S-2）
    const upstream = resolveUpstream(request);
    if (!upstream.ok) {
      const { body, status } = errorResponse(upstream.errorCode, upstream.reason);
      return NextResponse.json({ error: body }, { status });
    }
    const { apiKey, baseURL, proxyUrl } = upstream;

    if (!apiKey) {
      const { body, status } = errorResponse("AUTH_MISSING_KEY");
      return NextResponse.json({ error: body }, { status });
    }

    // 请求体大小
    const contentLength = request.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > MAX_BODY_BYTES) {
      const { body, status } = errorResponse(
        "REQ_BODY_TOO_LARGE",
        `当前上限 ${process.env.GEN_MAX_BODY_MB || 4}MB`
      );
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
    const syncUrl = `${baseURL}/images/generations`;
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
      // 部分中转只实现了 OpenAI 标准同步端点，没有 async 端点（404/405）。
      // 此时回落同步，且必须按用途分端点 + 精简参数：
      //  - 图生图走标准 /v1/images/edits（multipart: model/prompt/size/image）。
      //    带图的 /generations、或携带 response_format/quality 参数，
      //    都会被 NewAPI 系中转识别为 dall-e 请求 → 503 No available channel
      //  - 纯文生图走 /v1/images/generations（JSON: model/prompt/size/n）
      if (res.status === 404 || res.status === 405) {
        console.log("[generate] 上游无异步端点, 回落同步端点");
        if (imageFiles.length > 0) {
          console.log("[generate] 图生图 → /images/edits");
          const editForm = new UndiciFormData();
          editForm.append("model", model);
          editForm.append("prompt", prompt);
          editForm.append("size", sizeMap[size] || "auto");
          for (let i = 0; i < imageFiles.length; i++) {
            const file = imageFiles[i];
            if (file instanceof Blob) {
              editForm.append(
                "image",
                file,
                (file as File).name || `input_${i}.png`
              );
            }
          }
          res = await httpFormDataRequest(
            `${baseURL}/images/edits`,
            editForm,
            { Authorization: `Bearer ${apiKey}` },
            proxyUrl
          );
        } else {
          console.log("[generate] 文生图 → /images/generations (JSON)");
          res = await httpJsonPost(
            syncUrl,
            {
              model,
              prompt,
              size: sizeMap[size] === "auto" ? "auto" : sizeMap[size],
              n: 1,
            },
            { Authorization: `Bearer ${apiKey}` },
            proxyUrl
          );
        }
      }
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
    if (taskId) {
      // 异步分支：提交成功，客户端拿 task_id 轮询
      return NextResponse.json({
        task_id: taskId,
        status: "PENDING",
      });
    }

    // 同步分支：上游直接返回成图（OpenAI 标准格式 data[].url / data[].b64_json）。
    // 图片可能是外链 URL，客户端无法带鉴权头下载，这里代理取回并转成 base64 透传，
    // 复用前端已有的 images[] 同步处理路径。
    const first = Array.isArray(data?.data) ? data.data[0] : undefined;
    if (first) {
      let b64Json: string | undefined = first.b64_json;
      if (!b64Json && typeof first.url === "string") {
        // 上游返回的图片地址在服务端代取前必须过 SSRF 基线校验：
        // 恶意"上游"可返回内网地址（如 169.254.169.254）借服务端读内网（评审 S-2）
        const downloadErr = upstreamUrlError(first.url);
        if (downloadErr) {
          console.error("[generate] 同步分支图片 URL 未通过安全校验:", downloadErr);
        } else {
          try {
            const imgRes = await httpRequest(first.url, { proxyUrl: proxyUrl || undefined });
            if (imgRes.status >= 200 && imgRes.status < 300 && imgRes.bodyBuffer) {
              b64Json = imgRes.bodyBuffer.toString("base64");
            } else {
              console.error("[generate] 同步分支下载图片失败:", imgRes.status);
            }
          } catch (err) {
            console.error("[generate] 同步分支下载图片异常:", err);
          }
        }
      }
      if (b64Json) {
        return NextResponse.json({
          images: [{ b64_json: b64Json, mime: "image/png" }],
        });
      }
    }

    console.error("[generate] 上游响应中未找到 task_id 或图片数据:", data);
    const { body, status } = errorResponse("GEN_UPSTREAM_NO_TASK_ID");
    return NextResponse.json({ error: body }, { status });
  } catch (error: unknown) {
    // details 不透出内部异常原文（可能含内部 URL），仅记日志
    console.error("[generate] 未知异常:", error);
    const { body, status } = errorResponse("UNKNOWN");
    return NextResponse.json({ error: body }, { status });
  }
}
