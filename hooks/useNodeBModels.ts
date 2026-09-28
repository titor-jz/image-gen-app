"use client";

/**
 * useNodeBModels - 对比模式 B 侧模型列表（桌面输入卡与移动 ParamSheet 共用）
 *
 * 从 UnifiedInputCard 抽出（纯搬移）：跨节点对比时按需拉取 B 节点 /api/models，
 * 失败回退当前列表；列表不同源时自动校正 modelB 为第一个可用项。
 */

import { useState, useEffect } from "react";
import { buildApiHeaders } from "@/lib/api-headers";
import { mergeCustomModels } from "@/lib/custom-models";
import type { ApiProfile } from "@/lib/api-config-context";
import type { ModelInfo } from "@/lib/types";

export function useNodeBModels({
  compareMode,
  nodeBProfile,
  activeNodeId,
  modelB,
  onModelBChange,
}: {
  compareMode: boolean;
  nodeBProfile: ApiProfile | null;
  activeNodeId: string;
  modelB: string;
  onModelBChange: (m: string) => void;
}) {
  const isCrossNode = !!nodeBProfile && nodeBProfile.id !== activeNodeId;
  const [modelsB, setModelsB] = useState<ModelInfo[] | null>(null);

  useEffect(() => {
    if (!compareMode || !isCrossNode || !nodeBProfile) {
      // 撤销拉取结果（异步 IIFE 内重置,避免 effect 体同步 setState）
      void (async () => setModelsB(null))();
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/models", {
          headers: buildApiHeaders({
            apiKey: nodeBProfile.apiKey,
            baseUrl: nodeBProfile.baseUrl,
            proxyUrl: nodeBProfile.proxyUrl,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!cancelled && data?.models && Array.isArray(data.models) && data.models.length > 0) {
          const merged = mergeCustomModels(data.models, nodeBProfile.customModels);
          setModelsB(merged);
          // 节点 B 的模型列表与当前选择不同源:若 modelB 不在列表中，自动校正为第一个，
          // 避免下拉显示与实际生成用的模型不一致
          if (!merged.some((m) => m.id === modelB) && merged[0]?.id) {
            onModelBChange(merged[0].id);
          }
        } else if (!cancelled) {
          setModelsB(null);
        }
      } catch {
        if (!cancelled) setModelsB(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [compareMode, isCrossNode, nodeBProfile, modelB, onModelBChange]);

  return { modelsB, isCrossNode };
}
