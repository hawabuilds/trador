/**
 * What the browser will and will not let us do about notifications.
 *
 * Every check here exists because the answer differs per platform in a way that
 * changes what the UI may offer. Asking for permission where it cannot be
 * granted spends the one prompt a person will ever see on a guaranteed failure,
 * and a denied permission cannot be undone from inside the app.
 */

/** Namespaced with the app, like every other key this app stores. */
const DECLINED_KEY = "trador.push.declinedAt";

/**
 * How long a "not now" is respected.
 *
 * Long enough that declining feels honoured rather than deferred by a day.
 */
export const DECLINE_DAYS = 30;

export function isIosSafari(
  ua = typeof navigator === "undefined" ? "" : navigator.userAgent,
): boolean {
  const ios =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS reports a Mac UA; the touch point is what gives it away.
    (ua.includes("Mac") && typeof document !== "undefined" && "ontouchend" in document);
  // Every iOS browser is WebKit underneath; these are the wrappers around it.
  const webkit = /WebKit/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  return ios && webkit;
}

/** Whether this is running as an installed app rather than in a browser tab. */
export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  const media = window.matchMedia?.("(display-mode: standalone)")?.matches;
  // iOS never implemented the media query for home-screen apps; it sets this
  // non-standard flag on `navigator` instead.
  const ios =
    "standalone" in navigator &&
    Boolean((navigator as Navigator & {standalone?: boolean}).standalone);
  return Boolean(media || ios);
}

/**
 * On iOS, web push only works in an installed app.
 *
 * Safari delivers nothing to a normal tab, so on iOS the honest answer to
 * "turn on notifications" is "add this to your Home Screen first" — not a
 * permission prompt that resolves to nothing.
 */
export function safariNeedsHomeScreen(ua?: string): boolean {
  return isIosSafari(ua) && !isStandaloneDisplay();
}

export function pushApiAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function declinedRecently(now = Date.now()): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(DECLINED_KEY);
    if (!raw) return false;
    const at = Date.parse(raw);
    if (!Number.isFinite(at)) return false;
    return now - at < DECLINE_DAYS * 24 * 60 * 60_000;
  } catch {
    // Private mode. Treat as not declined: the bar is dismissible either way.
    return false;
  }
}

export function markPushDeclined(now = new Date()): void {
  try {
    window.localStorage.setItem(DECLINED_KEY, now.toISOString());
  } catch {
    // Private mode. The dismissal lasts for this session only.
  }
}

/**
 * Whether the bar may appear.
 *
 * Pulled out as a function because the cost of getting it wrong is either
 * nagging someone on every screen or never asking at all — and the second is
 * what happened: gated on being installed, the bar never appeared for anyone
 * browsing normally, so nobody ever subscribed and a follow notification had
 * nowhere to go. `push-prompt.test.ts` covers each condition.
 */
export function shouldShowPushBar(input: {
  authenticated: boolean;
  /**
   * Whether a subscription can actually be made here.
   *
   * This was `standalone`, which hid the bar in every desktop and Android
   * browser — places where push works perfectly well in a tab. Only iOS
   * requires an installed app, so only iOS should be asked to install one.
   */
  canSubscribe: boolean;
  /** From `usePushNotifications`: `off` means configured and not subscribed. */
  state: string;
  permission: NotificationPermission | null;
  dismissed: boolean;
  /** A sheet is already open for a specific action; do not stack a bar on it. */
  intentOpen: boolean;
}): boolean {
  return (
    input.authenticated &&
    input.canSubscribe &&
    input.state === "off" &&
    input.permission === "default" &&
    !input.dismissed &&
    !input.intentOpen
  );
}
