"use client";

import { useState, useEffect, useCallback } from "react";
import { Header } from "@/components/Header";
import { HistoryDrawer } from "@/components/HistoryDrawer";
import { UnifiedInputCard, type Quality, type ReferenceImage } from "@/components/UnifiedInputCard";
import { ResultGrid } from "@/components/ResultGrid";
import { getApiKey, getBaseUrl, getProxyUrl } from "@/lib/api-key";
import { getSettings, saveSettings } from "@/lib/api-key";
import { addHistory } from "@/lib/db";
import type { AspectRatio, GenerateResult, HistoryRecord, ModelInfo } from "@/lib/types";

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const [selectedModel, setSelectedModel] = useState("gpt-image-2");
  const [selectedSize, setSelectedSize] = useState<AspectRatio>("auto");
  const [selectedQuality, setSelectedQuality] = useState<Quality>("1k");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [results, setResults] = useState<GenerateResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pollProgress, setPollProgress] = useState(0);
  const [showHistory, setShowHistory] = useState(false);

  const loadModels = useCallback(async () => {
    const apiKey = getApiKey();
    const baseURL = getBaseUrl();
    const proxyURL = getProxyUrl();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers["x-api-key"] = apiKey;
    if (baseURL) headers["x-base-url"] = baseURL;
    if (proxyURL) headers["x-proxy-url"] = proxyURL;
    try {
      const res = await fetch("/api/models", { headers });
      const data = await res.json();
      if (data.models && data.models.length > 0) setModels(data.models);
    } catch {
      setModels([{ id: "gpt-image-2", name: "GPT-Image2", costPerImage: 0, supportedSizes: ["auto", "1:1", "16:9", "9:16", "4:3", "3:4"] }]);
    }
  }, []);

  useEffect(() => {
    loadModels();
    const settings = getSettings();
    if (settings.defaultModel) setSelectedModel(settings.defaultModel);
    if (settings.defaultSize) setSelectedSize(settings.defaultSize);
    if (settings.defaultQuality) setSelectedQuality(settings.defaultQuality as Quality);
  }, [loadModels]);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return;
    const apiKey = getApiKey();
    if (!apiKey) { setError("请先在设置中配置 API Key"); return; }
    const baseURL = getBaseUrl();
    const proxyURL = getProxyUrl();
    setLoading(true);
    setError(null);
    setResults([]);

    try {
      let referencedImages: ReferenceImage[] = [];
      const hasAtMentions = referenceImages.some(img => prompt.includes(`@${img.name}`));
      if (hasAtMentions) {
        for (const img of referenceImages) { if (prompt.includes(`@${img.name}`)) referencedImages.push(img); }
      } else {
        const imgPattern = /图(\d+)/g;
        const matches = [...prompt.matchAll(imgPattern)];
        if (matches.length > 0) {
          const order = [...matches].map(m => parseInt(m[1]) - 1).filter(i => i >= 0 && i < referenceImages.length);
          referencedImages = [...new Set(order)].map(i => referenceImages[i]);
        } else { referencedImages = [...referenceImages]; }
      }

      const formData = new FormData();
      formData.append("prompt", prompt.trim());
      formData.append("model", selectedModel);
      formData.append("size", selectedSize);
      formData.append("quality", selectedQuality);
      formData.append("n", "1");
      for (const img of referencedImages) {
        const response = await fetch(img.base64);
        const blob = await response.blob();
        formData.append("images", blob, img.name);
      }

      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "x-api-key": apiKey, ...(baseURL ? { "x-base-url": baseURL } : {}), ...(proxyURL ? { "x-proxy-url": proxyURL } : {}) },
        body: formData,
      });

      const contentType = response.headers.get("content-type") || "";
      let data: any;
      if (contentType.includes("application/json")) { data = await response.json(); }
      else { const text = await response.text(); throw new Error(`服务返回了非预期响应: ${text.slice(0, 200)}`); }
      if (!response.ok) throw new Error(data.error || "生成失败");

      let newResults: GenerateResult[] = [];
      if (data.task_id) {
        const taskId = data.task_id;
        const maxPolls = 60;
        const pollInterval = 3000;
        let b64Json: string | null = null;
        let mime = "image/png";
        for (let i = 0; i < maxPolls; i++) {
          await new Promise((r) => setTimeout(r, pollInterval));
          setPollProgress(i + 1);
          const taskResponse = await fetch(`/api/task/${taskId}`, {
            headers: { "x-api-key": apiKey, ...(baseURL ? { "x-base-url": baseURL } : {}), ...(proxyURL ? { "x-proxy-url": proxyURL } : {}) },
          });
          if (!taskResponse.ok) { const errData = await taskResponse.json().catch(() => ({ error: "轮询失败" })); throw new Error(errData.error || `轮询失败 (${taskResponse.status})`); }
          const taskData = await taskResponse.json();
          if (taskData.status === "SUCCESS") { b64Json = taskData.image_base64; mime = taskData.mime || "image/png"; break; }
          if (taskData.status === "FAILURE" || taskData.status === "FAILED") throw new Error(`生成失败: ${taskData.fail_reason || "未知原因"}`);
        }
        if (!b64Json) throw new Error("生成超时，请稍后在历史记录中查看");
        newResults = [{ id: `gen-${Date.now()}-0`, b64_json: b64Json, mime, prompt: prompt.trim(), model: selectedModel, size: selectedSize, createdAt: Date.now() }];
      } else {
        newResults = (data.images || []).map((img: { b64_json: string; mime: string }, i: number) => ({ id: `gen-${Date.now()}-${i}`, b64_json: img.b64_json, mime: img.mime, prompt: prompt.trim(), model: selectedModel, size: selectedSize, createdAt: Date.now() }));
      }

      setResults(newResults);
      const record: HistoryRecord = {
        id: `hist-${Date.now()}`,
        params: { prompt: prompt.trim(), model: selectedModel, size: selectedSize, quality: selectedQuality, images: referencedImages.length > 0 ? referencedImages.map(img => img.base64) : undefined },
        results: newResults, createdAt: Date.now(),
      };
      await addHistory(record);
      saveSettings({ defaultModel: selectedModel, defaultSize: selectedSize, defaultQuality: selectedQuality });
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败，请重试");
    } finally {
      setLoading(false);
      setPollProgress(0);
    }
  }, [prompt, referenceImages, selectedModel, selectedSize, selectedQuality]);

  const handleSelectRecord = useCallback((record: HistoryRecord) => {
    setPrompt(record.params.prompt);
    setSelectedModel(record.params.model);
    setSelectedSize(record.params.size || "auto");
    setSelectedQuality(record.params.quality || "1k");
    setResults(record.results);
    if (record.params.images && record.params.images.length > 0) {
      const restored: ReferenceImage[] = record.params.images.map((base64, i) => ({ id: `ref-hist-${i}`, name: `参考图${i + 1}.png`, base64, mimeType: "image/png" }));
      setReferenceImages(restored);
    } else { setReferenceImages([]); }
    setShowHistory(false);
  }, []);

  return (
    <div className="flex flex-col h-screen bg-background">
      <Header onShowHistory={() => setShowHistory(true)} />

      {showHistory && (
        <HistoryDrawer onClose={() => setShowHistory(false)} onSelectRecord={handleSelectRecord} />
      )}

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
          {/* 大标题 */}
          <h1 className="text-3xl font-bold text-center text-foreground">智能生图</h1>

          {/* 一体化输入卡片 */}
          <UnifiedInputCard
            prompt={prompt}
            onPromptChange={setPrompt}
            referenceImages={referenceImages}
            onReferenceImagesChange={setReferenceImages}
            models={models}
            selectedModel={selectedModel}
            onModelChange={setSelectedModel}
            selectedSize={selectedSize}
            onSizeChange={setSelectedSize}
            selectedQuality={selectedQuality}
            onQualityChange={setSelectedQuality}
            onGenerate={handleGenerate}
            loading={loading}
            pollProgress={pollProgress}
          />

          {/* 错误提示 */}
          {error && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
              {error}
            </div>
          )}

          {/* 输出图库 */}
          <div className="input-card p-5">
            <ResultGrid results={results} loading={loading} />
          </div>
        </div>
      </main>
    </div>
  );
}
