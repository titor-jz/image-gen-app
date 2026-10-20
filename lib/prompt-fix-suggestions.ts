/**
 * 上游"提示词限制"的识别与修改建议（纯函数，可直测）
 *
 * 两类最常见：
 *  1. 内容审核（moderation / policy / 违规 / 敏感 …）：上游不会给出完整词表，
 *     只能给"该删什么、怎么替换"的可操作建议；
 *  2. 长度超限（too long / exceeds …）：上游的上限可能比我们的 2000 字更短。
 *
 * 只在错误信息里追加建议，不改错误码契约。
 */

export interface PromptFixAdvice {
  kind: "policy" | "length";
  /** 一句话归类 */
  title: string;
  /** 具体改法（按可操作性排序） */
  tips: string[];
}

const POLICY_HINTS = [
  "moderation",
  "content policy",
  "content_policy",
  "safety system",
  "safety",
  "violat",
  "unsafe",
  "inappropriate",
  "prohibited",
  "审核",
  "违规",
  "敏感",
  "内容政策",
];

const LENGTH_HINTS = [
  "too long",
  "exceeds",
  "exceed",
  "maximum",
  "max length",
  "token limit",
  "context length",
  "prompt is too long",
  "过长",
  "超出",
  "字符数",
  "长度",
];

export function suggestPromptFixes(message: string): PromptFixAdvice | null {
  if (!message) return null;
  const m = message.toLowerCase();

  if (LENGTH_HINTS.some((k) => m.includes(k))) {
    return {
      kind: "length",
      title: "提示词超出上游长度限制",
      tips: [
        "只留「主体 + 场景 + 风格」三要素，删掉重复和堆叠的修饰词",
        "一条特征只说一次，同义描述合并（如「柔和」「温柔」二选一）",
        "先压到 500 字以内试一次；能出图再逐步加回细节",
        "细节太多时，用「优化提示词」让它压缩成更短的一版",
      ],
    };
  }

  if (POLICY_HINTS.some((k) => m.includes(k))) {
    return {
      kind: "policy",
      title: "上游判定为敏感 / 违规内容",
      tips: [
        "去掉真实人名、明星、政治人物与事件，以及暴力血腥、性暗示、未成年相关元素",
        "品牌名、商标、受版权保护的角色名改成通用描述（如「一位宇航员」而不是具体 IP）",
        "用风格/材质/光线描述替代具体作品或画家名（如「水彩质感」）",
        "人像注明「虚构人物」，去掉真实身份特征",
        "删掉「忽略以上规则」这类指令性文字",
        "一次只删一处再试，便于定位到底是哪句触发的",
      ],
    };
  }

  return null;
}
