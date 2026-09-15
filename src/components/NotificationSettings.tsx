"use client";

import {useEffect, useState} from "react";
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";

import {usePushNotifications} from "@/hooks/usePushNotifications";
import {useSession} from "@/lib/session";
import {cn} from "@/lib/cn";
import {MILESTONES, type Milestone} from "@/lib/notifications/milestones";
import type {NotificationPrefs} from "@/lib/server/notifications/prefs";

/**
 * Notification settings, inside the settings sheet.
 *
 * Push permission is requested only from the switch below — never on load.
 * Browsers penalise sites that ask unprompted, and someone who dismisses a
 * prompt they did not summon usually blocks it for good, which is a decision
 * that cannot be undone from inside the app.
 *
 * Every state the browser can be in gets its own sentence rather than a
 * disabled toggle: "your browser cannot", "this deployment has no keys" and
 * "you blocked it" are three different problems, and only one of them is
 * fixable from here.
 */
export function NotificationSettings() {
  const session = useSession();
  const push = usePushNotifications();
  const queryClient = useQueryClient();

  const prefs = useQuery({
    queryKey: ["notification-prefs"],
    enabled: session.authenticated,
    queryFn: async (): Promise<NotificationPrefs | null> => {
      const token = await session.getAccessToken();
      if (!token) return null;
      const response = await fetch("/api/notifications/prefs", {
        headers: {authorization: `Bearer ${token}`},
      });
      if (!response.ok) return null;
      return ((await response.json()) as {prefs: NotificationPrefs}).prefs;
    },
  });

  const save = useMutation({
    mutationFn: async (patch: Partial<NotificationPrefs>) => {
      const token = await session.getAccessToken();
      if (!token) throw new Error("Sign in to change notifications.");

      const response = await fetch("/api/notifications/prefs", {
        method: "PUT",
        headers: {"content-type": "application/json", authorization: `Bearer ${token}`},
        body: JSON.stringify(patch),
      });
      if (!response.ok) throw new Error("Could not save that.");
      return ((await response.json()) as {prefs: NotificationPrefs}).prefs;
    },
    onSuccess: (next) => queryClient.setQueryData(["notification-prefs"], next),
  });

  const current = prefs.data;

  if (push.state === "unsupported") {
    return <Note>This browser cannot show push notifications.</Note>;
  }

  if (push.state === "unconfigured") {
    return (
      <Note>
        Push is not configured on this deployment. Set VAPID keys to turn it on.
      </Note>
    );
  }

  return (
    <div className="pb-1">
      <Row
        label="Push notifications"
        hint={
          push.state === "denied"
            ? "Blocked in your browser settings — it has to be re-allowed there."
            : push.state === "on"
              ? "This browser is registered."
              : "Follows, replies, price milestones and graduations."
        }
      >
        <Switch
          on={push.state === "on"}
          disabled={push.busy || push.state === "denied"}
          onChange={() => (push.state === "on" ? void push.disable() : void push.enable())}
        />
      </Row>

      {/*
        The rest only matters once a device is registered. Showing toggles that
        cannot produce a notification is a settings screen that lies.
      */}
      {push.state === "on" && current ? (
        <>
          <Row label="Mute everything" hint="One switch, above all the others.">
            <Switch on={current.muted} onChange={() => save.mutate({muted: !current.muted})} />
          </Row>

          <Row label="New followers">
            <Switch
              on={current.socialFollow}
              disabled={current.muted}
              onChange={() => save.mutate({socialFollow: !current.socialFollow})}
            />
          </Row>

          <Row label="Replies to your comments">
            <Switch
              on={current.socialReply}
              disabled={current.muted}
              onChange={() => save.mutate({socialReply: !current.socialReply})}
            />
          </Row>

          <Row
            label="Graduations"
            hint="When a coin you watch finishes its curve, and when it is close."
          >
            <Switch
              on={current.graduationOn}
              disabled={current.muted}
              onChange={() => save.mutate({graduationOn: !current.graduationOn})}
            />
          </Row>

          <Row label="Your holdings" hint="When a coin you own hits a multiple.">
            <Switch
              on={current.holdingsOn}
              disabled={current.muted}
              onChange={() => save.mutate({holdingsOn: !current.holdingsOn})}
            />
          </Row>

          {current.holdingsOn && !current.muted ? (
            <MilestonePicker
              selected={current.holdingsMultiples}
              onChange={(holdingsMultiples) => save.mutate({holdingsMultiples})}
            />
          ) : null}

          <Row
            label="Your watchlist"
            hint="Off by default — a watchlist is for browsing, not for alerts."
          >
            <Switch
              on={current.watchlistOn}
              disabled={current.muted}
              onChange={() => save.mutate({watchlistOn: !current.watchlistOn})}
            />
          </Row>

          <QuietHours
            start={current.quietStart}
            end={current.quietEnd}
            disabled={current.muted}
            onChange={(patch) => save.mutate(patch)}
          />
        </>
      ) : null}

      {save.error ? (
        <p role="alert" className="px-1 pt-2 text-[12px] font-semibold text-error">
          {(save.error as Error).message}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Which multiples are worth a buzz.
 *
 * Multi-select rather than a single threshold, because people want the early
 * one and the big one and nothing between — 2x and 10x, not everything above
 * 2x. At least one must stay selected: an empty set means "off", which is the
 * switch above, and storing it here would leave a toggle reading on while
 * nothing could ever fire.
 */
function MilestonePicker({
  selected,
  onChange,
}: {
  selected: Milestone[];
  onChange: (next: Milestone[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5 px-4 pb-3">
      {MILESTONES.map((step) => {
        const on = selected.includes(step);
        return (
          <button
            key={step}
            type="button"
            aria-pressed={on}
            onClick={() => {
              const next = on
                ? selected.filter((value) => value !== step)
                : [...selected, step].sort((a, b) => a - b);
              if (next.length > 0) onChange(next as Milestone[]);
            }}
            className={cn(
              "tabular-nums rounded-full px-3 py-1.5 text-[12px] font-extrabold transition-colors",
              on
                ? "bg-[var(--price-up-wash)] text-price-up"
                : "bg-[var(--overlay-wash)] text-faint hover:text-muted",
            )}
          >
            {step}x
          </button>
        );
      })}
    </div>
  );
}

/**
 * Quiet hours, with the timezone read from the browser.
 *
 * Asking someone to pick a timezone is asking them to answer a question their
 * device already knows, and a wrong answer silences them at the wrong hours.
 */
function QuietHours({
  start,
  end,
  disabled,
  onChange,
}: {
  start: string | null;
  end: string | null;
  disabled: boolean;
  onChange: (patch: Partial<NotificationPrefs>) => void;
}) {
  const [timezone, setTimezone] = useState("UTC");

  useEffect(() => {
    try {
      setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    } catch {
      setTimezone("UTC");
    }
  }, []);

  const on = Boolean(start && end);

  return (
    <>
      <Row label="Quiet hours" hint={on ? `${start}–${end} · ${timezone}` : "Off"}>
        <Switch
          on={on}
          disabled={disabled}
          onChange={() =>
            onChange(
              on
                ? {quietStart: null, quietEnd: null}
                : {quietStart: "22:00", quietEnd: "07:00", timezone},
            )
          }
        />
      </Row>

      {on && !disabled ? (
        <div className="flex items-center gap-2 px-4 pb-3">
          <TimeField
            label="From"
            value={start ?? "22:00"}
            onChange={(quietStart) => onChange({quietStart, timezone})}
          />
          <TimeField
            label="To"
            value={end ?? "07:00"}
            onChange={(quietEnd) => onChange({quietEnd, timezone})}
          />
        </div>
      ) : null}
    </>
  );
}

function TimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-1 items-center gap-2 rounded-[12px] bg-[var(--bg-input)] px-3 py-2 shadow-inset-soft">
      <span className="text-[11px] font-bold uppercase tracking-[0.07em] text-faint">
        {label}
      </span>
      <input
        type="time"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="tabular-nums min-w-0 flex-1 border-none bg-transparent text-[13px] font-extrabold text-ink outline-none"
      />
    </label>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 even:bg-[var(--overlay-wash)]/40">
      <div className="min-w-0">
        <div className="text-[13px] font-bold">{label}</div>
        {hint ? (
          <p className="mt-0.5 text-[11.5px] leading-[1.45] text-faint">{hint}</p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function Switch({
  on,
  disabled,
  onChange,
}: {
  on: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onChange}
      className={cn(
        "relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors duration-200",
        on ? "bg-brand-500" : "bg-[var(--segment-track)]",
        disabled && "opacity-40",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-[3px] h-5 w-5 rounded-full bg-white transition-[left] duration-200",
          on ? "left-[21px]" : "left-[3px]",
        )}
      />
    </button>
  );
}

function Note({children}: {children: React.ReactNode}) {
  return <p className="px-4 py-3 text-[12px] leading-[1.5] text-faint">{children}</p>;
}
