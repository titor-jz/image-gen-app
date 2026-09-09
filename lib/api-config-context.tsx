"use client";

/**
 * ApiConfigContext - API 节点配置的单一数据源（支持多套配置手动切换）
 *
 * 数据结构（localStorage）：
 *  - image-gen-api-profiles: ApiProfile[]（多个节点：名称 + baseUrl + apiKey + proxyUrl）
 *  - image-gen-api-active:   当前激活 profile 的 id
 *
 * 迁移：老版本只有 image-gen-api-key/base-url/proxy-url 三个平铺键。
 * 首次加载时若存在旧键且无 profiles，自动迁移为一个 profile（保持向后兼容），
 * 旧键保留不删（防止旧版本代码回写丢失）。
 *
 * 对下游的兼容：useApiConfig() 仍然暴露 apiKey/baseUrl/proxyUrl 三个字段
 * （取自当前激活的 profile），useImageGeneration / useModels / buildApiHeaders
 * 的消费方式完全不变。
 *
 * 响应式机制：同标签页用自定义事件通知，跨标签页订阅原生 'storage' 事件。
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
// localStorage 存储 key
// ============================================================
const LEGACY_API_KEY = "image-gen-api-key";
const LEGACY_BASE_URL = "image-gen-base-url";
const LEGACY_PROXY_URL = "image-gen-proxy-url";
const PROFILES_STORAGE_KEY = "image-gen-api-profiles";
const ACTIVE_STORAGE_KEY = "image-gen-api-active";

// 自定义事件名：同标签页内多组件间通知（'storage' 事件只在跨标签页触发）
const CHANGE_EVENT = "image-gen-api-config-change";

/** 一个 API 节点配置 */
export interface ApiProfile {
  /** 稳定 id（生成后不变，用于切换/删除定位） */
  id: string;
  /** 节点显示名（如「快快API」「官方」），仅用于 UI 区分 */
  name: string;
  /** 该节点的上游 baseURL（对应 x-base-url） */
  baseUrl: string;
  /** 该节点的 API Key（对应 x-api-key） */
  apiKey: string;
  /** 可选代理（对应 x-proxy-url） */
  proxyUrl: string;
}

export interface ApiConfig {
  /** 当前激活的 profile（无任何配置时为 null） */
  activeProfile: ApiProfile | null;
  /** 全部配置（顺序即 UI 展示顺序） */
  profiles: ApiProfile[];
  /** 当前激活 profile 的 id（无则为空串） */
  activeId: string;
  /** 新增/更新一个 profile（按 id 匹配；无 id 则生成新 profile 并激活），返回最终 id */
  saveProfile: (profile: Omit<ApiProfile, "id"> & { id?: string }) => string;
  /** 删除一个 profile；若删除的是激活项则顺延激活第一个 */
  removeProfile: (id: string) => void;
  /** 切换当前激活的 profile */
  setActiveId: (id: string) => void;
  // ---- 兼容字段：下游 hooks 继续按单配置消费 ----
  /** 当前激活 profile 的 apiKey（等价 activeProfile?.apiKey） */
  apiKey: string;
  baseUrl: string;
  proxyUrl: string;
}

const ApiConfigContext = createContext<ApiConfig | null>(null);

// ============================================================
// localStorage 读写工具（内部使用，不导出）
// ============================================================

