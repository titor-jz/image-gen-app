import { cn } from "@/lib/utils";

interface SkeletonProps {
  className?: string;
  rounded?: "sm" | "md" | "lg" | "full";
}

export function Skeleton({ className, rounded = "md" }: SkeletonProps) {
  const roundedClass = {
    sm: "rounded-sm",
    md: "rounded-md",
    lg: "rounded-lg",
    full: "rounded-full",
  }[rounded];

  return (
    <div
      className={cn("relative overflow-hidden bg-muted/60", roundedClass, className)}
      aria-hidden="true"
    >
      <div className="absolute inset-0 animate-shimmer" />
    </div>
  );
}
