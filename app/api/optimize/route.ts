import { NextRequest, NextResponse } from "next/server";
import { httpRequest, httpJsonPost } from "@/lib/http-client";
import { errorResponse } from "@/lib/error-messages";
import { resolveUpstream } from "@/lib/upstream-config";
import {
  buildOptimizeMessages,
  pickChatModel,
  sanitizeOptimizedPrompt,
  normalizeSize,
  MAX_INPUT_CHARS,
} from "@/lib/prompt-optimizer";
import { MAX_PROMPT_CHARS } from "@/lib/prompt-rules";
import { parseModelIds } from "@/lib/model-list";

/**
 * POST /api/optimize - 用上游对话模型改写提示词（无状态透传）
 *
 * 设计对齐行业范式（Ideogram / Leonardo / Venice）：
 *  - 开关与方向由客户端决定，本路由只做一次改写，不落任何数据；
 *  - 密钥与上游地址沿用 resolveUpstream（BYO 头透传 / 服务端 env，同源不变式 + SSRF 基线）；
 *  - 失败一律返回稳定 error code，由客户端决定是否 fail-open 保留原文。
 */

/**
 * 单次改写超时：给推理系模型留足时间（实测 deepseek-v4-flash 波动 6~30s+）。
 * 客户端钉死模型时不会走 /models 探测，整条链路基本只花这一次调用。
 */
const OPT_TIMEOUT_MS = Number(process.env.OPT_TIMEOUT_MS) || 45000;
/** 整个请求的总预算：探测 /models + 逐个试模型都算在内，必须低于平台 60s 上限 */
const OPT_TOTAL_BUDGET_MS = Number(process.env.OPT_TOTAL_BUDGET_MS) || 50000;
/** /models 探测超时：它只是锦上添花，不该吃掉对话预算 */
const MODELS_PROBE_TIMEOUT_MS = 8000;
/** 请求体上限（提示词很短，1MB 足够；自托管可放宽） */
const MAX_BODY_BYTES = (Number(process.env.OPT_MAX_BODY_MB) || 1) * 1024 * 1024;

/**
 * 列表缺失时的探测候选：不少中转（NewAPI 系）对非管理员 token 返回空 /models，
 * 但 /chat/completions 是可用的。此时按常见型号逐个试，命中即用。
 * 404/400 通常不计费；401 立即终止（Key 问题，试别的型号没意义）。
 */
const FALLBACK_CHAT_MODELS = ["gpt-4o-mini", "gpt-4.1-mini", "deepseek-chat", "gpt-3.5-turbo"];

/** 这些状态码说明"换个模型可能就行"，其余状态直接放弃 */
const MODEL_RETRYABLE_STATUS = new Set([400, 404, 422]);

interface OptimizeBody {
  prompt?: unknown;
  model?: unknown;
  size?: unknown;
  hasReference?: unknown;
  avoid?: unknown;
}

/**
 * 失败分类决定最终错误码：
 *  - no-model：候选模型全部不存在/不可用 → 用户该去换节点或填模型名
 *  - bad-response：模型存在且返回 2xx，但内容不可用 → 不是配置问题，重试即可
 *  - upstream：上游 5xx / 非模型类网络错误
 */
type FailureKind = "no-model" | "bad-response" | "upstream";

const FAILURE_CODES: Record<FailureKind, "OPT_NO_CHAT_MODEL" | "OPT_BAD_RESPONSE" | "OPT_UPSTREAM_FAILED"> = {
  "no-model": "OPT_NO_CHAT_MODEL",
  "bad-response": "OPT_BAD_RESPONSE",
  upstream: "OPT_UPSTREAM_FAILED",
};

