/**
 * 提示词优化节点的解析（纯函数，可直测）
 *
 * 背景：图像专用中转（如只提供 /images/* 的 NewAPI 系）往往没有对话模型，
 * 而节点列表里可能有另一个通用中转。用户在设置里指定"提示词优化节点"后，
 * 改写请求走该节点，生图仍走当前激活节点——两套 Key 互不影响。
 */

export interface NodeLike {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  proxyUrl: string;
  /** 该节点用于「优化提示词」的对话模型（空 = 由服务端自动挑） */
  optimizeModel?: string;
}

export interface OptimizeEndpoint {
  apiKey: string;
  baseUrl: string;
  proxyUrl: string;
  nodeId: string;
  nodeName: string;
  /** 指定的对话模型（空串 = 自动挑） */
  optimizeModel: string;
}

/**
 * 解析实际使用哪个节点：
 *  1. 用户指定的优化节点（仍存在时）；
 *  2. 否则回落到当前激活节点；
 *  3. 都没有则取列表第一个；
 *  4. 列表为空 → null（调用方按未配置处理）。
 */
export function resolveOptimizeEndpoint(
  profiles: NodeLike[],
  preferredId: string | undefined,
  activeId: string
): OptimizeEndpoint | null {
  const node =
    (preferredId ? profiles.find((p) => p.id === preferredId) : undefined) ??
    profiles.find((p) => p.id === activeId) ??
    profiles[0];

  if (!node) return null;

  return {
    apiKey: node.apiKey,
    baseUrl: node.baseUrl,
    proxyUrl: node.proxyUrl,
    nodeId: node.id,
    nodeName: node.name,
    optimizeModel: node.optimizeModel ?? "",
  };
}
