"use client";

import { useState, useEffect } from "react";
import { Settings, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  getApiKey,
  setApiKey,
  getBaseUrl,
  setBaseUrl,
  getProxyUrl,
  setProxyUrl,
} from "@/lib/api-key";

type TestStatus = "idle" | "testing" | "success" | "error";

export function SettingsDialog() {
  const [apiKey, setApiKeyState] = useState("");
  const [inputValue, setInputValue] = useState("");
  const [baseUrl, setBaseUrlState] = useState("");
  const [baseUrlInput, setBaseUrlInput] = useState("");
  const [proxyUrl, setProxyUrlState] = useState("");
  const [proxyUrlInput, setProxyUrlInput] = useState("");
  const [testStatus, setTestStatus] = useState<TestStatus>("idle");
  const [testMessage, setTestMessage] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    const key = getApiKey();
    const url = getBaseUrl();
    const proxy = getProxyUrl();
    setApiKeyState(key);
    setInputValue(key);
    setBaseUrlState(url);
    setBaseUrlInput(url);
    setProxyUrlState(proxy);
    setProxyUrlInput(proxy);
  }, [dialogOpen]);

  const handleSave = () => {
    setApiKey(inputValue);
    setApiKeyState(inputValue);
    setBaseUrl(baseUrlInput);
    setBaseUrlState(baseUrlInput);
    setProxyUrl(proxyUrlInput);
    setProxyUrlState(proxyUrlInput);
    setTestStatus("idle");
    setTestMessage("");
    setDialogOpen(false);
  };

  const handleTest = async () => {
    const key = inputValue.trim();
    if (!key) return;

    setTestStatus("testing");
    setTestMessage("");

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "x-api-key": key,
      };
      if (baseUrlInput.trim()) headers["x-base-url"] = baseUrlInput.trim();
      if (proxyUrlInput.trim()) headers["x-proxy-url"] = proxyUrlInput.trim();

      const res = await fetch("/api/test-key", { method: "POST", headers });
      const data = await res.json();

      if (res.ok) {
        setTestStatus("success");
        setTestMessage(data.message || "API Key 验证通过");
      } else {
        setTestStatus("error");
        setTestMessage(data.error || "验证失败");
      }
    } catch {
      setTestStatus("error");
      setTestMessage("网络错误，请检查连接");
    }
  };

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
      <DialogContent className="bg-card border-border animate-scale-in">
        <DialogHeader>
          <DialogTitle>API 设置</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-sm text-muted-foreground mb-1.5 block">
              API Base URL
            </label>
            <Input
              placeholder="https://api.openai.com/v1"
              value={baseUrlInput}
              onChange={(e) => {
                setBaseUrlInput(e.target.value);
                setTestStatus("idle");
                setTestMessage("");
              }}
            />
            <p className="text-xs text-muted-foreground mt-1">
              第三方中转请填写服务商提供的地址
            </p>
          </div>
          <div>
            <label className="text-sm text-muted-foreground mb-1.5 block">
              API Key
            </label>
            <Input
              type="password"
              placeholder="sk-..."
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                setTestStatus("idle");
                setTestMessage("");
              }}
            />
          </div>
          <div>
            <label className="text-sm text-muted-foreground mb-1.5 block">
              代理地址（可选）
            </label>
            <Input
              placeholder="http://127.0.0.1:7890"
              value={proxyUrlInput}
              onChange={(e) => {
                setProxyUrlInput(e.target.value);
                setTestStatus("idle");
                setTestMessage("");
              }}
            />
          </div>
          <div className="flex gap-2">
            <Button
              onClick={handleTest}
              disabled={!inputValue.trim() || testStatus === "testing"}
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
            <Button onClick={handleSave} className="flex-1 press">
              保存
            </Button>
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
          {apiKey && (
            <p className="text-xs text-muted-foreground">
              当前 Key: {apiKey.slice(0, 8)}...
              {baseUrl && ` | Base URL: ${baseUrl}`}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
