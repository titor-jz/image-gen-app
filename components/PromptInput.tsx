"use client";

import { useState, useRef, useCallback } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Eraser, AtSign, Image as ImageIcon, X } from "lucide-react";
import type { ReferenceImage } from "./ReferenceImages";

interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
  referenceImages: ReferenceImage[];
  placeholder?: string;
}

interface MentionItem {
  image: ReferenceImage;
  start: number;
  end: number;
}

function parseMentions(text: string, images: ReferenceImage[]): MentionItem[] {
  const mentions: MentionItem[] = [];
  for (const img of images) {
    const tag = `@${img.name}`;
    let idx = 0;
    while ((idx = text.indexOf(tag, idx)) !== -1) {
      mentions.push({ image: img, start: idx, end: idx + tag.length });
      idx += tag.length;
    }
  }
  return mentions;
}

export function PromptInput({ value, onChange, referenceImages, placeholder }: PromptInputProps) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionQuery, setSuggestionQuery] = useState("");
  const [suggestionPos, setSuggestionPos] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const mentions = parseMentions(value, referenceImages);

  const filteredImages = referenceImages.filter((img) =>
    img.name.toLowerCase().includes(suggestionQuery.toLowerCase())
  );

  const insertMention = useCallback(
    (img: ReferenceImage) => {
      const tag = `@${img.name} `;
      const textBeforeCursor = value.slice(0, suggestionPos);
      const atIndex = textBeforeCursor.lastIndexOf("@");
      const beforeAt = atIndex >= 0 ? value.slice(0, atIndex) : value.slice(0, suggestionPos);
      const afterCursor = value.slice(suggestionPos);
      const newValue = beforeAt + tag + afterCursor;
      onChange(newValue);
      setShowSuggestions(false);

      setTimeout(() => {
        if (textareaRef.current) {
          const newPos = beforeAt.length + tag.length;
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(newPos, newPos);
        }
      }, 0);
    },
    [value, suggestionPos, onChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (showSuggestions && filteredImages.length > 0) {
        if (e.key === "Escape") {
          setShowSuggestions(false);
          return;
        }
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % filteredImages.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + filteredImages.length) % filteredImages.length);
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          insertMention(filteredImages[selectedIndex]);
          return;
        }
      }
    },
    [showSuggestions, filteredImages, selectedIndex, insertMention]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      const cursorPos = e.target.selectionStart;

      const textBeforeCursor = newValue.slice(0, cursorPos);
      const atIndex = textBeforeCursor.lastIndexOf("@");

      if (atIndex !== -1) {
        const afterAt = textBeforeCursor.slice(atIndex + 1);
        const isPartOfMention = mentions.some(
          (m) => atIndex >= m.start && atIndex < m.end
        );
        if (!isPartOfMention && !afterAt.includes(" ")) {
          setShowSuggestions(true);
          setSuggestionQuery(afterAt);
          setSuggestionPos(cursorPos);
          setSelectedIndex(0);
          onChange(newValue);
          return;
        }
      }

      setShowSuggestions(false);
      onChange(newValue);
    },
    [onChange, mentions]
  );

  return (
    <div className="relative">
      <div className="relative">
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || "描述你想要的图片，例如：@参考图1 保持这个风格，生成一张海报"}
          className="min-h-[120px] resize-none pr-12 bg-card border-border text-foreground placeholder:text-muted-foreground"
          rows={4}
        />
        {value && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-2 right-2"
            onClick={() => onChange("")}
          >
            <Eraser className="w-4 h-4 text-muted-foreground" />
          </Button>
        )}
      </div>

      {mentions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {mentions.map((m) => (
            <span
              key={m.image.id}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 border border-primary/20 text-xs text-primary"
            >
              <ImageIcon className="w-3 h-3" />
              {m.image.name}
              <button
                onClick={() => {
                  const before = value.slice(0, m.start);
                  const after = value.slice(m.end);
                  onChange(before + after);
                }}
                className="ml-1 hover:text-destructive"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {showSuggestions && filteredImages.length > 0 && (
        <div className="absolute z-50 mt-1 w-64 rounded-lg border border-border bg-popover shadow-lg overflow-hidden">
          <div className="px-3 py-1.5 text-xs text-muted-foreground border-b border-border flex items-center gap-1.5">
            <AtSign className="w-3 h-3" />
            选择参考图片
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filteredImages.map((img, idx) => (
              <button
                key={img.id}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                  idx === selectedIndex ? "bg-accent" : "hover:bg-accent"
                }`}
                onClick={() => insertMention(img)}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                <img
                  src={img.base64}
                  alt={img.name}
                  className="w-8 h-8 rounded object-cover flex-shrink-0"
                />
                <span className="truncate">{img.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
