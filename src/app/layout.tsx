import type {Metadata, Viewport} from "next";

import {APP_NAME, APP_SUBTITLE, APP_TAGLINE} from "@/config/app";

import "./globals.css";

export const metadata: Metadata = {
  title: {default: `${APP_NAME} — ${APP_TAGLINE}`, template: `%s · ${APP_NAME}`},
  description: APP_SUBTITLE,
  applicationName: APP_NAME,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: [
    {media: "(prefers-color-scheme: dark)", color: "#0d0f18"},
    {media: "(prefers-color-scheme: light)", color: "#f5f5ff"},
  ],
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en" className="dark">
      <body>
        <div className="app-frame">
          {children}
          {/*
            Overlays portal in here rather than into <body>, so on a wide screen
            a sheet stays inside the phone frame instead of covering the desktop.
          */}
          <div id="app-overlays" />
        </div>
      </body>
    </html>
  );
}