function readStorage(key: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

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

function genProfileId(): string {
  return `profile-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** 解析 profiles；坏数据返回空数组 */
function parseProfiles(raw: string): ApiProfile[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list
      .filter((p) => p && typeof p === "object" && typeof p.id === "string")
      .map((p: Partial<ApiProfile>) => ({
        id: p.id as string,
        name: typeof p.name === "string" ? p.name : "",
        baseUrl: typeof p.baseUrl === "string" ? p.baseUrl : "",
        apiKey: typeof p.apiKey === "string" ? p.apiKey : "",
        proxyUrl: typeof p.proxyUrl === "string" ? p.proxyUrl : "",
      }));
  } catch {
    return [];
  }
}

/** 读取全部 profiles，并处理旧版本平铺键的一次性迁移 */
function loadProfiles(): ApiProfile[] {
  let profiles = parseProfiles(readStorage(PROFILES_STORAGE_KEY));
  if (profiles.length === 0) {
    const legacyKey = readStorage(LEGACY_API_KEY);
    const legacyBase = readStorage(LEGACY_BASE_URL);
    const legacyProxy = readStorage(LEGACY_PROXY_URL);
    if (legacyKey || legacyBase || legacyProxy) {
      // 老配置迁移为第一个 profile，激活之。迁移后必须删除旧键：
      // 否则用户删空所有 profile 时，这里的 legacy 检查会再次命中，
      // 已删除的"默认节点"被原样复活（删空操作永远不成功）。
      profiles = [
        {
          id: genProfileId(),
          name: "默认节点",
          baseUrl: legacyBase,
          apiKey: legacyKey,
          proxyUrl: legacyProxy,
        },
      ];
      writeStorage(PROFILES_STORAGE_KEY, JSON.stringify(profiles));
      writeStorage(ACTIVE_STORAGE_KEY, profiles[0].id);
      writeStorage(LEGACY_API_KEY, "");
      writeStorage(LEGACY_BASE_URL, "");
      writeStorage(LEGACY_PROXY_URL, "");
    }
  }
  return profiles;
}

function loadActiveId(profiles: ApiProfile[]): string {
  const active = readStorage(ACTIVE_STORAGE_KEY);
  if (active && profiles.some((p) => p.id === active)) return active;
  return profiles[0]?.id ?? "";
}

/** 序列化 + 广播（写入后所有消费方同步刷新） */
function persist(profiles: ApiProfile[], activeId: string): void {
  writeStorage(PROFILES_STORAGE_KEY, JSON.stringify(profiles));
  writeStorage(ACTIVE_STORAGE_KEY, activeId);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

// ============================================================
// Provider 实现
// ============================================================

export function ApiConfigProvider({ children }: { children: ReactNode }) {
  // 初始值为空：服务端与客户端首帧一致（hydration 安全），挂载后从 localStorage 同步
  const [state, setState] = useState<{ profiles: ApiProfile[]; activeId: string }>({
    profiles: [],
    activeId: "",
  });

  useEffect(() => {
    const refresh = () => {
      const profiles = loadProfiles();
      setState({ profiles, activeId: loadActiveId(profiles) });
    };

    refresh();
    const handleStorage = (e: StorageEvent) => {
      if (
        e.key === PROFILES_STORAGE_KEY ||
        e.key === ACTIVE_STORAGE_KEY ||
        e.key === LEGACY_API_KEY ||
        e.key === LEGACY_BASE_URL ||
        e.key === LEGACY_PROXY_URL
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

  const saveProfile = useCallback(
    (profile: Omit<ApiProfile, "id"> & { id?: string }): string => {
      const profiles = loadProfiles();
      const activeId = loadActiveId(profiles);
      if (profile.id) {
        const idx = profiles.findIndex((p) => p.id === profile.id);
        if (idx >= 0) {
          const next = [...profiles];
          next[idx] = { ...next[idx], ...profile, id: profile.id };
          persist(next, activeId);
          return profile.id;
        }
        // id 未命中：该节点已被（可能是另一标签页）删除。
        // 不能沿用旧 id 走创建分支——那会以相同 id"复活"已删节点，
        // 且已持有该 id 引用的界面会与用户"已删除"的心智冲突。
      }
      const created: ApiProfile = {
        id: genProfileId(),
        name: profile.name,
        baseUrl: profile.baseUrl,
        apiKey: profile.apiKey,
        proxyUrl: profile.proxyUrl,
      };
      // 新建即激活
      persist([...profiles, created], created.id);
      return created.id;
    },
    []
  );

  const removeProfile = useCallback((id: string) => {
    const profiles = loadProfiles();
    const next = profiles.filter((p) => p.id !== id);
    const activeId = loadActiveId(profiles);
    // 删除激活项则顺延到第一个；删空则清空激活
    const nextActive = activeId === id ? (next[0]?.id ?? "") : activeId;
    persist(next, nextActive);
  }, []);

  const setActiveId = useCallback((id: string) => {
    const profiles = loadProfiles();
    if (!profiles.some((p) => p.id === id)) return;
    persist(profiles, id);
  }, []);

  const activeProfile = useMemo(
    () => state.profiles.find((p) => p.id === state.activeId) ?? null,
    [state.profiles, state.activeId]
  );

  const ctxValue = useMemo<ApiConfig>(
    () => ({
      activeProfile,
      profiles: state.profiles,
      activeId: state.activeId,
      saveProfile,
      removeProfile,
      setActiveId,
      // 兼容字段（下游 hooks 按单配置消费，语义不变）
      apiKey: activeProfile?.apiKey ?? "",
      baseUrl: activeProfile?.baseUrl ?? "",
      proxyUrl: activeProfile?.proxyUrl ?? "",
    }),
    [
      activeProfile,
      state.profiles,
      state.activeId,
      saveProfile,
      removeProfile,
      setActiveId,
    ]
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
