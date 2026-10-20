"use client";

import { MAX_PROMPT_CHARS, PROMPT_GUIDE } from "@/lib/prompt-rules";

/**
 * 创作须知：写什么 / 长度上限 / 禁止内容。
 * 桌面与移动共用，避免两处文案与上限漂移。
 */
export function PromptGuide({ className = "" }: { className?: string }) {
  return (
    <div
      className={`rounded-xl border border-border/60 bg-accent/15 p-3 text-xs leading-relaxed text-muted-foreground ${className}`}
    >
      <p>
        <span className="font-medium text-foreground/80">写什么：</span>
        {PROMPT_GUIDE.what}
      </p>
      <p className="mt-1">
        <span className="font-medium text-foreground/80">长度：</span>
        上限 {MAX_PROMPT_CHARS} 字（含标点与空格）；引用参考图用 @图片名。
      </p>
      <div className="mt-1.5">
        <span className="font-medium text-foreground/80">禁止内容：</span>
        <ul className="mt-1 grid gap-0.5 sm:grid-cols-2">
          {PROMPT_GUIDE.forbidden.map((item) => (
            <li key={item}>· {item}</li>
          ))}
        </ul>
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground/80">{PROMPT_GUIDE.note}</p>
    </div>
  );
}
