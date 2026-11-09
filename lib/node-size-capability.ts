/**
 * 节点「清晰度档位」能力记忆（按节点 id 存 localStorage）
 *
 * 动机：用户配了很多 key（= 多个节点），不同 key 能出多大分辨率并不一致 ——
 * 有的只到 1K，有的到 2K/4K。而 4K 探测本身就是一次真实生成（要花钱），
 * 没法免费扫描，所以只能**被动学习**：每次真实生成后记录该节点该档的结果。
 *
 *   supported   —— 实测按请求尺寸出图
 *   degraded    —— 出图但明显小于请求（<90%），基本等于该档不可用
 *   unsupported —— 上游因尺寸报错
 *
 * 未记录的档位 = 未知（UI 显示 ?，不做任何阻断）。
 * checkedAt 超过 7 天视为过期：节点升级/换 key 后自动重新学习。
 */

const STORAGE_KEY = "image-gen-node-size-capabilities";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type SizeTier = "1k" | "2k" | "4k";
export type TierState = "supported" | "degraded" | "unsupported";

export interface TierCapability {
  state: TierState;
  /** 实测出图尺寸（仅 supported/degraded 有） */
  width?: number;
  height?: number;
  checkedAt: number;
}

export type NodeSizeCapability = Partial<Record<SizeTier, TierCapability>>;

function readAll(): Record<string, NodeSizeCapability> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** 读取某节点的档位能力（过滤过期项）；整条都没记录返回 null */
export function getNodeSizeCapability(nodeId: string): NodeSizeCapability | null {
  const entry = readAll()[nodeId];
  if (!entry) return null;
  const now = Date.now();
  const fresh: NodeSizeCapability = {};
  let any = false;
  for (const tier of ["1k", "2k", "4k"] as SizeTier[]) {
    const cap = entry[tier];
    if (cap && now - cap.checkedAt <= TTL_MS) {
      fresh[tier] = cap;
      any = true;
    }
  }
  return any ? fresh : null;
}

/** 记录一次真实生成的结果（成功/降档/尺寸报错都算证据） */
export function recordSizeOutcome(
  nodeId: string,
  tier: SizeTier,
  state: TierState,
  dims?: { width: number; height: number }
): void {
  if (typeof window === "undefined" || !nodeId) return;
  try {
    const all = readAll();
    const entry = all[nodeId] ?? {};
    entry[tier] = {
      state,
      ...(dims ? { width: dims.width, height: dims.height } : {}),
      checkedAt: Date.now(),
    };
    all[nodeId] = entry;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // 隐私模式/配额满：忽略，退化为不记忆
  }
}

/** UI 标记：已知可用 ✓ / 降档 △ / 不可用 ✗ / 未知空 */
export function tierMark(cap?: TierCapability | null): string {
  if (!cap) return "";
  if (cap.state === "supported") return " ✓";
  if (cap.state === "degraded") return " △";
  return " ✗";
}
