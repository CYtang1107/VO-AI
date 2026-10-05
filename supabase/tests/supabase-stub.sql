-- Just enough of Supabase (auth, storage, roles, realtime publication) for a
-- plain local Postgres to run the migrations and the RLS tests in
-- supabase/tests/rls.test.sql. Never applied to the real project.
create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists storage;
do $$ begin
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
exception when duplicate_object then null; end $$;
create table if not exists auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
create or replace function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table if not exists storage.buckets (id text primary key, name text, public boolean);
create table if not exists storage.objects (id bigserial primary key, bucket_id text, name text);
create or replace function storage.foldername(name text) returns text[] language sql immutable as
$$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
alter table storage.objects enable row level security;
create publication supabase_realtime;
grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;
grant select on auth.users to authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
grant all on storage.objects to authenticated;
grant usage on all sequences in schema storage to authenticated;
