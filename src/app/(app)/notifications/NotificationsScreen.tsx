"use client";

import {useEffect, useRef, useState} from "react";
import {useMutation, useQueryClient} from "@tanstack/react-query";
import Link from "next/link";

import {StickyPageHeader} from "@/components/AppShell";
import {NotificationSettings} from "@/components/NotificationSettings";
import {rankById} from "@/config/ranks";
import {Avatar} from "@/components/ui/Avatar";
import {RankBadge} from "@/components/ui/RankBadge";
import {SettingsIcon} from "@/components/ui/Icons";
import {Sheet, SheetTitle} from "@/components/ui/Sheet";
import {useNotifications} from "@/hooks/useNotifications";
import {useSession} from "@/lib/session";
import {cn} from "@/lib/cn";
import {groupByAge} from "@/lib/notifications/inboxList";
import {tokenAge} from "@/lib/priceFormat";
import type {InboxItem} from "@/lib/server/notifications/inbox";

/**
 * Everything that happened to you, in one list.
 *
 * No tabs and no filters. The whole point is that this is short — only things
 * about you reach it — and a list you can read to the end does not need to be
 * divided up.
 *
 * What is new is a soft purple row rather than a dot. A dot has to be found;
 * a tinted row is read at a glance, and the tint fades out of the way the next
 * time the screen opens rather than needing to be dismissed.
 */
