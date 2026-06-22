"use client";

import { useEffect, useCallback, useState } from "react";
import { X, Download, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ImageLightboxProps {
  images: string[];
  currentIndex: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}

export function ImageLightbox({ images, currentIndex, onClose, onPrev, onNext }: ImageLightboxProps) {
  const [zoom, setZoom] = useState(1);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") onPrev();
      if (e.key === "ArrowRight") onNext();
      if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(z + 0.25, 3));
      if (e.key === "-") setZoom((z) => Math.max(z - 0.25, 0.25));
      if (e.key === "0") setZoom(1);
    },
    [onClose, onPrev, onNext]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const handleDownload = async () => {
    try {
      const dataUrl = images[currentIndex];
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `generated-${Date.now()}.png`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Download failed:", e);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm">
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-4 right-4 text-white hover:bg-white/10 z-10"
        onClick={onClose}
      >
        <X className="w-6 h-6" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="absolute left-4 text-white hover:bg-white/10 z-10"
        onClick={onPrev}
        disabled={currentIndex === 0}
      >
        <ChevronLeft className="w-8 h-8" />
      </Button>

      <div className="relative max-w-[95vw] max-h-[90vh] overflow-auto">
        <img
          src={images[currentIndex]}
          alt=""
          className="max-w-none transition-transform duration-200"
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: "center center",
          }}
        />
      </div>

      <Button
        variant="ghost"
        size="icon"
        className="absolute right-4 text-white hover:bg-white/10 z-10"
        onClick={onNext}
        disabled={currentIndex === images.length - 1}
      >
        <ChevronRight className="w-8 h-8" />
      </Button>

      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 z-10">
        <span className="text-white/70 text-sm">
          {currentIndex + 1} / {images.length}
        </span>
        <div className="flex items-center gap-1 bg-black/50 rounded-lg p-1">
          <Button
            variant="ghost"
            size="icon"
            className="w-7 h-7 text-white hover:bg-white/10"
            onClick={() => setZoom((z) => Math.max(z - 0.25, 0.25))}
          >
            <ZoomOut className="w-4 h-4" />
          </Button>
          <span className="text-white/70 text-xs w-10 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="w-7 h-7 text-white hover:bg-white/10"
            onClick={() => setZoom((z) => Math.min(z + 0.25, 3))}
          >
            <ZoomIn className="w-4 h-4" />
          </Button>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleDownload}
        >
          <Download className="w-4 h-4 mr-2" />
          下载
        </Button>
      </div>
    </div>
  );
}
