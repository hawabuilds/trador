"use client";

import {useState} from "react";
import Link from "next/link";

import {StickyPageHeader} from "@/components/AppShell";
import {FeedCommentRow} from "@/components/feed/FeedCommentRow";
import {LoadMore} from "@/components/LoadMore";
import {PanelTabs, type PanelTab} from "@/components/PanelTabs";
import {BellIcon} from "@/components/ui/Icons";
import {SegmentedToggle, type SegmentedOption} from "@/components/ui/SegmentedToggle";
import {useNotifications} from "@/hooks/useNotifications";
import {useSocialFeed, type FeedTab} from "@/hooks/useSocialFeed";

type TopWindow = "week" | "all";

const WINDOWS: SegmentedOption<TopWindow>[] = [
  {value: "week", label: "This week"},
  {value: "all", label: "All time"},
];

const TABS: PanelTab<FeedTab>[] = [
  {value: "following", label: "Following"},
  {value: "top", label: "Top calls"},
  {value: "latest", label: "Latest"},
];

/**
 * The Feed.
 *
 * One list of what people are saying and doing, with the tabs deciding which
 * people. Latest is every comment; Following and Top calls arrive with their
 * own reads and are empty until then.
 */
export function FeedScreen() {
  const [tab, setTab] = useState<FeedTab>("top");
  const [period, setPeriod] = useState<TopWindow>("week");
  const feed = useSocialFeed(tab, {enabled: tab !== "following", period});
  const now = Date.now();

  return (
    <div>
      <StickyPageHeader>
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-[28px] font-bold tracking-[-0.03em] text-ink">Feed</h1>
          <NotificationsBell />
        </div>
        <PanelTabs tabs={TABS} value={tab} onChange={setTab} size="md" align="start" />
      </StickyPageHeader>

      {tab === "following" ? (
        <p className="px-2 py-16 text-center text-[13px] leading-[1.5] text-muted">
          The people you follow land here next.
        </p>
      ) : (
        <>
          {tab === "top" ? (
            <div className="flex justify-end pb-1 pt-3">
              <SegmentedToggle options={WINDOWS} value={period} onChange={setPeriod} />
            </div>
          ) : null}
          <FeedList
            feed={feed}
            now={now}
            empty={
              tab === "top"
                ? period === "week"
                  ? "No calls this week yet."
                  : "No calls yet."
                : "No takes yet. Open a coin and post the first one."
            }
            // A quiet week is not a dead end: the calls people voted on are
            // one tap away rather than behind a switch nobody thinks to try.
            emptyAction={
              tab === "top" && period === "week"
                ? {label: "See all time", onAct: () => setPeriod("all")}
                : undefined
            }
          />
        </>
      )}
    </div>
  );
}

function FeedList({
  feed,
  now,
  empty,
  emptyAction,
}: {
  feed: ReturnType<typeof useSocialFeed>;
  now: number;
  empty: string;
  emptyAction?: {label: string; onAct: () => void};
}) {
  if (feed.isLoading) {
    return (
      <ul className="divide-y-0">
        {Array.from({length: 4}).map((_unused, index) => (
          <li key={index} className="flex gap-3 py-4">
            <div className="h-10 w-10 animate-pulse rounded-full bg-wash" />
            <div className="flex-1">
              <div className="h-3.5 w-28 animate-pulse rounded bg-wash" />
              <div className="mt-2 h-3 w-16 animate-pulse rounded bg-wash" />
              <div className="mt-3 h-3.5 w-full animate-pulse rounded bg-wash" />
            </div>
          </li>
        ))}
      </ul>
    );
  }

  if (feed.error) {
    return (
      <p className="px-2 py-16 text-center text-[13px] text-muted">{feed.error.message}</p>
    );
  }

  if (feed.items.length === 0) {
    return (
      <div className="px-2 py-16 text-center">
        <p className="mx-auto max-w-[30ch] text-[13px] leading-[1.5] text-muted">{empty}</p>
        {emptyAction ? (
          <button
            type="button"
            onClick={emptyAction.onAct}
            className="mt-3 inline-flex h-11 items-center rounded-full bg-[var(--overlay-wash)] px-4 text-[13px] font-medium text-ink transition-colors hover:bg-[var(--overlay-wash-hover)]"
          >
            {emptyAction.label}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <ul>
        {feed.items.map((item) => (
          <li key={item.id}>
            <FeedCommentRow comment={item} now={now} />
          </li>
        ))}
      </ul>
      {feed.hasMore ? (
        <LoadMore onLoad={feed.loadMore} loading={feed.loadingMore} />
      ) : (
        <p className="py-8 text-center text-[13px] text-faint">You have seen everything</p>
      )}
    </>
  );
}

/**
 * The way into the list, and the only place a count is shown.
 *
 * The number is capped at 9+ because past that it stops being a count and
 * starts being a reason not to look. Nothing renders when there is nothing
 * new, so the header stays quiet for someone with an empty list.
 */
function NotificationsBell() {
  const {unread} = useNotifications();

  return (
    <Link
      href="/notifications"
      aria-label={unread > 0 ? `Notifications, ${unread} new` : "Notifications"}
      className="relative grid h-11 w-11 place-items-center rounded-full text-muted transition-colors hover:bg-[var(--overlay-wash)] hover:text-ink"
    >
      <BellIcon className="h-[21px] w-[21px]" />
      {unread > 0 ? (
        <span className="tabular-nums absolute right-1 top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-brand-500 px-1 text-[11px] font-semibold text-white">
          {unread > 9 ? "9+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
