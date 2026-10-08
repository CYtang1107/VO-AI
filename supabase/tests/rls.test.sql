-- RLS and column-ownership tests for supabase/migrations/0001_init.sql.
-- Run with supabase/tests/run.sh (a throwaway local Postgres + pgvector).
\set ON_ERROR_STOP on

insert into auth.users (id, email, raw_user_meta_data) values
    ('00000000-0000-0000-0000-00000000000a', 'serena@example.com', '{"name":"Serena Wong"}'),
    ('00000000-0000-0000-0000-00000000000b', 'outsider@example.com', '{}'),
    ('00000000-0000-0000-0000-00000000000c', 'ong@example.com', '{"name":"Ong Wei Han"}'),
    ('00000000-0000-0000-0000-00000000000d', 'tan@example.com', '{"name":"Tan Zi Qian"}');

create function pg_temp.as_user(u text) returns void language plpgsql as $$
begin
    perform set_config('request.jwt.claim.sub', u, false);
end $$;

create function pg_temp.expect_fail(stmt text, label text) returns void language plpgsql as $$
begin
    begin
        execute stmt;
    exception when others then
        raise notice 'ok   % (refused: %)', label, sqlerrm;
        return;
    end;
    raise exception 'FAIL % — statement was allowed', label;
end $$;

create function pg_temp.expect(cond boolean, label text) returns void language plpgsql as $$
begin
    if not cond then raise exception 'FAIL %', label; end if;
    raise notice 'ok   %', label;
end $$;

set role authenticated;

-- the consultant creates a project (as js/cloud.js does: upsert, no returning)
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.projects (id, name, data) values ('PRJ-1', 'ABC Residence', '{"bq":[]}')
    on conflict (id) do update set name = excluded.name, data = excluded.data;
select pg_temp.expect((select role from public.members where project_id = 'PRJ-1'
                       and user_id = auth.uid()) = 'consultant', 'creator becomes consultant');
select pg_temp.expect(public.add_member('PRJ-1', 'ong@example.com', 'contractor') = 'ok', 'add contractor');
select pg_temp.expect(public.add_member('PRJ-1', 'TAN@example.com ', 'client') = 'ok', 'add client (email case/space)');
select pg_temp.expect(public.add_member('PRJ-1', 'nobody@example.com', 'client') = 'no-account', 'unknown email');
select pg_temp.expect((select count(*) from public.members where project_id = 'PRJ-1') = 3, 'consultant sees 3 members');
-- upsert again (second save of the same project)
insert into public.projects (id, name, data) values ('PRJ-1', 'ABC Residence 2', '{"bq":[]}')
    on conflict (id) do update set name = excluded.name, data = excluded.data;

-- an outsider sees nothing and cannot join or write
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect((select count(*) from public.projects) = 0, 'outsider sees no project');
select pg_temp.expect((select count(*) from public.members) = 0, 'outsider sees no members');
select pg_temp.expect_fail($$select public.add_member('PRJ-1', 'outsider@example.com', 'client')$$, 'outsider cannot add self');
select pg_temp.expect_fail($$insert into public.vos (project_id, id, data) values ('PRJ-1', 'VO-X', '{}')$$, 'outsider cannot add VO');
select pg_temp.expect_fail($$insert into public.members (project_id, user_id, role) values ('PRJ-1', auth.uid(), 'client')$$, 'outsider cannot insert member row');
update public.projects set name = 'hacked' where id = 'PRJ-1';

-- the contractor raises and edits a VO
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.expect((select name from public.projects where id = 'PRJ-1') = 'ABC Residence 2', 'outsider update had no effect; contractor sees project');
insert into public.vos (project_id, id, data) values ('PRJ-1', 'VO-1',
    '{"description":"Tile to marble","certifiedStatus":"Pending","evaluateStatus":"Draft","measurement":[],"history":[]}');
