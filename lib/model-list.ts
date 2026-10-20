/**
 * 解析上游 /models 的响应（纯函数，可直测）
 *
 * 模型名必须"同步"自上游，但不同网关的形状不一样，只认 {data:[...]} 会漏掉：
 *  - OpenAI / 多数中转：{ data: [{ id: "gpt-image-2" }] }
 *  - 裸数组：            [{ id: "..." }]
 *  - Google / Vertex 风格：{ models: [{ name: "models/imagen-3.0-generate-002" }] }
 *
 * 返回 null = 结构不认识（调用方按"没拿到列表"处理）；空数组 = 上游确实没有模型。
 */

const MODELS_PREFIX = /^models\//;

export interface ModelEntry {
  /** 裸 id（去掉 Google 风格的 "models/" 前缀） */
  id: string;
  /** 上游声明的端点能力（OpenAI 系中转常见 supported_endpoint_types） */
  endpointTypes: string[];
}

function extractEntries(list: unknown[]): ModelEntry[] {
  const out: ModelEntry[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const rec = item as { id?: unknown; name?: unknown; supported_endpoint_types?: unknown };
    const raw =
      typeof rec.id === "string" ? rec.id : typeof rec.name === "string" ? rec.name : "";
    // Google 风格带 "models/" 前缀，生图接口要的是裸 id
    const id = raw.trim().replace(MODELS_PREFIX, "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const endpointTypes = Array.isArray(rec.supported_endpoint_types)
      ? rec.supported_endpoint_types.filter((t): t is string => typeof t === "string")
      : [];
    out.push({ id, endpointTypes });
  }
  return out;
}

function findList(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as { data?: unknown; models?: unknown };
  if (Array.isArray(obj.data)) return obj.data;
  if (Array.isArray(obj.models)) return obj.models;
  return null;
}

export function parseModelEntries(payload: unknown): ModelEntry[] | null {
  const list = findList(payload);
  return list ? extractEntries(list) : null;
}

export function parseModelIds(payload: unknown): string[] | null {
  const entries = parseModelEntries(payload);
  return entries ? entries.map((e) => e.id) : null;
}
