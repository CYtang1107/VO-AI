-- VO-AI | 0005_issue_and_notify.sql — the design team's issued instruction,
-- and the email log of the notify Edge Function.
--
-- 1. vo.issuedInstruction (js/instruction.js) is the design team's field,
--    like instructionStatus: only the administrator may set it. Same
--    function as 0003 with that one key added to `owners`.
-- 2. notify_log: one row per step emailed (supabase/functions/notify), so a
--    step is emailed once however often it is saved. Written only by the
--    function (service role); members may read their projects' rows.

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
        "caCertifiedStatus":"administrator","caRemark":"administrator","issuedInstruction":"administrator",
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

create table if not exists public.notify_log (
    project_id text references public.projects on delete cascade,
    vo_id      text not null,
    step_key   text not null,
    sent_to    int not null default 0,
    sent_at    timestamptz not null default now(),
    primary key (project_id, step_key)
);
alter table public.notify_log enable row level security;
drop policy if exists notify_log_read on public.notify_log;
create policy notify_log_read on public.notify_log for select
    using (public.member_role(project_id) is not null);
