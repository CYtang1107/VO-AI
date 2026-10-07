-- VO-AI | 0002_delete_vo.sql — deleting a draft VO.
--
-- A VO the contractor has not yet submitted is a draft, and a draft raised
-- by mistake (or left empty) can be deleted by the project's contractor or
-- consultant. A submitted VO is part of the contract record: it cannot be
-- deleted, only rejected. The client never deletes.
--
-- Browser saves send only what changed (js/cloud.js), so a deletion is its
-- own call. security definer, because vos has no delete policy: this
-- function is the only way a row leaves the table, and it checks the rule.

create or replace function public.delete_vo(p_project text, p_id text)
returns text language plpgsql security definer set search_path = public as $$
declare
    my_role text;
    v jsonb;
begin
    my_role := public.member_role(p_project);
    if my_role is null then
        raise exception 'not a member of project %', p_project using errcode = '42501';
    end if;
    if my_role not in ('contractor', 'consultant') then
        raise exception 'the % cannot delete a VO', my_role using errcode = '42501';
    end if;
    select data into v from public.vos where project_id = p_project and id = p_id;
    if v is null then
        return 'not-found';
    end if;
    if coalesce((v ->> 'submitted')::boolean, false) then
        raise exception 'a submitted VO cannot be deleted; reject it instead' using errcode = '42501';
    end if;
    delete from public.vos where project_id = p_project and id = p_id;
    return 'ok';
end $$;

revoke execute on function public.delete_vo(text, text) from anon, public;
grant execute on function public.delete_vo(text, text) to authenticated;
