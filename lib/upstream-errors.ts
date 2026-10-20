/**
 * 上游错误翻译（纯函数，可直测）
 *
 * NewAPI / one-api 系中转的错误原文（"No available compatible accounts" 之类）
 * 对普通用户没有信息量。这里把最常见几类翻译成"原因 + 该去哪儿改"。
 * 只在 details 末尾追加，不改变错误码契约。
 */
export function upstreamErrorHint(message: string): string {
  const m = (message || "").toLowerCase();

  if (m.includes("no available compatible account")) {
    return "该模型在当前节点没有可用的上游渠道（额度用尽或未开通）";
  }
  if (m.includes("not supported model")) {
    return "当前节点不支持这个模型，请在节点的「自定义模型」里填写服务商支持的模型名";
  }
  if (m.includes("model not found") || m.includes("does not exist")) {
    return "模型名不存在，请核对模型 id";
  }
  if (m.includes("insufficient") || m.includes("quota") || m.includes("balance")) {
    return "额度不足，请检查该节点余额";
  }
  if (m.includes("invalid token") || m.includes("unauthorized") || m.includes("invalid api key")) {
    return "API Key 无效或已过期";
  }
  return "";
}

/**
 * 这些错误码表示"连接没建立、请求没发出去"——重试是安全的（不会重复计费）。
 * 不要包含 ECONNRESET / UND_ERR_SOCKET：它们可能发生在请求已发送之后。
 */
const TRANSIENT_CONNECT_CODES = new Set([
  "UND_ERR_CONNECT_TIMEOUT",
  "ECONNREFUSED",
  "ENETUNREACH",
  "EAI_AGAIN",
  "ENOTFOUND",
]);

export function isTransientConnectError(code: string): boolean {
  return TRANSIENT_CONNECT_CODES.has(code);
}
