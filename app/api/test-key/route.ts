import { NextRequest, NextResponse } from "next/server";
import { httpRequest, httpFormDataRequest } from "@/lib/http-client";
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

    const url = `${baseURL || "https://api.openai.com/v1"}/images/generations/async`;
    const form = new FormData();
    form.append("model", "gpt-image-2");
    form.append("prompt", "a red dot");
    form.append("size", "1024x1024");
    form.append("quality", "low");
    form.append("response_format", "url");

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
      let errMsg = "Unknown error";
      try {
        const errData = JSON.parse(res.body);
        errMsg = errData.error?.message || errData.message || errMsg;
      } catch { /* ignore */ }
      const { body, status } = errorResponse("AUTH_INVALID_KEY", `${res.status} ${errMsg}`);
      return NextResponse.json({ error: body }, { status });
    }

    let data;
    try {
      data = JSON.parse(res.body);
    } catch {
      const { body, status } = errorResponse("GEN_UPSTREAM_BAD_RESPONSE", "verify");
      return NextResponse.json({ error: body }, { status });
    }
    const taskId = data?.data?.task_id || data?.task_id;
    if (!taskId) {
      const { body, status } = errorResponse("GEN_UPSTREAM_NO_TASK_ID", "verify");
      return NextResponse.json({ error: body }, { status });
    }

    // 轮询
    const taskUrl = `${baseURL || "https://api.openai.com/v1"}/images/tasks/${taskId}`;

    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const taskRes = await httpRequest(taskUrl, {
        headers: { Authorization: `Bearer ${apiKey}` },
        proxyUrl: proxyUrl || undefined,
      });
      if (taskRes.status < 200 || taskRes.status >= 300) continue;
      const taskData = JSON.parse(taskRes.body);
      const status = taskData?.data?.status || taskData?.status;
      if (status === "SUCCESS") {
        return NextResponse.json({ ok: true, message: "API Key 验证通过，生图接口正常" });
      }
      if (status === "FAILURE") {
        const reason = taskData?.data?.fail_reason || "未知原因";
        const { body, status } = errorResponse("TASK_FAILED", reason);
        return NextResponse.json({ error: body }, { status });
      }
    }

    return NextResponse.json({ ok: true, message: "API Key 验证通过，任务已提交（生图接口正常）" });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const { body, status } = errorResponse("UNKNOWN", message);
    return NextResponse.json({ error: body }, { status });
  }
}