export function NotificationsScreen() {
  const {items, seenAt, loading, failed, markSeen} = useNotifications();
  const [settingsOpen, setSettingsOpen] = useState(false);

  // The line between read and unread is fixed when the screen opens, so rows
  // do not lose their tint while being looked at.
  const openedWith = useRef<string | null | undefined>(undefined);
  if (openedWith.current === undefined && !loading) openedWith.current = seenAt;

  useEffect(() => {
    if (!loading) markSeen();
  }, [loading, markSeen]);

  const groups = groupByAge(items);

  return (
    <div>
      <StickyPageHeader>
        <div className="flex items-center justify-between">
          <h1 className="text-[28px] font-bold tracking-[-0.03em] text-ink">Notifications</h1>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label="Notification settings"
            className="grid h-11 w-11 place-items-center rounded-full text-muted transition-colors hover:bg-[var(--overlay-wash)] hover:text-ink"
          >
            <SettingsIcon className="h-[19px] w-[19px]" />
          </button>
        </div>
      </StickyPageHeader>

      {loading ? (
        <p className="px-2 py-16 text-center text-[13px] text-muted">Loading</p>
      ) : failed ? (
        <p className="px-2 py-16 text-center text-[13px] leading-[1.5] text-muted">
          Could not load your notifications. Pull down to try again.
        </p>
      ) : items.length === 0 ? (
        <p className="px-2 py-16 text-center text-[13px] leading-[1.5] text-muted">
          Replies, votes and new followers land here.
        </p>
      ) : (
        groups.map((group) => (
          <section key={group.label}>
            <h2 className="px-4 pb-1 pt-5 text-[13px] font-semibold text-faint">{group.label}</h2>
            <ul>
              {group.items.map((item) => (
                <li key={item.id}>
                  <Row
                    item={item}
                    unread={openedWith.current === null || item.at > (openedWith.current ?? "")}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      <Sheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        height="auto"
        label="Notifications"
        header={<SheetTitle title="Notifications" onClose={() => setSettingsOpen(false)} />}
      >
        <div className="overflow-hidden rounded-2xl bg-surface-card pb-1 shadow-card">
          <NotificationSettings />
        </div>
      </Sheet>
    </div>
  );
}

function Row({item, unread}: {item: InboxItem; unread: boolean}) {
  return (
    <Link
      href={item.href}
      className={cn(
        "flex gap-3 px-4 py-3.5 transition-colors",
        // The shared purple wash, not an opacity modifier on the brand colour:
        // these colours are CSS variables, and Tailwind's `/14` on one of those
        // compiles to no background at all — the tint silently disappears.
        unread ? "bg-[var(--brand-wash)]" : "hover:bg-wash",
      )}
    >
      <Face item={item} />

      <div className="min-w-0 flex-1">
        <p className="text-[15px] leading-[1.35] text-ink">
          <Headline item={item} />
        </p>

        {item.text ? (
          <p className="mt-0.5 line-clamp-2 break-words text-[15px] leading-[1.4] text-muted">
            {item.text}
          </p>
        ) : null}

        <p className="mt-1 text-[13px] text-faint">{tokenAge(item.at)}</p>
      </div>

      {item.kind === "follow" && item.actor && !item.actor.followsBack ? (
        <FollowBack handle={item.actor.handle} />
      ) : null}
    </Link>
  );
}

/** The avatar for a person, or the coin's artwork for a price move. */
function Face({item}: {item: InboxItem}) {
  if (item.actor) {
    return (
      <Avatar
        name={item.actor.displayName}
        src={item.actor.pfpUrl}
        seed={item.actor.handle}
        size={40}
      />
    );
  }

  if (item.rank) return <RankBadge rank={item.rank} size={40} />;

  if (item.asset) {
    return <Avatar name={item.asset.symbol} src={item.asset.imageUrl} seed={item.asset.id} size={40} />;
  }

  // A grouped vote belongs to no one person, so it is shown as the action.
  return (
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--brand-wash)] text-[15px] font-semibold text-brand-500">
      ↑
    </span>
  );
}

function Headline({item}: {item: InboxItem}) {
  const who = item.actor ? <span className="font-semibold">{item.actor.handle}</span> : null;
  const symbol = item.asset?.symbol ?? "A coin you hold";

  switch (item.kind) {
    case "reply":
      return <>{who} replied to you</>;
    case "votes":
      return item.count === 1 ? (
        <>Someone found your comment useful</>
      ) : (
        <>
          <span className="font-semibold">{item.count} people</span> found your comment useful
        </>
      );
    case "follow":
      return <>{who} followed you</>;
    case "holding_multiple":
      return (
        <>
          <span className="font-semibold">{symbol}</span> is up {item.rung}x since you bought
        </>
      );
    case "watchlist_multiple":
      return (
        <>
          <span className="font-semibold">{symbol}</span> is up {item.rung}x
        </>
      );
    case "graduating_soon":
      return (
        <>
          <span className="font-semibold">{symbol}</span> is close to graduating
        </>
      );
    case "graduation":
      return (
        <>
          <span className="font-semibold">{symbol}</span> graduated
        </>
      );
    case "rank_up":
      return (
        <>
          You reached <span className="font-semibold">{rankById(item.rank ?? "intern").name}</span>
        </>
      );
  }
}

/**
 * Follows back without leaving the list.
 *
 * Inside the row's link, so the click has to be stopped by hand or tapping the
 * button would also navigate to their profile.
 */
function FollowBack({handle}: {handle: string}) {
  const session = useSession();
  const client = useQueryClient();

  const follow = useMutation({
    mutationFn: async () => {
      const token = await session.getAccessToken();
      if (!token) throw new Error("Sign in to follow people.");

      const response = await fetch("/api/follows", {
        method: "POST",
        headers: {"content-type": "application/json", authorization: `Bearer ${token}`},
        body: JSON.stringify({handle, following: true}),
      });
      if (!response.ok) throw new Error("Could not follow them.");
    },
    onSuccess: () => {
      void client.invalidateQueries({queryKey: ["notifications"]});
      void client.invalidateQueries({queryKey: ["profile", handle]});
    },
  });

  if (follow.isSuccess) return <span className="shrink-0 self-center text-[13px] text-faint">Following</span>;

  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        follow.mutate();
      }}
      disabled={follow.isPending}
      className="h-9 shrink-0 self-center rounded-full bg-brand-500 px-3.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
    >
      Follow back
    </button>
  );
}
