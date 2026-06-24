export interface HttpResult {
  status: number;
  headers: Record<string, string>;
  body: string;
  bodyBuffer?: Buffer;
}

// 使用原生 fetch 发送请求（Vercel 环境兼容）
export async function httpRequest(
  urlStr: string,
  options: { headers?: Record<string, string>; proxyUrl?: string } = {}
): Promise<HttpResult> {
  const res = await fetch(urlStr, {
    method: "GET",
    headers: options.headers,
  });

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

// 发送 FormData 请求（使用原生 fetch）
export async function httpFormDataRequest(
  urlStr: string,
  form: FormData,
  extraHeaders: Record<string, string> = {},
  _proxyUrl?: string
): Promise<HttpResult> {
  // 注意：原生 fetch 会自动处理 multipart boundary 和中文文件名编码
  const res = await fetch(urlStr, {
    method: "POST",
    headers: {
      ...extraHeaders,
      // 不要设置 Content-Type，让 fetch 自动设置 multipart boundary
    },
    body: form,
  });

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
