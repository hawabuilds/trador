"use client";

import Link from "next/link";

import {Avatar} from "@/components/ui/Avatar";
import {LinkCards} from "@/components/comments/LinkCards";
import {ArrowUpIcon, ReplyIcon, ShareIcon} from "@/components/ui/Icons";
import {cn} from "@/lib/cn";
import {BAND_LABEL} from "@/lib/holdingBand";
import {tokenAge} from "@/lib/priceFormat";
import {assetPath, profilePath} from "@/lib/routes";
import type {AssetComment, AssetKind} from "@/lib/types";

/** The coin a comment is about, when the reader cannot already see it. */
export interface CommentAsset {
  kind: AssetKind;
  id: string;
  symbol: string;
  imageUrl: string | null;
}

/**
 * One comment, wherever it appears.
 *
 * No card and no box: posts are separated by space alone, so a thread reads as
 * people talking rather than as a stack of adverts.
 *
 * The line under the name is the whole point of the design. It says how much
 * of the coin the person actually holds — in bands, never figures — and
 * whether they were early. A take from someone holding $1K+ since before the
 * run reads differently from the same words with nothing behind them, and
 * there is nowhere to type any of it.
 */
export function CommentCard({
  comment,
  asset,
  compact,
  canVote,
  canReply,
  onVote,
  onReply,
  onShare,
  footer,
  replyCount,
  now,
}: {
  comment: AssetComment;
  /** Passed in the Feed, where the coin is not already on screen. */
  asset?: CommentAsset | null;
  /** A reply: smaller avatar, tighter spacing. */
  compact?: boolean;
  canVote?: boolean;
  canReply?: boolean;
  onVote?: (commentId: string) => void;
  onReply?: (comment: AssetComment) => void;
  onShare?: (comment: AssetComment) => void;
  /** The replies toggle, rendered under the actions by the thread. */
  footer?: React.ReactNode;
  replyCount?: number;
  now?: number;
}) {
  const position = comment.position ?? null;
  const voted = Boolean(comment.liked);

  return (
    <div className={cn("flex gap-3", compact ? "py-3" : "py-4")}>
      <Link href={profilePath(comment.author.handle)} className="shrink-0">
        <Avatar
          name={comment.author.displayName}
          src={comment.author.pfpUrl}
          seed={comment.author.handle}
          size={compact ? 32 : 40}
        />
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <Link
            href={profilePath(comment.author.handle)}
            className="truncate text-[15px] font-semibold tracking-[-0.015em] text-ink transition-colors hover:text-accent-link"
          >
            {comment.author.handle}
          </Link>
          <time dateTime={comment.createdAt} className="shrink-0 text-[13px] text-faint">
            {tokenAge(comment.createdAt, now)}
          </time>
        </div>

        {position ? (
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[13px] text-faint">
            {position.status === "sold" ? (
              <span>Sold</span>
            ) : position.band ? (
              <span>Holding {BAND_LABEL[position.band]}</span>
            ) : (
              <span>Holding</span>
            )}
            {asset ? (
              <Link
                href={assetPath(asset.kind, asset.id)}
                className="inline-flex items-center gap-1.5 transition-colors hover:text-muted"
              >
                <span>of</span>
                {asset.imageUrl ? (
                  <Avatar name={asset.symbol} src={asset.imageUrl} seed={asset.id} size={18} />
                ) : null}
                <span className="font-semibold">{asset.symbol}</span>
              </Link>
            ) : null}
            {position.early ? (
              <span className="font-medium text-[var(--warning)]">Early</span>
            ) : null}
          </p>
        ) : null}

        <p className="mt-2 whitespace-pre-wrap break-words text-[15px] leading-[1.45] text-ink">
          <CommentBody body={comment.body} />
        </p>

        <LinkCards commentId={comment.id} body={comment.body} />

        <div className="mt-2.5 flex items-center gap-1 text-[13px] text-faint">
          <button
            type="button"
            onClick={() => onVote?.(comment.id)}
            disabled={!canVote}
            aria-pressed={voted}
            aria-label={voted ? "Not useful" : "Useful"}
            className={cn(
              "tabular-nums -ml-2 flex h-11 items-center gap-1.5 rounded-full px-2 transition-colors disabled:cursor-default",
              voted ? "text-brand-500" : "hover:text-muted",
            )}
          >
            <ArrowUpIcon className="h-[15px] w-[15px]" />
            {comment.likes ?? 0}
          </button>

          <button
            type="button"
            onClick={() => onReply?.(comment)}
            disabled={!canReply}
            aria-label="Reply"
            className="tabular-nums flex h-11 items-center gap-1.5 rounded-full px-2 transition-colors hover:text-muted disabled:cursor-default"
          >
            <ReplyIcon className="h-[15px] w-[15px]" />
            {replyCount ?? 0}
          </button>

          <button
            type="button"
            onClick={() => onShare?.(comment)}
            aria-label="Share"
            className="flex h-11 items-center rounded-full px-2 transition-colors hover:text-muted"
          >
            <ShareIcon className="h-[15px] w-[15px]" />
          </button>
        </div>

        {footer}
      </div>
    </div>
  );
}

/**
 * The comment's words, with its links tappable.
 *
 * The URL is left as the person typed it. Replacing it with a title would mean
 * the text of a comment is not what its author wrote, and the card underneath
 * already says what the link is.
 */
function CommentBody({body}: {body: string}) {
  const parts = body.split(/(https?:\/\/[^\s<>"']+)/gi);

  return (
    <>
      {parts.map((part, index) => {
        if (!/^https?:\/\//i.test(part)) return part;

        // The full stop someone ended the sentence with is not the link, and
        // linking it would send them somewhere that does not exist.
        const url = part.replace(/[.,;:!?)\]}]+$/, "");
        return (
          <span key={index}>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              onClick={(event) => event.stopPropagation()}
              className="break-all text-accent-link hover:underline"
            >
              {url}
            </a>
            {part.slice(url.length)}
          </span>
        );
      })}
    </>
  );
}
