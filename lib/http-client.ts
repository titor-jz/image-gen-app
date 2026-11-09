/**
 * 运行时自适应 HTTP 客户端
 *
 * 同一套 API 路由要跑在两种运行时上：
 * - Node / Vercel Serverless：undici——连接池 + 放宽建连超时 + ProxyAgent
 *   （x-proxy-url 头的代理透传依赖它，见 AGENTS 架构边界）
 * - Cloudflare Workers（workerd）：undici 的 dispatcher 机制不可用，走全局 fetch；
 *   服务端出海请求从 CF 边缘直连上游（不经墙），proxyUrl 参数在该运行时被忽略。
 *
 * HttpResult 契约对两种运行时完全一致，调用方无感知。
 */

// workerd 运行时检测：workerd 不暴露 WorkerGlobalScope 构造器（浏览器才有，
// typeof/instanceof 检测在部署后恒为假，会误走 undici 分支报 MessagePort 错），
// 用 navigator.userAgent 的官方标识判断——Node 里没有 navigator，同样恒为假
const IS_WORKERS =
  typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";

// 上游请求超时：Vercel 上对齐 maxDuration（60s，见 vercel.json）；
// Workers 上没有函数时长限制（只有 CF 边缘 100s 截断），放宽到 95s——
// 中转无异步端点时同步生成分支要挂住整个生成期（flare 实测 41s，sunburst 更久）。
// 本地/自托管部署可用环境变量放宽（如 GEN_TIMEOUT_MS=300000）。
const GEN_TIMEOUT_MS =
  Number(process.env.GEN_TIMEOUT_MS) || (IS_WORKERS ? 95000 : 55000);
const GET_TIMEOUT_MS = Number(process.env.HTTP_GET_TIMEOUT_MS) || 30000;

// 建连超时：undici 默认 10s，跨境/中转偶发握手挂起会被过早判死（实测同一地址
// 第一次 10s 超时、第二次 861ms 成功）。放宽到 30s，失败由调用方的重试兜底。
const CONNECT_TIMEOUT_MS = Number(process.env.HTTP_CONNECT_TIMEOUT_MS) || 30000;

export interface HttpResult {
  status: number;
  headers: Record<string, string>;
  body: string;
  bodyBuffer?: Buffer;
}

// —— undici 懒加载：仅 Node 运行时 import；Workers 打包后该分支不会执行，
//    也不会在 Workers 上实例化 Node 专属的 Agent/ProxyAgent ——
type UndiciModule = typeof import("undici");
let undiciModulePromise: Promise<UndiciModule> | undefined;
let defaultAgent: import("undici").Agent | undefined;

function loadUndici(): Promise<UndiciModule> {
  undiciModulePromise ??= import("undici");
  return undiciModulePromise;
}

/** multipart 部件：文本字段，或带文件名的二进制部件 */
export type MultipartPart =
  | { name: string; value: string; contentType?: string }
  | { name: string; value: Blob; filename: string; contentType?: string };

