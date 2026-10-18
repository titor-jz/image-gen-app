/**
 * 提示词 AI 改写的纯逻辑（无网络、无依赖，可直测）
 *
 * 路线取舍（2026-10 调研后定）：主流产品（Ideogram / Leonardo / Venice / 豆包）都是 LLM 改写，
 * 重点不在"让规则更聪明"，而在给用户控制权与可见性。因此这里只做三件纯事：
 *  1. 构造改写指令（system prompt）——质量的关键全在这段话里；
 *  2. 清洗模型输出——模型经常会擅自加引号/代码围栏/"优化后的提示词："前缀；
 *  3. 从上游 /models 里挑一个对话模型——不能选中图像模型。
 *
 * 网络调用与错误码映射在 app/api/optimize/route.ts。
 */

// ============================================================
// 改写指令
// ============================================================

export interface OptimizeContext {
  /** 当前画幅比例（"auto" 视为未指定） */
  size?: string;
  /** 是否带参考图（图生图） */
  hasReference?: boolean;
  /** 同一提示词的再次优化：上一版结果，用于避免雷同 */
  avoid?: string;
}

/** 送入模型前的输入长度上限（按字符；远超正常提示词，仅防滥用/超费） */
export const MAX_INPUT_CHARS = 2000;

/**
 * 构造 chat/completions 的 messages。
 *
 * 七条约束对应此前实测暴露的问题：改写跟风格打架、补的内容与画面无关、
 * 堆空话、输出夹带解释。改这段话前先想清楚破坏的是哪一条。
 */
export function buildOptimizeMessages(
  input: string,
  ctx: OptimizeContext = {}
): { role: "system" | "user"; content: string }[] {
  const { size, hasReference, avoid } = ctx;

  let system = [
    "你是资深 AI 绘画提示词工程师。用户会给你一句简短的图像描述，请把它改写成更具体、更可执行、更贴合用户意图的生图提示词。",
    "",
    "必须遵守：",
    "1. 守住意图：主体、动作、场景、风格、情绪、色调、构图要求、画面中的文字，一律以用户写的为准。用户写了的风格或情绪（如“极简”“忧郁”“暗黑”“治愈”“扁平”），绝对不能改成相反方向。改写结果必须保留用户原文的主体表述——用户写的“悲伤的少女”仍应出现在结果里（通常作为开头），不能用同义描写整体替换掉主体。",
    "2. 只补画面：补充能被“看到”的具体视觉信息——主体特征、环境细节、光线方向与质感、视角与构图、材质与纹理。",
    "3. 不许编造：原文没有暗示的内容不要凭空新增，尤其不要新增与画面主旨无关的道具、人物、文字。宁可少写，不要跑题。",
    "4. 不许空话：不要出现“8K”“超高清”“超高细节”“大师作品”“最佳质量”“杰作”“获奖作品”这类没有信息量的词。",
    "5. 长度：改写后约为原文的 1.5~2.5 倍，中文控制在 30~120 字；短句、用逗号分隔、读起来自然。如果原文已经超过 200 字，只做精炼与结构化，不要再加内容。",
    "6. 只输出结果：只输出改写后的提示词本身——不要解释、不要加引号、不要 Markdown、不要写“优化后：”之类的前缀。",
    "7. 语言：用户用什么语言，就用什么语言输出。",
  ].join("\n");

  const contextLines: string[] = [];
  if (size && size !== "auto") {
    contextLines.push(`- 画幅：${size}。构图建议要符合这个比例。`);
  }
  if (hasReference) {
    contextLines.push(
      "- 本次是图生图（带参考图）：改写应说明在保留参考图主体与构图的前提下要改变什么（风格/光线/背景），不要重新描述整幅画面。"
    );
  } else {
    contextLines.push("- 本次是文生图（无参考图）：可以完整描述画面。");
  }
  if (avoid) {
    contextLines.push(
      "- 用户想要另一版：下面这版是上次的改写结果，请给出一版不同的，不要与它雷同（主体与风格仍需保持一致）：\n" +
        avoid
    );
  }

  if (contextLines.length > 0) {
    system += `\n\n当前上下文：\n${contextLines.join("\n")}`;
  }

  return [
    { role: "system", content: system },
    { role: "user", content: input.slice(0, MAX_INPUT_CHARS) },
  ];
}

// ============================================================
// 改写计划（纯决策，供 hook 与测试共用）
// ============================================================

export interface OptimizePlan {
  /** 本次改写的基底：用户原文（已 trim；换版时仍是原文，不是在上一版结果上叠加） */
  base: string;
  /** 请求发出时期望输入框里的内容（trim 后）——竞态判断只能拿它比，不能拿 base 比 */
  requestText: string;
  /** 上一版结果：换版时交给模型"不要雷同" */
  avoid?: string;
  /** 本地兜底的版本号（换版时沿用并递增） */
  variant: number;
  /** 当前文本是否就是上一版结果（= 用户连续点了第二次） */
  isReoptimize: boolean;
}

/**
 * 决定"这次点击该以什么为基底、要不要避免雷同"。
 *
 * 关键点：`base` 与 `requestText` 不是一回事。
 *  - base 是改写基底（换版时=原文）；
 *  - requestText 是点击瞬间输入框里的内容（换版时=上一版结果），异步返回后用它判断
 *    "用户是否在等待期间改过文本"。二者混用会让换版永远被判定为"文本已改动"。
 */
