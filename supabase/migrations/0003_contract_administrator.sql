-- VO-AI | 0003_contract_administrator.sql — the contract administrator role.
--
-- The Architect, Engineer or SO named in the contract (PAM 2018 cl. 11,
-- PWD 203A cl. 24) confirms the instruction behind a submitted VO and
-- certifies the value the consultant QS approved:
--   contractor submits → administrator confirms the instruction →
--   consultant QS values → administrator certifies → client approves.
-- Same rule as js/permissions.js.

-- 1. a fourth project role
alter table public.members drop constraint if exists members_role_check;
alter table public.members add constraint members_role_check
    check (role in ('contractor', 'consultant', 'client', 'administrator'));

-- 2. who may change which VO field, and when the contractor may submit.
--    The contractor's submission sets evaluateStatus from Draft (or
--    Rejected) to Pending: the one change to a consultant's field the
--    contractor may make. The administrator's return sends `submitted`
--    back to false (a shared field).
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
        "instructionStatus":"administrator","instructionNote":"administrator",
        "caCertifiedStatus":"administrator","caRemark":"administrator",
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
        /* save_vo is an upsert: this insert check runs before the conflict
           with an existing VO is found. Saving an existing VO is an update,
           checked by the update rules below when it runs. */
        if exists (select 1 from public.vos where project_id = new.project_id and id = new.id) then
            return new;
        end if;
        if my_role not in ('contractor', 'consultant') then
            raise exception 'the % cannot create a VO', my_role using errcode = '42501';
        end if;
        new.updated_by := auth.uid();
        new.updated_at := now();
        return new;
    end if;

    for k in select jsonb_object_keys(owners) loop
        if (old.data -> k) is distinct from (new.data -> k) then
            owner := owners ->> k;
            if owner <> my_role then
                /* the contractor submitting: Draft / Rejected → Pending */
                if not (k = 'evaluateStatus' and my_role = 'contractor'
                        and coalesce(old.data ->> 'evaluateStatus', 'Draft') in ('Draft', 'Rejected', 'Pending')
                        and new.data ->> 'evaluateStatus' = 'Pending') then
                    raise exception 'the % cannot change %', my_role, k using errcode = '42501';
                end if;
            end if;
        end if;
    end loop;
    if (old.data -> 'measurement') is distinct from (new.data -> 'measurement')
       and my_role not in ('contractor', 'consultant') then
        raise exception 'the % cannot change measurement', my_role using errcode = '42501';
    end if;

    new.updated_by := auth.uid();
    new.updated_at := now();
    return new;
end $$;

-- 3. the consultant may add a contract administrator to the project
create or replace function public.add_member(p_project text, p_email text, p_role text)
returns text language plpgsql security definer set search_path = public as $$
declare
    uid uuid;
    uname text;
begin
    if public.member_role(p_project) is distinct from 'consultant' then
        raise exception 'only the project consultant can add members' using errcode = '42501';
    end if;
    if p_role not in ('contractor', 'consultant', 'client', 'administrator') then
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
