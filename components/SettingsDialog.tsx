"use client";

/**
 * SettingsDialog - API 节点配置弹窗（多节点管理）
 *
 * 左侧/上方为节点列表（点击切换激活），下方为当前编辑的节点表单。
 * 行为：
 *  - 选中节点 → 加载其值到表单编辑；「保存」写回该节点
 *  - 「新建节点」→ 空表单，保存后自动激活
 *  - 「删除」→ 二次确认后删除（至少保留时可删，删空也可）
 *  - 「测试」→ 用表单当前值测试，不影响已保存配置
 */

import { useState, useEffect, useRef } from "react";
import {
  Settings,
  CheckCircle2,
  XCircle,
  Loader2,
  Plus,
  Trash2,
  Server,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useApiConfig, type ApiProfile } from "@/lib/api-config-context";
import { buildApiHeaders } from "@/lib/api-headers";
import { parseErrorResponse } from "@/lib/error-messages";

type TestStatus = "idle" | "testing" | "success" | "error";

/** 编辑态：null id 表示新建 */
interface EditState {
  id: string | null;
  name: string;
  baseUrl: string;
  apiKey: string;
  proxyUrl: string;
  /** 逗号/换行分隔的自定义模型 id（文本态） */
  customModelsText: string;
}

const EMPTY_EDIT: EditState = {
  id: null,
  name: "",
  baseUrl: "",
  apiKey: "",
  proxyUrl: "",
  customModelsText: "",
};

function toEdit(p: ApiProfile): EditState {
  return {
    id: p.id,
    name: p.name,
    baseUrl: p.baseUrl,
    apiKey: p.apiKey,
    proxyUrl: p.proxyUrl,
    customModelsText: (p.customModels ?? []).join(", "),
  };
}

/** 文本 → 模型 id 数组（按逗号/顿号/换行/空格切分，去重去空） */
function parseCustomModels(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[,，、\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    ),
  ];
}

