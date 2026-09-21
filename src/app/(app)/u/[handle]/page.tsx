import type {Metadata} from "next";

import {APP_NAME, APP_TAGLINE} from "@/config/app";
import {profilePath, shareUrl} from "@/lib/routes";
import {profileByHandle} from "@/lib/server/social";
import {ProfileScreen} from "./ProfileScreen";

export const dynamic = "force-dynamic";

/**
 * The preview a shared profile link unfurls into.
 *
 * This URL is everyone's invite link, so it is pasted into group chats and
 * posts far more than it is visited from inside the app. A bare "@handle" title
 * made it look like a broken link; a name, a line about the app and the
 * person's picture makes it look like an invitation. Rendered on the server, so
 * crawlers see it even though a signed-out visitor is sent on to sign up.
 */
export async function generateMetadata({params}: {params: {handle: string}}): Promise<Metadata> {
  const profile = await profileByHandle(params.handle, null).catch(() => null);
  if (!profile) return {title: `@${params.handle}`};

  const title = `${profile.displayName} (@${profile.handle}) on ${APP_NAME}`;
  const description = `Join ${profile.displayName} on ${APP_NAME} — ${APP_TAGLINE.toLowerCase()}. Every tokenized stock, and every coin launched against one.`;
  const url = shareUrl(profilePath(profile.handle));
  const images = profile.pfpUrl ? [{url: profile.pfpUrl, width: 400, height: 400, alt: profile.displayName}] : [];

  return {
    title: `${profile.displayName} (@${profile.handle})`,
    description,
    openGraph: {title, description, url, type: "profile", siteName: APP_NAME, images},
    twitter: {card: "summary", title, description, images: images.map((image) => image.url)},
  };
}

export default function ProfilePage({params}: {params: {handle: string}}) {
  return <ProfileScreen handle={params.handle} />;
}