function collectResult(
  // 结构化签名：全局 Response（Workers）与 undici Response（Node）都满足
  res: { status: number; headers: { forEach: (fn: (value: string, key: string) => void) => void } },
  arrayBuf: ArrayBuffer
): HttpResult {
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

interface RequestOptions {
  method: "GET" | "POST";
  headers?: Record<string, string>;
  body?: FormData | string | ArrayBuffer;
  proxyUrl?: string;
  timeoutMs: number;
}

async function doRequest(urlStr: string, opts: RequestOptions): Promise<HttpResult> {
  const signal = AbortSignal.timeout(opts.timeoutMs);

  if (!IS_WORKERS) {
    const { Agent, ProxyAgent, fetch: undiciFetch } = await loadUndici();
    defaultAgent ??= new Agent({ connect: { timeout: CONNECT_TIMEOUT_MS } });
    const res = await undiciFetch(
      urlStr,
      {
        method: opts.method,
        headers: opts.headers,
        body: opts.body,
        signal,
        // dispatcher 是 undici 的扩展字段（标准 RequestInit 没有）
        dispatcher: opts.proxyUrl ? new ProxyAgent(opts.proxyUrl) : defaultAgent,
      } as unknown as Parameters<typeof undiciFetch>[1]
    );
    return collectResult(res, await res.arrayBuffer());
  }

  // Workers：全局 fetch。无连接池/代理概念，超时语义相同
  const res = await fetch(urlStr, {
    method: opts.method,
    headers: opts.headers,
    body: opts.body,
    signal,
  });
  return collectResult(res, await res.arrayBuffer());
}

export function httpRequest(
  urlStr: string,
  options: { headers?: Record<string, string>; proxyUrl?: string; timeoutMs?: number } = {}
): Promise<HttpResult> {
  return doRequest(urlStr, {
    method: "GET",
    headers: options.headers,
    proxyUrl: options.proxyUrl,
    timeoutMs: options.timeoutMs ?? GET_TIMEOUT_MS,
  });
}

/**
 * 手写 multipart 编码。
 *
 * 为什么不直接用 FormData：FormData 的文本字段**无法声明 Content-Type**，
 * 而过的中转（NewAPI 系）在部件没有 `charset=utf-8` 时按 latin-1 解码表单字段 ——
 * 中文提示词变乱码，模型收到的是垃圾，表现为「忽略提示词、返回无关内容」。
 *
 * 实测对照（同一张底图、同一个模型）：
 * - 英文提示词：完全正常（红苹果→绿梨，其余不动）
 * - 中文提示词、无 charset：失效（原样不动 / 多出一个马克杯 / 只改背景）
 * - 中文提示词、prompt 部件声明 `text/plain; charset=utf-8`：完全正常
 * 详见 docs/inpaint/PLAN.md。这个问题会让「参考图生图」对中文提示词整体失效。
 */
async function buildMultipart(
  parts: MultipartPart[]
): Promise<{ body: ArrayBuffer; contentType: string }> {
  const boundary = `----imggen${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const pushText = (s: string) => {
    chunks.push(enc.encode(s));
  };
  // 引号/换行会破坏 header 结构，转义掉（正常字段名与文件名不会遇到）
  const esc = (s: string) => s.replace(/"/g, "%22").replace(/[\r\n]/g, " ");

  for (const part of parts) {
    pushText(`--${boundary}\r\n`);
    // 用 `in` 收窄：文本部件没有 filename，二进制部件没有可读的字符串值
    if ("filename" in part) {
      pushText(
        `Content-Disposition: form-data; name="${esc(part.name)}"; filename="${esc(part.filename)}"\r\n`
      );
      pushText(
        `Content-Type: ${part.contentType ?? (part.value.type || "application/octet-stream")}\r\n\r\n`
      );
      chunks.push(new Uint8Array(await part.value.arrayBuffer()));
      pushText("\r\n");
    } else {
      pushText(`Content-Disposition: form-data; name="${esc(part.name)}"\r\n`);
      // 默认给文本字段声明 UTF-8——正是这个头修复了中文提示词被吞的问题
      pushText(`Content-Type: ${part.contentType ?? "text/plain; charset=utf-8"}\r\n\r\n`);
      pushText(part.value);
      pushText("\r\n");
    }
  }
  pushText(`--${boundary}--\r\n`);

  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const body = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    body.set(c, offset);
    offset += c.byteLength;
  }
  return { body: body.buffer, contentType: `multipart/form-data; boundary=${boundary}; charset=utf-8` };
}

/**
 * POST multipart。与 httpFormDataRequest 的区别是**手写编码**，因此能给文本字段
 * 声明 `charset=utf-8`（见 buildMultipart 注释）——带中文提示词的上游请求一律走这里。
 */
export async function httpMultipartRequest(
  urlStr: string,
  parts: MultipartPart[],
  extraHeaders: Record<string, string> = {},
  proxyUrl?: string
): Promise<HttpResult> {
  const { body, contentType } = await buildMultipart(parts);
  return doRequest(urlStr, {
    method: "POST",
    headers: { "Content-Type": contentType, ...extraHeaders },
    body,
    proxyUrl,
    timeoutMs: GEN_TIMEOUT_MS,
  });
}

/**
 * POST JSON（OpenAI 标准格式）。
 * 超时默认 55s：必须低于 Vercel serverless maxDuration（60s，见 vercel.json），
 * 否则同步生图分支会先被平台杀掉，客户端只能看到连接中断。
 * 本地/自托管可用 GEN_TIMEOUT_MS 放宽。
 *
 * timeoutMs：按调用场景覆盖超时（如提示词改写只给 25s，不值得让用户干等 55s）。
 */
export function httpJsonPost(
  urlStr: string,
  body: unknown,
  extraHeaders: Record<string, string> = {},
  proxyUrl?: string,
  timeoutMs?: number
): Promise<HttpResult> {
  return doRequest(urlStr, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
    proxyUrl,
    timeoutMs: timeoutMs ?? GEN_TIMEOUT_MS,
  });
}
