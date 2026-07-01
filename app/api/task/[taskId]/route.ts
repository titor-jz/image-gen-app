import { NextRequest, NextResponse } from "next/server";
import { httpRequest } from "@/lib/http-client";

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
      return NextResponse.json(
        { error: "请先在设置中配置 API Key" },
        { status: 401 }
      );
    }

    if (!taskId) {
      return NextResponse.json(
        { error: "缺少任务 ID" },
        { status: 400 }
      );
    }

    // 第一步：查询任务状态（返回 JSON）
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
      return NextResponse.json(
        { error: `请求上游 API 失败: ${msg}` },
        { status: 502 }
      );
    }

    let statusData;
    try {
      statusData = JSON.parse(statusRes.body);
    } catch {
      console.error("[task] 解析状态响应失败:", statusRes.body);
      return NextResponse.json(
        { error: "上游服务返回了无效响应" },
        { status: 502 }
      );
    }

    const status = statusData?.data?.status || statusData?.status || "UNKNOWN";
    const failReason = statusData?.data?.fail_reason || statusData?.fail_reason;

    // 任务仍在进行中
    if (status === "IN_PROGRESS" || status === "PENDING" || status === "PROCESSING") {
      return NextResponse.json({
        task_id: taskId,
        status,
        image_url: null,
        fail_reason: null,
      });
    }

    // 任务失败
    if (status === "FAILURE" || status === "FAILED") {
      return NextResponse.json({
        task_id: taskId,
        status,
        image_url: null,
        fail_reason: failReason || "未知原因",
      });
    }

    // 任务成功 → 获取图片内容（返回二进制）
    if (status === "SUCCESS") {
      const contentUrl = `${baseURL}/images/tasks/${taskId}/content?index=0`;
      let contentRes;
      try {
        contentRes = await httpRequest(contentUrl, {
          headers: { Authorization: `Bearer ${apiKey}` },
          proxyUrl: proxyUrl || undefined,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "网络请求失败";
        console.error("[task] 下载图片失败:", msg, err);
        return NextResponse.json(
          { error: `下载图片失败: ${msg}` },
          { status: 502 }
        );
      }

      if (contentRes.status < 200 || contentRes.status >= 300) {
        console.error("[task] 图片下载返回错误:", contentRes.status, contentRes.body);
        return NextResponse.json(
          { error: `图片下载失败 (${contentRes.status})` },
          { status: 500 }
        );
      }

      // 将二进制图片转为 base64 返回
      const buf = contentRes.bodyBuffer || Buffer.from(contentRes.body, "binary");
      const b64 = buf.toString("base64");
      const contentType = contentRes.headers["content-type"] || "image/png";

      return NextResponse.json({
        task_id: taskId,
        status: "SUCCESS",
        image_base64: b64,
        mime: contentType,
        fail_reason: null,
      });
    }

    // 未知状态 → 当作仍在处理中，让前端继续轮询
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
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
