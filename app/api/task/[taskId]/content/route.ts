import { NextRequest, NextResponse } from "next/server";
import { httpRequest } from "@/lib/http-client";
import { errorResponse } from "@/lib/error-messages";

/**
 * GET /api/task/[taskId]/content
 *
 * 直接返回上游图片的二进制内容（image/png 等）。
 * 与 /api/task/[taskId] 配套使用：
 *   1. 轮询状态接口，SUCCESS 时拿到 image_url
 *   2. 再访问本端点获取真正的图片 binary
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;
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
    if (!taskId) {
      const { body, status } = errorResponse("REQ_BAD_FORMAT", "缺少任务 ID");
      return NextResponse.json({ error: body }, { status });
    }

    const contentUrl = `${baseURL}/images/tasks/${taskId}/content?index=0`;
    let contentRes;
    try {
      contentRes = await httpRequest(contentUrl, {
        headers: { Authorization: `Bearer ${apiKey}` },
        proxyUrl: proxyUrl || undefined,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "网络请求失败";
      console.error("[content] 请求上游 API 失败:", msg, err);
      const { body, status } = errorResponse("GEN_UPSTREAM_NETWORK", msg);
      return NextResponse.json({ error: body }, { status });
    }

    if (contentRes.status === 401 || contentRes.status === 403) {
      const { body, status } = errorResponse(
        contentRes.status === 401 ? "AUTH_INVALID_KEY" : "AUTH_FORBIDDEN"
      );
      return NextResponse.json({ error: body }, { status });
    }

    if (contentRes.status < 200 || contentRes.status >= 300) {
      console.error("[content] 上游返回错误:", contentRes.status);
      const { body, status } = errorResponse("TASK_DOWNLOAD_FAILED", `上游 ${contentRes.status}`);
      return NextResponse.json({ error: body }, { status });
    }

    const buf = contentRes.bodyBuffer || Buffer.from(contentRes.body, "binary");
    const contentType = contentRes.headers["content-type"] || "image/png";
    const uint8 = new Uint8Array(buf);

    return new NextResponse(uint8, {
      status: 200,
      headers: {
        "content-type": contentType,
        "content-length": String(uint8.byteLength),
        "cache-control": "private, max-age=3600",
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "未知错误";
    console.error("[content] 处理请求异常:", error);
    const { body, status } = errorResponse("UNKNOWN", message);
    return NextResponse.json({ error: body }, { status });
  }
}
