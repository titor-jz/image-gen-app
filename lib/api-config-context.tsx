"use client";

/**
 * ApiConfigContext - API 鉴权配置的单一数据源
 *
 * 背景：
 *  之前 API Key / BaseUrl / ProxyUrl 通过 lib/api-key.ts 的工具函数直接读写
 *  localStorage，组件各自用 useState + useEffect 同步，导致：
 *   1. Header 的「Key 已配置」绿勾不会在 SettingsDialog 修改后自动更新
 *   2. useImageGeneration 内 getApiKey() 不在 React 订阅体系内
 *   3. 多处「sync setState in effect」触发 lint 错误
 *
 * 方案：
 *  把 apiKey/baseUrl/proxyUrl 三个字段抽到 React Context，通过自定义事件
 *  + 'storage' 事件实现订阅：
 *   - 单一数据源：所有组件读同一份状态
 *   - 响应式：任何组件修改后所有消费方自动重渲染
 *   - SSR 安全：useState lazy init 在客户端首次渲染时同步，避免 hydration mismatch
 *   - 跨标签页：订阅原生 'storage' 事件，B 标签页能感知 A 标签页的修改
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// ============================================================
// localStorage 存储 key（与原 lib/api-key.ts 保持一致，避免迁移）
// ============================================================
const API_KEY_STORAGE_KEY = "image-gen-api-key";
const BASE_URL_STORAGE_KEY = "image-gen-base-url";
const PROXY_URL_STORAGE_KEY = "image-gen-proxy-url";

// 自定义事件名：同标签页内多组件间通知（'storage' 事件只在跨标签页触发）
const CHANGE_EVENT = "image-gen-api-config-change";

export interface ApiConfig {
  /** 当前 API Key（原文，因为是用户自己存的） */
  apiKey: string;
  /** 自定义上游 baseURL */
  baseUrl: string;
  /** 自定义代理 URL */
  proxyUrl: string;
  /** 设置 API Key（同步写 localStorage 并通知订阅者） */
  setApiKey: (key: string) => void;
  /** 设置 Base URL */
  setBaseUrl: (url: string) => void;
  /** 设置代理 URL */
  setProxyUrl: (url: string) => void;
}

const ApiConfigContext = createContext<ApiConfig | null>(null);

// ============================================================
// localStorage 读写工具（内部使用，不导出）
// ============================================================

/** 安全读取 localStorage（容错：SSR/隐私模式返回空字符串） */
function readStorage(key: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

/** 安全写入 localStorage（空值会删除键） */
function writeStorage(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    if (value) {
      window.localStorage.setItem(key, value);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // 忽略写入失败（隐私模式/QuotaExceeded）
  }
}

// ============================================================
// Provider 实现
// ============================================================

export interface ApiConfigProviderProps {
  children: ReactNode;
}

export function ApiConfigProvider({ children }: ApiConfigProviderProps) {
  // 初始值：从 localStorage 同步读取（仅在客户端首次渲染时执行一次）
  // 说明：这是「从外部系统（localStorage）初始化 state」的标准模式，
  //      React 官方文档明确允许 useState 的 lazy init 函数从 localStorage 读。
  const [value, setValue] = useState(() => ({
    apiKey: readStorage(API_KEY_STORAGE_KEY),
    baseUrl: readStorage(BASE_URL_STORAGE_KEY),
    proxyUrl: readStorage(PROXY_URL_STORAGE_KEY),
  }));

  // 订阅 'storage' 事件（跨标签页）+ 自定义事件（同标签页多组件）
  useEffect(() => {
    const refresh = () => {
      setValue({
        apiKey: readStorage(API_KEY_STORAGE_KEY),
        baseUrl: readStorage(BASE_URL_STORAGE_KEY),
        proxyUrl: readStorage(PROXY_URL_STORAGE_KEY),
      });
    };

    const handleStorage = (e: StorageEvent) => {
      // 只关心我们关心的 key
      if (
        e.key === API_KEY_STORAGE_KEY ||
        e.key === BASE_URL_STORAGE_KEY ||
        e.key === PROXY_URL_STORAGE_KEY
      ) {
        refresh();
      }
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener(CHANGE_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(CHANGE_EVENT, refresh);
    };
  }, []);

  // setter 实现：写 localStorage + 广播（同标签页）
  // 跨标签页的 storage 事件由浏览器自动触发
  const setApiKey = useCallback((key: string) => {
    writeStorage(API_KEY_STORAGE_KEY, key);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  const setBaseUrl = useCallback((url: string) => {
    writeStorage(BASE_URL_STORAGE_KEY, url);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  const setProxyUrl = useCallback((url: string) => {
    writeStorage(PROXY_URL_STORAGE_KEY, url);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  // 暴露的 context value（用 useMemo 避免下游不必要的重渲染）
  const ctxValue = useMemo<ApiConfig>(
    () => ({
      apiKey: value.apiKey,
      baseUrl: value.baseUrl,
      proxyUrl: value.proxyUrl,
      setApiKey,
      setBaseUrl,
      setProxyUrl,
    }),
    [value.apiKey, value.baseUrl, value.proxyUrl, setApiKey, setBaseUrl, setProxyUrl]
  );

  return (
    <ApiConfigContext.Provider value={ctxValue}>
      {children}
    </ApiConfigContext.Provider>
  );
}

// ============================================================
// 消费 hook
// ============================================================

/**
 * 消费 API 配置 Context
 *
 * @throws 在 Provider 外调用时抛出错误（防止忘记包裹 Provider）
 */
export function useApiConfig(): ApiConfig {
  const ctx = useContext(ApiConfigContext);
  if (!ctx) {
    throw new Error(
      "useApiConfig must be used within <ApiConfigProvider>. " +
        "Wrap your app root in <ApiConfigProvider> in app/layout.tsx."
    );
  }
  return ctx;
}
