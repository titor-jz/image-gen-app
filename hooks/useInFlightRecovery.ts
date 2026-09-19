"use client";

/**
 * useInFlightRecovery - 启动时检测未完成的生成任务
 *
 * 异步任务可能在前一次会话未结束（关浏览器、刷新、断网、手机杀后台），
 * 通过扫描 IndexedDB 的 in_flight store，把超过 maxAgeMs 的标记为 abandoned，
 * 把仍在 maxAgeMs 内的交给 onRecover 恢复（凭持久化 taskId 续轮询）。
 * 无 onRecover 时退化为提示——文案不得引导直接重新发起：重复提交 = 重复扣费。
 *
 * 仅在挂载时执行一次。
 */

import { useEffect } from "react";
import { toast } from "sonner";
import {
  markStaleInFlight,
  listRecoverableInFlight,
  cleanExpiredCache,
  type InFlightEntry,
} from "@/lib/db";

export interface UseInFlightRecoveryOptions {
  /** in-flight 任务的最大有效期（毫秒），超过则视为已放弃 */
  maxAgeMs?: number;
  /**
   * 跨会话恢复回调（由 useImageGeneration.recoverInFlight 提供）。
   * 返回实际恢复的任务数；返回 0 表示快照里没有可恢复的 taskId。
   */
  onRecover?: (entries: InFlightEntry[]) => number;
}

export function useInFlightRecovery(options: UseInFlightRecoveryOptions = {}): void {
  const { maxAgeMs = 5 * 60 * 1000, onRecover } = options;

  useEffect(() => {
    // 顺手清理已过期的 prompt cache
    cleanExpiredCache().catch(() => {});

    (async () => {
      try {
        const stale = await markStaleInFlight(maxAgeMs);
        const recoverable = await listRecoverableInFlight(maxAgeMs);
        if (recoverable.length > 0 && onRecover) {
          const recovered = onRecover(recoverable);
          if (recovered > 0) {
            toast.success(`已恢复 ${recovered} 个生成中的任务`, {
              description: "正在继续等待上游结果，无需重新发起",
            });
          } else {
            // 有未完成记录但快照里没有 taskId（多见于提交阶段被杀），
            // 上游可能已在计费执行，但结果无法找回——不引导重复提交
            const preview = recoverable[0].promptPreview || "(无提示词)";
            toast.warning(`检测到 ${recoverable.length} 个未完成生成`, {
              description: `最近一条: "${preview}" — 结果无法自动找回。为避免重复扣费，请先确认上游是否已完成，再决定是否重新发起`,
              duration: 10000,
            });
          }
        } else if (recoverable.length > 0) {
          // 无恢复能力的兜底路径（理论上 page.tsx 始终传 onRecover）
          const preview = recoverable[0].promptPreview || "(无提示词)";
          toast.warning(`检测到 ${recoverable.length} 个未完成生成`, {
            description: `最近一条: "${preview}" — 上游可能仍在生成。为避免重复扣费，请先确认结果是否已完成，再决定是否重新发起`,
            duration: 10000,
          });
        }
        if (stale > 0) {
          // 仅在控制台记录，UI 不打扰
          console.info(`[in-flight] ${stale} stale entries marked abandoned`);
        }
      } catch (err) {
        console.warn("[in-flight] recovery check failed", err);
      }
    })();
    // 仅挂载时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
