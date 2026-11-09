/**
 * 节点「清晰度档位」能力记忆（按节点 id 存 localStorage）
 *
 * 动机：用户配了很多 key（= 多个节点），不同 key 能出多大分辨率并不一致 ——
 * 有的只到 1K，有的到 2K/4K。而 4K 探测本身就是一次真实生成（要花钱），
 * 没法免费扫描，所以只能**被动学习**：每次真实生成后记录该节点该档的结果。
 *
 *   supported   —— 实测按请求尺寸出图
 *   degraded    —— 出图了，但明显小于请求（<90%）：该档算「给不到」，不算「给不了」
 *   unsupported —— 上游因尺寸报错
 *
 * 未记录的档位 = 未知（UI 不显示标记，也不做任何阻断）。
 * checkedAt 超过 7 天视为过期：节点升级/换 key 后自动重新学习。
 */

const STORAGE_KEY = "image-gen-node-size-capabilities";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type SizeTier = "1k" | "2k" | "4k";
export type TierState = "supported" | "degraded" | "unsupported";

/** 档位由低到高。单调推断与「最高可用档」都依赖这个顺序，只在这里定义一次 */
export const TIER_ORDER: readonly SizeTier[] = ["1k", "2k", "4k"];

export interface TierCapability {
  state: TierState;
  /** 实测出图尺寸（仅 supported/degraded 有） */
  width?: number;
  height?: number;
  /** true = 由相邻档位推断（不是实测），UI 上要能区分 */
  inferred?: boolean;
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

function isFresh(cap: TierCapability | undefined, now: number): boolean {
  return !!cap && now - cap.checkedAt <= TTL_MS;
}

/** 读取某节点的档位能力（过滤过期项）；整条都没记录返回 null */
export function getNodeSizeCapability(nodeId: string): NodeSizeCapability | null {
  const entry = readAll()[nodeId];
  if (!entry) return null;
  const now = Date.now();
  const fresh: NodeSizeCapability = {};
  let any = false;
  for (const tier of TIER_ORDER) {
    const cap = entry[tier];
    if (isFresh(cap, now)) {
      fresh[tier] = cap as TierCapability;
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
    const now = Date.now();
    entry[tier] = {
      state,
      ...(dims ? { width: dims.width, height: dims.height } : {}),
      inferred: false,
      checkedAt: now,
    };

    // 单调推断：分辨率是包含关系，不必每档都花一次生成去试
    //  - 某档能出 → 更低档也能出（低分辨率不会比高分辨率更难）
    //  - 某档给不到/给不了 → 更高档更不可能
    // 这是上游的普遍行为，不是白纸黑字的契约，所以推断值一律带 inferred 标记，
    // 且**未来任何一次实测都能覆盖它**。
    const idx = TIER_ORDER.indexOf(tier);

    // 向下传播「可用」：连低档那条**矛盾**的实测也一起改掉——
    // 「4K 实测可用」比「1K 之前失败过」是更强的证据，否则界面会同时显示
    // 「可用至 4K」和「1K 此档失败过」。实测可用且带尺寸的保留原样。
    const fillDownSupported = (target: SizeTier) => {
      const cur = entry[target];
      if (cur && !cur.inferred && isFresh(cur, now) && cur.state === "supported") return;
      entry[target] = { state: "supported", inferred: true, checkedAt: now };
    };
    // 向上传播「给不到」：只填空缺/推断/过期，不覆盖尚未过期的实测
    // （实测「4K 可用」比「1K 失败」强，不能被反过来降级）
    const fillUp = (target: SizeTier, nextState: TierState) => {
      const cur = entry[target];
      if (cur && !cur.inferred && isFresh(cur, now)) return;
      entry[target] = { state: nextState, inferred: true, checkedAt: now };
    };

    if (state === "supported") {
      for (let i = 0; i < idx; i++) fillDownSupported(TIER_ORDER[i]);
    } else if (state === "degraded") {
      // 降档 ≠ 不支持：出图偏小通常意味着更高档也会被压，但档位本身还「能给」
      for (let i = idx + 1; i < TIER_ORDER.length; i++) fillUp(TIER_ORDER[i], "degraded");
    } else {
      for (let i = idx + 1; i < TIER_ORDER.length; i++) fillUp(TIER_ORDER[i], "unsupported");
    }

    all[nodeId] = entry;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // 隐私模式/配额满：忽略，退化为不记忆
  }
}

/**
 * 一句话概括该节点能用到哪一档：
 * 分辨率是包含关系，所以「最高可用档」就够表达了，不必逐档打勾
 * （下拉里打勾会跟「当前选中项」的勾混淆）。
 *
 * 实测与推断必须分开说 —— 推断值可能是错的。
 */
export function capabilitySummary(cap: NodeSizeCapability | null | undefined): string {
  if (!cap) return "";
  let best: SizeTier | null = null;
  for (const t of TIER_ORDER) {
    if (cap[t]?.state === "supported") best = t;
  }
  if (best) {
    return cap[best]?.inferred
      ? `推断可用至 ${best.toUpperCase()}`
      : `实测可用至 ${best.toUpperCase()}`;
  }
  // 没有可用档：区分「出图偏小」和「压根出不了」——后者才是真的不可用
  if (TIER_ORDER.some((t) => cap[t]?.state === "degraded")) return "实测出图偏小";
  if (TIER_ORDER.some((t) => cap[t])) return "实测各档均被拒";
  return "";
}
