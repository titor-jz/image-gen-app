const API_KEY_STORAGE_KEY = "image-gen-api-key";
const BASE_URL_STORAGE_KEY = "image-gen-base-url";
const PROXY_URL_STORAGE_KEY = "image-gen-proxy-url";
const SETTINGS_STORAGE_KEY = "image-gen-settings";

import type { AppSettings } from "./types";

export function getApiKey(): string {
  return localStorage.getItem(API_KEY_STORAGE_KEY) || "";
}

export function setApiKey(key: string): void {
  localStorage.setItem(API_KEY_STORAGE_KEY, key);
}

export function clearApiKey(): void {
  localStorage.removeItem(API_KEY_STORAGE_KEY);
}

export function getBaseUrl(): string {
  return localStorage.getItem(BASE_URL_STORAGE_KEY) || "";
}

export function setBaseUrl(url: string): void {
  localStorage.setItem(BASE_URL_STORAGE_KEY, url);
}

export function clearBaseUrl(): void {
  localStorage.removeItem(BASE_URL_STORAGE_KEY);
}

export function getProxyUrl(): string {
  return localStorage.getItem(PROXY_URL_STORAGE_KEY) || "";
}

export function setProxyUrl(url: string): void {
  localStorage.setItem(PROXY_URL_STORAGE_KEY, url);
}

export function getSettings(): Partial<AppSettings> {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveSettings(settings: Partial<AppSettings>): void {
  const current = getSettings();
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ ...current, ...settings }));
}
