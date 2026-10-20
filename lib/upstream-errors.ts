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
