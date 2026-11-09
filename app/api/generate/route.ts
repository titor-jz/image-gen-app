import { NextRequest, NextResponse } from "next/server";
import { httpRequest, httpMultipartRequest, httpJsonPost, type MultipartPart } from "@/lib/http-client";
import { errorResponse, type ErrorCode } from "@/lib/error-messages";
import { resolveUpstream } from "@/lib/upstream-config";
import { upstreamUrlError } from "@/lib/url-guard";
import { MAX_PROMPT_CHARS } from "@/lib/prompt-rules";
import { upstreamErrorHint } from "@/lib/upstream-errors";
import { QUALITY_MAP, upstreamSizeFor } from "@/lib/size-map";

/** 按魔数嗅探图片 MIME：2.6 等模型可返回动图 GIF，写死 image/png 会让下载后缀与展示出错 */
function sniffImageMime(b64: string): string {
  const bytes = Buffer.from(b64, "base64").subarray(0, 12);
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif"; // "GIF8"
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e) return "image/png";
  if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x3c) {
    // 文本类：SVG（<?xml… 或 <svg… 开头）
    const head = Buffer.from(b64, "base64").subarray(0, 256).toString("latin1");
    if (head.includes("<svg") || head.includes("<?xml")) return "image/svg+xml";
  }
  return "image/png";
}

/** 同步兜底生成 + ndjson 流式保活。
 *
 * 部分中转无异步端点（async 404），回落同步后整个生成期间挂住连接 40s+——
 * 手机蜂窝网络会掐断这种长连接（实测 failed to fetch 但上游已扣费）。
 * 改为流式响应：每 10s 一行心跳让连接保持活跃，最终结果/错误以最后一行 JSON 返回。
 */
