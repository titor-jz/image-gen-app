"use client";

/**
 * ParamSheet - 移动端生成参数底部面板
 *
 * 行式布局（iOS 设置风）：左标签 + 右当前值 + ›；点行弹出二级选择面板（PickerSheet），
 * 避免在底部面板内使用浮动下拉（会浮出面板外/遮挡标题）。
 * 对比相关项按需展开（progressive disclosure）。
 */

import { ChevronRight, GitCompare, Server } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { PickerSheet } from "@/components/ui/picker-sheet";
import { SIZES, QUALITIES, COUNTS, type Quality, type RefQuality } from "@/components/UnifiedInputCard";
import type { ApiProfile } from "@/lib/api-config-context";
import type { AspectRatio, ModelInfo } from "@/lib/types";

/** 二级选择面板的类型（状态由 MobileHome 持有，纳入返回键层级） */
export type ParamPickerKind =
  | "model"
  | "refQuality"
  | "size"
  | "quality"
  | "count"
  | "modelB"
  | "nodeB";

/** 行按钮：左标签 + 右当前值 + › */
function ValueRow({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 py-3.5 border-b border-border/40 last:border-b-0 press"
    >
      <span className="text-[15px] text-foreground shrink-0">{label}</span>
      <span className="flex-1 min-w-0 text-right text-[15px] text-muted-foreground truncate">{value}</span>
      <ChevronRight className="w-4 h-4 text-muted-foreground/60 shrink-0" />
    </button>
  );
}

const REF_QUALITY_OPTIONS: { value: RefQuality; label: string }[] = [
  { value: "auto", label: "自动压缩" },
  { value: "hd", label: "高清压缩" },
  { value: "original", label: "原图直传" },
];

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
  picker,
  onPickerChange,
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
  /** 当前打开的二级选择面板（受控；null = 无） */
  picker: ParamPickerKind | null;
  onPickerChange: (p: ParamPickerKind | null) => void;
}) {
  const modelLabel =
    models.find((m) => m.id === selectedModel)?.name ??
    (modelsLoading && models.length === 0 ? "模型加载中…" : selectedModel);

  return (
    <>
      <BottomSheet open={open} onClose={onClose} title="生成参数">
        <div className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <ValueRow label="模型" value={modelLabel} onClick={() => onPickerChange("model")} />
          <ValueRow
            label="参考图"
            value={REF_QUALITY_OPTIONS.find((o) => o.value === refQuality)?.label ?? refQuality}
            onClick={() => onPickerChange("refQuality")}
          />
          <ValueRow
            label="比例"
            value={SIZES.find((s) => s.value === selectedSize)?.label ?? selectedSize}
            onClick={() => onPickerChange("size")}
          />
          <ValueRow
            label="清晰度"
            value={QUALITIES.find((q) => q.value === selectedQuality)?.label ?? selectedQuality}
            onClick={() => onPickerChange("quality")}
          />
          {!compareMode && (
            <ValueRow
              label="数量"
              value={COUNTS.find((c) => c.value === String(selectedN))?.label ?? `${selectedN}张`}
              onClick={() => onPickerChange("count")}
            />
          )}

          {/* 对比模式：开关行 */}
          <div className="w-full flex items-center gap-3 py-3.5 border-b border-border/40 last:border-b-0">
            <span className="text-[15px] text-foreground flex-1">对比模式</span>
            <button
              type="button"
              className={`toolbar-chip press ${compareMode ? "toolbar-chip-active" : ""}`}
              onClick={() => onCompareModeChange(!compareMode)}
              aria-pressed={compareMode}
            >
              <GitCompare className="w-3.5 h-3.5" />
              对比
            </button>
          </div>

          {compareMode && (
            <>
              <ValueRow
                label="对比模型"
                value={modelBOptions.find((m) => m.id === modelB)?.name ?? modelB}
                onClick={() => onPickerChange("modelB")}
              />
              {profiles.length > 1 && (
                <ValueRow
                  label="对比节点"
                  value={
                    nodeBId
                      ? profiles.find((p) => p.id === nodeBId)?.name || "未命名节点"
                      : "同当前节点"
                  }
                  onClick={() => onPickerChange("nodeB")}
                />
              )}
              <p className="text-xs text-muted-foreground flex items-center gap-1 pt-3">
                <Server className="w-3 h-3" />
                对比模式下每侧各出 1 张，节点切换在顶栏
              </p>
            </>
          )}
        </div>
      </BottomSheet>

      {/* 二级选择面板（同一时刻最多一个） */}
      <PickerSheet
        open={picker === "model"}
        onClose={() => onPickerChange(null)}
        title="选择模型"
        options={models.map((m) => ({ value: m.id, label: m.name }))}
        value={selectedModel}
        onSelect={(v) => onModelChange(v)}
      />
      <PickerSheet
        open={picker === "refQuality"}
        onClose={() => onPickerChange(null)}
        title="参考图处理"
        options={REF_QUALITY_OPTIONS}
        value={refQuality}
        onSelect={(v) => onRefQualityChange(v)}
      />
      <PickerSheet
        open={picker === "size"}
        onClose={() => onPickerChange(null)}
        title="选择比例"
        options={SIZES}
        value={selectedSize}
        onSelect={(v) => onSizeChange(v)}
      />
      <PickerSheet
        open={picker === "quality"}
        onClose={() => onPickerChange(null)}
        title="选择清晰度"
        options={QUALITIES}
        value={selectedQuality}
        onSelect={(v) => onQualityChange(v)}
      />
      <PickerSheet
        open={picker === "count"}
        onClose={() => onPickerChange(null)}
        title="生成数量"
        options={COUNTS}
        value={String(selectedN)}
        onSelect={(v) => onNChange(Number(v) as 1 | 2 | 3 | 4)}
      />
      <PickerSheet
        open={picker === "modelB"}
        onClose={() => onPickerChange(null)}
        title="对比模型"
        options={modelBOptions.map((m) => ({ value: m.id, label: m.name }))}
        value={modelBOptions.some((m) => m.id === modelB) ? modelB : (modelBOptions[0]?.id ?? "")}
        onSelect={(v) => onModelBChange(v)}
      />
      <PickerSheet
        open={picker === "nodeB"}
        onClose={() => onPickerChange(null)}
        title="对比节点"
        options={[
          { value: activeNodeId, label: "同当前节点" },
          ...profiles
            .filter((p) => p.id !== activeNodeId)
            .map((p) => ({ value: p.id, label: p.name || "未命名节点" })),
        ]}
        value={nodeBId ?? activeNodeId}
        onSelect={(v) => onNodeBChange(v === activeNodeId ? null : v)}
      />
    </>
  );
}
