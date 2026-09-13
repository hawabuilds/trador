"use client";

import {useCallback, useEffect, useState} from "react";
import {useQuery, useQueryClient} from "@tanstack/react-query";

import {useSession} from "@/lib/session";
import {
  readProfileEdits,
  writeProfileEdits,
  type ProfileEdits,
} from "@/lib/localStore";
import type {Profile, SocialLinks} from "@/lib/types";

interface ProfileResponse {
  profile: Profile;
  followers: Profile[];
  following: Profile[];
}

/**
 * The signed-in person's own profile.
 *
 * Two stores, on purpose, and the split is not arbitrary:
 *
 *   - **Identity and follows live on the server.** A follower count has to be
 *     the same number on every device and for everyone looking, so it comes
 *     from the database or it does not come at all.
 *   - **Display name, bio and links are edited locally first**, then pushed.
 *     The edit sheet has to open instantly with what is already there, and a
 *     save has to feel done before a round trip — so localStorage is the
 *     optimistic copy and the server is the record.
 *
 * The local copy is written before the request and not rolled back if it
 * fails. That is deliberate: losing what someone typed because a network blip
 * happened is worse than a profile that is briefly ahead of the server, and the
 * next successful save reconciles it.
 */
export function useMe() {
  const session = useSession();
  const queryClient = useQueryClient();
  const handle = session.user?.handle ?? null;

  const [edits, setEdits] = useState<ProfileEdits>({
    displayName: null,
    bio: null,
    socials: {},
  });

  // Read after mount only. localStorage does not exist during SSR, and reading
  // it in a useState initialiser would mismatch on hydration.
  useEffect(() => setEdits(readProfileEdits()), []);

  const query = useQuery({
    queryKey: ["profile", handle],
    enabled: Boolean(handle),
    staleTime: 60_000,
    queryFn: async (): Promise<ProfileResponse | null> => {
      const token = await session.getAccessToken();
      const response = await fetch(`/api/profile/${handle}`, {
        headers: token ? {authorization: `Bearer ${token}`} : {},
      });
      // A 404 is the ordinary state for someone who has not saved a profile
      // yet, not an error worth surfacing.
      if (response.status === 404) return null;
      if (!response.ok) throw new Error("Could not load your profile.");
      return (await response.json()) as ProfileResponse;
    },
  });

  const save = useCallback(
    async (patch: {
      displayName: string | null;
      bio: string | null;
      socials: Partial<SocialLinks>;
    }) => {
      const next: ProfileEdits = {
        displayName: patch.displayName,
        bio: patch.bio,
        socials: patch.socials,
      };
      setEdits(next);
      writeProfileEdits(next);

      if (!handle) return;

      try {
        const token = await session.getAccessToken();
        if (!token) return;

        await fetch("/api/me", {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            handle,
            displayName: patch.displayName,
            bio: patch.bio,
            pfpUrl: session.user?.pfpUrl ?? null,
            wallet: session.user?.wallet ?? null,
          }),
        });

        await queryClient.invalidateQueries({queryKey: ["profile", handle]});
      } catch {
        // The local copy stands. See the note above.
      }
    },
    [handle, session, queryClient],
  );

  return {
    handle,
    // Local edits win over the server copy, which is what makes a save feel
    // immediate; the server value is the fallback, not the override.
    displayName:
      edits.displayName ?? query.data?.profile.displayName ?? session.user?.displayName ?? null,
    bio: edits.bio ?? query.data?.profile.bio ?? null,
    socials: {
      x: edits.socials.x ?? null,
      telegram: edits.socials.telegram ?? null,
      website: edits.socials.website ?? null,
      discord: edits.socials.discord ?? null,
    } as SocialLinks,
    pfpUrl: session.user?.pfpUrl ?? query.data?.profile.pfpUrl ?? null,
    followers: query.data?.followers ?? [],
    following: query.data?.following ?? [],
    followerCount: query.data?.profile.followers ?? 0,
    followingCount: query.data?.profile.following ?? 0,
    isLoading: query.isLoading,
    /** False when this deployment has no account store — the UI hides, not lies. */
    available: Boolean(handle) && query.error === null,
    save,
  };
}
