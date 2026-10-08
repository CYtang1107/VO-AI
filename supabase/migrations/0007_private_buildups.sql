-- VO-AI | 0007_private_buildups.sql — a built-up rate's working is its author's.
--
-- The contractor builds a rate up line by line (js/buildup.js): their
-- supplier prices, gang sizes, outputs, diesel, profit. That working is
-- theirs alone. The rest of the team sees only its summary (materials,
-- labour, machinery and tools, profit, the rate), kept on the measurement
-- row as `buildUpSummary` in the shared VO.
--
-- private_notes holds what one member keeps for themselves on a project:
-- 'buildup/<VO id>/<row id>' (a build-up) and 'pricelist' (their own
-- prices). Row-level security: only the owner, and only while a member.
--
-- So that nothing private can reach the shared rows, a measurement row's
-- `buildUp` and a project's `priceList` are removed on every save, whoever
-- sends them; what is already stored moves to the project's contractors.

create table public.private_notes (
    project_id text references public.projects on delete cascade,
    owner      uuid not null default auth.uid() references auth.users on delete cascade,
    key        text not null,
    data       jsonb not null,
    updated_at timestamptz not null default now(),
    primary key (project_id, owner, key)
);

alter table public.private_notes enable row level security;

create policy private_notes_own on public.private_notes for all to authenticated
    using (owner = auth.uid() and public.is_member(project_id))
    with check (owner = auth.uid() and public.is_member(project_id));

revoke all on public.private_notes from anon;

-- ---------- nothing private in the shared rows ----------

create or replace function public.strip_private_vo()
returns trigger language plpgsql as $$
begin
    if jsonb_typeof(new.data->'measurement') = 'array' then
        new.data := jsonb_set(new.data, '{measurement}', (
            select coalesce(jsonb_agg(case when jsonb_typeof(r) = 'object' then r - 'buildUp' else r end order by i), '[]'::jsonb)
            from jsonb_array_elements(new.data->'measurement') with ordinality as x(r, i)));
    end if;
    return new;
end $$;

create trigger vos_strip_private
    before insert or update on public.vos
    for each row execute function public.strip_private_vo();

create or replace function public.strip_private_project()
returns trigger language plpgsql as $$
begin
    new.data := coalesce(new.data, '{}'::jsonb) - 'priceList';
    return new;
end $$;

create trigger projects_strip_private
    before insert or update on public.projects
    for each row execute function public.strip_private_project();

-- ---------- what is already stored: to the project's contractors ----------

insert into public.private_notes (project_id, owner, key, data)
select p.id, m.user_id, 'pricelist', p.data->'priceList'
from public.projects p
join public.members m on m.project_id = p.id and m.role = 'contractor'
where jsonb_typeof(p.data->'priceList') = 'array'
on conflict do nothing;

insert into public.private_notes (project_id, owner, key, data)
select v.project_id, m.user_id, 'buildup/' || v.id || '/' || (r->>'id'), r->'buildUp'
from public.vos v
cross join lateral jsonb_array_elements(case when jsonb_typeof(v.data->'measurement') = 'array' then v.data->'measurement' else '[]'::jsonb end) as r
join public.members m on m.project_id = v.project_id and m.role = 'contractor'
where jsonb_typeof(r) = 'object' and r ? 'buildUp' and r ? 'id'
on conflict do nothing;

update public.vos set data = data where data::text like '%"buildUp"%';
update public.projects set data = data where data ? 'priceList';
