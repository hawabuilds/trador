import assert from "node:assert/strict";
import {test} from "node:test";


import {
  DECLINE_DAYS,
  isIosSafari,
  isStandaloneDisplay,
  safariNeedsHomeScreen,
  shouldShowPushBar,
} from "@/lib/notifications/pushClient";

/*
 * The notifications bar.
 *
 * Every condition here has a cost on one side and a worse one on the other: too
 * loose and the app nags on every screen with a prompt that cannot be undone
 * once denied; too tight and it never appears, which is the state this was in.
 * It only ever lines up inside an installed app, so it is pinned here rather
 * than clicked through.
 */

const ok = {
  authenticated: true,
  canSubscribe: true,
  state: "off",
  permission: "default" as NotificationPermission | null,
  dismissed: false,
  intentOpen: false,
};

test("the bar shows for a signed-in person in an installed app", () => {
  assert.equal(shouldShowPushBar(ok), true);
});

test("never where a subscription cannot be made", () => {
  /*
   * iOS Safari in a tab, or a browser with no push API. The button would
   * resolve to nothing, and on iOS it would burn the one permission prompt.
   *
   * This is deliberately *not* "not installed". Gating on installation is what
   * kept the bar off every desktop and Android browser, so nobody subscribed
   * and the first follow notification had nowhere to go.
   */
  assert.equal(shouldShowPushBar({...ok, canSubscribe: false}), false);
});

test("never before signing in", () => {
  // There is no account to attach a subscription to yet.
  assert.equal(shouldShowPushBar({...ok, authenticated: false}), false);
});

test("never once permission has been answered either way", () => {
  for (const permission of ["granted", "denied"] as NotificationPermission[]) {
    assert.equal(shouldShowPushBar({...ok, permission}), false, permission);
  }
});

test("never when the deployment has no push keys, or the browser cannot", () => {
  for (const state of ["unconfigured", "unsupported", "denied", "on"]) {
    assert.equal(shouldShowPushBar({...ok, state}), false, state);
  }
});

test("a dismissal is respected", () => {
  assert.equal(shouldShowPushBar({...ok, dismissed: true}), false);
  // Long enough to read as honoured rather than deferred by a day.
  assert.ok(DECLINE_DAYS >= 30);
});

test("the bar never stacks on top of the action sheet", () => {
  assert.equal(shouldShowPushBar({...ok, intentOpen: true}), false);
});

test("iOS is recognised, and Chrome on iOS is not treated as Safari", () => {
  const iphone =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
  assert.equal(isIosSafari(iphone), true);
  assert.equal(isIosSafari(iphone.replace("Safari/604.1", "CriOS/120 Safari/604.1")), false);
  assert.equal(isIosSafari("Mozilla/5.0 (Windows NT 10.0) Chrome/120"), false);
});

test("outside a browser these answer false rather than throwing", () => {
  // They run during server rendering too, where there is no `window`.
  assert.equal(isStandaloneDisplay(), false);
  assert.equal(safariNeedsHomeScreen("Mozilla/5.0 (Windows NT 10.0) Chrome/120"), false);
});
