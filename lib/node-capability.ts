/**
 * 节点异步能力记忆（按节点 id 存 localStorage）
 *
 * 中转的 async 端点行为参差：真异步（task_id 秒回）、无异步端点（404）、
 * 假异步（挂满整个生成期才回）。生成路由按请求探测 async，探测结果
 * 记忆在这里，后续生成直接走正确路径：
 *  - asyncCapable=true  → 走 async 提交 + 轮询
 *  - asyncCapable=false → 跳过 async（省 404 往返），直接同步流式保活
 *
 * checkedAt 超过 7 天视为过期（返回 null 重新探测）：中转日后升级出
 * 真异步时无需手动清理，一周内自动纠正。
 */

const STORAGE_KEY = "image-gen-node-capabilities";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface NodeCapability {
  /** true=有可用异步端点；false=无端点或假异步（按同步流式处理） */
  asyncCapable: boolean;
  checkedAt: number;
}

function readAll(): Record<string, NodeCapability> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** 读取节点能力；无记录或超过 TTL 返回 null（触发重新探测） */
export function getNodeCapability(nodeId: string): NodeCapability | null {
  const cap = readAll()[nodeId];
  if (!cap) return null;
  if (Date.now() - cap.checkedAt > TTL_MS) return null;
  return cap;
}

export function setNodeCapability(nodeId: string, asyncCapable: boolean): void {
  if (typeof window === "undefined" || !nodeId) return;
  try {
    const all = readAll();
    all[nodeId] = { asyncCapable, checkedAt: Date.now() };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // 忽略写入失败（隐私模式/QuotaExceeded）：退化为每次探测
  }
}
