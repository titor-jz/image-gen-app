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
import { useApiConfig } from "@/lib/api-config-context";
import type { ModelInfo } from "@/lib/types";

// 默认兜底模型：当接口失败时仍可继续使用（价格与 /api/models 内置表保持一致）
const FALLBACK_MODELS: ModelInfo[] = [
  {
    id: "gpt-image-2",
    name: "GPT-Image2",
    costPerImage: 0.03,
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
  // API 配置来自 Context：组件挂载时初值为空（SSR/hydration 安全），
  // Context 在自己的 effect 里读取 localStorage 后才有真实值
  const { apiKey, baseUrl, proxyUrl } = useApiConfig();

  // 暴露给 UI 手动重载（如设置页改完 API Key 后重新拉取）；
  // 依赖鉴权三要素，保证每次调用都用最新配置（否则闭包会锁死首次渲染的空值）
  const loadModels = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/models", {
        headers: buildApiHeaders({ apiKey, baseUrl, proxyUrl }),
      });
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
  }, [apiKey, baseUrl, proxyUrl]);

  // 关键时序：Context 的 apiKey 初始为空，读取 localStorage 后状态更新，
  // 依赖 [apiKey, ...] 让本 effect 重新执行、带上鉴权头再拉一次。
  // 之前 deps 为 [] 时，首屏请求发出时 Key 还没就绪，且永不重试，
  // 导致模型列表永远停留在兜底的 gpt-image-2。
  useEffect(() => {
    if (!apiKey) return; // Key 未就绪/未配置时保持兜底列表，不发无鉴权请求
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/models", {
          headers: buildApiHeaders({ apiKey, baseUrl, proxyUrl }),
        });
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
  }, [apiKey, baseUrl, proxyUrl]);

  return { models, loading, reload: loadModels };
}