-- VO-AI | 0001_init.sql — shared projects, VOs and files, plus the contract
-- knowledge base (docs/rag-plan.md, steps 1–2).
--
-- The browser keeps its data model: a project is one JSON object and each VO
-- is one JSON object, exactly as js/store.js builds them. Postgres stores them
-- as jsonb, with a few columns pulled out for listing and for the rules below.
--
-- Every table has row-level security. A signed-in user sees a project's rows
-- only when they are in `members` for that project, and their role there
-- decides which VO columns they may change (same rule as js/permissions.js).

create extension if not exists vector with schema extensions;

-- ---------- tables ----------

create table public.projects (
    id           text primary key,              -- today's ids (PRJ-…)
    name         text not null,
    client       text,
    contract_no  text,
    contract_sum numeric,
    data         jsonb not null default '{}',   -- the project object without its vos
    created_by   uuid references auth.users default auth.uid(),
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    updated_by   uuid references auth.users default auth.uid()
);

create table public.members (
    project_id   text references public.projects on delete cascade,
    user_id      uuid references auth.users on delete cascade,
    role         text not null check (role in ('contractor', 'consultant', 'client')),
    display_name text,
    email        text,
    primary key (project_id, user_id)
);
create index members_user_idx on public.members (user_id);

create table public.vos (
    project_id   text references public.projects on delete cascade,
    id           text not null,                 -- today's ids (VO-…, VO-SEED-1)
    data         jsonb not null,                -- the whole VO object
    updated_at   timestamptz not null default now(),
    updated_by   uuid references auth.users default auth.uid(),
    primary key (project_id, id)
);

-- One row per clause (or per piece of a long clause). Filled only by
-- tools/ingest-contract.py with the service-role key; the text is the team's
-- own contract and never leaves their project.
create table public.contract_chunks (
    id         bigserial primary key,
    project_id text references public.projects on delete cascade,  -- null = every project
    doc_name   text not null,
    form       text,                            -- e.g. 'PAM 2018'
    clause_no  text not null,
    title      text,
    part       int not null default 1,
    text       text not null,
    embedding  extensions.vector(1024) not null -- DashScope text-embedding-v4, 1024 dims
);
create index contract_chunks_embedding_idx
    on public.contract_chunks using hnsw (embedding extensions.vector_cosine_ops);
create index contract_chunks_doc_idx on public.contract_chunks (project_id, doc_name);

-- ---------- helpers ----------

-- security definer so RLS policies can ask about membership without
-- recursing into members' own policy.
create or replace function public.member_role(p_project text)
returns text language sql stable security definer set search_path = public as $$
    select role from public.members where project_id = p_project and user_id = auth.uid()
$$;

create or replace function public.is_member(p_project text)
returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.members where project_id = p_project and user_id = auth.uid())
$$;

-- The creator of a project becomes its consultant (only the consultant
-- creates projects in VO-AI).
create or replace function public.add_creator_as_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    if auth.uid() is not null then
        insert into public.members (project_id, user_id, role, display_name, email)
        select new.id, auth.uid(), 'consultant',
               coalesce(u.raw_user_meta_data ->> 'name', u.email), u.email
        from auth.users u where u.id = auth.uid()
        on conflict do nothing;
    end if;
    return new;
end $$;

create trigger projects_creator_member
    after insert on public.projects
    for each row execute function public.add_creator_as_member();

-- Column ownership, enforced on the server as well as in the page: a member
-- may change only the VO fields their role owns (js/permissions.js
-- FIELD_OWNER). Fields nobody owns (history, submitted, no…) are shared.
-- `measurement` is written by the contractor (quantities, claimed rates) and
-- the consultant (assessed quantities and rates), so both may change it.
-- The service role (auth.uid() is null) is not restricted.
create or replace function public.check_vo_fields()
returns trigger language plpgsql security definer set search_path = public as $$
declare
    my_role text;
    k text;
    owner text;
    owners constant jsonb := '{
        "description":"contractor","dateIssued":"contractor","typeOfInstruction":"contractor",
        "instructionNo":"contractor","revisedDrawing":"contractor","oldDrawing":"contractor",
        "supportingDocs":"contractor","contractDocs":"contractor","contractorRemark":"contractor",
        "dueDate":"consultant","assessmentNote":"consultant","timeImpact":"consultant",
        "evaluateStatus":"consultant","consultantRemark":"consultant","infoRequestedAt":"consultant",
        "infoRequestNote":"consultant",
        "certifiedStatus":"client","finalPrice":"client","clientRemark":"client",
        "clientInfoRequestedAt":"client","clientInfoRequestNote":"client"
    }';
