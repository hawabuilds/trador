import type {MetadataRoute} from "next";

import {APP_NAME, APP_SUBTITLE, APP_TAGLINE} from "@/config/app";
import {THEME_COLOR} from "@/lib/theme";

/**
 * The web app manifest — what makes an installed Trador an app.
 *
 * There was none, and the app carried only `apple-mobile-web-app-capable`.
 * That meta tag is legacy: iOS 17 and later read `display` from here instead,
 * so without a manifest a home-screen launch opened inside browser chrome —
 * a URL bar and a reload button over a full-screen trading app. On Android it
 * meant the install prompt never offered a real app at all.
 *
 * `display: "standalone"` rather than `"fullscreen"`: the status bar carries
 * the clock, the battery and the signal, which somebody checking a price
 * actually wants. `display_override` asks for `standalone` explicitly before
 * the browser falls back through the older list.
 *
 * `start_url` is `/home` rather than `/`, because `/` is the sign-in landing
 * page — an installed app belongs to someone who has already signed in, and
 * launching them onto a marketing page every time is a wrong first frame. The
 * shell redirects anyone who is not signed in.
 *
 * `background_color` matches `--bg-base` exactly. It is the colour the OS
 * paints behind the splash before the first frame renders, and a light default
 * there is a white flash on every cold launch of a dark app.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: `${APP_NAME} — ${APP_TAGLINE}`,
    short_name: APP_NAME,
    description: APP_SUBTITLE,
    start_url: "/home",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "portrait",
    background_color: THEME_COLOR,
    theme_color: THEME_COLOR,
    categories: ["finance"],
    icons: [
      {src: "/brand/pwa-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any"},
      {src: "/brand/pwa-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any"},
      /*
       * Maskable is a separate entry, not a second `purpose` on the one above.
       * Android crops an icon to whatever shape the launcher uses, and a
       * non-maskable icon declared maskable loses its edges to that crop.
       */
      {
        src: "/brand/pwa-icon-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
