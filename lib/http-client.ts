import https from "https";
import http from "http";
import { Resolver } from "dns";
import net from "net";

// 使用指定 DNS 服务器解析（绕过系统 DNS）
const resolver = new Resolver();
resolver.setServers(["223.5.5.5", "114.114.114.114", "8.8.8.8"]);

// DNS 缓存
const dnsCache = new Map<string, string>();

async function resolveHostname(hostname: string): Promise<string | null> {
  if (dnsCache.has(hostname)) return dnsCache.get(hostname)!;
  try {
    const addresses = await new Promise<string[]>((resolve, reject) => {
      resolver.resolve4(hostname, (err, addrs) => {
        if (err) reject(err);
        else resolve(addrs);
      });
    });
    if (addresses.length > 0) {
      dnsCache.set(hostname, addresses[0]);
      return addresses[0];
    }
  } catch { /* ignore */ }
  return null;
}

export interface HttpResult {
  status: number;
  headers: Record<string, string>;
  body: string;
  bodyBuffer?: Buffer;
}

interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  proxyUrl?: string;
}

// 通过代理建立 HTTPS 隧道连接
function createTunnelSocket(
  proxyHost: string,
  proxyPort: number,
  targetHost: string,
  targetPort: number,
  proxyAuth?: string
): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: proxyHost, port: proxyPort }, () => {
      let authHeader = "";
      if (proxyAuth) {
        authHeader = `Proxy-Authorization: Basic ${Buffer.from(proxyAuth).toString("base64")}\r\n`;
      }
      socket.write(
        `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n` +
        `Host: ${targetHost}:${targetPort}\r\n` +
        authHeader +
        `\r\n`
      );
    });

    let responseBuffer = "";
    socket.on("data", (data) => {
      responseBuffer += data.toString();
      // 检查是否收到完整的 HTTP 响应头
      if (responseBuffer.includes("\r\n\r\n")) {
        const statusLine = responseBuffer.split("\r\n")[0];
        if (statusLine.includes("200")) {
          resolve(socket);
        } else {
          reject(new Error(`Proxy tunnel failed: ${statusLine}`));
          socket.destroy();
        }
      }
    });
    socket.on("error", reject);
  });
}

// 解析代理 URL
function parseProxyUrl(proxyUrl: string): {
  host: string;
  port: number;
  auth?: string;
  isHttps: boolean;
} | null {
  try {
    const parsed = new URL(proxyUrl);
    const auth = parsed.username
      ? `${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password || "")}`
      : undefined;
    return {
      host: parsed.hostname,
      port: parseInt(parsed.port) || (parsed.protocol === "https:" ? 443 : 80),
      auth,
      isHttps: parsed.protocol === "https:",
    };
  } catch {
    return null;
  }
}

// 使用 Node.js 原生 https 模块发请求，支持 IP 直连 + 自定义 Host + 跳过 SSL 验证 + 代理
export async function httpRequest(
  urlStr: string,
  options: RequestOptions = {}
): Promise<HttpResult> {
  const parsed = new URL(urlStr);
  const hostname = parsed.hostname;
  const isTargetHttps = parsed.protocol === "https:";

  let connectHost = hostname;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    const ip = await resolveHostname(hostname);
    if (ip) connectHost = ip;
  }

  const reqHeaders: Record<string, string> = { ...options.headers };
  if (connectHost !== hostname) {
    reqHeaders["Host"] = hostname;
  }

  // 如果有代理，通过代理隧道连接
  if (options.proxyUrl) {
    const proxy = parseProxyUrl(options.proxyUrl);
    if (proxy) {
      const targetPort = parsed.port ? parseInt(parsed.port) : (isTargetHttps ? 443 : 80);

      if (isTargetHttps) {
        // HTTPS 目标：建立 CONNECT 隧道
        const socket = await createTunnelSocket(
          proxy.host, proxy.port, connectHost, targetPort, proxy.auth
        );
        const tlsSocket = (await import("tls")).connect({
          socket,
          servername: hostname,
          rejectUnauthorized: false,
        });

        return new Promise((resolve, reject) => {
          const req = https.request(
            {
              createConnection: () => tlsSocket,
              hostname: connectHost,
              port: targetPort,
              path: parsed.pathname + parsed.search,
              method: options.method || "GET",
              headers: reqHeaders,
              rejectUnauthorized: false,
            },
            (res) => {
              const chunks: Buffer[] = [];
              res.on("data", (chunk) => chunks.push(chunk));
              res.on("end", () => {
                const headers: Record<string, string> = {};
                for (const [k, v] of Object.entries(res.headers)) {
                  if (typeof v === "string") headers[k] = v;
                }
                resolve({
                  status: res.statusCode || 0,
                  headers,
                  body: Buffer.concat(chunks).toString(),
                  bodyBuffer: Buffer.concat(chunks),
                });
              });
            }
          );
          req.on("error", reject);
          if (options.body) req.write(options.body);
          req.end();
        });
      } else {
        // HTTP 目标：直接通过代理发送
        const mod = http;
        return new Promise((resolve, reject) => {
          const req = mod.request(
            {
              hostname: proxy.host,
              port: proxy.port,
              path: urlStr, // 代理需要完整 URL
              method: options.method || "GET",
              headers: {
                ...reqHeaders,
                ...(proxy.auth ? { "Proxy-Authorization": `Basic ${Buffer.from(proxy.auth).toString("base64")}` } : {}),
              },
            },
            (res) => {
              const chunks: Buffer[] = [];
              res.on("data", (chunk) => chunks.push(chunk));
              res.on("end", () => {
                const headers: Record<string, string> = {};
                for (const [k, v] of Object.entries(res.headers)) {
                  if (typeof v === "string") headers[k] = v;
                }
                resolve({
                  status: res.statusCode || 0,
                  headers,
                  body: Buffer.concat(chunks).toString(),
                  bodyBuffer: Buffer.concat(chunks),
                });
              });
            }
          );
          req.on("error", reject);
          if (options.body) req.write(options.body);
          req.end();
        });
      }
    }
  }

  // 无代理：直接连接
  const mod = isTargetHttps ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(
      {
        hostname: connectHost,
        port: parsed.port || (isTargetHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: options.method || "GET",
        headers: reqHeaders,
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (typeof v === "string") headers[k] = v;
          }
          resolve({
            status: res.statusCode || 0,
            headers,
            body: Buffer.concat(chunks).toString(),
            bodyBuffer: Buffer.concat(chunks),
          });
        });
      }
    );
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

