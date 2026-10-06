"use client";

import {useEffect, useRef, useState, type KeyboardEvent} from "react";

import {CommentCard} from "@/components/comments/CommentCard";
import {LoadMore} from "@/components/LoadMore";
import {useComments} from "@/hooks/useComments";
import {cn} from "@/lib/cn";
import {assetPath} from "@/lib/routes";
import {shareUrl} from "@/lib/routes";
import type {AssetComment, AssetKind, CommentThread} from "@/lib/types";
import {CloseIcon} from "../ui/Icons";
import {PanelError, PanelNote} from "./TradesPanel";

/** Replies shown before the thread asks to be opened. */
const REPLIES_SHOWN = 2;

/**
 * Comments, each carrying what its author actually holds in this coin.
 *
 * The composer sits at the top, under the tabs, because the thing someone came
 * to do is say something — not scroll to the bottom of other people's takes to
 * find the box. Below it the thread is spacing and nothing else: no cards, no
 * rules between posts.
 */
export function CommentsPanel({
  kind,
  assetId,
  symbol,
}: {
  kind: AssetKind;
  assetId: string;
  symbol: string;
}) {
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<{rootId: string; label: string} | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const {
    threads,
    isLoading,
    error,
    retry,
    canPost,
    canLike,
    needsPosition,
    post,
    toggleLike,
    localOnly,
    hasMore,
    loadingMore,
    loadMore,
  } = useComments(kind, assetId);

  useEffect(() => {
    setDraft("");
    setReplyTo(null);
  }, [assetId]);

  const trimmed = draft.trim();
  const remaining = 500 - draft.length;
  const now = Date.now();

  function submit() {
    if (!trimmed) return;
    post({body: trimmed, parentId: replyTo?.rootId ?? null});
    setDraft("");
    setReplyTo(null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape" && replyTo) {
      setReplyTo(null);
      return;
    }
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    submit();
  }

  function startReply(comment: AssetComment, rootId: string) {
    setReplyTo({rootId, label: `@${comment.author.handle}`});
    composerRef.current?.focus();
  }

  async function share() {
    const url = shareUrl(assetPath(kind, assetId));
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({url, title: symbol});
        return;
      }
      await navigator.clipboard?.writeText(url);
    } catch {
      // Dismissed the sheet, or no clipboard. Nothing to report.
    }
  }

  // Newest conversation first, as a feed reads; replies inside stay in order.
  const ordered = [...threads].reverse();

  return (
    <div>
      <div className="pb-1 pt-1">
        {replyTo ? (
          <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-faint">
            <span className="min-w-0 truncate">
              Replying to <b className="font-extrabold text-muted">{replyTo.label}</b>
            </span>
            <button
              type="button"
              onClick={() => setReplyTo(null)}
              aria-label="Cancel reply"
              className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-[var(--overlay-wash)] text-muted transition-colors hover:bg-[var(--overlay-wash-hover)]"
            >
              <CloseIcon className="h-2.5 w-2.5" />
            </button>
          </div>
        ) : null}

        <label htmlFor={`comment-${assetId}`} className="sr-only">
          {replyTo ? `Reply to ${replyTo.label}` : `Share your take on ${symbol}`}
        </label>
        <div className="flex items-end gap-2">
          <textarea
            ref={composerRef}
            id={`comment-${assetId}`}
            rows={1}
            value={draft}
            disabled={!canPost}
            onChange={(event) => setDraft(event.target.value.slice(0, 500))}
            onKeyDown={onKeyDown}
            placeholder={
              canPost
                ? replyTo
                  ? `Reply to ${replyTo.label}…`
                  : `Your take on ${symbol}…`
                : needsPosition
                  ? `Hold ${symbol} to comment`
                  : "Sign in to post"
            }
            className="max-h-[64px] min-h-[38px] flex-1 resize-none rounded-2xl bg-[var(--bg-input)] px-3 py-2.5 text-[13px] leading-[1.4] text-ink shadow-inset-soft outline-none transition-[box-shadow,background-color] placeholder:text-faint focus:shadow-inset-focus disabled:cursor-not-allowed disabled:opacity-55"
          />
          <button
            type="button"
            disabled={!canPost || !trimmed}
            onClick={submit}
            className="shrink-0 rounded-full bg-brand-500 px-4 py-2.5 text-[12.5px] font-bold text-white shadow-brand transition-[transform,background-color,opacity] duration-150 hover:-translate-y-px hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {replyTo ? "Reply" : "Post"}
          </button>
        </div>
        {draft.length > 0 ? (
          <p
            className={cn(
              "mt-1.5 text-right text-[11px] font-semibold",
              remaining <= 0 ? "text-error" : "text-faint",
            )}
          >
            {remaining}
          </p>
        ) : null}
        {/*
          Why the box is closed, when it is. Only holders comment, so every take
          here comes from someone with money on it.
        */}
        {needsPosition ? (
          <p className="mt-1.5 text-[11px] font-medium leading-[1.45] text-faint">
            Only {symbol} holders can comment. Buy any amount to join in.
          </p>
        ) : null}
        {/* Only said when it is true: a deployment with no store to post to. */}
        {localOnly && !isLoading ? (
          <p className="mt-1.5 text-[11px] font-medium leading-[1.45] text-faint">
            Posts are saved in this browser until the comment database is connected.
          </p>
        ) : null}
      </div>

      {isLoading ? (
        <PanelNote>Loading comments</PanelNote>
      ) : error ? (
        <PanelError message={error} onRetry={retry} />
      ) : ordered.length === 0 ? (
        <PanelNote>No takes on {symbol} yet. Post the first one.</PanelNote>
      ) : (
        <>
          <ul>
            {ordered.map((thread) => (
              <li key={thread.root.id}>
                <Thread
                  thread={thread}
                  onReply={startReply}
                  onVote={toggleLike}
                  onShare={share}
                  canVote={canLike}
                  canReply={canPost}
                  now={now}
                />
              </li>
            ))}
          </ul>
          {hasMore ? (
            <LoadMore onLoad={loadMore} loading={loadingMore} />
          ) : (
            <p className="py-6 text-center text-[13px] text-faint">
              You have seen all comments
            </p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * A root comment and its replies.
 *
 * Two replies, then the rest behind one tap: a thread that opens fully is a
 * wall between the reader and the next call, and the two most recent are
 * usually the ones that matter.
 */
function Thread({
  thread,
  onReply,
  onVote,
  onShare,
  canVote,
  canReply,
  now,
}: {
  thread: CommentThread;
  onReply: (comment: AssetComment, rootId: string) => void;
  onVote: (commentId: string) => void;
  onShare: (comment: AssetComment) => void;
  canVote: boolean;
  canReply: boolean;
  now: number;
}) {
  const [open, setOpen] = useState(false);
  const replies = thread.replies;
  const shown = open ? replies : replies.slice(0, REPLIES_SHOWN);
  const hidden = replies.length - shown.length;

  return (
    <div>
      <CommentCard
        comment={thread.root}
        replyCount={replies.length}
        canVote={canVote}
        canReply={canReply}
        onVote={onVote}
        onReply={(comment) => onReply(comment, thread.root.id)}
        onShare={onShare}
        now={now}
      />

      {replies.length > 0 ? (
        <div className="ml-5 border-l border-[var(--overlay-wash-hover)] pl-4">
          {shown.map((reply) => (
            <CommentCard
              key={reply.id}
              comment={reply}
              compact
              canVote={canVote}
              canReply={canReply}
              onVote={onVote}
              onReply={(comment) => onReply(comment, thread.root.id)}
              onShare={onShare}
              now={now}
            />
          ))}

          {hidden > 0 || open ? (
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              className="flex h-11 items-center text-[13px] font-medium text-faint transition-colors hover:text-muted"
            >
              {open ? "Hide replies" : `View ${hidden} more ${hidden === 1 ? "reply" : "replies"}`}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