update public.vos set data = data || '{"description":"Ceramic tile to marble","submitted":true}' where id = 'VO-1';
select pg_temp.expect_fail($$update public.vos set data = data || '{"certifiedStatus":"Approved"}' where id = 'VO-1'$$, 'contractor cannot certify');
select pg_temp.expect_fail($$update public.vos set data = data || '{"evaluateStatus":"Approved"}' where id = 'VO-1'$$, 'contractor cannot approve');
select pg_temp.expect_fail($$select public.add_member('PRJ-1', 'outsider@example.com', 'client')$$, 'contractor cannot add members');

-- the consultant assesses
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
update public.vos set data = data || '{"evaluateStatus":"Approved","measurement":[{"assessedRate":248}]}' where id = 'VO-1';
select pg_temp.expect_fail($$update public.vos set data = data || '{"finalPrice":1}' where id = 'VO-1'$$, 'consultant cannot set final price');

-- the client certifies, and cannot touch the rest
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
update public.vos set data = data || '{"certifiedStatus":"Approved","finalPrice":55856,"history":[{"action":"Certified"}]}' where id = 'VO-1';
select pg_temp.expect((select data ->> 'certifiedStatus' from public.vos where id = 'VO-1') = 'Approved', 'client certified');
select pg_temp.expect_fail($$update public.vos set data = data || '{"description":"x"}' where id = 'VO-1'$$, 'client cannot change description');
select pg_temp.expect_fail($$update public.vos set data = data || '{"measurement":[]}' where id = 'VO-1'$$, 'client cannot change measurement');
select pg_temp.expect_fail($$insert into public.vos (project_id, id, data) values ('PRJ-1', 'VO-2', '{}')$$, 'client cannot create VO');
select pg_temp.expect_fail($$update public.vos set project_id = 'PRJ-OTHER' where id = 'VO-1'$$, 'cannot move VO to a foreign project');

-- merged saves (js/cloud.js): two roles patch different fields of one VO
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select public.save_vo('PRJ-1', 'VO-3', '{"no":"VO-003","description":"Ceiling","evaluateStatus":"Draft"}');
select public.save_vo('PRJ-1', 'VO-3', '{"contractorRemark":"see drawing","submitted":true}');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.save_vo('PRJ-1', 'VO-3', '{"evaluateStatus":"Pending","consultantRemark":"checking"}');
select pg_temp.expect((select data from public.vos where id = 'VO-3') =
    '{"no":"VO-003","description":"Ceiling","evaluateStatus":"Pending","contractorRemark":"see drawing","submitted":true,"consultantRemark":"checking"}'::jsonb,
    'save_vo merges both roles'' fields');
select pg_temp.expect_fail($$select public.save_vo('PRJ-1', 'VO-3', '{"clientRemark":"x"}')$$, 'save_vo still enforces ownership');
select public.save_project('PRJ-1', '{"name":"ABC Residence 3","contractSum":12500000,"bq":[{"code":"B/4.1"}]}');
select pg_temp.expect((select name || '|' || contract_sum from public.projects where id = 'PRJ-1') = 'ABC Residence 3|12500000', 'save_project updates columns');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_fail($$select public.save_project('PRJ-1', '{"name":"hacked"}')$$, 'outsider cannot save_project over a foreign project');
select public.save_project('PRJ-NEW', '{"name":"Outsider own"}');
select pg_temp.expect((select role from public.members where project_id = 'PRJ-NEW') = 'consultant', 'save_project creates a project with its creator as consultant');

