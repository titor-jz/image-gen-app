"use client";

/**
 * usePromptOptimize - 「AI 优化提示词」的交互逻辑
 *
 * 主路径：POST /api/optimize → 用节点上游的对话模型改写（无状态透传，见 app/api/optimize/route.ts）。
 * 失败时 **fail-open**：不改动原文，toast 说明原因；要不要退回本地规则**由用户点 toast 里的
 * 「用本地规则」决定**——不静默降级到已知不贴合的模板输出（这是 2026-10 首轮实测的教训）。
 *
 * 文本记账：
 *  - 记住「原文」与「上次产物」：连点第二次以原文为基底换一版，并把上一版交给模型避免雷同；
 *  - 撤销目标始终是原文；
 *  - 请求期间用户改了文本框 → 丢弃本次结果，避免把刚敲的字冲掉。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { buildApiHeaders } from "@/lib/api-headers";
import { getErrorMessage, parseErrorResponse } from "@/lib/error-messages";
import { enhancePrompt } from "@/lib/prompt-enhancer";
import { planOptimize } from "@/lib/prompt-optimizer";

/** 固定 id：连点时替换同一条 toast，避免堆叠（撤销目标始终是原文，替换无副作用） */
const TOAST_ID = "prompt-optimize";

export function usePromptOptimize({
  prompt,
  onPromptChange,
  apiKey,
  baseUrl,
  proxyUrl,
  size,
  hasReference,
  optimizeModel,
}: {
  prompt: string;
  onPromptChange: (v: string) => void;
  /** 当前激活节点的透传配置（BYO：从 localStorage 经请求头带到服务端） */
  apiKey: string;
  baseUrl: string;
  proxyUrl: string;
  /** 当前画幅（auto 视为未指定），帮助模型给出合适的构图 */
  size?: string;
  /** 是否带参考图（图生图时改写策略不同） */
  hasReference?: boolean;
  /** 节点设置里钉死的对话模型（空 = 服务端自动挑） */
  optimizeModel?: string;
}) {
  const [loading, setLoading] = useState(false);
  /** 优化前原文（撤销目标） */
  const baseRef = useRef("");
  /** 上次优化产物：用于识别"当前文本就是我生成的"，从而连点换稿而不是层层叠加 */
  const lastResultRef = useRef<string | null>(null);
  /** 本地规则的版本轮换计数（仅兜底用） */
  const variantRef = useRef(0);
  /** 请求在途标记：双保险（loading 状态对快速连点不够及时） */
  const inFlightRef = useRef(false);
  /** 上次成功使用的对话模型：下次直接指定，省掉服务端探测 /models 与逐个试模型的开销 */
  const modelRef = useRef<string | undefined>(undefined);
  /** 请求期间检测用户是否改了文本（用 ref 读最新值，避免闭包旧值） */
  const promptRef = useRef(prompt);
  useEffect(() => {
    promptRef.current = prompt;
  }, [prompt]);

  // 换了节点（Key/BaseURL/代理任一变化）→ 上次成功的模型名属于旧节点，不能再钉住
  useEffect(() => {
    modelRef.current = undefined;
  }, [apiKey, baseUrl, proxyUrl]);

  const undo = useCallback(() => {
    lastResultRef.current = null;
    onPromptChange(baseRef.current);
  }, [onPromptChange]);

  const applyLocal = useCallback(
    (base: string, variant: number) => {
      const { text, added } = enhancePrompt(base, variant);
      variantRef.current = variant + 1;
      if (added === 0) {
        toast.info("提示词已经足够完整，未做改动", { id: TOAST_ID });
        return;
      }
      baseRef.current = base;
      lastResultRef.current = text;
      onPromptChange(text);
      toast.success(`已用本地规则优化（补充 ${added} 处细节）`, {
        id: TOAST_ID,
        duration: 6000,
        action: { label: "撤销", onClick: undo },
      });
    },
    [onPromptChange, undo]
  );

  const optimize = useCallback(async () => {
    if (!prompt.trim() || inFlightRef.current) return;

    // 决策（基底/换版/avoid/竞态期望文本）全部交给纯函数，见 planOptimize 的注释
    const plan = planOptimize({
      prompt,
      lastResult: lastResultRef.current,
      base: baseRef.current,
      variant: variantRef.current,
    });
    if (!plan.base) return;

    inFlightRef.current = true;
    setLoading(true);
    try {
      const res = await fetch("/api/optimize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...buildApiHeaders({ apiKey, baseUrl, proxyUrl }),
        },
        body: JSON.stringify({
          prompt: plan.base,
          size,
          hasReference,
          avoid: plan.avoid,
          // 节点里钉死的模型优先；否则用上次成功的（省探测）
          model: optimizeModel || modelRef.current,
        }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        const err = parseErrorResponse(data);
        // 失败后不再钉住模型：下次重新探测（节点/模型可能刚好换过）
        modelRef.current = undefined;
        toast.error(err.message, {
          id: TOAST_ID,
          duration: 10000,
          // 把上游/网络的真实原因带上，否则只剩一句"请稍后重试"没法排查
          description:
            err.code === "OPT_NO_CHAT_MODEL"
              ? "已保留原文。请在设置里配置「提示词优化接口」（Base URL / Key / 模型）"
              : [err.details, "已保留原文"].filter(Boolean).join(" · "),
          action: { label: "用本地规则", onClick: () => applyLocal(plan.base, plan.variant) },
        });
        return;
      }

      if (typeof data?.model === "string" && data.model) {
        modelRef.current = data.model;
      }

      const optimized = typeof data?.prompt === "string" ? data.prompt.trim() : "";
      if (!optimized) {
        toast.error(getErrorMessage("OPT_BAD_RESPONSE"), {
          id: TOAST_ID,
          duration: 10000,
          action: { label: "用本地规则", onClick: () => applyLocal(plan.base, plan.variant) },
        });
        return;
      }

      // 请求期间用户改了文本：不覆盖，避免把刚敲的字冲掉。
      // 注意比的是 requestText（点击瞬间框里的内容），不是 base（换版时 base 是原文）。
      if (promptRef.current.trim() !== plan.requestText) {
        toast.info("提示词已改动，本次优化未应用", { id: TOAST_ID });
        return;
      }

      if (optimized === plan.base) {
        toast.info("AI 认为这句已经足够好，未做改动", { id: TOAST_ID });
        return;
      }

      baseRef.current = plan.base;
      lastResultRef.current = optimized;
      variantRef.current = plan.variant + 1;
      onPromptChange(optimized);
      toast.success("已用 AI 优化提示词", {
        id: TOAST_ID,
        duration: 6000,
        action: { label: "撤销", onClick: undo },
      });
    } catch {
      // 与 HTTP 失败路径一致：不再钉住模型，下次重新探测
      modelRef.current = undefined;
      const message = getErrorMessage("OPT_UPSTREAM_FAILED");
      toast.error(message, {
        id: TOAST_ID,
        duration: 10000,
        description: "已保留原文",
        action: { label: "用本地规则", onClick: () => applyLocal(plan.base, plan.variant) },
      });
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [prompt, onPromptChange, apiKey, baseUrl, proxyUrl, size, hasReference, optimizeModel, applyLocal, undo]);

  return { optimize, loading };
}
