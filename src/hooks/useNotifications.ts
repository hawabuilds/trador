"use client";

import {useCallback, useEffect, useMemo, useState} from "react";
import {useQuery, useQueryClient} from "@tanstack/react-query";

import {
  LOCAL_STORE_EVENT,
  readNotificationsSeenAt,
  writeNotificationsSeenAt,
} from "@/lib/localStore";
import {unreadCount} from "@/lib/notifications/inboxList";
import {useSession} from "@/lib/session";
import type {InboxItem} from "@/lib/server/notifications/inbox";

interface InboxResponse {
  items: InboxItem[];
}

/**
 * The list, and how much of it is new.
 *
 * "New" is anything after the moment this device last opened the screen, which
 * is a local value — see `readNotificationsSeenAt`. Read before the list
 * arrives and re-read on every local write, so opening the screen on one tab
 * clears the bell on another.
 */
export function useNotifications(options: {enabled?: boolean} = {}) {
  const session = useSession();
  const client = useQueryClient();
  const [seenAt, setSeenAt] = useState<string | null>(null);

  // After mount only: localStorage does not exist while rendering on the
  // server, and reading it in a state initialiser mismatches on hydration.
  useEffect(() => {
    const sync = () => setSeenAt(readNotificationsSeenAt());
    sync();
    window.addEventListener(LOCAL_STORE_EVENT, sync);
    return () => window.removeEventListener(LOCAL_STORE_EVENT, sync);
  }, []);

  const query = useQuery({
    queryKey: ["notifications"],
    enabled: options.enabled !== false && Boolean(session.ready && session.authenticated),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<InboxItem[]> => {
      const token = await session.getAccessToken();
      if (!token) return [];
      const response = await fetch("/api/notifications", {
        headers: {authorization: `Bearer ${token}`},
      });
      if (!response.ok) throw new Error("Could not load your notifications.");
      return ((await response.json()) as InboxResponse).items ?? [];
    },
  });

  const items = useMemo(() => query.data ?? [], [query.data]);

  const unread = useMemo(() => unreadCount(items, seenAt), [items, seenAt]);

  /** Called when the screen opens: everything up to now has been seen. */
  const markSeen = useCallback(() => {
    writeNotificationsSeenAt(new Date().toISOString());
    void client.invalidateQueries({queryKey: ["notifications"]});
  }, [client]);

  return {
    items,
    unread,
    /** What was already read when the screen opened, for the purple rows. */
    seenAt,
    loading: query.isPending && query.fetchStatus !== "idle",
    failed: query.isError,
    markSeen,
  };
}
