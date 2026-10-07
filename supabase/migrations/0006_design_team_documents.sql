-- VO-AI | 0006_design_team_documents.sql — the step-by-step workflow.
--
-- The design team now adds the original and revised drawings and its
-- supporting documents when it approves a VO (js/permissions.js), and the
-- contractor answers the consultant QS's request for further information
-- (vo.infoResponse). Same function as 0005, with those keys moved or added
-- in `owners`: oldDrawing, revisedDrawing and designDocs are the design
-- team's; infoResponse is the contractor's. vo.sentToDesign is shared (the
-- contractor sends; the design team's rejection clears it).

create or replace function public.check_vo_fields()
returns trigger language plpgsql security definer set search_path = public as $$
declare
    my_role text;
    k text;
    owner text;
    owners constant jsonb := '{
        "description":"contractor","dateIssued":"contractor","typeOfInstruction":"contractor",
        "instructionNo":"contractor",
        "supportingDocs":"contractor","contractDocs":"contractor","contractorRemark":"contractor",
        "infoResponse":"contractor",
        "dueDate":"consultant","assessmentNote":"consultant","timeImpact":"consultant",
        "evaluateStatus":"consultant","consultantRemark":"consultant","infoRequestedAt":"consultant",
        "infoRequestNote":"consultant",
        "instructionStatus":"administrator","instructionNote":"administrator",
        "caCertifiedStatus":"administrator","caRemark":"administrator","issuedInstruction":"administrator",
        "oldDrawing":"administrator","revisedDrawing":"administrator","designDocs":"administrator",
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
