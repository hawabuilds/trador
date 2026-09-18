"use client";

import {useCallback, useEffect, useState} from "react";

import {usePushNotifications} from "@/hooks/usePushNotifications";
import {useUser} from "@/hooks/useUser";
import {
  declinedRecently,
  isStandaloneDisplay,
  markPushDeclined,
  pushApiAvailable,
  safariNeedsHomeScreen,
  shouldShowPushBar,
} from "@/lib/notifications/pushClient";
import {Button} from "./ui/Button";
import {Sheet} from "./ui/Sheet";

/**
 * Asking to turn notifications on, in the two places it is fair to ask.
 *
 * **A bar, once, in the installed app.** Someone who has added Trador to their
 * Home Screen has opted into it being an app, and an app that cannot reach you
 * is not much of one. The bar sits above the tab bar rather than over the feed,
 * is one tap to allow, and one tap to dismiss for a month.
 *
 * **A sheet, after an action that earns it.** Starring a coin or posting a
 * comment creates something worth being told about, which is the moment the
 * request makes sense on its own terms. Those call sites already exist; this is
 * what finally answers them.
 *
 * Nothing is asked on load, ever. A browser penalises a site that does, and
 * someone who dismisses a prompt they did not summon usually blocks it for
 * good — a decision that cannot be reversed from inside the app.
 *
 * The bar appears wherever a subscription can actually be made. That is every
 * browser except iOS in a tab, where Safari delivers push only to an installed
 * app — there the sheet explains Add to Home Screen instead of offering a
 * button that cannot work.
 */
export type PushIntent = "watchlist" | "comment" | "trade" | "launch";

/** The event the call sites fire. A module variable would not cross the tree. */
const INTENT_EVENT = "trador:push-intent";

export function requestPushIntent(intent: PushIntent): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<PushIntent>(INTENT_EVENT, {detail: intent}));
}

const COPY: Record<PushIntent, {title: string; body: string}> = {
  watchlist: {
    title: "Get a ping when this coin moves",
    body: "Alerts for the coins you watch, replies to your comments, and coins about to graduate. Change any of it in Settings.",
  },
  comment: {
    title: "Know when someone replies",
    body: "Turn on notifications so a reply to your comment does not sit unseen. One tap in Settings to mute.",
  },
  trade: {
    title: "Know when this one runs",
    body: "Get told when a coin you hold hits a multiple, and when one you watch is close to graduating.",
  },
  launch: {
    title: "Follow your launch",
    body: "Get told when your coin graduates and when holders trade it. Change this anytime in Settings.",
  },
};

