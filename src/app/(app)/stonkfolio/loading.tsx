import {APP_SCROLL_PAD_TOP} from "@/components/AppShell";
import {cn} from "@/lib/cn";

export default function StonkfolioLoading() {
  return (
    <div className={cn(APP_SCROLL_PAD_TOP, "animate-pulse space-y-4 px-[22px]")} aria-busy>
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-full bg-wash" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-32 rounded bg-wash" />
          <div className="h-3 w-24 rounded bg-wash" />
        </div>
      </div>
      <div className="h-9 w-48 rounded bg-wash" />
      <div className="h-[180px] rounded-panel bg-wash" />
      <div className="space-y-2">
        <div className="h-14 rounded-panel bg-wash" />
        <div className="h-14 rounded-panel bg-wash" />
        <div className="h-14 rounded-panel bg-wash" />
      </div>
    </div>
  );
}
