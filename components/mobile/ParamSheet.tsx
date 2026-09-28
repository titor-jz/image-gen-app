"use client";

/**
 * ParamSheet - 移动端生成参数底部面板
 *
 * 行式布局：左标签 + 右 SelectChip；对比模式相关项按需展开（progressive disclosure）。
 */

import { GitCompare, Server } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { SelectChip } from "@/components/SelectChip";
import { SIZES, QUALITIES, COUNTS, type Quality, type RefQuality } from "@/components/UnifiedInputCard";
import type { ApiProfile } from "@/lib/api-config-context";
import type { AspectRatio, ModelInfo } from "@/lib/types";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 border-b border-border/40 last:border-b-0">
      <span className="text-sm text-muted-foreground shrink-0">{label}</span>
      <div className="flex items-center gap-2 min-w-0">{children}</div>
    </div>
  );
}

export function ParamSheet({
  open,
  onClose,
  models,
  modelsLoading,
  selectedModel,
  onModelChange,
  refQuality,
  onRefQualityChange,
  selectedSize,
  onSizeChange,
  selectedQuality,
  onQualityChange,
  selectedN,
  onNChange,
  compareMode,
  onCompareModeChange,
  modelB,
  onModelBChange,
  profiles,
  activeNodeId,
  nodeBId,
  onNodeBChange,
  modelBOptions,
}: {
  open: boolean;
  onClose: () => void;
  models: ModelInfo[];
  modelsLoading?: boolean;
  selectedModel: string;
  onModelChange: (m: string) => void;
  refQuality: RefQuality;
  onRefQualityChange: (q: RefQuality) => void;
  selectedSize: AspectRatio;
  onSizeChange: (s: AspectRatio) => void;
  selectedQuality: Quality;
  onQualityChange: (q: Quality) => void;
  selectedN: 1 | 2 | 3 | 4;
  onNChange: (n: 1 | 2 | 3 | 4) => void;
  compareMode: boolean;
  onCompareModeChange: (on: boolean) => void;
  modelB: string;
  onModelBChange: (m: string) => void;
  profiles: ApiProfile[];
  activeNodeId: string;
  nodeBId: string | null;
  onNodeBChange: (id: string | null) => void;
  /** 对比模式 B 侧可用模型（跨节点时为 B 节点列表） */
  modelBOptions: ModelInfo[];
}) {
  return (
    <BottomSheet open={open} onClose={onClose} title="生成参数">
      <div className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <Row label="模型">
          <SelectChip
            value={selectedModel}
            onChange={onModelChange}
            options={models.map((m) => ({ value: m.id, label: m.name }))}
            displayLabel={modelsLoading && models.length === 0 ? "模型加载中…" : undefined}
          />
        </Row>
        <Row label="参考图">
          <SelectChip
            value={refQuality}
            onChange={onRefQualityChange}
            options={[
              { value: "auto", label: "自动压缩" },
              { value: "hd", label: "高清压缩" },
              { value: "original", label: "原图直传" },
            ]}
          />
        </Row>
        <Row label="比例">
          <SelectChip value={selectedSize} onChange={onSizeChange} options={SIZES} />
        </Row>
        <Row label="清晰度">
          <SelectChip value={selectedQuality} onChange={onQualityChange} options={QUALITIES} />
        </Row>
        {!compareMode && (
          <Row label="数量">
            <SelectChip
              value={String(selectedN)}
              onChange={(v) => onNChange(Number(v) as 1 | 2 | 3 | 4)}
              options={COUNTS}
            />
          </Row>
        )}
        <Row label="对比模式">
          <button
            type="button"
            className={`toolbar-chip press ${compareMode ? "toolbar-chip-active" : ""}`}
            onClick={() => onCompareModeChange(!compareMode)}
            aria-pressed={compareMode}
          >
            <GitCompare className="w-3.5 h-3.5" />
            对比
          </button>
        </Row>
        {compareMode && (
          <>
            <Row label="对比模型">
              <SelectChip
                value={modelBOptions.some((m) => m.id === modelB) ? modelB : (modelBOptions[0]?.id ?? "")}
                onChange={onModelBChange}
                options={modelBOptions.map((m) => ({ value: m.id, label: `B: ${m.name}` }))}
              />
            </Row>
            {profiles.length > 1 && (
              <Row label="对比节点">
                <SelectChip
                  value={nodeBId ?? activeNodeId}
                  onChange={(id) => onNodeBChange(id === activeNodeId ? null : id)}
                  options={[
                    { value: activeNodeId, label: "同当前节点" },
                    ...profiles
                      .filter((p) => p.id !== activeNodeId)
                      .map((p) => ({ value: p.id, label: p.name || "未命名节点" })),
                  ]}
                />
              </Row>
            )}
            <p className="text-xs text-muted-foreground flex items-center gap-1 pt-3">
              <Server className="w-3 h-3" />
              对比模式下每侧各出 1 张，节点切换在顶栏
            </p>
          </>
        )}
      </div>
    </BottomSheet>
  );
}
