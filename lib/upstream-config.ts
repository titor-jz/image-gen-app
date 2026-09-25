import type { NextRequest } from "next/server";
import type { ErrorCode } from "@/lib/error-messages";
import { upstreamUrlError } from "@/lib/url-guard";

/**
 * 上游配置解析：Key 与 BaseURL 同源不变式
 *
 * - 请求头带 x-api-key（BYO 模式）：base/proxy 同样取自请求头
 * - 无请求头 Key（服务端 env Key 模式）：base/proxy **只取服务端 env**
 *   （OPENAI_BASE_URL / OPENAI_PROXY_URL），忽略客户端传入的
 *   x-base-url / x-proxy-url——否则服务端 Key 会被以 Bearer 发往
 *   调用方指定主机，构成凭据外泄（评审 S-1）。
 *
 * 客户端来源的 base/proxy 一律过 url-guard（SSRF 基线，评审 S-2）；
 * 服务端 env 值视为可信，不再校验。
 */
export const DEFAULT_BASE_URL = "https://api.openai.com/v1";

export type UpstreamResult =
  | { ok: true; apiKey: string; baseURL: string; proxyUrl: string; usingServerKey: boolean }
  | { ok: false; errorCode: ErrorCode; reason?: string };

export function resolveUpstream(request: NextRequest): UpstreamResult {
  const headerKey = request.headers.get("x-api-key")?.trim() || "";

  if (headerKey) {
    const baseURL = request.headers.get("x-base-url")?.trim() || DEFAULT_BASE_URL;
    const proxyUrl = request.headers.get("x-proxy-url")?.trim() || "";
    const reason = upstreamUrlError(baseURL) ?? (proxyUrl ? upstreamUrlError(proxyUrl) : null);
    if (reason) {
      return { ok: false, errorCode: "REQ_INVALID_UPSTREAM_URL", reason };
    }
    return { ok: true, apiKey: headerKey, baseURL, proxyUrl, usingServerKey: false };
  }

  // 服务端 Key 模式：base/proxy 只来自服务端 env（trusted）
  return {
    ok: true,
    apiKey: process.env.OPENAI_API_KEY?.trim() || "",
    baseURL: process.env.OPENAI_BASE_URL?.trim() || DEFAULT_BASE_URL,
    proxyUrl: process.env.OPENAI_PROXY_URL?.trim() || "",
    usingServerKey: true,
  };
}
