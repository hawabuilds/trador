"use client";

import {useRef, useState} from "react";
import {useRouter} from "next/navigation";
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";

import {APP_SCROLL_PAD_TOP} from "@/components/AppShell";
import {ConnectionsSheet} from "@/components/ConnectionsSheet";
import {Avatar} from "@/components/ui/Avatar";
import {Button} from "@/components/ui/Button";
import {ChevronLeftIcon, UserIcon} from "@/components/ui/Icons";
import {useSession} from "@/lib/session";
import {cn} from "@/lib/cn";
import {compact} from "@/lib/format";
import {shortPubkey} from "@/lib/pubkey";
import type {Profile} from "@/lib/types";

interface ProfileResponse {
  profile: Profile;
  followers: Profile[];
  following: Profile[];
}

/**
 * Someone else's profile.
 *
 * Readable signed out, because a profile link shared into a group chat has to
 * open for whoever taps it. What changes when you are signed in is the Follow
 * button — `isFollowing` comes back null for a visitor, and the button is then
 * not rendered at all rather than being rendered and failing on tap.
 */
export function ProfileScreen({handle}: {handle: string}) {
  const router = useRouter();
  const session = useSession();
  const queryClient = useQueryClient();

  const [connections, setConnections] = useState<"followers" | "following" | null>(
    null,
  );
  const followersRef = useRef<HTMLButtonElement>(null);
  const followingRef = useRef<HTMLButtonElement>(null);

  const query = useQuery({
    queryKey: ["profile", handle],
    queryFn: async (): Promise<ProfileResponse | null> => {
      const token = await session.getAccessToken();
      const response = await fetch(`/api/profile/${handle}`, {
        headers: token ? {authorization: `Bearer ${token}`} : {},
      });
      // A missing handle is an ordinary outcome, not an error worth a retry.
      if (response.status === 404) return null;
      if (!response.ok) throw new Error("Could not load this profile.");
      return (await response.json()) as ProfileResponse;
    },
  });

  const follow = useMutation({
    mutationFn: async (wantFollow: boolean) => {
      const token = await session.getAccessToken();
      if (!token) throw new Error("Sign in to follow people.");

      const response = await fetch("/api/follows", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({handle, following: wantFollow}),
      });
      if (!response.ok) throw new Error("Could not update that follow.");
    },
    // Refetched rather than patched locally: the follower *count* moves too,
    // and a local toggle that updates the button but not the number beside it
    // is the kind of small lie people notice immediately.
    onSuccess: () => queryClient.invalidateQueries({queryKey: ["profile", handle]}),
  });

  const profile = query.data?.profile ?? null;
  const isSelf = session.user?.handle === profile?.handle;

  return (
    <div className={APP_SCROLL_PAD_TOP}>
      <button
        type="button"
        onClick={() => router.back()}
        aria-label="Back"
        className="-ml-2 grid h-9 w-9 place-items-center rounded-full text-muted transition-colors hover:bg-[var(--overlay-wash)] hover:text-ink"
      >
        <ChevronLeftIcon className="h-5 w-5" />
      </button>

      {query.isLoading ? (
        <div className="mt-4 flex items-center gap-3">
          <div className="h-14 w-14 animate-pulse rounded-full bg-wash" />
          <div className="flex-1">
            <div className="h-4 w-32 animate-pulse rounded bg-wash" />
            <div className="mt-2 h-3 w-20 animate-pulse rounded bg-wash" />
          </div>
        </div>
      ) : !profile ? (
        <div className="px-6 py-16 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[var(--overlay-wash)] text-faint">
            <UserIcon className="h-6 w-6" />
          </span>
          <p className="mt-4 text-[14px] font-bold">No account @{handle}</p>
          <p className="mx-auto mt-1.5 max-w-[32ch] text-[13px] leading-[1.5] text-muted">
            {query.error
              ? (query.error as Error).message
              : "Nobody has claimed this handle here yet."}
          </p>
        </div>
      ) : (
        <>
          <div className="mt-4 flex items-start gap-3">
            <Avatar name={profile.displayName} src={profile.pfpUrl} size={56} />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[20px] font-extrabold tracking-[-0.03em]">
                {profile.displayName}
              </h1>
              <div className="truncate text-[13px] font-semibold text-faint">
                @{profile.handle}
              </div>
            </div>

            {/*
              Null means nobody is signed in, which is not the same as "not
              following" — so no button at all, rather than one that fails at
              the moment it is tapped.
            */}
            {!isSelf && profile.isFollowing !== null ? (
              <Button
                variant={profile.isFollowing ? "outline" : "primary"}
                size="sm"
                disabled={follow.isPending}
                onClick={() => follow.mutate(!profile.isFollowing)}
              >
                {profile.isFollowing ? "Following" : "Follow"}
              </Button>
            ) : null}
          </div>

          {profile.bio ? (
            <p className="mt-3 text-[13.5px] leading-[1.55] text-muted">
              {profile.bio}
            </p>
          ) : null}

          <div className="mt-3 flex items-center gap-4">
            <button
              ref={followersRef}
              type="button"
              onClick={() =>
                setConnections(connections === "followers" ? null : "followers")
              }
              className="tabular-nums text-[12.5px] font-semibold text-faint transition-colors hover:text-ink"
            >
              <span className="font-extrabold text-ink">
                {compact(profile.followers)}
              </span>{" "}
              followers
            </button>
            <button
              ref={followingRef}
              type="button"
              onClick={() =>
                setConnections(connections === "following" ? null : "following")
              }
              className="tabular-nums text-[12.5px] font-semibold text-faint transition-colors hover:text-ink"
            >
              <span className="font-extrabold text-ink">
                {compact(profile.following)}
              </span>{" "}
              following
            </button>
          </div>

          {profile.wallet ? (
            <div
              className={cn(
                "mt-4 flex items-center justify-between gap-3 rounded-2xl",
                "bg-[var(--segment-track)] px-3.5 py-2.5 shadow-inset-soft",
              )}
            >
              <span className="text-[12px] font-bold text-faint">Wallet</span>
              <span className="font-mono text-[12.5px] font-semibold">
                {shortPubkey(profile.wallet, 5, 5)}
              </span>
            </div>
          ) : null}

          {follow.error ? (
            <p role="alert" className="mt-3 text-[12.5px] font-semibold text-error">
              {(follow.error as Error).message}
            </p>
          ) : null}

          <ConnectionsSheet
            open={connections === "followers"}
            anchorRef={followersRef}
            title="Followers"
            people={query.data?.followers ?? []}
            emptyLabel={`Nobody follows @${profile.handle} yet.`}
            onClose={() => setConnections(null)}
          />
          <ConnectionsSheet
            open={connections === "following"}
            anchorRef={followingRef}
            title="Following"
            people={query.data?.following ?? []}
            emptyLabel={`@${profile.handle} is not following anyone yet.`}
            onClose={() => setConnections(null)}
          />
        </>
      )}
    </div>
  );
}
