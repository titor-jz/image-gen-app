import type { ModelInfo } from "./types";

/** 自定义模型的默认可选尺寸（与 /api/models 返回的模型保持一致） */
const DEFAULT_SIZES: ModelInfo["supportedSizes"] = [
  "auto",
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
];

/**
 * 把节点手动配置的模型 id 合并进模型列表（去重，追加在末尾）。
 *
 * 用途：上游 /v1/models 不返回、或端点类型识别不到的生图模型
 * （例如挂在 /v1/chat/completions 上的 gpt-image-2.5-flare）。
 */
export function mergeCustomModels(
  models: ModelInfo[],
  customIds: string[] | undefined
): ModelInfo[] {
  if (!customIds || customIds.length === 0) return models;
  const known = new Set(models.map((m) => m.id));
  const extra: ModelInfo[] = [];
  for (const id of customIds) {
    const trimmed = id.trim();
    if (!trimmed || known.has(trimmed)) continue;
    known.add(trimmed);
    extra.push({ id: trimmed, name: trimmed, supportedSizes: DEFAULT_SIZES });
  }
  return extra.length > 0 ? [...models, ...extra] : models;
}
