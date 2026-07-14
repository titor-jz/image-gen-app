// 临时 lib/api-headers.ts
/**
 * API 请求头构造工具
 *
 * 把鉴权配置显式作为入参传入，避免与 Context 产生循环依赖，
 * 也让纯函数语义保持纯粹（不读外部状态）。
 */

export interface ApiConfigInput {
  apiKey?: string;
  baseUrl?: string;
  proxyUrl?: string;
}

/**
 * 构造透传给后端 /api/* 路由的请求头
 * - x-api-key: 客户端 localStorage 中的 API Key
 * - x-base-url: 自定义上游 baseURL
 * - x-proxy-url: 自定义代理 URL
 *
 * 未配置时省略对应字段，避免发送空值
 */
export function buildApiHeaders(config: ApiConfigInput = {}): Record<string, string> {
  const headers: Record<string, string> = {};
  if (config.apiKey) headers["x-api-key"] = config.apiKey;
  if (config.baseUrl) headers["x-base-url"] = config.baseUrl;
  if (config.proxyUrl) headers["x-proxy-url"] = config.proxyUrl;
  return headers;
}
