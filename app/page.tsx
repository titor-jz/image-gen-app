"use client";

import { useState, useEffect, useCallback } from "react";
import { Header } from "@/components/Header";
import { Sidebar } from "@/components/Sidebar";
import { ReferenceImages, type ReferenceImage } from "@/components/ReferenceImages";
import { PromptInput } from "@/components/PromptInput";
import { ParamConfig, type Quality } from "@/components/ParamConfig";
import { GenerateButton } from "@/components/GenerateButton";
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

  const loadModels = useCallback(async () => {
    const apiKey = getApiKey();
    const baseURL = getBaseUrl();
    const proxyURL = getProxyUrl();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) headers["x-api-key"] = apiKey;
    if (baseURL) headers["x-base-url"] = baseURL;
    if (proxyURL) headers["x-proxy-url"] = proxyURL;

    try {
      const res = await fetch("/api/models", { headers });
      const data = await res.json();
      if (data.models && data.models.length > 0) {
        setModels(data.models);
      }
    } catch {
      setModels([
        {
          id: "gpt-image-2",
          name: "GPT-Image2",
          costPerImage: 0,
          supportedSizes: ["auto", "1:1", "16:9", "9:16", "4:3", "3:4"],
        },
      ]);
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
    if (!apiKey) {
      setError("请先在设置中配置 API Key");
      return;
    }

    const baseURL = getBaseUrl();
    const proxyURL = getProxyUrl();

    setLoading(true);
    setError(null);
    setResults([]);

    try {
      // Collect referenced images (those mentioned in prompt with @)
      const referencedImages: ReferenceImage[] = [];
      for (const img of referenceImages) {
        const tag = `@${img.name}`;
        if (prompt.includes(tag)) {
          referencedImages.push(img);
        }
      }

      // Use FormData to avoid JSON body size limit on Vercel
      const formData = new FormData();
      formData.append("prompt", prompt.trim());
      formData.append("model", selectedModel);
      formData.append("size", selectedSize);
      formData.append("quality", selectedQuality);
      formData.append("n", "1");
      for (const img of referencedImages) {
        // Convert base64 data URL to Blob
        const response = await fetch(img.base64);
        const blob = await response.blob();
        formData.append("images", blob, img.name);
      }

      const response = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          ...(baseURL ? { "x-base-url": baseURL } : {}),
          ...(proxyURL ? { "x-proxy-url": proxyURL } : {}),
        },
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "生成失败");
      }

      const newResults: GenerateResult[] = data.images.map(
        (img: { b64_json: string; mime: string }, i: number) => ({
          id: `gen-${Date.now()}-${i}`,
          b64_json: img.b64_json,
          mime: img.mime,
          prompt: prompt.trim(),
          model: selectedModel,
          size: selectedSize,
          createdAt: Date.now(),
        })
      );

      setResults(newResults);

      // 保存到历史记录
      const record: HistoryRecord = {
        id: `hist-${Date.now()}`,
        params: {
          prompt: prompt.trim(),
          model: selectedModel,
          size: selectedSize,
          quality: selectedQuality,
          images: referencedImages.length > 0 ? referencedImages.map(img => img.base64) : undefined,
        },
        results: newResults,
        createdAt: Date.now(),
      };
      await addHistory(record);

      // 保存设置
      saveSettings({
        defaultModel: selectedModel,
        defaultSize: selectedSize,
        defaultQuality: selectedQuality,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败，请重试");
    } finally {
      setLoading(false);
    }
  }, [prompt, referenceImages, selectedModel, selectedSize, selectedQuality]);

  const handleSelectRecord = useCallback((record: HistoryRecord) => {
    setPrompt(record.params.prompt);
    setSelectedModel(record.params.model);
    setSelectedSize(record.params.size || "auto");
    setSelectedQuality(record.params.quality || "1k");
    setResults(record.results);
    // Restore reference images from history if available
    if (record.params.images && record.params.images.length > 0) {
      const restored: ReferenceImage[] = record.params.images.map((base64, i) => ({
        id: `ref-hist-${i}`,
        name: `参考图${i + 1}.png`,
        base64,
        mimeType: "image/png",
      }));
      setReferenceImages(restored);
    } else {
      setReferenceImages([]);
    }
  }, []);

  return (
    <div className="flex flex-col h-screen bg-gradient-to-b from-background via-background to-card/30">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar onSelectRecord={handleSelectRecord} />

        <main className="flex-1 overflow-y-auto p-6 scrollbar-thin">
          <div className="max-w-2xl mx-auto space-y-6">
            <div className="glass rounded-2xl p-5 space-y-6">
              <ReferenceImages
                images={referenceImages}
                onChange={setReferenceImages}
              />

              <ParamConfig
                models={models}
                selectedModel={selectedModel}
                onModelChange={setSelectedModel}
                selectedSize={selectedSize}
                onSizeChange={setSelectedSize}
                selectedQuality={selectedQuality}
                onQualityChange={setSelectedQuality}
              />

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm text-muted-foreground">提示词</label>
                  <span className="text-xs text-muted-foreground/60">输入 @ 引用参考图</span>
                </div>
                <PromptInput
                  value={prompt}
                  onChange={setPrompt}
                  referenceImages={referenceImages}
                />
              </div>
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
                {error}
              </div>
            )}

            <div className="glow-primary">
              <GenerateButton
                onClick={handleGenerate}
                loading={loading}
                disabled={!prompt.trim()}
              />
            </div>

            <div className="glass rounded-2xl p-5">
              <ResultGrid results={results} loading={loading} />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
