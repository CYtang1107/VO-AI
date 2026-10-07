-- VO-AI | 0004_guest_quota.sql — 「评审一键体验」: 「问合同」 without an account.
--
-- A judge or visitor using the demo (no sign-in) may ask the demo
-- project's contract questions. The ask-contract Edge Function answers them
-- with the service role, for the demo project only, and counts each
-- question here first: a daily limit per visitor (by IP address) and for
-- everyone together, so the AI quota cannot be drained and the contract
-- text cannot be copied out in bulk.
--
-- Nobody reads or writes this table from the browser: RLS on, no policies,
-- and the counting function is for the service role only.

create table if not exists public.guest_usage (
    day   date not null,
    ip    text not null,
    count int  not null default 0,
    primary key (day, ip)
);
alter table public.guest_usage enable row level security;
revoke all on public.guest_usage from anon, authenticated;

-- Counts one question; true when it is within both limits (the question
-- may go ahead), false when either is already used up (nothing counted).
create or replace function public.guest_quota(p_ip text, p_ip_limit int, p_day_limit int)
returns boolean language plpgsql security definer set search_path = public as $$
declare
    today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
    mine int;
    everyone int;
begin
    select coalesce(sum(count), 0) into everyone from public.guest_usage where day = today;
    select coalesce(count, 0) into mine from public.guest_usage where day = today and ip = p_ip;
    if everyone >= p_day_limit or coalesce(mine, 0) >= p_ip_limit then
        return false;
    end if;
    insert into public.guest_usage (day, ip, count) values (today, p_ip, 1)
    on conflict (day, ip) do update set count = public.guest_usage.count + 1;
    return true;
end $$;

revoke execute on function public.guest_quota(text, int, int) from anon, authenticated, public;
grant execute on function public.guest_quota(text, int, int) to service_role;
