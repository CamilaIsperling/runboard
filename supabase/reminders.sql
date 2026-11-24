-- =====================================================================
-- RunBoard - Grau B: daily race reminders
-- Run this file ONCE in Supabase (SQL Editor > New query > Run), after
-- setup.sql and after deploying the "send-reminders" Edge Function.
-- It adds: the "reminded" mark, the query used by the Edge Function and
-- the daily schedule (pg_cron + pg_net).
-- =====================================================================


-- 1) "ALREADY REMINDED" MARK ---------------------------------------------
-- Filled by the Edge Function after the e-mail is sent, so each runner
-- gets only one reminder per race, even if the function runs again.
alter table public.reminder_subscriptions
  add column if not exists reminded_at timestamptz;


-- 2) WHICH REMINDERS ARE DUE ---------------------------------------------
-- Races that start in the next 48 hours, for subscriptions not reminded
-- yet. As the job runs once a day, each race is e-mailed 1 or 2 days
-- before it starts. "security definer" lets the function read the
-- runner's e-mail in auth.users; only the service role (used by the
-- Edge Function, on the server) is allowed to call it.
create or replace function public.due_reminders()
returns table (
  user_id uuid,
  event_id bigint,
  email text,
  name text,
  city text,
  location text,
  start_at timestamptz,
  distances_km numeric[],
  kit_pickup_info text,
  official_url text,
  banner_url text
)
language sql
security definer
set search_path = ''
as $$
  select s.user_id, s.event_id, u.email::text,
         e.name, e.city, e.location, e.start_at, e.distances_km,
         e.kit_pickup_info, e.official_url, e.banner_url
  from public.reminder_subscriptions s
  join public.events e on e.id = s.event_id
  join auth.users u on u.id = s.user_id
  where s.reminded_at is null
    and e.start_at > now()
    and e.start_at <= now() + interval '48 hours';
$$;

revoke execute on function public.due_reminders() from public, anon, authenticated;
grant execute on function public.due_reminders() to service_role;


-- 3) DAILY SCHEDULE ------------------------------------------------------
-- pg_cron runs the job; pg_net makes the HTTPS call to the Edge Function.
-- '0 12 * * *' = every day at 12:00 UTC (09:00 in Brasília).
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'runboard-daily-reminders',
  '0 12 * * *',
  $$
  select net.http_post(
    url     := 'https://kozosrjnqdhtekdgfjyl.supabase.co/functions/v1/send-reminders',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);
