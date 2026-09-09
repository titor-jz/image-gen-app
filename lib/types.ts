export type AspectRatio = "auto" | "1:1" | "16:9" | "9:16" | "4:3" | "3:4";

export type ModelId = "gpt-image-2" | string;

export interface GenerateParams {
  prompt: string;
  model: ModelId;
  size?: AspectRatio;
  quality?: "1k" | "2k" | "4k";
  images?: string[]; // base64 data URLs for multiple reference images
  n?: number; // number of images to generate
  /** 对比模式的第二个模型（compare 批次入库时记录，历史回填时恢复） */
  modelB?: string;
  /** 对比模式第二个模型所用节点名（仅记录展示，回填不恢复节点选择） */
  nodeBName?: string;
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
  /** 生成该图的 API 节点名（对比跨节点时用于横幅展示；单节点留空） */
  nodeName?: string;
  size: AspectRatio;
  createdAt: number;
  cost?: number;
  favorite?: boolean;
  /** 对比组标识:同值表示这组图是一次多模型对比产生的,用于并排分组展示。单模型生成留空 */
  compareGroup?: string;
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
  /** 默认单次生成图片数量（1~4），未配置时按 1 处理（向后兼容） */
  defaultN?: 1 | 2 | 3 | 4;
}

/**
 * 单个图像生成任务（任务级状态模型）
 *
 * 一次"生成"点击创建 N 个独立 GenTask（每个上游 n=1），并发执行。
 * 每个任务独立追踪状态/进度/取消，是 UI 进度列表与取消按钮的唯一数据源。
 * 跨批次并发：多次点击产生多批任务，共存于 tasks[]，互不阻塞。
 */
export type GenTaskStatus =
  | "submitting" // 已创建，正在 POST /api/generate
  | "polling" // 已拿到 task_id，指数退避轮询中
  | "success" // 成功，result 已就绪
  | "failed" // 上游/轮询/下载失败
  | "cancelled"; // 用户主动取消

export interface GenTask {
  /** 任务唯一 id，格式 task-{ts}-{rand} */
  id: string;
  /** 同一次"生成"点击的任务共享，仅用于 UI 分组展示 */
  batchId: string;
  /** 槽位序号（仅用于该批次内显示 #1/#2…），不影响逻辑 */
  slot: number;
  prompt: string;
  model: string;
  size: string;
  quality: string;
  status: GenTaskStatus;
  /** 进度 0~1（polling 阶段有意义，success 后置 1） */
  progress: number;
  /** 已轮询秒数 */
  elapsedSec: number;
  result?: GenerateResult;
  error?: string;
  /** 上游异步任务 id（submitting 完成后存在） */
  taskId?: string;
  /** 对比组标识(同 GenerateResult.compareGroup),单模型任务留空 */
  compareGroup?: string;
  /** 本任务使用的 API 节点快照（提交时定格；多节点对比时两任务节点不同） */
  node?: {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    proxyUrl: string;
  };
  createdAt: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  supportedSizes: AspectRatio[];
}

export interface BalanceInfo {
  balance: number;
  currency: string;
}
