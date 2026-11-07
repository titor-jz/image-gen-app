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

// 上游请求超时：默认对齐 Vercel maxDuration（60s，见 vercel.json）。
// 本地/自托管部署可用环境变量放宽（如 GEN_TIMEOUT_MS=300000），
// Vercel 上不配置即维持安全默认（评审 S-5）。
const GEN_TIMEOUT_MS = Number(process.env.GEN_TIMEOUT_MS) || 55000;
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

/** 表单工厂：调用方一律用它构造 multipart，不要再直接 import undici 的 FormData */
export function createFormData(): FormData {
  // Node 的全局 FormData 本身就是 undici 实现（spec 一致），两种运行时通用
  return new FormData();
}

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
  body?: FormData | string;
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

export async function httpFormDataRequest(
  urlStr: string,
  form: FormData,
  extraHeaders: Record<string, string> = {},
  proxyUrl?: string
): Promise<HttpResult> {
  return doRequest(urlStr, {
    method: "POST",
    headers: extraHeaders,
    body: form,
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
