export type AspectRatio = "auto" | "1:1" | "16:9" | "9:16" | "4:3" | "3:4";

export type ModelId = "gpt-image-2" | string;

export interface GenerateParams {
  prompt: string;
  model: ModelId;
  size?: AspectRatio;
  quality?: "1k" | "2k" | "4k";
  images?: string[]; // base64 data URLs for multiple reference images
  n?: number; // number of images to generate
}

export interface GenerateResult {
  id: string;
  /** base64 image data（用于持久化到 IndexedDB 与历史回填） */
  b64_json: string;
  /** 内存中的 blob: URL（仅当前会话有效，避免 base64 来回转换） */
  imageUrl?: string;
  /** image mime type */
  mime: string;
  prompt: string;
  model: string;
  size: AspectRatio;
  createdAt: number;
  cost?: number;
  favorite?: boolean;
}

export interface HistoryRecord {
  id: string;
  params: GenerateParams;
  results: GenerateResult[];
  createdAt: number;
}

export interface AppSettings {
  apiKey: string;
  defaultModel: ModelId;
  defaultSize: AspectRatio;
  defaultQuality: "1k" | "2k" | "4k";
  proxyUrl?: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  costPerImage: number;
  supportedSizes: AspectRatio[];
}

export interface BalanceInfo {
  balance: number;
  currency: string;
}
