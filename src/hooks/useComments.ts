"use client";

import {useCallback, useMemo} from "react";
import {useQuery, useQueryClient} from "@tanstack/react-query";
import {readLocalComments, writeLocalComment} from "@/lib/localStore";
import {useSession} from "@/lib/session";
import type {
  AssetComment,
  AssetKind,
  CommentThread,
} from "@/lib/types";
import {useLocalStore} from "./useLocalStore";
import {useUser} from "./useUser";
import {requestPushIntent} from "@/components/PushPrompt";

/**
 * Groups a flat, oldest-first list into one-level threads.
 *
 * A reply whose root fell outside the fetched window is promoted to a root of
 * its own rather than dropped, so a long-running asset never silently loses
 * comments off the top.
 */
function buildThreads(comments: AssetComment[]): CommentThread[] {
  const threads = new Map<string, CommentThread>();
  const orphans: AssetComment[] = [];

  for (const comment of comments) {
    if (!comment.parentId) threads.set(comment.id, {root: comment, replies: []});
  }

  for (const comment of comments) {
    if (!comment.parentId) continue;
    const thread = threads.get(comment.parentId);
    if (thread) thread.replies.push(comment);
    else orphans.push(comment);
  }

  return [
    ...Array.from(threads.values()),
    ...orphans.map((root) => ({root, replies: []})),
  ].sort(
    (a, b) =>
      new Date(a.root.createdAt).getTime() - new Date(b.root.createdAt).getTime(),
  );
}

/**
 * Comments for one asset.
 *
 * Live comments come from Supabase. Anything posted while the database is
 * down is written to this browser and merged in.
 */
export function useComments(kind: AssetKind, assetId: string) {
  const {authenticated, handle, displayName, pfpUrl} = useUser();
  const session = useSession();
  const queryClient = useQueryClient();

  const remote = useQuery({
    queryKey: ["comments", kind, assetId],
    queryFn: async () => {
      // With a token, so the server can say which of these the caller liked.
      const token = await session.getAccessToken();
      const res = await fetch(`/api/asset/${kind}/${assetId}/comments`, {
        headers: token ? {authorization: `Bearer ${token}`} : undefined,
      });
      if (!res.ok) throw new Error("Could not load comments.");
      return (await res.json()) as {comments: AssetComment[]; localOnly: boolean};
    },
    retry: false,
    // Comments are a conversation: new ones should arrive without a reload.
    refetchInterval: 20_000,
  });

  const readLocal = useCallback(
    () => readLocalComments(assetId),
    [assetId],
  );
  const [local] = useLocalStore<AssetComment[]>(readLocal, []);

  const comments = useMemo(() => {
    const merged = [...(remote.data?.comments ?? []), ...local];
    return merged.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }, [remote.data, local]);

  const threads = useMemo(() => buildThreads(comments), [comments]);

  const post = useCallback(
    ({body, parentId}: {body: string; parentId: string | null}) => {
      const trimmed = body.trim();
      if (!trimmed || !authenticated) return;
      requestPushIntent("comment");
      if (remote.data?.localOnly === false) {
        void session.getAccessToken().then(async (token) => {
          if (!token) return;
          await fetch(`/api/asset/${kind}/${assetId}/comments`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({body: trimmed.slice(0, 500), parentId}),
          });
          await queryClient.invalidateQueries({queryKey: ["comments", kind, assetId]});
        });
        return;
      }
      writeLocalComment({
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        assetId,
        parentId,
        author: {
          handle: handle ?? "you",
          displayName: displayName ?? "You",
          pfpUrl,
        },
        body: trimmed.slice(0, 500),
        createdAt: new Date().toISOString(),
      });
    },
    [assetId, authenticated, handle, displayName, pfpUrl, kind, queryClient, remote.data?.localOnly, session],
  );

  /*
   * Like or unlike, reflected immediately and settled on the server's count.
   *
   * Optimistic because a heart that waits a round trip to fill reads as a tap
   * that did not register, and gets tapped again — which would unlike it.
   */
  const toggleLike = useCallback(
    (commentId: string) => {
      if (!authenticated || remote.data?.localOnly !== false) return;
      const key = ["comments", kind, assetId];
      const current = queryClient.getQueryData<{comments: AssetComment[]; localOnly: boolean}>(key);
      const target = current?.comments.find((comment) => comment.id === commentId);
      if (!current || !target) return;

      const nextLiked = !target.liked;
      const patch = (likes: number, liked: boolean) =>
        queryClient.setQueryData(key, {
          ...current,
          comments: current.comments.map((comment) =>
            comment.id === commentId ? {...comment, likes, liked} : comment,
          ),
        });

      patch(Math.max(0, (target.likes ?? 0) + (nextLiked ? 1 : -1)), nextLiked);

      void session.getAccessToken().then(async (token) => {
        if (!token) return;
        try {
          const res = await fetch(`/api/comments/${commentId}/like`, {
            method: "POST",
            headers: {"content-type": "application/json", authorization: `Bearer ${token}`},
            body: JSON.stringify({liked: nextLiked}),
          });
          if (!res.ok) throw new Error();
          const settled = (await res.json()) as {likes: number; liked: boolean};
          patch(settled.likes, settled.liked);
        } catch {
          // Put it back rather than leave a count the server does not agree with.
          patch(target.likes ?? 0, Boolean(target.liked));
        }
      });
    },
    [assetId, authenticated, kind, queryClient, remote.data?.localOnly, session],
  );

  return {
    comments,
    threads,
    toggleLike,
    isLoading: remote.isLoading,
    error: remote.error ? (remote.error as Error).message : null,
    retry: () => void remote.refetch(),
    canPost: authenticated,
    localOnly: remote.data?.localOnly ?? true,
    post,
  };
}
