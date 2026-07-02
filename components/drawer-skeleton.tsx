import { Skeleton } from "./skeleton";

export function HistoryDrawerSkeleton() {
  return (
    <div
      className="fixed top-0 left-0 z-50 w-80 h-full bg-card border-r border-border shadow-2xl flex flex-col animate-fade-in"
      aria-hidden="true"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <Skeleton className="h-4 w-16" />
        <div className="flex items-center gap-1">
          <Skeleton className="h-7 w-16" rounded="sm" />
          <Skeleton className="h-7 w-7" rounded="sm" />
        </div>
      </div>
      <div className="flex-1 p-2 space-y-1">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-start gap-3 p-2.5 rounded-lg">
            <Skeleton className="w-11 h-11 flex-shrink-0" />
            <div className="flex-1 space-y-2 pt-1">
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
