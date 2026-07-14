"use client";

/**
 * useModels - 加载可用模型列表
 *
 * 从 /api/models 拉取可用模型，失败时回退到默认模型 gpt-image-2。
 * 通过 buildApiHeaders() 透传 x-api-key/x-base-url/x-proxy-url 给后端。
 *
 * 注意：异步 setState 放在 IIFE 回调中而非 effect 主体，避免
 * react-hooks/set-state-in-effect 警告。
 */

import { useCallback, useEffect, useState } from "react";
import { buildApiHeaders } from "@/lib/api-headers";
import type { ModelInfo } from "@/lib/types";

// 默认兜底模型：当接口失败时仍可继续使用
const FALLBACK_MODELS: ModelInfo[] = [
  {
    id: "gpt-image-2",
    name: "GPT-Image2",
    costPerImage: 0,
    supportedSizes: ["auto", "1:1", "16:9", "9:16", "4:3", "3:4"],
  },
];

export interface UseModelsResult {
  models: ModelInfo[];
  loading: boolean;
  reload: () => Promise<void>;
}

export function useModels(): UseModelsResult {
  const [models, setModels] = useState<ModelInfo[]>(FALLBACK_MODELS);
  const [loading, setLoading] = useState(false);

  // 暴露给 UI 手动重载（如设置页改完 API Key 后重新拉取）
  const loadModels = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/models", { headers: buildApiHeaders() });
      const data = await res.json();
      if (data?.models && Array.isArray(data.models) && data.models.length > 0) {
        setModels(data.models);
      } else {
        setModels(FALLBACK_MODELS);
      }
    } catch {
      setModels(FALLBACK_MODELS);
    } finally {
      setLoading(false);
    }
  }, []);

  // 挂载时拉取一次；用 cancelled 标志避免 StrictMode 双调用
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/models", { headers: buildApiHeaders() });
        if (cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        if (data?.models && Array.isArray(data.models) && data.models.length > 0) {
          setModels(data.models);
        } else {
          setModels(FALLBACK_MODELS);
        }
      } catch {
        if (cancelled) return;
        setModels(FALLBACK_MODELS);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { models, loading, reload: loadModels };
}