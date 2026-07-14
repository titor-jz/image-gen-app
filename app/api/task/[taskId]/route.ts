import { NextRequest, NextResponse } from "next/server";
import { httpRequest } from "@/lib/http-client";
import { errorResponse } from "@/lib/error-messages";

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

    const statusUrl = `${baseURL}/images/tasks/${taskId}`;

    let statusRes;
    try {
      statusRes = await httpRequest(statusUrl, {
        headers: { Authorization: `Bearer ${apiKey}` },
        proxyUrl: proxyUrl || undefined,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "网络请求失败";
      console.error("[task] 请求上游 API 失败:", msg, err);
      const { body, status } = errorResponse("GEN_UPSTREAM_NETWORK", msg);
      return NextResponse.json({ error: body }, { status });
    }

    if (statusRes.status === 401 || statusRes.status === 403) {
      const { body, status } = errorResponse(
        statusRes.status === 401 ? "AUTH_INVALID_KEY" : "AUTH_FORBIDDEN"
      );
      return NextResponse.json({ error: body }, { status });
    }

    if (statusRes.status < 200 || statusRes.status >= 300) {
      console.error("[task] 上游返回错误:", statusRes.status, statusRes.body);
      const { body, status } = errorResponse("TASK_POLL_FAILED", `上游 ${statusRes.status}`);
      return NextResponse.json({ error: body }, { status });
    }

    let statusData;
    try {
      statusData = JSON.parse(statusRes.body);
    } catch {
      console.error("[task] 解析状态响应失败:", statusRes.body);
      const { body, status } = errorResponse("TASK_BAD_RESPONSE");
      return NextResponse.json({ error: body }, { status });
    }

    const status = statusData?.data?.status || statusData?.status || "UNKNOWN";
    const failReason = statusData?.data?.fail_reason || statusData?.fail_reason;

    if (
      status === "IN_PROGRESS" ||
      status === "PENDING" ||
      status === "PROCESSING"
    ) {
      return NextResponse.json({
        task_id: taskId,
        status,
        image_url: null,
        fail_reason: null,
      });
    }

    if (status === "FAILURE" || status === "FAILED") {
      return NextResponse.json({
        task_id: taskId,
        status: "FAILED",
        image_url: null,
        fail_reason: failReason || "未知原因",
      });
    }

    if (status === "SUCCESS") {
      return NextResponse.json({
        task_id: taskId,
        status: "SUCCESS",
        image_url: `/api/task/${taskId}/content`,
        fail_reason: null,
      });
    }

    console.warn("[task] 未知任务状态:", status, "响应:", JSON.stringify(statusData).slice(0, 200));
    return NextResponse.json({
      task_id: taskId,
      status: "PENDING",
      image_url: null,
      fail_reason: null,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "未知错误";
    console.error("[task] 处理请求异常:", error);
    const { body, status } = errorResponse("UNKNOWN", message);
    return NextResponse.json({ error: body }, { status });
  }
}
