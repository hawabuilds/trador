import {APP_SCROLL_PAD_TOP} from "@/components/AppShell";
import {cn} from "@/lib/cn";

/** Generic in-app skeleton while a route's server work runs. */
export default function AppLoading() {
  return (
    <div
      className={cn(APP_SCROLL_PAD_TOP, "animate-pulse space-y-4")}
      aria-busy
      aria-label="Loading"
    >
      <div className="h-8 w-40 rounded-md bg-surface-raised" />
      <div className="h-64 rounded-xl bg-surface-raised" />
    </div>
  );
}
