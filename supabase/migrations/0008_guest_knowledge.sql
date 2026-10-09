-- VO-AI | 0008_guest_knowledge.sql — the demo's own contract imports.
--
-- A visitor using the demo (no sign-in) may import a contract and scan
-- it, as a team account's consultant does. Their clauses go here, not in
-- contract_chunks: each visitor has a sandbox id kept in their browser
-- ("GUEST-" + random hex), only their 问合同 searches it, and nothing they
-- import reaches a team's knowledge base. Rows older than 3 days are
-- cleared as new ones arrive (supabase/functions/import-contract).
--
-- Nobody reads or writes this table from the browser: RLS on, no
-- policies; the Edge Functions use the service role.

create table if not exists public.guest_chunks (
    id         bigserial primary key,
    sandbox    text not null,
    doc_name   text not null,
    form       text,
    clause_no  text not null,
    title      text,
    part       int not null default 1,
    text       text not null,
    embedding  extensions.vector(1024) not null,
    created_at timestamptz not null default now()
);
create index if not exists guest_chunks_sandbox_idx on public.guest_chunks (sandbox, doc_name);
create index if not exists guest_chunks_created_idx on public.guest_chunks (created_at);
alter table public.guest_chunks enable row level security;
revoke all on public.guest_chunks from anon, authenticated;

-- A sandbox's nearest clauses to a question (as match_chunks does for a
-- project). Few rows each, so no vector index is needed.
create or replace function public.match_guest_chunks(
    p_sandbox text, q extensions.vector(1024), k int default 6, min_sim float default 0.35)
returns table (clause_no text, title text, text text, doc_name text, form text, similarity float)
language sql stable set search_path = public, extensions as $$
    select c.clause_no, c.title, c.text, c.doc_name, c.form, 1 - (c.embedding <=> q) as similarity
    from public.guest_chunks c
    where c.sandbox = p_sandbox
      and 1 - (c.embedding <=> q) >= min_sim
    order by c.embedding <=> q
    limit k
$$;
revoke execute on function public.match_guest_chunks(text, extensions.vector, int, float) from anon, authenticated, public;
grant execute on function public.match_guest_chunks(text, extensions.vector, int, float) to service_role;
