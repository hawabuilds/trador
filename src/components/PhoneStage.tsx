"use client";

import {useEffect, useRef, useState, type ReactNode} from "react";

/**
 * The width the app lays out at inside the frame: an iPhone 15 Pro's, in CSS
 * pixels. The screen box itself is sized from the window's height, so on a
 * laptop it is nearer 340px — and the app laid out in 340px draws everything
 * larger relative to the device and fits less on screen, which is what made
 * the showcase look zoomed in. The app renders at a real phone's width and is
 * scaled to the box instead.
 */
const PHONE_WIDTH = 393;

/** `?scale=` bounds. Below this the app is unreadable, above it absurd. */
const MIN_SCALE = 0.5;
const MAX_SCALE = 2;

/** Kept for the tab, so in-app navigation does not drop the chosen scale. */
const SCALE_KEY = "trador:phone-scale";

const clampScale = (value: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));

/**
 * How much smaller than a real phone to draw the inside, from `?scale=`.
 *
 * One is a phone. Lower shrinks the contents and fits more in the same frame,
 * which is what a recording sometimes wants. The link carries it once and the
 * tab remembers it, since the app replaces the URL as it navigates.
 */
function usePhoneScale(): number {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const read = () => {
      const asked = Number(new URLSearchParams(window.location.search).get("scale"));
      if (Number.isFinite(asked) && asked > 0) {
        const next = clampScale(asked);
        setScale(next);
        try {
          window.sessionStorage.setItem(SCALE_KEY, String(next));
        } catch {
          // Private window, or storage blocked: the param still applies.
        }
        return;
      }
      try {
        const held = Number(window.sessionStorage.getItem(SCALE_KEY));
        if (Number.isFinite(held) && held > 0) setScale(clampScale(held));
      } catch {
        // Nothing held, nothing to restore.
      }
    };

    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);

  return scale;
}

/**
 * The desktop phone from the showcase deployment.
 *
 * The app itself is the screen: routes, scrolls and sheets all run inside the
 * glass. The bezel, island and status glyphs are chrome and do not take clicks.
 * On a narrow viewport the shell collapses (see globals.css) so a phone opening
 * this same link still gets the full-screen app.
 *
 * The screen holds one scaled layer. It is laid out at a phone's width and
 * scaled to whatever the box is, so the device can be any size on screen while
 * the app inside it stays the size it is on a phone.
 */
export function PhoneStage({children}: {children: ReactNode}) {
  const screen = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{width: number; height: number} | null>(null);
  const scale = usePhoneScale();

  useEffect(() => {
    const element = screen.current;
    if (!element) return;

    const measure = () => {
      const {width, height} = element.getBoundingClientRect();
      setBox((held) =>
        held && held.width === width && held.height === height ? held : {width, height},
      );
    };

    /*
     * Measured directly, not only observed. A ResizeObserver does not fire
     * while the page is not being rendered — a hidden tab, a window behind
     * another — and the layer would then sit unscaled until something moved.
     * The observer stays for the window being dragged to another size.
     */
    measure();
    const frame = window.requestAnimationFrame(measure);
    window.addEventListener("resize", measure);

    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, []);

  /*
   * Physical pixels per CSS pixel of app. Below the breakpoint the screen is
   * `display: contents` and measures zero, and the styles below are ignored
   * anyway — a real phone gets the app at its own width, untouched.
   */
  const zoom = box && box.width > 0 ? (box.width / PHONE_WIDTH) * scale : 0;

  return (
    <div className="phone-stage">
      <div className="phone">
        <span className="phone-btn phone-btn-silent" />
        <span className="phone-btn phone-btn-volup" />
        <span className="phone-btn phone-btn-voldown" />
        <span className="phone-btn phone-btn-power" />
        <div className="phone-bezel">
          <div className="phone-screen" ref={screen}>
            <div
              className="phone-viewport"
              style={
                zoom > 0 && box
                  ? {
                      width: `${box.width / zoom}px`,
                      height: `${box.height / zoom}px`,
                      transform: `scale(${zoom})`,
                    }
                  : undefined
              }
            >
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Time, signal, Wi-Fi and battery, laid out like an iPhone status bar. */
export function PhoneStatusBar() {
  const [time, setTime] = useState("9:41");

  useEffect(() => {
    const format = () => {
      const now = new Date();
      const hours = now.getHours() % 12 || 12;
      const minutes = now.getMinutes().toString().padStart(2, "0");
      setTime(`${hours}:${minutes}`);
    };
    format();
    const id = window.setInterval(format, 15_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="phone-status" aria-hidden="true">
      <span className="phone-time">{time}</span>
      <span className="phone-island" />
      <span className="phone-glyphs">
        <SignalIcon />
        <WifiIcon />
        <BatteryIcon />
      </span>
    </div>
  );
}

function SignalIcon() {
  return (
    <svg width="17" height="12" viewBox="0 0 17 12" fill="currentColor">
      <rect x="0" y="7.5" width="3" height="4.5" rx="0.6" />
      <rect x="4.6" y="5" width="3" height="7" rx="0.6" />
      <rect x="9.2" y="2.5" width="3" height="9.5" rx="0.6" />
      <rect x="13.8" y="0" width="3" height="12" rx="0.6" />
    </svg>
  );
}

function WifiIcon() {
  return (
    <svg width="16" height="12" viewBox="0 0 16 12" fill="none">
      <path
        d="M1 4.2C3.1 2.2 5.4 1.2 8 1.2s4.9 1 7 3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M3.3 6.6c1.3-1.2 2.9-1.8 4.7-1.8s3.4.6 4.7 1.8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="8" cy="9.6" r="1.35" fill="currentColor" />
    </svg>
  );
}

function BatteryIcon() {
  return (
    <svg width="27" height="13" viewBox="0 0 27 13" fill="none">
      <rect
        x="0.7"
        y="0.7"
        width="22.2"
        height="11.6"
        rx="3.2"
        stroke="currentColor"
        strokeOpacity="0.45"
        strokeWidth="1.3"
      />
      <rect x="2.2" y="2.2" width="17.4" height="8.6" rx="1.6" fill="currentColor" />
      <path
        d="M24.2 4.2v4.6c1-.5 1.7-1.5 1.7-2.3s-.7-1.8-1.7-2.3z"
        fill="currentColor"
        fillOpacity="0.45"
      />
    </svg>
  );
}
