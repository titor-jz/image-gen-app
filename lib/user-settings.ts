// 临时 lib/user-settings.ts
/**
 * 用户偏好设置（defaultModel / defaultSize / defaultQuality）
 *
 * 与 ApiConfigContext 解耦：这些是 UI 偏好（持久化用户上次选择），
 * 不是鉴权配置。属于纯 localStorage 工具函数，无需 Context 包装。
 */

import type { AppSettings } from "./types";

const SETTINGS_STORAGE_KEY = "image-gen-settings";

/** 读取全部用户偏好（解析失败返回空对象） */
export function getSettings(): Partial<AppSettings> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * 合并保存用户偏好（与已有设置深合并一层）
 */
export function saveSettings(settings: Partial<AppSettings>): void {
  if (typeof window === "undefined") return;
  try {
    const current = getSettings();
    window.localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ ...current, ...settings })
    );
  } catch {
    // 忽略写入失败（隐私模式/QuotaExceeded）
  }
}