-- private build-ups and price lists (0007): only their owner, only while a member
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
insert into public.private_notes (project_id, key, data) values ('PRJ-1', 'buildup/VO-1/M1', '{"items":[{"name":"Backhoe","price":475}]}');
insert into public.private_notes (project_id, key, data) values ('PRJ-1', 'pricelist', '[{"name":"Tiler","unit":"day","price":150}]');
select pg_temp.expect((select count(*) from public.private_notes) = 2, 'contractor sees own private notes');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect((select count(*) from public.private_notes) = 0, 'consultant cannot see the contractor''s build-up');
update public.private_notes set data = '{}' where project_id = 'PRJ-1';
delete from public.private_notes where project_id = 'PRJ-1';
select pg_temp.expect_fail($$insert into public.private_notes (project_id, owner, key, data) values ('PRJ-1', '00000000-0000-0000-0000-00000000000c', 'pricelist', '[]')$$,
                           'cannot write a note as someone else');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.expect((select count(*) from public.private_notes) = 0, 'client cannot see the contractor''s build-up');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_fail($$insert into public.private_notes (project_id, key, data) values ('PRJ-1', 'pricelist', '[]')$$, 'outsider cannot keep notes on a project');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.expect((select data->'items'->0->>'price' from public.private_notes where key = 'buildup/VO-1/M1') = '475',
                      'others'' update and delete had no effect');
-- a build-up's working sent in the shared VO is dropped; its summary stays
select public.save_vo('PRJ-1', 'VO-1', '{"measurement":[{"id":"M1","rate":50,"buildUp":{"items":[1]},"buildUpSummary":{"rate":50,"labour":4.72}}]}');
select pg_temp.expect(not ((select data->'measurement'->0 from public.vos where id = 'VO-1') ? 'buildUp'), 'build-up detail never stored in the shared VO');
select pg_temp.expect((select data->'measurement'->0->'buildUpSummary'->>'rate' from public.vos where id = 'VO-1') = '50', 'summary is shared');
select public.save_project('PRJ-1', '{"priceList":[{"name":"x"}]}');
select pg_temp.expect(not ((select data from public.projects where id = 'PRJ-1') ? 'priceList'), 'price list never stored in the shared project');

-- knowledge base: shared form readable by all signed-in users, a project's own only by members
reset role;
select pg_temp.as_user('');  -- the service role: no auth.uid()
insert into public.projects (id, name, created_by) values ('PRJ-2', 'Other', '00000000-0000-0000-0000-00000000000b');
insert into public.members (project_id, user_id, role) values ('PRJ-2', '00000000-0000-0000-0000-00000000000b', 'consultant');
insert into public.contract_chunks (project_id, doc_name, form, clause_no, title, text, embedding) values
    (null,    'PAM 2018', 'PAM 2018', '11.1', 'Variations', 'shared', array_fill(0.1, array[1024])::extensions.vector),
    ('PRJ-1', 'PAM 2018', 'PAM 2018', '11.6', 'Valuation', 'own',    array_fill(0.1, array[1024])::extensions.vector),
    ('PRJ-2', 'Other',    'PAM 2018', '99',   'Secret',    'theirs', array_fill(0.1, array[1024])::extensions.vector);
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.expect((select count(*) from public.match_chunks('PRJ-1', array_fill(0.1, array[1024])::extensions.vector)) = 2,
                      'match_chunks returns shared + own project clauses');
select pg_temp.expect((select count(*) from public.match_chunks('PRJ-2', array_fill(0.1, array[1024])::extensions.vector)) = 1,
                      'asking about a foreign project returns only the shared form');
select pg_temp.expect_fail($$insert into public.contract_chunks (doc_name, clause_no, text, embedding) values ('x','1','x', array_fill(0.1, array[1024])::extensions.vector)$$,
                           'browser cannot write chunks');

-- files: only members, only under their project's folder
insert into storage.objects (bucket_id, name) values ('documents', 'PRJ-1/F1');
select pg_temp.expect_fail($$insert into storage.objects (bucket_id, name) values ('documents', 'PRJ-2/F9')$$, 'cannot upload into a foreign project');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect((select count(*) from storage.objects where bucket_id = 'documents') = 0, 'outsider sees no files of PRJ-1');

-- anon sees nothing
reset role;
set role anon;
select pg_temp.expect_fail($$select * from public.projects$$, 'anon cannot read projects');
reset role;
\echo ALL RLS TESTS PASSED
