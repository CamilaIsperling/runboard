-- =====================================================================
-- RunBoard - Grau A demo
-- Run this whole file ONCE in Supabase: SQL Editor > New query > Run
-- It creates: the events table, the reminder subscriptions table,
-- the API permissions, the access rules (Row Level Security) and the
-- "banners" storage bucket.
-- =====================================================================


-- 1) EVENTS TABLE --------------------------------------------------------
-- One row per race. organizer_id is filled automatically with the id of
-- the logged-in user who creates the event (default auth.uid()).
create table public.events (
  id               bigint generated always as identity primary key,
  organizer_id     uuid not null default auth.uid()
                   references auth.users (id) on delete cascade,
  name             text not null,
  description      text,
  city             text not null,
  location         text,
  start_at         timestamptz not null,
  distances_km     numeric[] not null default '{}',
  kit_pickup_info  text,
  entry_fee        numeric(10, 2),
  official_url     text,
  banner_url       text,
  created_at       timestamptz not null default now()
);


-- 2) REMINDER SUBSCRIPTIONS TABLE (used in Grau B) -----------------------
-- Links a runner to an event when they click "Notify me".
create table public.reminder_subscriptions (
  user_id     uuid not null default auth.uid()
              references auth.users (id) on delete cascade,
  event_id    bigint not null references public.events (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, event_id)
);


-- 3) API PERMISSIONS -----------------------------------------------------
-- Since 2026, new Supabase projects do not expose tables to the Data API
-- automatically. These grants let the web page reach the tables; the RLS
-- policies below still decide WHICH rows each user can see or change.
grant select on public.events to anon;
grant select, insert, update, delete on public.events to authenticated;
grant select, insert, delete on public.reminder_subscriptions to authenticated;
grant usage, select on all sequences in schema public to authenticated;


-- 4) ACCESS RULES (Row Level Security) -----------------------------------
-- With RLS on, nobody can do anything unless a policy below allows it.
alter table public.events                 enable row level security;
alter table public.reminder_subscriptions enable row level security;

-- Anyone, even without an account, can read the public feed.
create policy "Anyone can read events"
  on public.events for select
  to anon, authenticated
  using (true);

-- A logged-in user can create an event only in their own name.
create policy "Organizers create their own events"
  on public.events for insert
  to authenticated
  with check ((select auth.uid()) = organizer_id);

-- Only the responsible organizer can edit the event.
create policy "Organizers update their own events"
  on public.events for update
  to authenticated
  using ((select auth.uid()) = organizer_id)
  with check ((select auth.uid()) = organizer_id);

-- Only the responsible organizer can delete the event.
create policy "Organizers delete their own events"
  on public.events for delete
  to authenticated
  using ((select auth.uid()) = organizer_id);

-- Runners see and manage only their own subscriptions.
create policy "Runners manage their own subscriptions"
  on public.reminder_subscriptions for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);


-- 5) STORAGE BUCKET FOR BANNERS ------------------------------------------
-- Public bucket: anyone can view the images through their public URL.
insert into storage.buckets (id, name, public)
values ('banners', 'banners', true);

-- Only logged-in users can upload, and only into a folder named with
-- their own user id (for example: <user-id>/banner.png).
create policy "Logged-in users upload their own banners"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'banners'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
