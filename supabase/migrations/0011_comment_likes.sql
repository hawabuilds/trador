-- Likes on comments.
--
-- A like is a row, not a counter on the comment, for the same reason follows
-- are: a stored count drifts the first time an unlike races a like, and there is
-- no way to notice. Counts are taken on read.
--
-- One like per person per comment, enforced by the key rather than by the
-- route, so a double tap cannot count twice however it arrives.

create table if not exists public.comment_likes (
  comment_id bigint not null references public.comments (id) on delete cascade,
  user_id    text   not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

-- Counting likes for a page of comments reads by comment.
create index if not exists comment_likes_comment on public.comment_likes (comment_id);

-- Same posture as every other per-user table: RLS on with no policies, so the
-- anon key cannot read who liked what. The app's service role bypasses it.
alter table public.comment_likes enable row level security;
