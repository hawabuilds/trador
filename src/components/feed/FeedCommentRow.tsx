"use client";

import Link from "next/link";

import {Avatar} from "@/components/ui/Avatar";
import {ArrowUpIcon, ReplyIcon} from "@/components/ui/Icons";
import {assetPath} from "@/lib/routes";
import {tokenAge} from "@/lib/priceFormat";
import type {FeedComment} from "@/lib/server/socialFeed";

/**
 * One comment in the Feed.
 *
 * Spacing separates posts, not cards: a feed of boxes reads as a list of
 * adverts, and the eye needs the name and the text, not a frame around them.
 *
 * The counts are readouts here. Voting and replying belong to the comment
 * layout that the Feed and the coin page will share, and a button that looks
 * live but does nothing is worse than a number.
 */
export function FeedCommentRow({comment, now}: {comment: FeedComment; now?: number}) {
  const {asset, author} = comment;

  return (
    <article className="py-4">
      <div className="flex gap-3">
        <Avatar
          name={author.displayName}
          src={author.pfpUrl}
          seed={author.handle}
          size={40}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-[15px] font-semibold tracking-[-0.015em]">
              {author.displayName}
            </span>
            <span className="shrink-0 text-[13px] text-faint">
              {tokenAge(comment.createdAt, now)}
            </span>
          </div>

          <Link
            href={assetPath(asset.kind, asset.id)}
            className="mt-1 flex w-fit items-center gap-1.5 text-[13px] text-faint transition-colors hover:text-muted"
          >
            {asset.imageUrl ? (
              <Avatar name={asset.symbol} src={asset.imageUrl} seed={asset.id} size={18} />
            ) : null}
            <span className="font-semibold">{asset.symbol}</span>
          </Link>

          <p className="mt-2 whitespace-pre-wrap text-[15px] leading-[1.45] text-ink">
            {comment.body}
          </p>

          <div className="mt-2.5 flex items-center gap-5 text-[13px] text-faint">
            <span className="flex items-center gap-1.5">
              <ArrowUpIcon className="h-[15px] w-[15px]" />
              {comment.likes}
            </span>
            <span className="flex items-center gap-1.5">
              <ReplyIcon className="h-[15px] w-[15px]" />
              {comment.replies}
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}