/** 上游 /models 里取模型 id（兼容 OpenAI 的 {data:[...]} 与裸数组） */
async function listModelIds(
  baseURL: string,
  apiKey: string,
  proxyUrl: string
): Promise<string[] | null> {
  try {
    const res = await httpRequest(`${baseURL}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      proxyUrl: proxyUrl || undefined,
      timeoutMs: MODELS_PROBE_TIMEOUT_MS,
    });
    if (res.status < 200 || res.status >= 300) return null;
    // 兼容 OpenAI {data}/裸数组/Google {models}，id 可能是 name 或 "models/xxx"
    return parseModelIds(JSON.parse(res.body));
  } catch {
    return null;
  }
}

/** 模型输出的 content 可能是字符串，也可能是多模态分片数组 */
function extractContent(message: { content?: unknown; text?: unknown } | undefined): string {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
          return (part as { text: string }).text;
        }
        return "";
      })
      .join("");
  }
  return typeof message?.text === "string" ? message.text : "";
}

export async function POST(request: NextRequest) {
  try {
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

    // 请求体上限：提示词很小，但公开端点不应让超大 JSON 整包进内存（对齐 generate 路由）
    const contentLength = request.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
      const { body, status } = errorResponse(
        "REQ_BODY_TOO_LARGE",
        `当前上限 ${process.env.OPT_MAX_BODY_MB || 1}MB`
      );
      return NextResponse.json({ error: body }, { status });
    }

    // 总预算从请求开始计（/models 探测也算在内），避免多个候选各等 30s 撞上平台上限
    const deadline = Date.now() + OPT_TOTAL_BUDGET_MS;

    let input: OptimizeBody;
    try {
      input = await request.json();
    } catch {
      const { body, status } = errorResponse("REQ_BAD_FORMAT");
      return NextResponse.json({ error: body }, { status });
    }

    const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
    if (!prompt) {
      const { body, status } = errorResponse("REQ_MISSING_PROMPT");
      return NextResponse.json({ error: body }, { status });
    }
    // 与生图共用同一条长度规则（lib/prompt-rules.ts），不静默截断
    if (prompt.length > MAX_PROMPT_CHARS) {
      const { body, status } = errorResponse("REQ_PROMPT_TOO_LONG", `上限 ${MAX_PROMPT_CHARS} 字`);
      return NextResponse.json({ error: body }, { status });
    }

    const messages = buildOptimizeMessages(prompt, {
      // 只接受已知画幅：它会拼进 system prompt，不能把任意文本带进去
      size: normalizeSize(input.size),
      hasReference: input.hasReference === true,
      avoid: typeof input.avoid === "string" ? input.avoid.slice(0, MAX_INPUT_CHARS) : undefined,
    });

    // 候选模型：客户端指定（上次成功过的）> 服务端 env > /models 挑出的 > 常见型号探测
    const candidates: string[] = [];
    const requested =
      (typeof input.model === "string" && input.model.trim()) ||
      process.env.OPT_MODEL?.trim() ||
      "";
    if (requested) {
      candidates.push(requested);
    } else {
      const ids = await listModelIds(baseURL, apiKey, proxyUrl);
      const picked = ids ? pickChatModel(ids) : null;
      if (picked) candidates.push(picked);
      // 列表为空/无对话模型时不能直接放弃：部分中转对普通 token 隐藏 /models
      for (const m of FALLBACK_CHAT_MODELS) {
        if (!candidates.includes(m)) candidates.push(m);
      }
    }

    /** 上一轮失败信息；kind 决定最终错误码（见 FailureKind） */
    let lastFailure: { kind: FailureKind; message: string } | null = null;

    for (const model of candidates) {
      const remaining = deadline - Date.now();
      // 预算不足就别再开一轮了：宁可明确报失败，也不要被平台掐断成"未知错误"
      if (remaining < 3000) {
        lastFailure = lastFailure ?? { kind: "upstream", message: "请求总时长超出预算" };
        break;
      }

      let res;
      try {
        // 只发 model + messages：不同厂商对 max_tokens / temperature 的兼容性不一，
        // 少发一个参数就少一类"这个模型不支持"的失败。
        res = await httpJsonPost(
          `${baseURL}/chat/completions`,
          { model, messages },
          { Authorization: `Bearer ${apiKey}` },
          proxyUrl || undefined,
          Math.min(OPT_TIMEOUT_MS, remaining)
        );
      } catch (err) {
        const name = err instanceof Error ? err.name : "";
        // 超时是"这个模型太慢"，换下一个候选还有机会；其它网络错误（DNS/TLS/拒绝连接）
        // 换模型救不了，直接失败。
        if (name === "TimeoutError" || name === "AbortError") {
          console.error("[optimize] 上游对话超时:", model);
          lastFailure = { kind: "upstream", message: `${model} 请求超时` };
          continue;
        }
        const msg = err instanceof Error ? err.message : "网络请求失败";
        console.error("[optimize] 上游对话请求失败:", model, msg);
        const { body, status } = errorResponse("OPT_UPSTREAM_FAILED", msg.slice(0, 200));
        return NextResponse.json({ error: body }, { status });
      }

      if (res.status === 401 || res.status === 403) {
        // Key 问题：换模型救不了
        const { body, status } = errorResponse(
          res.status === 401 ? "AUTH_INVALID_KEY" : "AUTH_FORBIDDEN"
        );
        return NextResponse.json({ error: body }, { status });
      }

      if (res.status >= 200 && res.status < 300) {
        let data;
        try {
          data = JSON.parse(res.body);
        } catch {
          console.error("[optimize] 上游响应非 JSON:", model);
          lastFailure = { kind: "bad-response", message: `${model} 响应非 JSON` };
          continue;
        }

        const raw = extractContent(data?.choices?.[0]?.message ?? data?.choices?.[0]);
        const optimized = sanitizeOptimizedPrompt(raw);
        if (!optimized) {
          // 模型存在且返回 2xx，只是内容不可用——这不是"没有对话模型"，换一个候选也许就好
          console.error("[optimize] 改写结果为空:", model);
          lastFailure = { kind: "bad-response", message: `${model} 返回空结果` };
          continue;
        }

        return NextResponse.json({ prompt: optimized, model });
      }

      let errMsg = `上游返回 ${res.status}`;
      try {
        const errData = JSON.parse(res.body);
        errMsg = `${res.status} ${errData.error?.message || errData.message || ""}`.trim();
      } catch {
        // 非 JSON 错误体：保留状态码
      }
      // 不把上游错误原文整段写进日志（部分上游会在 400 里回显输入），截断后只用于排查
      console.error("[optimize] 上游返回错误:", model, res.status, errMsg.slice(0, 200));

      const retryable = MODEL_RETRYABLE_STATUS.has(res.status);
      lastFailure = { kind: retryable ? "no-model" : "upstream", message: errMsg.slice(0, 200) };
      if (!retryable) break;
    }

    const code = lastFailure ? FAILURE_CODES[lastFailure.kind] : "OPT_NO_CHAT_MODEL";
    const { body, status } = errorResponse(code, lastFailure?.message);
    return NextResponse.json({ error: body }, { status });
  } catch (error: unknown) {
    console.error("[optimize] 未知异常:", error);
    const { body, status } = errorResponse("UNKNOWN");
    return NextResponse.json({ error: body }, { status });
  }
}