begin
    if auth.uid() is null then return new; end if;
    my_role := public.member_role(new.project_id);
    if my_role is null then
        raise exception 'not a member of project %', new.project_id using errcode = '42501';
    end if;

    if tg_op = 'INSERT' then
        -- New VOs are raised by the contractor; the consultant may import or
        -- add one too. A client never creates a VO.
        if my_role = 'client' then
            raise exception 'a client cannot create a VO' using errcode = '42501';
        end if;
        new.updated_by := auth.uid();
        new.updated_at := now();
        return new;
    end if;

    for k in select jsonb_object_keys(owners) loop
        if (old.data -> k) is distinct from (new.data -> k) then
            owner := owners ->> k;
            if owner <> my_role then
                raise exception 'the % cannot change %', my_role, k using errcode = '42501';
            end if;
        end if;
    end loop;
    if (old.data -> 'measurement') is distinct from (new.data -> 'measurement')
       and my_role = 'client' then
        raise exception 'the client cannot change measurement' using errcode = '42501';
    end if;

    new.updated_by := auth.uid();
    new.updated_at := now();
    return new;
end $$;

create trigger vos_check_fields
    before insert or update on public.vos
    for each row execute function public.check_vo_fields();

create or replace function public.touch_project()
returns trigger language plpgsql as $$
begin
    new.updated_at := now();
    if auth.uid() is not null then new.updated_by := auth.uid(); end if;
    return new;
end $$;

create trigger projects_touch
    before update on public.projects
    for each row execute function public.touch_project();

-- Saves from the browser (js/cloud.js) send only the top-level fields that
-- changed since the last sync, merged into the stored object here, so two
-- people working on the same VO at once do not overwrite each other's
-- columns. A new VO or project sends the whole object. security invoker:
-- RLS and the column-ownership trigger above apply as usual.
create or replace function public.save_vo(p_project text, p_id text, p_patch jsonb)
returns void language sql security invoker set search_path = public as $$
    insert into public.vos (project_id, id, data) values (p_project, p_id, p_patch)
    on conflict (project_id, id) do update set data = public.vos.data || excluded.data
$$;

create or replace function public.save_project(p_id text, p_patch jsonb)
returns void language sql security invoker set search_path = public as $$
    insert into public.projects as p (id, name, client, contract_no, contract_sum, data)
    values (p_id, coalesce(nullif(p_patch ->> 'name', ''), 'Untitled project'),
            p_patch ->> 'client', p_patch ->> 'contractNo',
            nullif(p_patch ->> 'contractSum', '')::numeric, p_patch)
    on conflict (id) do update set
        data         = p.data || excluded.data,
        name         = coalesce(nullif((p.data || excluded.data) ->> 'name', ''), p.name),
        client       = (p.data || excluded.data) ->> 'client',
        contract_no  = (p.data || excluded.data) ->> 'contractNo',
        contract_sum = nullif((p.data || excluded.data) ->> 'contractSum', '')::numeric
$$;

-- The consultant adds team members by email. The person must already have an
-- account (sign-up on the VO-AI sign-in page, or created by the team admin).
create or replace function public.add_member(p_project text, p_email text, p_role text)
returns text language plpgsql security definer set search_path = public as $$
declare
    uid uuid;
    uname text;
begin
    if public.member_role(p_project) is distinct from 'consultant' then
        raise exception 'only the project consultant can add members' using errcode = '42501';
    end if;
    if p_role not in ('contractor', 'consultant', 'client') then
        raise exception 'unknown role %', p_role;
    end if;
    select id, coalesce(raw_user_meta_data ->> 'name', email) into uid, uname
    from auth.users where lower(email) = lower(trim(p_email));
    if uid is null then
        return 'no-account';
    end if;
    insert into public.members (project_id, user_id, role, display_name, email)
    values (p_project, uid, p_role, uname, lower(trim(p_email)))
    on conflict (project_id, user_id) do update set role = excluded.role;
    return 'ok';
