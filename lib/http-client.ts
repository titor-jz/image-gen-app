import { ProxyAgent, fetch as undiciFetch, FormData as UndiciFormData, type RequestInit as UndiciRequestInit } from "undici";

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
    signal: AbortSignal.timeout(30000),
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
    signal: AbortSignal.timeout(55000),
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
 * POST JSON（OpenAI 标准格式）。同步生图耗时较长，超时放宽到 120s。
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
    signal: AbortSignal.timeout(120000),
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