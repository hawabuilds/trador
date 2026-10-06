"use client";

import {useLinkCards} from "@/hooks/useLinkCards";
import {cn} from "@/lib/cn";
import type {LinkCard} from "@/lib/linkPreview";

/**
 * What a link in a comment turned out to be.
 *
 * The point of the whole feature is the difference between a claim and a
 * claim with something behind it, so a card that resolved looks like evidence
 * and one that did not looks like a link. Nothing in between is invented: a
 * deleted post or a blocked page falls back to its domain rather than to a
 * plausible-looking summary of what it might have said.
 */
export function LinkCards({commentId, body}: {commentId: string; body: string}) {
  const cards = useLinkCards(commentId, body);
  if (cards.length === 0) return null;

  return (
    <div className="mt-2.5 flex flex-col gap-2">
      {cards.map((card) => (
        <LinkCardView key={card.url} card={card} />
      ))}
    </div>
  );
}

/** The shell every card shares: tappable, quiet, and never the loudest thing. */
function Shell({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      onClick={(event) => event.stopPropagation()}
      className={cn(
        "block overflow-hidden rounded-xl border border-hairline transition-colors hover:bg-wash",
        className,
      )}
    >
      {children}
    </a>
  );
}

export function LinkCardView({card}: {card: LinkCard}) {
  switch (card.kind) {
    case "x":
      return (
        <Shell href={card.url} className="px-3 py-2.5">
          <p className="flex items-baseline gap-1.5 text-[13px]">
            <span className="truncate font-semibold text-ink">{card.author}</span>
            {card.handle ? <span className="truncate text-faint">@{card.handle}</span> : null}
          </p>
          <p className="mt-1 line-clamp-4 whitespace-pre-wrap break-words text-[15px] leading-[1.4] text-ink">
            {card.text}
          </p>
          <p className="mt-1.5 text-[12px] text-faint">x.com</p>
        </Shell>
      );

    case "news":
      return (
        <Shell href={card.url}>
          {card.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={card.imageUrl}
              alt=""
              loading="lazy"
              className="h-36 w-full object-cover"
            />
          ) : null}
          <div className="px-3 py-2.5">
            <p className="line-clamp-2 text-[15px] font-semibold leading-[1.3] text-ink">
              {card.title}
            </p>
            {card.description ? (
              <p className="mt-1 line-clamp-2 text-[13px] leading-[1.4] text-muted">
                {card.description}
              </p>
            ) : null}
            <p className="mt-1.5 text-[12px] text-faint">{card.domain}</p>
          </div>
        </Shell>
      );

    case "solscan-tx":
      return (
        <Shell href={card.url} className="px-3 py-2.5">
          <p
            className={cn(
              "text-[15px] font-semibold leading-[1.3]",
              card.side === "buy" ? "text-price-up" : null,
              card.side === "sell" ? "text-price-down" : null,
              card.side === null ? "text-ink" : null,
            )}
          >
            {card.headline}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[13px] text-faint">
            <span>{card.when}</span>
            <span className="tabular-nums">{card.who}</span>
          </p>
          <p className="mt-1.5 text-[12px] text-faint">solscan.io</p>
        </Shell>
      );

    case "solscan-account":
      return (
        <Shell href={card.url} className="px-3 py-2.5">
          <p className="text-[13px] font-semibold tabular-nums text-ink">{card.address}</p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {card.facts.map((fact) => (
              <li key={fact} className="text-[15px] leading-[1.35] text-ink">
                {fact}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[12px] text-faint">solscan.io</p>
        </Shell>
      );

    default:
      return (
        <Shell href={card.url} className="px-3 py-2.5">
          <p className="text-[15px] font-semibold text-ink">{card.domain}</p>
          <p className="mt-0.5 truncate text-[13px] text-faint">{card.url}</p>
        </Shell>
      );
  }
}
