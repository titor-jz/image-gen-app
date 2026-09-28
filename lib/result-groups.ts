/**
 * 结果渲染项分组：按 compareGroup 把对比组两两成对，其余单列。
 *
 * 从 ResultGrid 抽出（纯搬移）；桌面网格与移动结果网格共用。
 */

import type { GenerateResult } from "@/lib/types";

export type ResultRenderItem =
  | { type: "single"; result: GenerateResult; index: number }
  | { type: "compare"; a: GenerateResult; b: GenerateResult; indexA: number; indexB: number };

export function buildResultRenderItems(results: GenerateResult[]): ResultRenderItem[] {
  const renderItems: ResultRenderItem[] = [];
  const consumed = new Set<number>();
  results.forEach((r, i) => {
    if (consumed.has(i)) return;
    if (r.compareGroup) {
      const pairIdx = results.findIndex(
        (r2, j) => j > i && r2.compareGroup === r.compareGroup
      );
      if (pairIdx > -1) {
        consumed.add(i);
        consumed.add(pairIdx);
        renderItems.push({
          type: "compare",
          a: r,
          b: results[pairIdx],
          indexA: i,
          indexB: pairIdx,
        });
        return;
      }
    }
    renderItems.push({ type: "single", result: r, index: i });
  });
  return renderItems;
}
