/**
 * 提示词优化接口的解析（纯函数，可直测）
 *
 * 设计：优化接口是**独立配置**——用户自己填 Base URL / Key / 模型并保存，
 * 不从生图节点里挑（图像专用中转往往没有对话模型，混在一起容易选错）。
 * 只有完全没配置时，才回落到当前生图节点（单节点通用中转的常见情况）。
 */

export interface NodeLike {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  proxyUrl: string;
}

/** 与 lib/api-config-context.tsx 的 OptimizeConfig 结构一致（此处不 import，避免纯函数被客户端模块牵连） */
export interface OptimizeConfigLike {
  baseUrl: string;
  apiKey: string;
  proxyUrl: string;
  model: string;
}

export interface OptimizeEndpoint {
  apiKey: string;
  baseUrl: string;
  proxyUrl: string;
  nodeId: string;
  nodeName: string;
  /** 指定的对话模型（空串 = 服务端自动挑） */
  optimizeModel: string;
}

/**
 * 解析实际使用的优化接口：
 *  1. 独立配置填了 Base URL **且** Key → 用它（只填一半视为未配置）；
 *  2. 否则回落到当前激活节点；
 *  3. 都没有 → 列表第一个；
 *  4. 完全没节点 → null（调用方按未配置处理）。
 */
export function resolveOptimizeEndpoint(
  config: OptimizeConfigLike,
  profiles: NodeLike[],
  activeId: string
): OptimizeEndpoint | null {
  const baseUrl = config.baseUrl.trim();
  const apiKey = config.apiKey.trim();

  if (baseUrl && apiKey) {
    return {
      apiKey,
      baseUrl,
      proxyUrl: config.proxyUrl.trim(),
      nodeId: "custom",
      nodeName: "自定义优化接口",
      optimizeModel: config.model.trim(),
    };
  }

  const node = profiles.find((p) => p.id === activeId) ?? profiles[0];
  if (!node) return null;

  return {
    apiKey: node.apiKey,
    baseUrl: node.baseUrl,
    proxyUrl: node.proxyUrl,
    nodeId: node.id,
    nodeName: node.name,
    optimizeModel: "",
  };
}
