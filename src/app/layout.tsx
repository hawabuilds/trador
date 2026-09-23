import type {ReactNode} from "react";
import type {Metadata, Viewport} from "next";
import dynamic from "next/dynamic";
import {Inter, JetBrains_Mono, Montserrat} from "next/font/google";

import {Providers} from "@/components/providers/Providers";
import {OVERLAY_ROOT_ID} from "@/components/ui/OverlayPortal";
import {APP_NAME, APP_SUBTITLE, APP_TAGLINE} from "@/config/app";
import {appOrigin} from "@/lib/routes";
import {THEME_COLOR} from "@/lib/theme";

import "./globals.css";
import {ZoomLock} from "@/components/ZoomLock";

const Analytics = dynamic(
  () => import("@vercel/analytics/react").then((m) => ({default: m.Analytics})),
  {ssr: false},
);

/** Separate deployment only. Unset, the document is the one trador.one serves. */
const desktopPhone = process.env.NEXT_PUBLIC_DESKTOP_PHONE === "1";

const PhoneStageShell = desktopPhone
  ? dynamic(() =>
      import("@/components/PhoneStage").then((m) => ({
        default: function PhoneStageShell({children}: {children: ReactNode}) {
          return (
            <m.PhoneStage>
              <div className="app-frame">
                <m.PhoneStatusBar />
                {children}
              </div>
            </m.PhoneStage>
          );
        },
      })),
    )
  : null;

/**
 * Inter for interface copy: 400 body, 300 large display, 500/700 headings.
 * Tabular figures keep price columns stable; mono stays on addresses only.
 */
const display = Inter({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

/** Montserrat Bold, one weight, for the TRADOR wordmark only. */
const wordmark = Montserrat({
  subsets: ["latin"],
  weight: ["700"],
  variable: "--font-wordmark",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(appOrigin()),
  title: `${APP_NAME} — ${APP_TAGLINE}`,
  description: APP_SUBTITLE,
  openGraph: {
    title: `${APP_NAME} — ${APP_TAGLINE}`,
    description: APP_SUBTITLE,
    siteName: APP_NAME,
    type: "website",
  },
  /*
   * Kept for iOS 16 and earlier, which read standalone from here. Newer iOS
   * reads `display` from the manifest, which is why that file exists now.
   */
  appleWebApp: {capable: true, title: APP_NAME, statusBarStyle: "black-translucent"},
  /*
   * The home-screen icon. Without an `apple-touch-icon` iOS installs a
   * screenshot of the page as the icon, which is how an installed app ends up
   * looking like a bookmark.
   */
  icons: {
    icon: [
      {url: "/brand/favicon-32.png", sizes: "32x32", type: "image/png"},
      {url: "/brand/favicon-128.png", sizes: "128x128", type: "image/png"},
    ],
    apple: [{url: "/brand/apple-icon.png", sizes: "180x180", type: "image/png"}],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Pinch and double-tap zoom off: this is a phone-shaped app, and a page that
  // zooms under a fat-fingered tap on a chart reads as a website. `ZoomLock`
  // handles the browsers that ignore these.
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  // One colour, because there is one theme. Matches `--bg-base`, so the phone's
  // status bar and the page share an edge instead of showing a seam.
  themeColor: THEME_COLOR,
};

export default function RootLayout({
  children,
}: Readonly<{children: React.ReactNode}>) {
  return (
    <html
      lang="en"
      className={`dark ${display.variable} ${mono.variable} ${wordmark.variable}`}
      style={{colorScheme: "dark"}}
      data-theme="dark"
    >
      <body
        className={`font-sans text-ink antialiased${desktopPhone ? " desktop-phone" : ""}`}
      >
        <ZoomLock />
        <Providers>
          {PhoneStageShell ? (
            <PhoneStageShell>
              {children}
              <div id={OVERLAY_ROOT_ID} />
            </PhoneStageShell>
          ) : (
            <div className="app-frame">
              {children}
              <div id={OVERLAY_ROOT_ID} />
            </div>
          )}
        </Providers>
        <Analytics />
      </body>
    </html>
  );
}
