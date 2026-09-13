import type {Metadata, Viewport} from "next";
import {Inter, JetBrains_Mono} from "next/font/google";

import {Providers} from "@/components/providers/Providers";
import {OVERLAY_ROOT_ID} from "@/components/ui/OverlayPortal";
import {APP_NAME, APP_SUBTITLE, APP_TAGLINE} from "@/config/app";
import {appOrigin} from "@/lib/routes";
import {THEME_COLOR} from "@/lib/theme";

import "./globals.css";

/**
 * Inter for interface copy: 400 body, 300 large display, 500/700 headings.
 * Tabular figures keep price columns stable; mono stays on addresses only.
 */
const display = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
  variable: "--font-display",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
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
  appleWebApp: {capable: true, title: APP_NAME, statusBarStyle: "black-translucent"},
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
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
      className={`dark ${display.variable} ${mono.variable}`}
      style={{colorScheme: "dark"}}
      data-theme="dark"
    >
      <body className="font-sans text-ink antialiased">
        <Providers>
          <div className="app-frame">
            {children}
            <div id={OVERLAY_ROOT_ID} />
          </div>
        </Providers>
      </body>
    </html>
  );
}
