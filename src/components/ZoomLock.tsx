"use client";

import {useEffect} from "react";

/**
 * Stop the browser zooming the page, so it behaves like an installed app.
 *
 * The viewport meta covers Android and an installed PWA, but Safari on iOS has
 * ignored `user-scalable=no` in a browser tab since iOS 10, and a trackpad
 * pinch on a desktop browser arrives as ctrl+wheel. Both are cancelled here.
 *
 * Deliberately not blocked: the browser's own zoom keys and menu. Those are
 * somebody's eyesight, not a stray gesture, and taking them away is a real
 * accessibility loss rather than a polish win.
 */
export function ZoomLock() {
  useEffect(() => {
    const stop = (event: Event) => event.preventDefault();
    const onWheel = (event: WheelEvent) => {
      // A trackpad pinch is a wheel event with ctrl held; a real ctrl+scroll
      // from a mouse is the same thing to the browser, and means zoom too.
      if (event.ctrlKey) event.preventDefault();
    };

    // Safari's pinch events, which fire instead of touch events on iOS.
    document.addEventListener("gesturestart", stop);
    document.addEventListener("gesturechange", stop);
    document.addEventListener("gestureend", stop);
    window.addEventListener("wheel", onWheel, {passive: false});

    return () => {
      document.removeEventListener("gesturestart", stop);
      document.removeEventListener("gesturechange", stop);
      document.removeEventListener("gestureend", stop);
      window.removeEventListener("wheel", onWheel);
    };
  }, []);

  return null;
}
