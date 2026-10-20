import { Agent, ProxyAgent, fetch as undiciFetch, FormData as UndiciFormData, type RequestInit as UndiciRequestInit } from "undici";

// 上游请求超时：默认对齐 Vercel maxDuration（60s，见 vercel.json）。
// 本地/自托管部署可用环境变量放宽（如 GEN_TIMEOUT_MS=300000），
// Vercel 上不配置即维持安全默认（评审 S-5）。
const GEN_TIMEOUT_MS = Number(process.env.GEN_TIMEOUT_MS) || 55000;
const GET_TIMEOUT_MS = Number(process.env.HTTP_GET_TIMEOUT_MS) || 30000;

// 建连超时：undici 默认 10s，跨境/中转偶发握手挂起会被过早判死（实测同一地址
// 第一次 10s 超时、第二次 861ms 成功）。放宽到 30s，失败由调用方的重试兜底。
const CONNECT_TIMEOUT_MS = Number(process.env.HTTP_CONNECT_TIMEOUT_MS) || 30000;

/** 无代理时的默认 dispatcher（连接池 + 放宽建连超时） */
const defaultAgent = new Agent({ connect: { timeout: CONNECT_TIMEOUT_MS } });

function pickDispatcher(proxyUrl?: string) {
  return proxyUrl ? new ProxyAgent(proxyUrl) : defaultAgent;
}

export interface HttpResult {
  status: number;
  headers: Record<string, string>;
  body: string;
  bodyBuffer?: Buffer;
}

export async function httpRequest(
  urlStr: string,
  options: { headers?: Record<string, string>; proxyUrl?: string; timeoutMs?: number } = {}
): Promise<HttpResult> {
  const fetchInit: UndiciRequestInit = {
    method: "GET",
    headers: options.headers,
    signal: AbortSignal.timeout(options.timeoutMs ?? GET_TIMEOUT_MS),
  };
  fetchInit.dispatcher = pickDispatcher(options.proxyUrl);
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
  fetchInit.dispatcher = pickDispatcher(proxyUrl);
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
 *
 * timeoutMs：按调用场景覆盖超时（如提示词改写只给 25s，不值得让用户干等 55s）。
 */
export async function httpJsonPost(
  urlStr: string,
  body: unknown,
  extraHeaders: Record<string, string> = {},
  proxyUrl?: string,
  timeoutMs?: number
): Promise<HttpResult> {
  const fetchInit: UndiciRequestInit = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs ?? GEN_TIMEOUT_MS),
  };
  fetchInit.dispatcher = pickDispatcher(proxyUrl);
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