export function PushPrompt() {
  const {authenticated} = useUser();
  const push = usePushNotifications();

  const [intent, setIntent] = useState<PushIntent | null>(null);
  const [needsHomeScreen, setNeedsHomeScreen] = useState(false);
  /*
   * Read in an effect, not during render.
   *
   * All three depend on `window`, so reading them while rendering would make
   * the server's HTML and the first client render disagree and hydration would
   * throw. The bar appearing one frame late is invisible; a hydration error is
   * the whole screen.
   */
  const [canSubscribe, setCanSubscribe] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    /*
     * Can a subscription be made from here at all?
     *
     * Push works in an ordinary tab everywhere except iOS, where Safari
     * delivers only to an installed app. Asking anywhere else is fine; asking
     * on iOS-in-a-tab would spend the one prompt on something that cannot work.
     */
    setCanSubscribe(pushApiAvailable() && !safariNeedsHomeScreen());
    setDismissed(declinedRecently());
    if (typeof Notification !== "undefined") setPermission(Notification.permission);

    /*
     * Register the worker on load, rather than waiting for someone to enable
     * notifications.
     *
     * Registering is not asking: it installs the script that will later receive
     * a push and shows no prompt at all. Doing it here means the worker is
     * already active when permission is granted — subscribing against a worker
     * that is still installing throws — and it is what makes an installed app
     * behave like one.
     */
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker
        .register("/sw.js", {scope: "/"})
        .catch((error: unknown) =>
          console.warn("service worker registration failed", error),
        );
    }
  }, []);

  useEffect(() => {
    const onIntent = (event: Event) => {
      const detail = (event as CustomEvent<PushIntent>).detail;
      if (!authenticated) return;
      if (declinedRecently()) return;
      // Already granted: the action itself will notify, so there is nothing to
      // ask for.
      if (typeof Notification !== "undefined" && Notification.permission !== "default") {
        return;
      }
      if (safariNeedsHomeScreen()) {
        setNeedsHomeScreen(true);
        setIntent(detail);
        return;
      }
      if (!pushApiAvailable()) return;
      setNeedsHomeScreen(false);
      setIntent(detail);
    };

    window.addEventListener(INTENT_EVENT, onIntent);
    return () => window.removeEventListener(INTENT_EVENT, onIntent);
  }, [authenticated]);

  const decline = useCallback(() => {
    markPushDeclined();
    setDismissed(true);
    setIntent(null);
  }, []);

  const enable = useCallback(async () => {
    // On iOS this cannot succeed from a tab, so the sheet explains instead.
    if (needsHomeScreen && !isStandaloneDisplay()) return;

    /*
     * `push.enable()` requests permission as its first await, which iOS
     * requires: the permission call has to be reached directly from the tap,
     * before any other promise resolves, or Safari ignores it.
     */
    await push.enable();
    if (typeof Notification !== "undefined") setPermission(Notification.permission);
    setIntent(null);
  }, [needsHomeScreen, push]);

  const copy = intent ? COPY[intent] : COPY.watchlist;

  const showBar = shouldShowPushBar({
    authenticated,
    canSubscribe,
    state: push.state,
    permission,
    dismissed,
    intentOpen: intent !== null,
  });

  return (
    <>
      {showBar ? (
        <div className="pointer-events-auto absolute inset-x-0 bottom-[calc(96px+env(safe-area-inset-bottom))] z-40 px-[22px]">
          <div className="flex items-center gap-3 rounded-2xl bg-surface-card px-4 py-3 shadow-card">
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-bold">Turn on notifications</div>
              <p className="mt-0.5 text-[11.5px] leading-[1.45] text-faint">
                Graduations, replies and coins you hold.
              </p>
            </div>
            <button
              type="button"
              onClick={decline}
              className="shrink-0 text-[12px] font-bold text-faint transition-colors hover:text-muted"
            >
              Not now
            </button>
            <button
              type="button"
              onClick={() => void enable()}
              disabled={push.busy}
              className="shrink-0 rounded-full bg-brand-500 px-3.5 py-2 text-[12.5px] font-extrabold text-white shadow-brand disabled:opacity-60"
            >
              {push.busy ? "…" : "Allow"}
            </button>
          </div>
        </div>
      ) : null}

      <Sheet
        open={intent !== null}
        onClose={decline}
        height="auto"
        label="Notifications"
      >
        <div className="px-1 pb-5 pt-1">
          <h2 className="text-[18px] font-extrabold tracking-[-0.03em]">{copy.title}</h2>
          <p className="mt-2 text-[13.5px] leading-[1.5] text-muted">{copy.body}</p>

          {needsHomeScreen ? (
            <p className="mt-3 text-[13px] leading-[1.5] text-ink">
              On iPhone, add Trador to your Home Screen first — Share, then Add to
              Home Screen — and open it from there. Safari only delivers
              notifications to installed apps.
            </p>
          ) : null}

          <div className="mt-5 flex flex-col gap-2">
            {needsHomeScreen ? null : (
              <Button type="button" onClick={() => void enable()} disabled={push.busy}>
                Turn on notifications
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={decline}>
              Not now
            </Button>
          </div>
        </div>
      </Sheet>
    </>
  );
}
