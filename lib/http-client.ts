import { ProxyAgent, fetch as undiciFetch } from "undici";

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
  const fetchInit: RequestInit & { dispatcher?: unknown } = {
    method: "GET",
    headers: options.headers,
    signal: AbortSignal.timeout(30000),
  };
  if (options.proxyUrl) {
    fetchInit.dispatcher = new ProxyAgent(options.proxyUrl);
  }
  const res = await undiciFetch(urlStr, fetchInit as any);

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
  form: FormData,
  extraHeaders: Record<string, string> = {},
  proxyUrl?: string
): Promise<HttpResult> {
  const fetchInit: RequestInit & { dispatcher?: unknown } = {
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
  const res = await undiciFetch(urlStr, fetchInit as any);

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