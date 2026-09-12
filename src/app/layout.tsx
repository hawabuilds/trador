import type {Metadata, Viewport} from "next";
import {Inter, JetBrains_Mono} from "next/font/google";

import {Providers} from "@/components/providers/Providers";
import {OVERLAY_ROOT_ID} from "@/components/ui/OverlayPortal";
import {APP_NAME, APP_SUBTITLE, APP_TAGLINE} from "@/config/app";
import {appOrigin} from "@/lib/routes";

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
  themeColor: [
    {media: "(prefers-color-scheme: light)", color: "#F5F5FF"},
    {media: "(prefers-color-scheme: dark)", color: "#0D0F18"},
  ],
};

export default function RootLayout({
  children,
}: Readonly<{children: React.ReactNode}>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${mono.variable}`}
      // The boot script below sets the theme class before paint, so the server
      // markup and the first client render legitimately differ on this element.
      suppressHydrationWarning
    >
      <head>
        {/*
          Theme applied before first paint, inline and synchronous. Doing it in
          an effect means a flash of the wrong theme on every cold load, which
          is the most visible bug a dark-first app can ship.

          Dark unless the person has explicitly chosen light — not
          `prefers-color-scheme`. A trading screen is read in a dark room more
          often than not, the palette is designed dark-first, and a laptop set
          to light mode is a statement about documents rather than about this.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var r=document.documentElement;var p=null;try{p=localStorage.getItem("trador.theme");}catch(e){}var t=(p==="light"||p==="dark")?p:"dark";r.classList.toggle("dark",t==="dark");r.classList.toggle("light",t==="light");r.style.colorScheme=t;r.dataset.theme=t;var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",t==="light"?"#F5F5FF":"#0D0F18");}catch(e){document.documentElement.classList.add("dark");}})();`,
          }}
        />
      </head>
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
