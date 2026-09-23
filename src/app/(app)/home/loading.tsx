import {APP_SCROLL_PAD_TOP} from "@/components/AppShell";
import {cn} from "@/lib/cn";

function Bar({className}: {className?: string}) {
  return <div className={cn("animate-pulse rounded-md bg-surface-raised", className)} />;
}

/** Shown while the live feed queries resolve — same chrome as HomeFeed, no data. */
export default function HomeLoading() {
  return (
    <div>
      <div
        className={cn(
          "sticky top-0 z-20 -mx-[22px] px-[22px] shadow-[0_8px_24px_-20px_var(--shadow-color)]",
          APP_SCROLL_PAD_TOP,
        )}
        style={{backgroundColor: "var(--surface-base)"}}
      >
        <div className="flex items-center justify-between pb-3">
          <Bar className="h-7 w-28" />
          <Bar className="h-9 w-9 rounded-full" />
        </div>
        <Bar className="mb-3 h-10 w-full rounded-xl" />
        <div className="flex gap-2 pb-3">
          <Bar className="h-8 w-16 rounded-full" />
          <Bar className="h-8 w-20 rounded-full" />
          <Bar className="h-8 w-14 rounded-full" />
        </div>
      </div>
      <div className="mt-2 space-y-3">
        {Array.from({length: 8}, (_, i) => (
          <div key={i} className="flex items-center gap-3 py-2">
            <Bar className="h-11 w-11 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Bar className="h-4 w-32" />
              <Bar className="h-3 w-24" />
            </div>
            <Bar className="h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
