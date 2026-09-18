"use client";

import {useCallback, useEffect, useState} from "react";

import {useSession} from "@/lib/session";

type PushState = "unsupported" | "unconfigured" | "denied" | "off" | "on";

/**
 * Web push, from the browser's side.
 *
 * Every step here can fail for a reason that is not a bug — no service worker
 * in this browser, no VAPID keys on this deployment, permission already denied
 * at the OS level — so the hook reports a state rather than throwing, and the
 * UI renders the reason instead of a broken toggle.
 *
 * Permission is only ever requested from a real tap. Browsers penalise sites
 * that ask on load, and a person who dismisses a prompt they did not summon
 * usually blocks it permanently.
 */
export function usePushNotifications() {
  const session = useSession();
  const [state, setState] = useState<PushState>("off");
  const [busy, setBusy] = useState(false);
  /*
   * Why the last attempt failed, in words.
   *
   * Every failure here used to end at `setState("off")`, so a switch that would
   * not turn on gave no reason at all — indistinguishable from not having been
   * tapped. Not knowing is how someone ends up believing notifications are on
   * when nothing is registered.
   */
  const [error, setError] = useState<string | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);

  const supported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;

  useEffect(() => {
    if (!supported) {
      setState("unsupported");
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/notifications/subscribe");
        const body = (await response.json()) as {configured: boolean; publicKey: string | null};
        if (cancelled) return;

        if (!body.configured || !body.publicKey) {
          setState("unconfigured");
          return;
        }
        setPublicKey(body.publicKey);

        if (Notification.permission === "denied") {
          setState("denied");
          return;
        }

        const registration = await navigator.serviceWorker.getRegistration();
        const existing = await registration?.pushManager.getSubscription();
        setState(existing ? "on" : "off");
      } catch {
        if (!cancelled) setState("unconfigured");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [supported]);

  const enable = useCallback(async () => {
    if (!supported || !publicKey) return;
    setBusy(true);
    setError(null);

    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        if (permission === "denied") {
          setError("Your browser blocked notifications. Allow them in site settings.");
        }
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      // `ready` rather than the register result: a worker that is installing
      // has no usable pushManager yet, and subscribing against it throws.
      await navigator.serviceWorker.ready;

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const token = await session.getAccessToken();
      if (!token) {
        setState("off");
        setError("Sign in again — this device could not be registered.");
        return;
      }

      const response = await fetch("/api/notifications/subscribe", {
        method: "POST",
        headers: {"content-type": "application/json", authorization: `Bearer ${token}`},
        // `test` asks the server for one notification back, so the first thing
        // that happens after allowing is a notification arriving.
        body: JSON.stringify({...subscription.toJSON(), test: true}),
      });

      setState(response.ok ? "on" : "off");
      if (!response.ok) {
        setError(`Could not register this device (${response.status}).`);
      }
    } catch (caught) {
      setState("off");
      setError((caught as Error).message || "Could not turn notifications on.");
    } finally {
      setBusy(false);
    }
  }, [supported, publicKey, session]);

  const disable = useCallback(async () => {
    if (!supported) return;
    setBusy(true);

    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription) {
        setState("off");
        return;
      }

      const token = await session.getAccessToken();
      if (token) {
        await fetch(
          `/api/notifications/subscribe?endpoint=${encodeURIComponent(subscription.endpoint)}`,
          {method: "DELETE", headers: {authorization: `Bearer ${token}`}},
        );
      }

      await subscription.unsubscribe();
      setState("off");
    } catch {
      // Left as-is: the next read resolves the real state.
    } finally {
      setBusy(false);
    }
  }, [supported, session]);

  return {state, busy, error, enable, disable};
}

/**
 * VAPID keys are base64url; `PushManager` wants raw bytes.
 *
 * Written out rather than pulled from a dependency because it is six lines and
 * the alternative is shipping a library to the browser for one conversion.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));

  /*
   * Built over an explicit `ArrayBuffer` rather than `Uint8Array.from`.
   *
   * `PushManager.subscribe` wants an `ArrayBufferView<ArrayBuffer>`, and the
   * generic `Uint8Array` can sit on a `SharedArrayBuffer` — which the type
   * system rejects and which would fail at runtime in a cross-origin-isolated
   * page.
   */
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
