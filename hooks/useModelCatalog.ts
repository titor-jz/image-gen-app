"use client";

/**
 * useModelCatalog - 跨节点模型目录聚合
 *
 * 并发拉取所有节点的 /api/models，聚合成「模型 → 有它的节点列表」目录：
 *  - 节点列表顺序 = 优先级（同名模型时靠前节点优先）
 *  - key 失效/超时的节点本轮排除，状态记录在 nodeStatus 供设置页提示
 *  - 合并每节点的 customModels（自定义模型归属其节点）
 *
 * 刷新时机：节点配置变化（id/baseUrl/key 任一）或手动 reload。
 * 消费方：page.tsx 解析「选中模型 → 实际节点」路由；UnifiedInputCard 只拿聚合列表。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildApiHeaders } from "@/lib/api-headers";
import { mergeCustomModels } from "@/lib/custom-models";
import type { ModelInfo } from "@/lib/types";
import type { ApiProfile } from "@/lib/api-config-context";

export interface CatalogEntry {
  modelId: string;
  /** 展示名（跨节点同名时取第一个节点给的名字） */
  name: string;
  /** 提供该模型的节点 id，按节点列表顺序（= 优先级） */
  nodes: string[];
}

export interface CatalogNodeStatus {
  nodeId: string;
  nodeName: string;
  status: "ok" | "error";
  /** 失败原因（401/超时/网络），设置页与模型行重试提示用 */
  error?: string;
}

/** 兜底目录：目录未加载/全部失败时保持首屏模型名可见（与 useModels 的兜底一致） */
const FALLBACK_CATALOG: CatalogEntry[] = [
  { modelId: "gpt-image-2", name: "GPT-Image2", nodes: [] },
];

export interface UseModelCatalogResult {
  /** 聚合目录（去重，节点顺序即优先级） */
  catalog: CatalogEntry[];
  /** 各节点本轮拉取状态 */
  nodeStatus: CatalogNodeStatus[];
  loading: boolean;
  /** 任一节点拉取失败（模型行重试提示用） */
  hasError: boolean;
  reload: () => Promise<void>;
}

/** 单节点拉取超时：节点多时并发进行，总耗时≈最慢者 */
const PER_NODE_TIMEOUT_MS = 8000;

/** 节点配置签名：任一变化才重新拉取（避免每次渲染重复请求） */
function profileSignature(profiles: ApiProfile[]): string {
  return profiles.map((p) => `${p.id}|${p.baseUrl}|${p.apiKey}|${p.proxyUrl ?? ""}`).join("§");
}

async function fetchNodeModels(profile: ApiProfile): Promise<ModelInfo[]> {
  const res = await fetch("/api/models", {
    headers: buildApiHeaders({
      apiKey: profile.apiKey,
      baseUrl: profile.baseUrl,
      proxyUrl: profile.proxyUrl,
    }),
    signal: AbortSignal.timeout(PER_NODE_TIMEOUT_MS),
  });
  const data = await res.json().catch(() => null);
  const list = data?.models;
  if (!Array.isArray(list) || list.length === 0) return [];
  return list
    .filter((m): m is ModelInfo => typeof m?.id === "string" && m.id.length > 0)
    .map((m) => ({ ...m, name: m.name || m.id }));
}

export function useModelCatalog(profiles: ApiProfile[]): UseModelCatalogResult {
  const [catalog, setCatalog] = useState<CatalogEntry[]>(FALLBACK_CATALOG);
  const [nodeStatus, setNodeStatus] = useState<CatalogNodeStatus[]>([]);
  const [loading, setLoading] = useState(false);
  /** 防止 effect 重入期间过期结果覆盖新结果 */
  const runIdRef = useRef(0);

  // 只启用有 Key 的节点：无 Key 节点既拉不到模型也无法出图
  const usable = useMemo(() => profiles.filter((p) => p.apiKey), [profiles]);
  const signature = profileSignature(usable);

  const load = useCallback(async () => {
    if (usable.length === 0) {
      setCatalog(FALLBACK_CATALOG);
      setNodeStatus([]);
      return;
    }
    const runId = ++runIdRef.current;
    setLoading(true);
    // 每个节点的结果先落位，再统一聚合（保持节点顺序语义）
    const results = await Promise.all(
      usable.map(async (profile): Promise<CatalogNodeStatus & { models: ModelInfo[] }> => {
        try {
          const models = await fetchNodeModels(profile);
          return {
            nodeId: profile.id,
            nodeName: profile.name || profile.id,
            status: "ok",
            models: mergeCustomModels(models, profile.customModels),
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : "网络请求失败";
          return {
            nodeId: profile.id,
            nodeName: profile.name || profile.id,
            status: "error",
            error: msg,
            models: [],
          };
        }
      })
    );
    if (runId !== runIdRef.current) return; // 已有更新的拉取，丢弃过期结果

    // 聚合：ModelInfo 去重按 modelId（跨节点同名合并，nodes 记录全部来源）
    const byModel = new Map<string, CatalogEntry>();
    const statuses: CatalogNodeStatus[] = [];
    results.forEach((r) => {
      statuses.push({
        nodeId: r.nodeId,
        nodeName: r.nodeName,
        status: r.status,
        error: r.error,
      });
      r.models.forEach((m) => {
        const entry = byModel.get(m.id);
        if (entry) {
          if (!entry.nodes.includes(r.nodeId)) entry.nodes.push(r.nodeId);
        } else {
          byModel.set(m.id, { modelId: m.id, name: m.name || m.id, nodes: [r.nodeId] });
        }
      });
    });

    // 全部节点失败时保留兜底目录（与 useModels 行为一致），部分成功用真实目录
    setCatalog(statuses.some((s) => s.status === "ok") ? [...byModel.values()] : FALLBACK_CATALOG);
    setNodeStatus(statuses);
    setLoading(false);
  }, [usable]);

  useEffect(() => {
    // 拉取属「同步外部系统」合法副作用；依赖用配置签名而非 load 引用（runIdRef 防重入）
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 见上
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 签名已含全部配置变化来源
  }, [signature]);

  const hasError = nodeStatus.some((s) => s.status === "error");

  const reload = useCallback(async () => {
    await load();
  }, [load]);

  return { catalog, nodeStatus, loading, hasError, reload };
}
