"use client";

import {useEffect, useState, type ReactNode} from "react";

/**
 * The desktop phone from the showcase deployment.
 *
 * The app itself is the screen: routes, scrolls and sheets all run inside the
 * glass. The bezel, island and status glyphs are chrome and do not take clicks.
 * On a narrow viewport the shell collapses (see globals.css) so a phone opening
 * this same link still gets the full-screen app.
 */
export function PhoneStage({children}: {children: ReactNode}) {
  return (
    <div className="phone-stage">
      <div className="phone">
        <span className="phone-btn phone-btn-silent" />
        <span className="phone-btn phone-btn-volup" />
        <span className="phone-btn phone-btn-voldown" />
        <span className="phone-btn phone-btn-power" />
        <div className="phone-bezel">
          <div className="phone-screen">{children}</div>
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