function streamSyncGeneration(opts: {
  syncUrl: string;
  model: string;
  upstreamPrompt: string;
  sizeParam: string;
  /** 上游 quality（low/medium/high）——图生图此前漏传，导致画质选项对它不生效 */
  qualityParam: string;
  imageFiles: (File | Blob)[];
  baseURL: string;
  apiKey: string;
  proxyUrl?: string;
  outputFormat: "static" | "gif" | "svg";

}): NextResponse {
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      let closed = false;
      const send = (obj: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
        } catch {
          // 客户端断开（cancel）后 enqueue 会抛错：静默标记关闭，等 finally 收尾
          closed = true;
        }
      };
      const heartbeat = setInterval(() => send({ type: "heartbeat" }), 10000);
      const finish = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // 流已被取消：无需收尾
        }
      };
      const fail = (status: number, code: ErrorCode, message: string) => {
        const { body } = errorResponse(code, message);
        send({ type: "error", status, error: body });
        finish();
      };

      try {
        let res;
        if (opts.imageFiles.length > 0) {
          // 图生图走标准 /v1/images/edits（multipart）——带图的 /generations 会被
          // NewAPI 系中转识别为 dall-e 请求 → 503 No available channel
          const editParts: MultipartPart[] = [
            { name: "model", value: opts.model },
            // 中文提示词必须声明 charset：中转对没有 charset 的表单字段按 latin-1
            // 解码 → 模型收到乱码，表现为「完全忽略提示词」（见 lib/http-client.ts）
            {
              name: "prompt",
              value: opts.upstreamPrompt,
              contentType: "text/plain; charset=utf-8",
            },
            { name: "size", value: opts.sizeParam },
            // 质量档位：图生图此前完全没传，质量选择对这条路径形同不存在
            { name: "quality", value: opts.qualityParam },
          ];
          // SVG 输出：edits 分支同样透传（漏传会导致图生图矢量化回 PNG）
          if (opts.outputFormat === "svg") {
            editParts.push({ name: "output_format", value: "svg" });
          }
          for (let i = 0; i < opts.imageFiles.length; i++) {
            const file = opts.imageFiles[i];
            if (file instanceof Blob) {
              editParts.push({
                name: "image",
                value: file,
                filename: (file as File).name || `input_${i}.png`,
              });
            }
          }

          res = await httpMultipartRequest(
            `${opts.baseURL}/images/edits`,
            editParts,
            { Authorization: `Bearer ${opts.apiKey}` },
            opts.proxyUrl
          );
        } else {
          // 纯文生图走 /v1/images/generations（JSON: model/prompt/size/n）
          res = await httpJsonPost(
            opts.syncUrl,
            {
              model: opts.model,
              prompt: opts.upstreamPrompt,
              size: opts.sizeParam,
              n: 1,
              // SVG 输出：透传 output_format=svg（实测返回真矢量 <svg> XML）
              ...(opts.outputFormat === "svg" ? { output_format: "svg" } : {}),
            },
            { Authorization: `Bearer ${opts.apiKey}` },
            opts.proxyUrl
          );
        }

        if (res.status === 401 || res.status === 403) {
          fail(res.status, res.status === 401 ? "AUTH_INVALID_KEY" : "AUTH_FORBIDDEN", "鉴权失败");
          return;
        }
        if (res.status < 200 || res.status >= 300) {
          let errMsg = "未知错误";
          try {
            const errData = JSON.parse(res.body);
            errMsg = errData.error?.message || errData.message || errMsg;
          } catch {
            errMsg = `上游服务返回错误 (${res.status})`;
          }
          const hint = upstreamErrorHint(errMsg);
          fail(res.status, "GEN_UPSTREAM_FAILED", `${res.status} ${errMsg}${hint ? ` · ${hint}` : ""}`);
          return;
        }

        let data;
        try {
          data = JSON.parse(res.body);
        } catch {
          fail(502, "GEN_UPSTREAM_BAD_RESPONSE", "上游响应解析失败");
          return;
        }

        const first = Array.isArray(data?.data) ? data.data[0] : undefined;
        if (!first) {
          fail(502, "GEN_UPSTREAM_NO_TASK_ID", "上游响应中未找到图片数据");
          return;
        }

        let b64Json: string | undefined = first.b64_json;
        if (!b64Json && typeof first.url === "string") {
          // 上游返回的图片地址在服务端代取前必须过 SSRF 基线校验（评审 S-2）
          const downloadErr = upstreamUrlError(first.url);
          if (downloadErr) {
            fail(502, "GEN_UPSTREAM_FAILED", downloadErr);
            return;
          }
          try {
            const imgRes = await httpRequest(first.url, { proxyUrl: opts.proxyUrl || undefined });
            if (imgRes.status >= 200 && imgRes.status < 300 && imgRes.bodyBuffer) {
              b64Json = imgRes.bodyBuffer.toString("base64");
            } else {
              fail(502, "GEN_UPSTREAM_FAILED", `下载图片失败 (${imgRes.status})`);
              return;
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : "下载图片异常";
            fail(502, "GEN_UPSTREAM_NETWORK", msg);
            return;
          }
        }

        if (b64Json) {
          send({ type: "result", images: [{ b64_json: b64Json, mime: sniffImageMime(b64Json) }] });
          finish();
          return;
        }
        fail(502, "GEN_UPSTREAM_NO_TASK_ID", "上游响应中未找到图片数据");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "网络请求失败";
        fail(502, "GEN_UPSTREAM_NETWORK", msg);
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

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
    // 输出格式：gif=动图（提示词驱动）；svg=矢量图（透传 output_format 参数）
    const fmtRaw = formData.get("format") as string;
    const outputFormat: "static" | "gif" | "svg" =
      fmtRaw === "gif" || fmtRaw === "svg" ? fmtRaw : "static";
    const imageFiles = formData.getAll("images") as (File | Blob)[];


    if (!prompt) {
      const { body, status } = errorResponse("REQ_MISSING_PROMPT");
      return NextResponse.json({ error: body }, { status });
    }


    // 动图模式注入两段指令（实测缺一不可，历史/回填仍存用户原文）：
    //  1. 前缀声明 GIF 动图；2. 追加循环动态要求——只有前缀时，静态描述类提示词
    //     （如「XX形象的卡通图」）模型会回静图（W1/W2 对照实测）
    const upstreamPrompt =
      outputFormat === "gif"
        ? `生成无缝循环的GIF动图：${prompt}，画面包含持续的循环动态动作，帧与帧之间连续变化`
        : prompt;

    // 与输入框 maxLength / 计数同源（lib/prompt-rules.ts），UI 与服务端不会各说各话
    if (prompt.length > MAX_PROMPT_CHARS) {
      const { body, status } = errorResponse("REQ_PROMPT_TOO_LONG", `上限 ${MAX_PROMPT_CHARS} 字`);
      return NextResponse.json({ error: body }, { status });
    }

    const url = `${baseURL}/images/generations/async`;
    const syncUrl = `${baseURL}/images/generations`;
    // 尺寸解析统一走 lib/size-map（1K/2K/4K 三档各自的像素表，服务端与界面共用）
    // 上游 2.6 动图管线对 size 挑剔：实测 1024x1024 / 2048x1152 出动画，
    // "auto"、3072x3072（4K 档）与超宽尺寸都静默回退静图（E/F/I/J 组对照）——
    // 且动图输出尺寸/画幅本就由模型自定（无视请求尺寸），GIF 模式一律送 1024x1024
    //（画幅选择器在 GIF 模式下已禁用）
    const upstreamSize = upstreamSizeFor(size, quality, outputFormat);
    // 质量参数：img2img 也要传（此前只在纯文生图表单里出现）
    const qualityValue = QUALITY_MAP[quality] || "low";
    // multipart 部件（手写编码，文本字段声明 charset=utf-8——中文提示词的必需项，
    // 见 lib/http-client.ts 的 buildMultipart）
    const parts: MultipartPart[] = [
      { name: "model", value: model },
      {
        name: "prompt",
        value: upstreamPrompt,
        contentType: "text/plain; charset=utf-8",
      },
      { name: "size", value: upstreamSize },
      { name: "quality", value: QUALITY_MAP[quality] || "low" },
      { name: "response_format", value: "url" },
    ];
    // SVG 输出：透传 output_format=svg（实测中转支持，返回真矢量 <svg> XML）
    if (outputFormat === "svg") {
      parts.push({ name: "output_format", value: "svg" });
    }

    for (let i = 0; i < imageFiles.length; i++) {
      const file = imageFiles[i];
      if (file instanceof Blob) {
        parts.push({
          name: "image",
          value: file,
          filename: (file as File).name || `input_${i}.png`,
        });
      }
    }

    // 客户端记忆该节点为同步型（无异步端点/假异步）时跳过 async 探测，直接流式同步
    if (formData.get("asyncMode") === "skip") {
      console.log("[generate] 节点记忆为同步型, 跳过 async 探测");
      return streamSyncGeneration({
        syncUrl,
        model,
        upstreamPrompt,
        sizeParam: upstreamSize,
        qualityParam: qualityValue,
        imageFiles,
        outputFormat,
        baseURL,
        apiKey,
        proxyUrl: proxyUrl || undefined,
      });
    }

    let res;
    try {
      res = await httpMultipartRequest(
        url,
        parts,
        { Authorization: `Bearer ${apiKey}` },
        proxyUrl
      );
      // 部分中转只实现了 OpenAI 标准同步端点，没有 async 端点（404/405）。
      // 回落同步时改走流式响应（streamSyncGeneration）：同步生成动辄 40s+，
      // 手机网络会掐断长连接（实测 failed to fetch 但上游已扣费）——
      // ndjson 心跳保活，结果以流内最后一行 JSON 返回。
      if (res.status === 404 || res.status === 405) {
        console.log("[generate] 上游无异步端点, 回落同步端点（ndjson 流式保活）");
        return streamSyncGeneration({
          syncUrl,
          model,
          upstreamPrompt,
          sizeParam: upstreamSize,
          qualityParam: qualityValue,
          imageFiles,
          outputFormat,
          baseURL,
          apiKey,
          proxyUrl: proxyUrl || undefined,
        });
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
      const hint = upstreamErrorHint(errMsg);
      const { body, status } = errorResponse(
        "GEN_UPSTREAM_FAILED",
        `${res.status} ${errMsg}${hint ? ` · ${hint}` : ""}`
      );
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
          images: [{ b64_json: b64Json, mime: sniffImageMime(b64Json) }],
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
