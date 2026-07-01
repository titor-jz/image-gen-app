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
  const res = await fetch(urlStr, {
    method: "GET",
    headers: options.headers,
    signal: AbortSignal.timeout(30000),
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

export async function httpFormDataRequest(
  urlStr: string,
  form: FormData,
  extraHeaders: Record<string, string> = {},
  _proxyUrl?: string
): Promise<HttpResult> {
  const res = await fetch(urlStr, {
    method: "POST",
    headers: {
      ...extraHeaders,
    },
    body: form,
    signal: AbortSignal.timeout(55000),
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
