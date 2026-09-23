import {APP_SCROLL_PAD_TOP} from "@/components/AppShell";

export default function SearchLoading() {
  return (
    <div className={`${APP_SCROLL_PAD_TOP} space-y-4 px-[22px] pb-8`} aria-busy aria-label="Loading search">
      <div className="h-10 animate-pulse rounded-xl bg-surface-raised" />
      <div className="space-y-2">
        {Array.from({length: 6}, (_, i) => (
          <div key={i} className="flex gap-3 py-3">
            <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-surface-raised" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-4 w-24 animate-pulse rounded bg-surface-raised" />
              <div className="h-3 w-32 animate-pulse rounded bg-surface-raised" />
            </div>
            <div className="h-4 w-14 animate-pulse rounded bg-surface-raised" />
          </div>
        ))}
      </div>
    </div>
  );
}