end $$;

create or replace function public.remove_member(p_project text, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
    if public.member_role(p_project) is distinct from 'consultant' then
        raise exception 'only the project consultant can remove members' using errcode = '42501';
    end if;
    if p_user = auth.uid() then
        raise exception 'you cannot remove yourself';
    end if;
    delete from public.members where project_id = p_project and user_id = p_user;
end $$;

-- Nearest clauses to a question's embedding. Called by the ask-contract Edge
-- Function with the caller's own JWT, so RLS on contract_chunks applies.
create or replace function public.match_chunks(
    p_project text, q extensions.vector(1024), k int default 6, min_sim float default 0.35)
returns table (clause_no text, title text, text text, doc_name text, form text, similarity float)
language sql stable set search_path = public, extensions as $$
    select c.clause_no, c.title, c.text, c.doc_name, c.form, 1 - (c.embedding <=> q) as similarity
    from public.contract_chunks c
    where (c.project_id = p_project or c.project_id is null)
      and 1 - (c.embedding <=> q) >= min_sim
    order by c.embedding <=> q
    limit k
$$;

-- ---------- row-level security ----------

alter table public.projects        enable row level security;
alter table public.members         enable row level security;
alter table public.vos             enable row level security;
alter table public.contract_chunks enable row level security;

-- created_by too: an upsert (insert … on conflict) must see its new row
-- before the after-insert trigger has made the creator a member.
create policy projects_select on public.projects for select to authenticated
    using (public.is_member(id) or created_by = auth.uid());
create policy projects_insert on public.projects for insert to authenticated
    with check (created_by = auth.uid());
create policy projects_update on public.projects for update to authenticated
    using (public.is_member(id)) with check (public.is_member(id));
-- no delete policy: projects are not deleted from the browser

create policy members_select on public.members for select to authenticated
    using (public.is_member(project_id));
-- members are written only through add_member/remove_member and the trigger

create policy vos_select on public.vos for select to authenticated
    using (public.is_member(project_id));
create policy vos_insert on public.vos for insert to authenticated
    with check (public.is_member(project_id));
create policy vos_update on public.vos for update to authenticated
    using (public.is_member(project_id)) with check (public.is_member(project_id));

-- A shared standard form (project_id null) is readable by every signed-in
-- user; a project's own contract only by its members. Nobody writes from the
-- browser.
create policy chunks_select on public.contract_chunks for select to authenticated
    using (project_id is null or public.is_member(project_id));

revoke all on public.contract_chunks from anon;
revoke all on public.projects, public.members, public.vos from anon;
revoke execute on function public.add_member(text, text, text) from anon, public;
revoke execute on function public.remove_member(text, uuid) from anon, public;
revoke execute on function public.save_vo(text, text, jsonb) from anon, public;
revoke execute on function public.save_project(text, jsonb) from anon, public;
grant execute on function public.save_vo(text, text, jsonb) to authenticated;
grant execute on function public.save_project(text, jsonb) to authenticated;
revoke execute on function public.match_chunks(text, extensions.vector, int, float) from anon, public;
grant execute on function public.add_member(text, text, text) to authenticated;
grant execute on function public.remove_member(text, uuid) to authenticated;
grant execute on function public.match_chunks(text, extensions.vector, int, float) to authenticated, service_role;

-- ---------- files ----------

-- Private bucket; each file lives at {project_id}/{document id}.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

create policy documents_read on storage.objects for select to authenticated
    using (bucket_id = 'documents' and public.is_member((storage.foldername(name))[1]));
create policy documents_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'documents' and public.is_member((storage.foldername(name))[1]));
create policy documents_update on storage.objects for update to authenticated
    using (bucket_id = 'documents' and public.is_member((storage.foldername(name))[1]));

-- ---------- realtime ----------

-- Another member's change reaches open pages (js/cloud.js subscribes).
alter publication supabase_realtime add table public.vos, public.projects;
