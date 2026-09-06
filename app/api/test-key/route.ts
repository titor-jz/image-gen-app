import { NextRequest, NextResponse } from "next/server";
import { httpRequest } from "@/lib/http-client";
import { errorResponse } from "@/lib/error-messages";

export async function POST(request: NextRequest) {
  try {
    const apiKey = request.headers.get("x-api-key");
    const baseURL = request.headers.get("x-base-url");
    const proxyUrl = request.headers.get("x-proxy-url") || "";

    if (!apiKey) {
      const { body, status } = errorResponse("AUTH_MISSING_KEY");
      return NextResponse.json({ error: body }, { status });
    }

    // 用 GET /models 验证鉴权（免费端点）。
    // 旧实现提交一次真实异步生图任务并轮询，导致每次「测试连接」都按一张图计费。
    const url = `${baseURL || "https://api.openai.com/v1"}/models`;
    let res;
    try {
      res = await httpRequest(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        proxyUrl: proxyUrl || undefined,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "网络请求失败";
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
      } catch { /* 非 JSON 错误体，保留默认文案 */ }
      const { body, status } = errorResponse("GEN_UPSTREAM_FAILED", `${res.status} ${errMsg}`);
      return NextResponse.json({ error: body }, { status });
    }

    try {
      JSON.parse(res.body);
    } catch {
      const { body, status } = errorResponse("GEN_UPSTREAM_BAD_RESPONSE", "verify");
      return NextResponse.json({ error: body }, { status });
    }

    return NextResponse.json({ ok: true, message: "API Key 验证通过" });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const { body, status } = errorResponse("UNKNOWN", message);
    return NextResponse.json({ error: body }, { status });
  }
}