// 发送 FormData 请求
export async function httpFormDataRequest(
  urlStr: string,
  form: FormData,
  extraHeaders: Record<string, string> = {},
  proxyUrl?: string
): Promise<HttpResult> {
  const parsed = new URL(urlStr);
  const hostname = parsed.hostname;
  const isTargetHttps = parsed.protocol === "https:";

  let connectHost = hostname;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    const ip = await resolveHostname(hostname);
    if (ip) connectHost = ip;
  }

  const boundary = `----NodeFormData${Math.random().toString(36).slice(2)}`;
  const parts: Buffer[] = [];

  for (const [key, value] of form.entries()) {
    parts.push(Buffer.from(`--${boundary}\r\n`));
    if (typeof value === "string") {
      parts.push(Buffer.from(`Content-Disposition: form-data; name="${key}"\r\n\r\n`));
      parts.push(Buffer.from(`${value}\r\n`));
    } else {
      const file = value as File;
      parts.push(Buffer.from(`Content-Disposition: form-data; name="${key}"; filename="${file.name || key}"\r\n`));
      parts.push(Buffer.from(`Content-Type: ${file.type || "application/octet-stream"}\r\n\r\n`));
      parts.push(Buffer.from(await file.arrayBuffer()));
      parts.push(Buffer.from("\r\n"));
    }
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));

  const body = Buffer.concat(parts);

  const reqHeaders: Record<string, string> = {
    ...extraHeaders,
    "Content-Type": `multipart/form-data; boundary=${boundary}`,
    "Content-Length": String(body.length),
  };
  if (connectHost !== hostname) {
    reqHeaders["Host"] = hostname;
  }

  // 如果有代理
  if (proxyUrl) {
    const proxy = parseProxyUrl(proxyUrl);
    if (proxy) {
      const targetPort = parsed.port ? parseInt(parsed.port) : (isTargetHttps ? 443 : 80);

      if (isTargetHttps) {
        const socket = await createTunnelSocket(
          proxy.host, proxy.port, connectHost, targetPort, proxy.auth
        );
        const tlsSocket = (await import("tls")).connect({
          socket,
          servername: hostname,
          rejectUnauthorized: false,
        });

        return new Promise((resolve, reject) => {
          const req = https.request(
            {
              createConnection: () => tlsSocket,
              hostname: connectHost,
              port: targetPort,
              path: parsed.pathname + parsed.search,
              method: "POST",
              headers: reqHeaders,
              rejectUnauthorized: false,
            },
            (res) => {
              const chunks: Buffer[] = [];
              res.on("data", (chunk) => chunks.push(chunk));
              res.on("end", () => {
                const headers: Record<string, string> = {};
                for (const [k, v] of Object.entries(res.headers)) {
                  if (typeof v === "string") headers[k] = v;
                }
                resolve({
                  status: res.statusCode || 0,
                  headers,
                  body: Buffer.concat(chunks).toString(),
                  bodyBuffer: Buffer.concat(chunks),
                });
              });
            }
          );
          req.on("error", reject);
          req.write(body);
          req.end();
        });
      } else {
        return new Promise((resolve, reject) => {
          const req = http.request(
            {
              hostname: proxy.host,
              port: proxy.port,
              path: urlStr,
              method: "POST",
              headers: {
                ...reqHeaders,
                ...(proxy.auth ? { "Proxy-Authorization": `Basic ${Buffer.from(proxy.auth).toString("base64")}` } : {}),
              },
            },
            (res) => {
              const chunks: Buffer[] = [];
              res.on("data", (chunk) => chunks.push(chunk));
              res.on("end", () => {
                const headers: Record<string, string> = {};
                for (const [k, v] of Object.entries(res.headers)) {
                  if (typeof v === "string") headers[k] = v;
                }
                resolve({
                  status: res.statusCode || 0,
                  headers,
                  body: Buffer.concat(chunks).toString(),
                  bodyBuffer: Buffer.concat(chunks),
                });
              });
            }
          );
          req.on("error", reject);
          req.write(body);
          req.end();
        });
      }
    }
  }

  // 无代理：直接连接
  const mod = isTargetHttps ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(
      {
        hostname: connectHost,
        port: parsed.port || (isTargetHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: reqHeaders,
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (typeof v === "string") headers[k] = v;
          }
          resolve({
            status: res.statusCode || 0,
            headers,
            body: Buffer.concat(chunks).toString(),
            bodyBuffer: Buffer.concat(chunks),
          });
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}