export function planOptimize(input: {
  prompt: string;
  lastResult: string | null;
  base: string;
  variant: number;
}): OptimizePlan {
  const current = input.prompt.trim();
  const isReoptimize = input.lastResult !== null && current === input.lastResult;
  const storedBase = input.base.trim();

  return {
    // 兜底：真处于换版态但原文丢了（理论上不可达），退回当前文本，避免发出空提示词
    base: isReoptimize && storedBase ? storedBase : current,
    requestText: current,
    avoid: isReoptimize ? input.lastResult ?? undefined : undefined,
    variant: isReoptimize ? input.variant : 0,
    isReoptimize,
  };
}

// ============================================================
// 画幅白名单（会被拼进 system prompt，必须收敛成已知枚举）
// ============================================================

const VALID_SIZES = new Set(["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "3:1"]);

/** 只接受已知画幅；"auto"/未知/夹带其他文字一律视为未指定（防止拼进指令造成注入） */
export function normalizeSize(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  return VALID_SIZES.has(v) ? v : undefined;
}

// ============================================================
// 输出清洗
// ============================================================

/** 模型跑偏时的句末截断长度（字符）：正常情况下中文 30~120 字，这里只防失控 */
const MAX_OUTPUT_CHARS = 600;

/**
 * 清洗模型输出：去代码围栏、去“优化后：”类前缀、去整体包裹的引号、压成单行。
 * 清洗后为空 → 调用方按 OPT_BAD_RESPONSE 处理。
 */
export function sanitizeOptimizedPrompt(raw: string): string {
  if (typeof raw !== "string") return "";

  let s = raw.trim();

  // 模型常在代码围栏外先写一句解释（"Here is the optimized prompt:"）。先取围栏内容，
  // 有围栏就以围栏内为准；没有再去首尾围栏。
  const fenced = s.match(/```[a-zA-Z]*\s*([\s\S]*?)```/);
  if (fenced && fenced[1].trim()) {
    s = fenced[1].trim();
  } else {
    s = s.replace(/^```[a-zA-Z]*\s*/, "").replace(/\s*```$/, "").trim();
  }

  // 英文引导语前缀（"Here is the optimized prompt:" / "Enhanced prompt:" 等）
  s = s.replace(
    /^(?:here(?:'s| is)[^:\n]*|(?:the )?(?:optimized|enhanced|rewritten) prompt)\s*[:：]\s*/i,
    ""
  );

  // 中文引导语前缀（“优化后：”“改写结果：”“提示词：”“prompt:” 之类）
  s = s.replace(
    /^(?:(?:优化|改写|增强)(?:后)?(?:的)?(?:提示词|结果|版本)?|提示词|prompt)\s*[:：]\s*/i,
    ""
  );

  // 整体包裹的成对引号（含中文引号）
  if (/^["'“”‘’「『].*["'“”‘’」』]$/.test(s)) {
    s = s.slice(1, -1).trim();
  }

  // 换行压成空格（生图提示词单行更稳），再合并多余空格
  s = s.replace(/\s*\n+\s*/g, " ").replace(/[ \t]{2,}/g, " ").trim();

  // 失控输出：在分隔符处截断，避免整段丢弃
  if (s.length > MAX_OUTPUT_CHARS) {
    const cut = s.slice(0, MAX_OUTPUT_CHARS);
    const lastSep = Math.max(cut.lastIndexOf("，"), cut.lastIndexOf("。"), cut.lastIndexOf(", "));
    s = (lastSep > MAX_OUTPUT_CHARS * 0.5 ? cut.slice(0, lastSep) : cut).trim();
  }

  return s;
}

// ============================================================
// 对话模型挑选
// ============================================================

/**
 * 优先使用的对话模型（按顺序匹配，命中即用）。
 * 只放便宜、快、普遍存在于中转的型号；不放开推理系（max_tokens/temperature 兼容性差）。
 */
const PREFERRED_CHAT_MODELS = [
  "gpt-4o-mini",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  "gpt-4o",
  "deepseek-chat",
  "qwen-turbo",
  "qwen-plus",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
  "claude-3-5-haiku",
  "claude-3-haiku",
];

/** 明显不是对话模型的 id 片段（图像/向量/语音/风控/视频/重排） */
const NON_CHAT_HINTS = [
  "image", "dall", "dalle", "banana", "flux", "midjourney", "stable-diffusion", "sd-",
  "embed", "rerank", "moderation", "whisper", "tts", "audio", "speech", "sora", "video",
  "veo", "kling", "seedance", "seedream",
];

/** 是否像一个可用于改写的对话模型（排除图像/向量/语音/风控/视频/重排） */
export function isChatModel(id: string): boolean {
  if (!id) return false;
  const lower = id.toLowerCase();
  return !NON_CHAT_HINTS.some((hint) => lower.includes(hint));
}

/**
 * 从上游 /models 返回的 id 列表里挑一个对话模型。
 * 优先级：偏好名单（按名单顺序）> 第一个非图像/非向量/非语音模型；都没有则 null。
 */
export function pickChatModel(ids: string[]): string | null {
  const list = ids.filter((x): x is string => typeof x === "string" && x.trim() !== "");
  const lower = list.map((x) => x.toLowerCase());

  for (const want of PREFERRED_CHAT_MODELS) {
    const idx = lower.findIndex(
      (id, i) =>
        isChatModel(list[i]) &&
        // 兼容中转只列版本化 id 的情况（gpt-4o-mini-2024-07-18 / vendor/gpt-4o-mini-xxxx）
        (id === want ||
          id.endsWith("/" + want) ||
          id.startsWith(want + "-") ||
          id.includes("/" + want + "-"))
    );
    if (idx >= 0) return list[idx];
  }

  for (let i = 0; i < list.length; i++) {
    if (isChatModel(list[i])) return list[i];
  }

  return null;
}
