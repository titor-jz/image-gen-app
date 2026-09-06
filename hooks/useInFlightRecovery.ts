"use client";

/**
 * useInFlightRecovery - 启动时检测未完成的生成任务
 *
 * 异步任务可能在前一次会话未结束（关浏览器、刷新、断网），通过扫描
 * IndexedDB 的 in_flight store，把超过 maxAgeMs 的标记为 abandoned，
 * 把仍在 maxAgeMs 内的列为可恢复，并通过 toast 提示用户。
 *
 * 仅在挂载时执行一次。
 */

import { useEffect } from "react";
import { toast } from "sonner";
import {
  markStaleInFlight,
  listRecoverableInFlight,
  cleanExpiredCache,
} from "@/lib/db";

export interface UseInFlightRecoveryOptions {
  /** in-flight 任务的最大有效期（毫秒），超过则视为已放弃 */
  maxAgeMs?: number;
}

export function useInFlightRecovery(options: UseInFlightRecoveryOptions = {}): void {
  const { maxAgeMs = 5 * 60 * 1000 } = options;

  useEffect(() => {
    // 顺手清理已过期的 prompt cache
    cleanExpiredCache().catch(() => {});

    (async () => {
      try {
        const stale = await markStaleInFlight(maxAgeMs);
        const recoverable = await listRecoverableInFlight(maxAgeMs);
        if (recoverable.length > 0) {
          const preview = recoverable[0].promptPreview || "(无提示词)";
          toast.warning(`检测到 ${recoverable.length} 个未完成生成`, {
            description: `最近一条: "${preview}" — 上游可能仍在生成，结果不会自动找回，可等待后重新发起`,
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