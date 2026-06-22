import { ProxyAgent, setGlobalDispatcher } from "undici";

// 全局代理 dispatcher（只设置一次）
let proxyInitialized = false;

function initProxy() {
  if (proxyInitialized) return;
  proxyInitialized = true;

  // 从环境变量读取代理
  const proxyUrl =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy;

  if (proxyUrl) {
    try {
      const agent = new ProxyAgent(proxyUrl);
      setGlobalDispatcher(agent);
    } catch {
      // 忽略无效代理
    }
  }
}

// 初始化代理
initProxy();

// 导出一个包装的 fetch，确保使用代理
export async function proxyFetch(
  url: string,
  options?: RequestInit
): Promise<Response> {
  return fetch(url, options);
}
