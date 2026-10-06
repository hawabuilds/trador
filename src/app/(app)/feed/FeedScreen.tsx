"use client";

import {useState} from "react";

import {StickyPageHeader} from "@/components/AppShell";
import {FeedCommentRow} from "@/components/feed/FeedCommentRow";
import {FeedTradeRow} from "@/components/feed/FeedTradeRow";
import {LoadMore} from "@/components/LoadMore";
import {PanelTabs, type PanelTab} from "@/components/PanelTabs";
import {BellIcon} from "@/components/ui/Icons";
import {useSocialFeed, type FeedTab} from "@/hooks/useSocialFeed";
import {useUser} from "@/hooks/useUser";

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
  const {authenticated} = useUser();
  /*
   * Following first for someone signed in, since that is the feed they came
   * for. A visitor, or somebody who follows nobody, opens on Top calls — an
   * empty Following tab is a dead end on a first visit.
   */
  const [tab, setTab] = useState<FeedTab>(authenticated ? "following" : "top");
  const feed = useSocialFeed(tab, {enabled: tab !== "top"});
  const now = Date.now();

  return (
    // Clear of the floating tab bar, so the last row is readable rather than
    // half under it.
    <div className="pb-[calc(84px+env(safe-area-inset-bottom))]">
      <StickyPageHeader>
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-[28px] font-bold tracking-[-0.03em] text-ink">Feed</h1>
          <button
            type="button"
            aria-label="Alerts"
            className="grid h-11 w-11 place-items-center rounded-full text-muted transition-colors hover:bg-[var(--overlay-wash)] hover:text-ink"
          >
            <BellIcon className="h-[21px] w-[21px]" />
          </button>
        </div>
        <PanelTabs tabs={TABS} value={tab} onChange={setTab} size="md" align="start" />
      </StickyPageHeader>

      {tab === "top" ? (
        <p className="px-2 py-16 text-center text-[13px] leading-[1.5] text-muted">
          The best calls land here next.
        </p>
      ) : (
        <FeedList
          feed={feed}
          now={now}
          empty={
            tab === "following"
              ? "Follow a few people and their buys, sells and takes land here."
              : "No takes yet. Open a coin and post the first one."
          }
        />
      )}
    </div>
  );
}

function FeedList({
  feed,
  now,
  empty,
}: {
  feed: ReturnType<typeof useSocialFeed>;
  now: number;
  empty: string;
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
      <p className="mx-auto max-w-[30ch] px-2 py-16 text-center text-[13px] leading-[1.5] text-muted">
        {empty}
      </p>
    );
  }

  return (
    <>
      <ul>
        {feed.items.map((item) => (
          <li key={`${item.type}:${item.id}`}>
            {item.type === "trade" ? (
              <FeedTradeRow trade={item} now={now} />
            ) : (
              <FeedCommentRow comment={item} now={now} />
            )}
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
