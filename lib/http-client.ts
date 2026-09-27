import { ProxyAgent, fetch as undiciFetch, FormData as UndiciFormData, type RequestInit as UndiciRequestInit } from "undici";

// 上游请求超时：默认对齐 Vercel maxDuration（60s，见 vercel.json）。
// 本地/自托管部署可用环境变量放宽（如 GEN_TIMEOUT_MS=300000），
// Vercel 上不配置即维持安全默认（评审 S-5）。
const GEN_TIMEOUT_MS = Number(process.env.GEN_TIMEOUT_MS) || 55000;
const GET_TIMEOUT_MS = Number(process.env.HTTP_GET_TIMEOUT_MS) || 30000;

export interface HttpResult {
  status: number;
  headers: Record<string, string>;
  body: string;
  bodyBuffer?: Buffer;
}

export async function httpRequest(
  urlStr: string,
  options: { headers?: Record<string, string>; proxyUrl?: string } = {}
): Promise<HttpResult> {
  const fetchInit: UndiciRequestInit = {
    method: "GET",
    headers: options.headers,
    signal: AbortSignal.timeout(GET_TIMEOUT_MS),
  };
  if (options.proxyUrl) {
    fetchInit.dispatcher = new ProxyAgent(options.proxyUrl);
  }
  const res = await undiciFetch(urlStr, fetchInit);

  const arrayBuf = await res.arrayBuffer();
  const buf = Buffer.from(arrayBuf);
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => { headers[k] = v; });

  return {
    status: res.status,
    headers,
    body: buf.toString("utf-8"),
    bodyBuffer: buf,
  };
}

export async function httpFormDataRequest(
  urlStr: string,
  form: UndiciFormData,
  extraHeaders: Record<string, string> = {},
  proxyUrl?: string
): Promise<HttpResult> {
  const fetchInit: UndiciRequestInit = {
    method: "POST",
    headers: {
      ...extraHeaders,
    },
    body: form,
    signal: AbortSignal.timeout(GEN_TIMEOUT_MS),
  };
  if (proxyUrl) {
    fetchInit.dispatcher = new ProxyAgent(proxyUrl);
  }
  const res = await undiciFetch(urlStr, fetchInit);

  const arrayBuf = await res.arrayBuffer();
  const buf = Buffer.from(arrayBuf);
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => { headers[k] = v; });

  return {
    status: res.status,
    headers,
    body: buf.toString("utf-8"),
    bodyBuffer: buf,
  };
}

/**
 * POST JSON（OpenAI 标准格式）。
 * 超时默认 55s：必须低于 Vercel serverless maxDuration（60s，见 vercel.json），
 * 否则同步生图分支会先被平台杀掉，客户端只能看到连接中断。
 * 本地/自托管可用 GEN_TIMEOUT_MS 放宽。
 */
export async function httpJsonPost(
  urlStr: string,
  body: unknown,
  extraHeaders: Record<string, string> = {},
  proxyUrl?: string
): Promise<HttpResult> {
  const fetchInit: UndiciRequestInit = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(GEN_TIMEOUT_MS),
  };
  if (proxyUrl) {
    fetchInit.dispatcher = new ProxyAgent(proxyUrl);
  }
  const res = await undiciFetch(urlStr, fetchInit);

  const arrayBuf = await res.arrayBuffer();
  const buf = Buffer.from(arrayBuf);
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => { headers[k] = v; });

  return {
    status: res.status,
    headers,
    body: buf.toString("utf-8"),
    bodyBuffer: buf,
  };
}