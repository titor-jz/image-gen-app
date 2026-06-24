import { NextRequest, NextResponse } from "next/server";
import { httpRequest, httpFormDataRequest } from "@/lib/http-client";

export async function POST(request: NextRequest) {
  try {
    const apiKey = request.headers.get("x-api-key");
    const baseURL = request.headers.get("x-base-url");
    const proxyUrl = request.headers.get("x-proxy-url") || "";

    if (!apiKey) {
      return NextResponse.json({ error: "API Key is required" }, { status: 401 });
    }

    const url = `${baseURL || "https://api.openai.com/v1"}/images/generations/async`;

    const form = new FormData();
    form.append("model", "gpt-image-2");
    form.append("prompt", "a red dot");
    form.append("size", "1024x1024");
    form.append("quality", "low");
    form.append("response_format", "url");

    const res = await httpFormDataRequest(url, form, {
      Authorization: `Bearer ${apiKey}`,
    }, proxyUrl || undefined);

    if (res.status < 200 || res.status >= 300) {
      let errMsg = "Unknown error";
      try {
        const errData = JSON.parse(res.body);
        errMsg = errData.error?.message || errData.message || errMsg;
      } catch { /* ignore */ }
      return NextResponse.json(
        { error: `验证失败 (${res.status}): ${errMsg}` },
        { status: 401 }
      );
    }

    let data;
    try {
      data = JSON.parse(res.body);
    } catch {
      return NextResponse.json({ error: `验证失败 (${res.status}): 上游服务返回无效响应` }, { status: 401 });
    }
    const taskId = data?.data?.task_id || data?.task_id;
    if (!taskId) {
      return NextResponse.json({ error: "验证失败: 未返回 task_id" }, { status: 401 });
    }

    // 轮询
    const taskUrl = `${baseURL || "https://api.openai.com/v1"}/images/tasks/${taskId}`;

    for (let i = 0; i < 30; i++) {
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
        return NextResponse.json({ error: `验证失败: 任务失败 - ${reason}` }, { status: 401 });
      }
    }

    return NextResponse.json({ error: "验证失败: 任务超时" }, { status: 401 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `验证失败: ${message}` }, { status: 401 });
  }
}
