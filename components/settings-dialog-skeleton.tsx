import { Skeleton } from "./skeleton";

export function SettingsDialogSkeleton() {
  return (
    <div className="w-9 h-9 rounded-md flex items-center justify-center" aria-hidden="true">
      <Skeleton className="w-4 h-4" rounded="sm" />
    </div>
  );
}
