/**
 * 错误码 → 用户友好文案映射
 *
 * 设计目标：
 *  1. 后端只返回稳定的 error code（永不变化）+ 可选的 details（堆栈、原始 err msg）
 *  2. 前端通过本表查询对应用户文案，统一 i18n
 *  3. 新增错误只需在 ERROR_MESSAGES 中加一行，不需改 API/UI
 *
 * 命名规范：<域>_<场景>，如 AUTH_MISSING_KEY、GEN_UPSTREAM_BAD_RESPONSE
 *
 * i18n 扩展：未来要做多语言时，把 ERROR_MESSAGES 抽成
 *   Record<Lang, Record<ErrorCode, string>> 即可
 */

export type ErrorCode =
  // 通用 / 认证
  | "AUTH_MISSING_KEY"
  | "AUTH_INVALID_KEY"
  | "AUTH_FORBIDDEN"
  | "UNKNOWN"
  // 请求
  | "REQ_BODY_TOO_LARGE"
  | "REQ_BAD_FORMAT"
  | "REQ_MISSING_PROMPT"
  | "REQ_PARSE_FAILED"
  // 上游 API
  | "GEN_UPSTREAM_NETWORK"
  | "GEN_UPSTREAM_BAD_RESPONSE"
  | "GEN_UPSTREAM_NO_TASK_ID"
  | "GEN_UPSTREAM_FAILED"
  | "GEN_INVALID_RESPONSE"
  // 轮询
  | "TASK_POLL_FAILED"
  | "TASK_NO_IMAGE_URL"
  | "TASK_DOWNLOAD_FAILED"
  | "TASK_TIMEOUT"
  | "TASK_FAILED"
  | "TASK_BAD_RESPONSE"
  // 客户端业务
  | "CLIENT_CANCELLED"
  | "CLIENT_INFLIGHT"
  | "CLIENT_CACHE_DECODE";

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
  details?: string;
  status: number;
}

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  // 认证
  AUTH_MISSING_KEY: "请先在设置中配置 API Key",
  AUTH_INVALID_KEY: "API Key 无效或已过期，请前往设置检查",
  AUTH_FORBIDDEN: "API Key 没有访问权限或余额不足",
  UNKNOWN: "未知错误，请稍后重试",

  // 请求
  REQ_BODY_TOO_LARGE: "请求体过大（>20MB），请减小参考图尺寸或使用更低清晰度",
  REQ_BAD_FORMAT: "请求格式错误，请刷新页面重试",
  REQ_MISSING_PROMPT: "请输入提示词",
  REQ_PARSE_FAILED: "请求解析失败，请刷新页面重试",

  // 上游
  GEN_UPSTREAM_NETWORK: "无法连接到上游 API，请检查网络与代理设置",
  GEN_UPSTREAM_BAD_RESPONSE: "上游服务返回了无效响应，请稍后重试",
  GEN_UPSTREAM_NO_TASK_ID: "上游服务未返回任务 ID，请稍后重试",
  GEN_UPSTREAM_FAILED: "上游服务处理失败，请稍后重试",
  GEN_INVALID_RESPONSE: "上游返回的数据无法解析",

  // 轮询
  TASK_POLL_FAILED: "查询任务状态失败",
  TASK_NO_IMAGE_URL: "任务成功但未返回图片地址",
  TASK_DOWNLOAD_FAILED: "下载生成图片失败",
  TASK_TIMEOUT: "生成超时，已停止等待（上游任务可能仍在进行，可点击「继续等待」找回结果）",
  TASK_FAILED: "任务执行失败",
  TASK_BAD_RESPONSE: "查询任务状态时返回无效响应",

  // 客户端
  CLIENT_CANCELLED: "已取消生成",
  CLIENT_INFLIGHT: "已有相同请求在进行中，请等待当前任务完成",
  CLIENT_CACHE_DECODE: "缓存数据损坏，将重新生成",
};

/**
 * 错误码 → HTTP 状态码（API 路由用）
 */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  AUTH_MISSING_KEY: 401,
  AUTH_INVALID_KEY: 401,
  AUTH_FORBIDDEN: 403,
  UNKNOWN: 500,

  REQ_BODY_TOO_LARGE: 413,
  REQ_BAD_FORMAT: 400,
  REQ_MISSING_PROMPT: 400,
  REQ_PARSE_FAILED: 400,

  GEN_UPSTREAM_NETWORK: 502,
  GEN_UPSTREAM_BAD_RESPONSE: 502,
  GEN_UPSTREAM_NO_TASK_ID: 500,
  GEN_UPSTREAM_FAILED: 500,
  GEN_INVALID_RESPONSE: 502,

  TASK_POLL_FAILED: 500,
  TASK_NO_IMAGE_URL: 500,
  TASK_DOWNLOAD_FAILED: 500,
  TASK_TIMEOUT: 504,
  TASK_FAILED: 500,
  TASK_BAD_RESPONSE: 502,

  CLIENT_CANCELLED: 200,
  CLIENT_INFLIGHT: 429,
  CLIENT_CACHE_DECODE: 200,
};

/**
 * 创建标准错误响应（API 路由使用）
 *
 * 用法：
 *   return errorResponse("GEN_UPSTREAM_NETWORK", originalErr.message);
 *   // → { body: ErrorPayload, status: number }
 */
export function errorResponse(
  code: ErrorCode,
  details?: string
): { body: ErrorPayload; status: number } {
  return {
    body: {
      code,
      message: ERROR_MESSAGES[code],
      details,
      status: ERROR_STATUS[code],
    },
    status: ERROR_STATUS[code],
  };
}

/**
 * 解析 API 错误响应（前端用）
 * - 新格式：`{ error: { code, message, details, status } }` → ErrorPayload
 * - 旧格式：`{ error: "string" }` → 包装成 UNKNOWN
 */
export function parseErrorResponse(json: unknown): {
  code: ErrorCode;
  message: string;
  details?: string;
} {
  if (!json || typeof json !== "object") {
    return { code: "UNKNOWN", message: ERROR_MESSAGES.UNKNOWN };
  }
  const err = (json as { error?: unknown }).error;
  if (typeof err === "string") {
    return { code: "UNKNOWN", message: err };
  }
  if (err && typeof err === "object") {
    const payload = err as Partial<ErrorPayload>;
    return {
      code: payload.code || "UNKNOWN",
      message: payload.message || ERROR_MESSAGES.UNKNOWN,
      details: payload.details,
    };
  }
  return { code: "UNKNOWN", message: ERROR_MESSAGES.UNKNOWN };
}

/**
 * 前端消费：根据 code 获取用户文案
 * - 传 details 时会拼接到末尾（如 "上游错误：xxx"）
 */
export function getErrorMessage(
  code: ErrorCode,
  details?: string
): string {
  const base = ERROR_MESSAGES[code] || ERROR_MESSAGES.UNKNOWN;
  if (!details) return base;
  return `${base}（${details}）`;
}
