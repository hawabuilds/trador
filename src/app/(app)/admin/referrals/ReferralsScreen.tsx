"use client";

import {useState} from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {useQuery} from "@tanstack/react-query";

import {APP_SCROLL_PAD_TOP} from "@/components/AppShell";
import {Avatar} from "@/components/ui/Avatar";
import {ChevronDownIcon, ChevronLeftIcon} from "@/components/ui/Icons";
import {cn} from "@/lib/cn";
import {compact, stamp} from "@/lib/format";
import {profilePath} from "@/lib/routes";
import {useSession} from "@/lib/session";

interface ReferredUser {
  id: string;
  handle: string | null;
  displayName: string | null;
  pfpUrl: string | null;
  joinedAt: string;
  traded: boolean;
}

interface Referrer {
  id: string;
  handle: string | null;
  displayName: string | null;
  pfpUrl: string | null;
  opens: number;
  signUps: number;
  traded: number;
  lastSignUpAt: string | null;
  referred: ReferredUser[];
}

interface Report {
  totals: {opens: number; signUps: number; traded: number; referrers: number};
  referrers: Referrer[];
}

/**
 * Who is bringing people in. Admin only.
 *
 * Totals first — link opens, sign-ups, and how many of those have traded,
 * because a sign-up who never trades is a weaker referral than one who does.
 * Then every referrer, most sign-ups first; tap one to see exactly who joined
 * through their link and when.
 *
 * A non-admin who finds this URL sees "Not found", the same answer the API
 * gives them.
 */
export function ReferralsScreen() {
  const router = useRouter();
  const session = useSession();
  const [expanded, setExpanded] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["admin-referrals"],
    queryFn: async (): Promise<Report | null> => {
      const token = await session.getAccessToken();
      const response = await fetch("/api/admin/referrals", {
        headers: token ? {authorization: `Bearer ${token}`} : {},
      });
      if (response.status === 404 || response.status === 401) return null;
      if (!response.ok) throw new Error("Could not load referrals.");
      return (await response.json()) as Report;
    },
    refetchInterval: 30_000,
  });

  const report = query.data;
  const conversion =
    report && report.totals.opens > 0 ? (report.totals.signUps / report.totals.opens) * 100 : null;

  return (
    <div className={APP_SCROLL_PAD_TOP}>
      <button
        type="button"
        onClick={() => router.back()}
        aria-label="Back"
        className="-ml-2 grid h-9 w-9 place-items-center rounded-full text-muted transition-colors hover:bg-[var(--overlay-wash)] hover:text-ink"
      >
        <ChevronLeftIcon className="h-5 w-5" />
      </button>

      <h1 className="mt-2 text-[24px] font-extrabold tracking-[-0.035em]">Referrals</h1>
      <p className="mt-1 text-[12.5px] leading-[1.5] text-faint">
        Sign-ups through shared profile links. Only you can see this.
      </p>

      {query.isLoading ? (
        <div className="mt-5 grid grid-cols-2 gap-2">
          {Array.from({length: 4}).map((_unused, index) => (
            <div key={index} className="h-[70px] animate-pulse rounded-2xl bg-wash" />
          ))}
        </div>
      ) : query.error ? (
        <p className="py-10 text-center text-[13px] text-muted">{(query.error as Error).message}</p>
      ) : !report ? (
        <p className="py-10 text-center text-[13px] text-muted">Not found.</p>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <Tile label="Sign-ups" value={compact(report.totals.signUps)} />
            <Tile label="Link opens" value={compact(report.totals.opens)} />
            <Tile
              label="Opens → sign-ups"
              value={conversion === null ? "—" : `${conversion.toFixed(conversion < 10 ? 1 : 0)}%`}
            />
            <Tile label="Referred who traded" value={compact(report.totals.traded)} />
          </div>

          <div className="mb-1 mt-6 text-[10px] font-bold uppercase tracking-[0.09em] text-faint">
            {report.totals.referrers} {report.totals.referrers === 1 ? "referrer" : "referrers"}
          </div>

          {report.referrers.length === 0 ? (
            <p className="py-8 text-center text-[13px] leading-[1.5] text-muted">
              No one has opened a shared link yet. Shares from the Stonkfolio tab show up here.
            </p>
          ) : (
            <ul className="-mx-[22px]">
              {report.referrers.map((referrer) => {
                const open = expanded === referrer.id;
                return (
                  <li key={referrer.id} className="border-b border-[var(--overlay-wash)] last:border-0">
                    <button
                      type="button"
                      onClick={() => setExpanded(open ? null : referrer.id)}
                      aria-expanded={open}
                      disabled={referrer.signUps === 0}
                      className="flex w-full items-center gap-3 px-[22px] py-3 text-left transition-colors hover:bg-[var(--overlay-wash)] disabled:hover:bg-transparent"
                    >
                      <Avatar
                        name={referrer.displayName ?? referrer.handle ?? "?"}
                        src={referrer.pfpUrl}
                        seed={referrer.id}
                        size={38}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[14.5px] font-extrabold">
                          {referrer.displayName ?? referrer.handle}
                        </div>
                        <div className="truncate text-[12px] font-semibold text-faint">
                          @{referrer.handle} · {referrer.opens} {referrer.opens === 1 ? "open" : "opens"}
                          {referrer.lastSignUpAt ? ` · last ${stamp(referrer.lastSignUpAt)}` : ""}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="tabular-nums text-[16px] font-extrabold">{referrer.signUps}</div>
                        <div className="text-[11px] font-semibold text-faint">{referrer.traded} traded</div>
                      </div>
                      <ChevronDownIcon
                        className={cn(
                          "h-4 w-4 shrink-0 text-faint transition-transform",
                          open && "rotate-180",
                          referrer.signUps === 0 && "invisible",
                        )}
                      />
                    </button>

                    {open && referrer.referred.length > 0 ? (
                      <ul className="pb-2">
                        {referrer.referred.map((person) => (
                          <li key={person.id}>
                            <Link
                              href={person.handle ? profilePath(person.handle) : "#"}
                              className="flex items-center gap-2.5 py-2 pl-[72px] pr-[22px] transition-colors hover:bg-[var(--overlay-wash)]"
                            >
                              <Avatar
                                name={person.displayName ?? person.handle ?? "?"}
                                src={person.pfpUrl}
                                seed={person.id}
                                size={26}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-[13px] font-bold">
                                  {person.displayName ?? person.handle ?? "Unnamed"}
                                  {person.handle ? (
                                    <span className="ml-1 font-semibold text-faint">@{person.handle}</span>
                                  ) : null}
                                </div>
                                <div className="text-[11px] font-medium text-faint">
                                  Joined {stamp(person.joinedAt)}
                                </div>
                              </div>
                              {person.traded ? (
                                <span className="shrink-0 rounded-full bg-[var(--price-up-wash)] px-1.5 py-0.5 text-[10px] font-bold text-price-up">
                                  Traded
                                </span>
                              ) : null}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function Tile({label, value}: {label: string; value: string}) {
  return (
    <div className="rounded-2xl bg-[var(--segment-track)] px-3.5 py-3 shadow-inset-soft">
      <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-faint">{label}</div>
      <div className="tabular-nums mt-1 text-[22px] font-extrabold leading-none tracking-[-0.03em]">
        {value}
      </div>
    </div>
  );
}
