create extension if not exists pg_cron;
create extension if not exists pg_net;

-- One-time tokens: each scheduled run creates one and the edge function deletes it, so no shared secret is stored anywhere.
create table public.cron_tokens (
  token uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);
alter table public.cron_tokens enable row level security;

create or replace function public.run_bot_job(task text) returns void
language sql security definer set search_path = public, extensions as $$
  with t as (insert into public.cron_tokens default values returning token)
  select net.http_post(
    url := 'https://dntpwkkkcfgrlderqgxt.supabase.co/functions/v1/whatsapp?task=' || task,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-token', t.token::text),
    body := '{}'::jsonb
  ) from t;
$$;
revoke all on function public.run_bot_job(text) from public, anon, authenticated;

-- Times are UTC; Windhoek is UTC+2.
select cron.schedule('reconfirm-send', '0 14 * * *', $$select public.run_bot_job('send')$$);    -- 16:00 Windhoek: ask tomorrow's passengers
select cron.schedule('reconfirm-noreply', '0 3 * * *', $$select public.run_bot_job('noreply')$$); -- 05:00 Windhoek: flag today's non-replies
