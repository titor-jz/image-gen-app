/**
 * 错误来源分类（纯函数，可直测）
 *
 * 用户最常问的："这是 App 的问题还是上游服务商的问题？"
 * 错误码本身已经编码了来源，这里翻译成一句人话 + 该去哪儿处理。
 */
import type { ErrorCode } from "@/lib/error-messages";

export type ErrorOrigin = "config" | "prompt" | "network" | "upstream" | "client";

export interface ErrorOriginInfo {
  origin: ErrorOrigin;
  /** 展示用短标签 */
  label: string;
  /** 该去哪儿处理 */
  advice: string;
}

export function classifyErrorCode(code: ErrorCode | null | undefined): ErrorOriginInfo | null {
  if (!code || code === "UNKNOWN") return null;

  if (code.startsWith("AUTH_") || code === "REQ_INVALID_UPSTREAM_URL" || code === "OPT_NO_CHAT_MODEL") {
    return {
      origin: "config",
      label: "本地配置",
      advice: "去设置检查 Key、Base URL、节点与模型",
    };
  }

  if (code.startsWith("REQ_")) {
    return {
      origin: "prompt",
      label: "输入/提示词",
      advice: "按下面的提示修改提示词或参数后重试",
    };
  }

  if (code === "GEN_UPSTREAM_NETWORK") {
    return {
      origin: "network",
      label: "网络 / 上游连接",
      advice: "检查本机网络与代理；上游超时或不通可换节点重试",
    };
  }

  if (
    code.startsWith("GEN_UPSTREAM_") ||
    code.startsWith("TASK_") ||
    code.startsWith("OPT_")
  ) {
    return {
      origin: "upstream",
      label: "上游服务",
      advice: "服务商侧返回的错误：换节点或稍后重试；反复出现请查中转后台的渠道/额度",
    };
  }

  if (code.startsWith("CLIENT_")) {
    return {
      origin: "client",
      label: "本地操作",
      advice: "取消或缓存相关，重试即可",
    };
  }

  return null;
}