export function SettingsDialog({
  open: openProp,
  onOpenChange,
}: {
  /** 受控模式：移动端把「设置弹窗开着」纳入返回键层级；不传 = 自管理（桌面） */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
} = {}) {
  const {
    profiles, activeId, saveProfile, removeProfile, setActiveId,
    optimizeId, setOptimizeId,
  } = useApiConfig();

  const [internalOpen, setInternalOpen] = useState(false);
  const dialogOpen = openProp ?? internalOpen;
  const setDialogOpen = (v: boolean) => {
    if (openProp === undefined) setInternalOpen(v);
    onOpenChange?.(v);
  };
  // 编辑态（本地草稿，不直接持久化）
  const [edit, setEdit] = useState<EditState>(EMPTY_EDIT);
  // 列表中选中的节点（= 正在编辑的对象；与激活项独立）
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const [testStatus, setTestStatus] = useState<TestStatus>("idle");
  const [testMessage, setTestMessage] = useState("");

  // ---- 提示词优化：节点 + 模型（模型跟节点走，存该节点的 optimizeModel） ----
  const optimizeNode = profiles.find((p) => p.id === (optimizeId || activeId)) ?? profiles[0] ?? null;
  const optNodeId = optimizeNode?.id ?? "";
  const optNodeBase = optimizeNode?.baseUrl ?? "";
  const optNodeKey = optimizeNode?.apiKey ?? "";
  const optNodeProxy = optimizeNode?.proxyUrl ?? "";
  const [modelDraft, setModelDraft] = useState("");
  // 列表带节点归属：切换节点后，旧节点的列表在返回前不会被误用（避免选到对新节点无效的模型）
  const [chatModels, setChatModels] = useState<{ nodeId: string; ids: string[] }>({
    nodeId: "",
    ids: [],
  });
  const chatModelIds = chatModels.nodeId === optNodeId ? chatModels.ids : [];

  // 只在打开弹窗或切换节点时同步草稿：外部保存（跨标签页 / 提交）不覆盖正在输入的值
  const syncedNodeRef = useRef<string | null>(null);
  useEffect(() => {
    if (!dialogOpen) {
      syncedNodeRef.current = null;
      return;
    }
    if (syncedNodeRef.current === optNodeId) return;
    syncedNodeRef.current = optNodeId;
    setModelDraft(optimizeNode?.optimizeModel ?? "");
  }, [dialogOpen, optNodeId, optimizeNode?.optimizeModel]);

  // 拉取该节点的对话模型列表（失败只是没有下拉，手填仍可用）
  useEffect(() => {
    if (!dialogOpen || !optNodeId) return;
    let cancelled = false;
    const headers = buildApiHeaders({
      apiKey: optNodeKey,
      baseUrl: optNodeBase,
      proxyUrl: optNodeProxy,
    });
    void (async () => {
      try {
        const res = await fetch("/api/models?type=chat", { headers });
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        const list = Array.isArray(data?.models)
          ? data.models
              .map((m: { id?: unknown }) => (typeof m?.id === "string" ? m.id : ""))
              .filter(Boolean)
          : [];
        setChatModels({ nodeId: optNodeId, ids: list });
      } catch {
        if (!cancelled) setChatModels({ nodeId: optNodeId, ids: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dialogOpen, optNodeId, optNodeBase, optNodeKey, optNodeProxy]);

  const commitOptimizeModel = () => {
    if (!optimizeNode) return;
    const value = modelDraft.trim();
    if (value === (optimizeNode.optimizeModel ?? "")) return;
    saveProfile({ ...optimizeNode, optimizeModel: value });
  };

  // 打开弹窗时：选中当前激活的节点开始编辑；无任何配置则进入新建态。
  // 依赖仅 [dialogOpen]：弹窗开着的时候 profiles/activeId 变化（启用切换、
  // 跨标签页改动）不允许重置表单，否则用户正在输入的草稿会被静默覆盖。
  useEffect(() => {
    if (!dialogOpen) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 弹窗打开时初始化编辑态
    setEditingId(activeId || null);
    const current = profiles.find((p) => p.id === activeId);
    setEdit(current ? toEdit(current) : { ...EMPTY_EDIT });
    setTestStatus("idle");
    setTestMessage("");
    setConfirmingDelete(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 故意只在打开时初始化（读值不作为依赖）
  }, [dialogOpen]);

  // 守卫（渲染期派生）：正在编辑的节点被外部删除（如另一标签页）时，
  // 保留用户草稿，但提示"保存将创建为新节点"（saveProfile 对失效 id 走新 id），
  // 删除按钮对幽灵节点禁用
  const editingMissing = !!editingId && !profiles.some((p) => p.id === editingId);

  const selectEditing = (id: string | null) => {
    setEditingId(id);
    setConfirmingDelete(false);
    setTestStatus("idle");
    setTestMessage("");
    if (id === null) {
      setEdit({ ...EMPTY_EDIT });
    } else {
      const p = profiles.find((x) => x.id === id);
      if (p) setEdit(toEdit(p));
    }
  };

  const handleSave = () => {
    const savedId = saveProfile({
      id: edit.id ?? undefined,
      name: edit.name.trim() || edit.baseUrl.trim() || "未命名节点",
      baseUrl: edit.baseUrl.trim(),
      apiKey: edit.apiKey.trim(),
      proxyUrl: edit.proxyUrl.trim(),
      customModels: parseCustomModels(edit.customModelsText),
    });
    // 同步真实 id（新建 / 幽灵节点保存都会拿到新 id），避免重复创建
    setEditingId(savedId);
    setEdit((prev) => ({ ...prev, id: savedId }));
    setConfirmingDelete(false);
    setTestStatus("idle");
    setTestMessage("");
  };

  const handleDelete = () => {
    if (!edit.id || editingMissing) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setConfirmingDelete(false);
    const remaining = profiles.filter((p) => p.id !== edit.id);
    removeProfile(edit.id);
    // 显式选中删除后的下一个节点（不依赖 effect 重置，保护用户草稿语义）
    const next = remaining[0];
    setEditingId(next ? next.id : null);
    setEdit(next ? toEdit(next) : { ...EMPTY_EDIT });
  };

  const handleTest = async () => {
    const key = edit.apiKey.trim();
    if (!key) return;

    setTestStatus("testing");
    setTestMessage("");

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "x-api-key": key,
      };
      if (edit.baseUrl.trim()) headers["x-base-url"] = edit.baseUrl.trim();
      if (edit.proxyUrl.trim()) headers["x-proxy-url"] = edit.proxyUrl.trim();

      const res = await fetch("/api/test-key", { method: "POST", headers });
      const data = await res.json().catch(() => null);

      if (res.ok) {
        setTestStatus("success");
        setTestMessage(data?.message || "API Key 验证通过");
      } else {
        setTestStatus("error");
        const parsed = parseErrorResponse(data);
        setTestMessage(
          parsed.details
            ? `${parsed.message}（${parsed.details}）`
            : parsed.message
        );
      }
    } catch {
      setTestStatus("error");
      setTestMessage("网络错误，请检查连接");
    }
  };

  const dirty =
    !!edit.apiKey.trim() || !!edit.baseUrl.trim() || !!edit.proxyUrl.trim() ||
    !!edit.name.trim() || !!edit.customModelsText.trim();

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="press transition-base hover:bg-accent/60"
            aria-label="设置"
          >
            <Settings className="w-4 h-4" />
          </Button>
        }
      />
      <DialogContent className="bg-card border-border animate-scale-in max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>API 节点设置</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* 节点列表：点击选中编辑； radio 标识当前激活（生成时使用） */}
          <div className="space-y-1.5">
            {profiles.map((p) => {
              const isEditing = editingId === p.id;
              const isActive = p.id === activeId;
              return (
                <div
                  key={p.id}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-base ${
                    isEditing
                      ? "border-primary/60 bg-primary/5"
                      : "border-border hover:bg-accent/40"
                  }`}
                  onClick={() => selectEditing(p.id)}
                  role="button"
                  aria-pressed={isEditing}
                >
                  <Server className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="text-sm text-foreground truncate flex-1">
                    {p.name || "未命名节点"}
                  </span>
                  {p.baseUrl && (
                    <span className="text-xs text-muted-foreground truncate max-w-36 hidden sm:inline">
                      {p.baseUrl.replace(/^https?:\/\//, "")}
                    </span>
                  )}
                  {isActive ? (
                    <span className="text-xs text-green-500 shrink-0 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> 使用中
                    </span>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground press"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveId(p.id);
                      }}
                    >
                      启用
                    </Button>
                  )}
                </div>
              );
            })}
            <Button
              variant="outline"
              size="sm"
              className="w-full press gap-1.5"
              onClick={() => selectEditing(null)}
            >
              <Plus className="w-3.5 h-3.5" />
              新建节点
            </Button>
          </div>

          {/* 提示词优化节点：图像专用中转往往没有对话模型，可在这里另指一个通用节点 */}
          <div className="space-y-2 border-t border-border pt-3">
            <label htmlFor="settings-optimize-node" className="text-sm text-muted-foreground block">
              提示词优化节点
            </label>
            <select
              id="settings-optimize-node"
              value={optimizeId}
              onChange={(e) => setOptimizeId(e.target.value)}
              className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary/60"
            >
              <option value="">跟随当前节点</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name || "未命名节点"}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              「优化提示词」需要一个支持对话模型的节点；当前节点只做生图时，把它指向另一个通用节点即可。
            </p>

            <label htmlFor="settings-optimize-model" className="text-sm text-muted-foreground block pt-1">
              优化模型
            </label>
            <Input
              id="settings-optimize-model"
              list="settings-optimize-model-options"
              placeholder={optimizeNode ? "留空自动挑选，或从列表选择" : "先添加节点"}
              value={modelDraft}
              disabled={!optimizeNode}
              onChange={(e) => setModelDraft(e.target.value)}
              onBlur={commitOptimizeModel}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitOptimizeModel();
                }
              }}
            />
            {/* datalist：点开即见该节点的对话模型，同时保留手填（中转模型名可能不在列表里） */}
            <datalist id="settings-optimize-model-options">
              {chatModelIds.map((id) => (
                <option key={id} value={id} />
              ))}
            </datalist>
            <p className="text-xs text-muted-foreground">
              {!optimizeNode
                ? "添加节点后可选择对话模型"
                : chatModelIds.length > 0
                  ? `从该节点 /models 取的对话模型（${chatModelIds.length} 个），留空则由服务端自动挑选`
                  : "该节点未返回对话模型列表，可直接手动填写模型名"}
            </p>
          </div>

          {/* 编辑表单 */}
          <div className="space-y-3 border-t border-border pt-3">
            <p className="text-xs text-muted-foreground">
              {editingMissing
                ? "该节点已被删除（可能在其他窗口操作），保存将创建为新节点"
                : edit.id
                ? "编辑选中节点"
                : "新建节点（保存后自动启用）"}
            </p>
            <div>
              <label htmlFor="settings-name" className="text-sm text-muted-foreground mb-1.5 block">
                节点名称
              </label>
              <Input
                id="settings-name"
                placeholder="如：快快API / 官方 / 备用线路"
                value={edit.name}
                onChange={(e) => setEdit({ ...edit, name: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="settings-base-url" className="text-sm text-muted-foreground mb-1.5 block">
                API Base URL
              </label>
              <Input
                id="settings-base-url"
                placeholder="https://api.openai.com/v1"
                value={edit.baseUrl}
                onChange={(e) => {
                  setEdit({ ...edit, baseUrl: e.target.value });
                  setTestStatus("idle");
                  setTestMessage("");
                }}
              />
              <p className="text-xs text-muted-foreground mt-1">
                第三方中转请填写服务商提供的地址
              </p>
            </div>
            <div>
              <label htmlFor="settings-api-key" className="text-sm text-muted-foreground mb-1.5 block">
                API Key
              </label>
              <Input
                id="settings-api-key"
                type="password"
                placeholder="sk-..."
                value={edit.apiKey}
                onChange={(e) => {
                  setEdit({ ...edit, apiKey: e.target.value });
                  setTestStatus("idle");
                  setTestMessage("");
                }}
              />
            </div>
            <div>
              <label htmlFor="settings-proxy-url" className="text-sm text-muted-foreground mb-1.5 block">
                代理地址（可选）
              </label>
              <Input
                id="settings-proxy-url"
                placeholder="http://127.0.0.1:7890"
                value={edit.proxyUrl}
                onChange={(e) => {
                  setEdit({ ...edit, proxyUrl: e.target.value });
                  setTestStatus("idle");
                  setTestMessage("");
                }}
              />
            </div>
            <div>
              <label htmlFor="settings-custom-models" className="text-sm text-muted-foreground mb-1.5 block">
                自定义模型（可选）
              </label>
              <Input
                id="settings-custom-models"
                placeholder="如 gpt-image-2.5-flare, gemini-3-pro-image-preview"
                value={edit.customModelsText}
                onChange={(e) => setEdit({ ...edit, customModelsText: e.target.value })}
              />
              <p className="text-xs text-muted-foreground mt-1">
                上游模型列表未返回、或识别不到的生图模型可在此手动补充（逗号分隔）
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handleTest}
              disabled={!edit.apiKey.trim() || testStatus === "testing"}
              variant="outline"
              className="flex-1 press"
            >
              {testStatus === "testing" ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : testStatus === "success" ? (
                <CheckCircle2 className="w-4 h-4 mr-2 text-green-500" />
              ) : testStatus === "error" ? (
                <XCircle className="w-4 h-4 mr-2 text-destructive" />
              ) : null}
              {testStatus === "testing" ? "验证中..." : "测试连接"}
            </Button>
            <Button onClick={handleSave} disabled={!dirty} className="flex-1 press">
              保存
            </Button>
            {edit.id && !editingMissing && (
              <Button
                onClick={handleDelete}
                variant="outline"
                className={`press shrink-0 ${confirmingDelete ? "border-destructive/50 text-destructive bg-destructive/10" : ""}`}
                aria-label="删除节点"
              >
                <Trash2 className="w-4 h-4" />
                {confirmingDelete ? "再点确认" : ""}
              </Button>
            )}
          </div>
          {testMessage && (
            <p
              className={`text-xs animate-fade-in ${
                testStatus === "success" ? "text-green-500" : "text-destructive"
              }`}
            >
              {testMessage}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
