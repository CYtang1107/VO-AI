# Plan A: VO-AI with a knowledge base, shared data and cited answers

**Status (5 Oct 2026, presentation 13 Oct 2026):** steps 1–3 done and live; step 4 mostly done; step 5 left.
Branch `claude/eager-ramanujan-6i2lox`.

- **Supabase (project `VO-AI`, Singapore):** `supabase/migrations/0001_init.sql` applied on 5 Oct through the
  Management API (`POST /v1/projects/{ref}/database/query`). It is not recorded in `supabase_migrations`, so a
  later `supabase db push` must start from `0002_…`. Tables, RLS (11 policies), the `documents` bucket and
  Realtime are in place; the anon key alone reads nothing.
- **Knowledge base:** PAM 2018 imported (231 chunks, `text-embedding-v4`, 1024 dims; 197 of 218 contents-page
  clauses) and, since 6 Oct, scoped to the demo project `PRJ-CADANGAN`: only its members can read it. It was first
  imported as shared (`project_id` null, readable by every signed-in user), which exposed the copyrighted text once
  sign-up was opened to anyone. A new project needs its own import:
  `node tools/ingest-contract.js --file PAM-2018-OCR.txt --form "PAM 2018" --project <id>`. The text file is not in the repo.
- **Sign-up:** open. Email confirmation is off (no mail server; the built-in mailer only reaches the project's own
  team, 2 emails an hour), and the site URL is GitHub Pages. A new account sees nothing until a consultant adds it.
  Similarity: a Chinese question finds 11.5/11.6 at about 0.5; an off-topic question scores about 0.15,
  so the 0.35 bar holds.
- **`ask-contract` Edge Function:** deployed (`npx supabase functions deploy ask-contract --project-ref <ref> --use-api`;
  secret `DASHSCOPE_API_KEY` set with `supabase secrets` / the Management API). Chat model `qwen-plus-latest`, then
  `qwen-flash` if its quota runs out (`ASK_MODELS` secret overrides). `qwen-plus` free quota is used up;
  `qwen3.7-plus` answers in thinking mode and is too slow. An answer takes about 8–14 s.
  The rules (`rules.mjs`) are checked on every answer, not only asked for: at least one 「引用」 label, only
  clauses that were retrieved, no amount that is not in `engine_facts`, the question or the clauses. One retry
  naming the broken rule, then no answer. Role comes from `members`, never from the request.
- **「问合同」 tab** on the VO page (`js/askcontract.js`), only for a team-account session. Each role sees its
  agent (承包商自查员 / 咨询核价员 / 业主核证员) with three suggested questions; citations open the clause text.
  Checked in a real browser (sign-in → VO → ask → cited answer).
- **Next:** step 5 (deck slide, defence Q&A). Before the demo: create the team's real accounts, add members to the
  demo project, and rehearse once on the venue network (the offline demo stays one click away).

Original status: planned, not started. Written at the end of the session that built the
contract reader, so the next session can start straight away.
**For the next session:** read this file first, then check the
[Before you start](#before-you-start) list. Ask the team for the presentation date. It
decides how much of this to build before the competition (see [Order of work](#order-of-work)).

---

## Why

The team chose this after reviewing GreenGru's 「初审智能体知识库」 slide. That slide's
pipeline is: official documents → MinerU (PDF → Markdown) → LangChain splitter → Qwen3
embedding → Supabase vector DB → one agent per channel. VO-AI should work the same way
for variation orders, and fix the prototype's biggest weakness on the way.

| Today (prototype) | After plan A |
|---|---|
| Data lives in one browser (localStorage + IndexedDB) | Shared in Supabase: the contractor's site photo reaches the consultant |
| Pick a role, no password | Real sign-in, role per project |
| Contract clauses found by **keyword**, quoted | Clauses found by **meaning (embeddings)**, including a Chinese question against an English contract |
| Assistant answers from fixed rules | Each role has an **agent** that answers from retrieved clauses, always citing them |

## Rules that do not change

1. **AI never calculates money.** Every amount, rate check and total stays in the existing
   rule engine (`js/analysis.js`, `js/calc.js`). The LLM may explain, quote and point to
   clauses. Prompts must forbid arithmetic on amounts, and answers that contain amounts must
   take them from engine output passed in as data, never generate them.
2. **Every answer cites its source** in the form 「引用：PAM 2018 第 11.6 条」. With no
   retrieved clause above the similarity bar, the agent says it cannot find one. It never
   answers from general knowledge as if it were the contract.
3. **Offline fallback.** If Supabase is not configured or not reachable, the app works
   exactly as it does now (local data, keyword reader). The competition demo must not depend
   on the network.
4. **Secrets never go in the website.** `SUPABASE_SERVICE_ROLE_KEY` and
   `DASHSCOPE_API_KEY` are used only in the Edge Function and in the import script. The
   browser gets only `SUPABASE_URL` and `SUPABASE_ANON_KEY`, which are public by design and
   protected by row-level security.
5. **No contract text in the public repo.** PAM 2018 is copyrighted (Pertubuhan Akitek
   Malaysia). The team's PAM text is imported into **their own Supabase project** (private,
   behind RLS) by the import script, from a file they provide. It is never committed to
   GitHub. Tests use sample wording only (see `test/contractread.test.js`).
6. Keep the app's style: vanilla JS, no build step. The Supabase client is the one
   exception, loaded as a single script from a CDN (jsDelivr `@supabase/supabase-js@2`
   UMD), and **only** when Supabase is configured.

## Before you start

Check these in the new session. Each needs the person to do something; never ask them to
paste a key into the chat.

- [ ] Environment variables are set (cloud environment → Edit → Environment variables):
      `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
      `SUPABASE_ACCESS_TOKEN`, `DASHSCOPE_API_KEY`.
      Check with `env | grep -c -E '^(SUPABASE|DASHSCOPE)_'` (expect 5). Do not print the values.
- [ ] Network allows `supabase.com`, `*.supabase.co`, `api.supabase.com`,
      `dashscope-intl.aliyuncs.com`. Check with `curl -s -o /dev/null -w "%{http_code}" https://api.supabase.com`.
- [ ] Supabase project region: Singapore (closest to Malaysia).
- [ ] DashScope: **verify the exact model names and the embedding dimension** in Model
      Studio before creating the vector column. Planned: a Qwen3 / `text-embedding-v*`
      embedding model through the OpenAI-compatible endpoint
      `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`, and `qwen-plus` (or the
      current equivalent) for chat. Do not assume a dimension; set `vector(N)` from the
      model's documented output size.
- [ ] Supabase CLI available (`npx supabase --version`) for migrations and Edge Function
      deploys, authenticated with `SUPABASE_ACCESS_TOKEN`.

## Architecture

```
Browser (GitHub Pages, vanilla JS)
  ├─ js/cloud.js        NEW: Supabase client wrapper; null when not configured
  ├─ js/store.js        loadDB/saveDB go through cloud.js when signed in, else localStorage
  ├─ js/filestore.js    put/get go to Supabase Storage when signed in, else IndexedDB
  └─ js/agents.js       NEW: calls the ask-contract function, renders cited answers

Supabase
  ├─ Auth               email + password (or magic link)
  ├─ Postgres + RLS     projects, members, vos, documents, contract_chunks (pgvector), past_rates
  ├─ Storage            bucket "documents" (private), path {project_id}/{doc_id}
  └─ Edge Function      ask-contract: embed question → match_chunks → Qwen answer with citations

tools/ingest-contract.js  file → text (OCR if scanned) → clauses → embeddings → contract_chunks
```

## Database (first migration, `supabase/migrations/0001_init.sql`)

Sketch only. Adjust names to fit, and keep RLS on every table.

```sql
create extension if not exists vector;

create table projects (
  id uuid primary key default gen_random_uuid(),
  name text not null, client text, contract_no text, contract_sum numeric,
  bq jsonb not null default '[]',          -- same shape as today's project.bq
  created_by uuid references auth.users, created_at timestamptz default now()
);

create table members (
  project_id uuid references projects on delete cascade,
  user_id uuid references auth.users on delete cascade,
  role text not null check (role in ('contractor','consultant','client')),
  display_name text,
  primary key (project_id, user_id)
);

create table vos (
  id text primary key,                     -- keep today's ids (VO-..., VO-SEED-1)
  project_id uuid references projects on delete cascade,
  data jsonb not null,                     -- the whole VO object as today
  updated_at timestamptz default now(), updated_by uuid references auth.users
);

create table documents (
  id text primary key, project_id uuid references projects on delete cascade,
  vo_id text, field text,                  -- null vo_id = project document
  name text, size bigint, category text, storage_path text,
  uploaded_by uuid references auth.users, created_at timestamptz default now()
);

create table contract_chunks (
  id bigserial primary key,
  project_id uuid references projects on delete cascade,
  doc_name text not null, form text,       -- e.g. 'PAM 2018'
  clause_no text not null, title text, text text not null,
  embedding vector(1024)                   -- set N from the chosen model
);
create index on contract_chunks using hnsw (embedding vector_cosine_ops);

create or replace function match_chunks(p_project uuid, q vector, k int default 6, min_sim float default 0.35)
returns table (clause_no text, title text, text text, doc_name text, similarity float)
language sql stable as $$
  select clause_no, title, text, doc_name, 1 - (embedding <=> q) as similarity
  from contract_chunks
  where project_id = p_project and 1 - (embedding <=> q) >= min_sim
  order by embedding <=> q limit k
$$;
```

**RLS:** a user sees a project's rows only if they are in `members` for that project.

**Column ownership.** Who can write which VO field stays as `js/permissions.js` defines it.
Enforce it in the client as today. Optionally add a trigger that rejects changes to fields
outside the writer's role.

## Knowledge-base pipeline (`tools/ingest-contract.py`)

GreenGru's steps, mapped to VO-AI:

| GreenGru | VO-AI |
|---|---|
| MinerU: PDF → Markdown | Text PDF/.docx/.txt: reuse the logic of `js/contractread.js` (or pdftotext). Scanned PDF: `pdftoppm -r 300` + `tesseract --psm 6` (tested on the team's PAM 2018 scan: 56 pages, about 2½ min, good accuracy). MinerU is optional later |
| LangChain MarkdownTextSplitter | VO-AI's **clause splitter**: same rules as `splitClauses` in `js/contractread.js` (contents-page titles, margin headings, de-duplication). One chunk = one clause; split clauses over ~1,500 characters at sentence ends and keep the clause number on every piece |
| Qwen3 embedding | DashScope embedding model (verify name/dimension), batched, chunk text prefixed with `Clause {no} {title}:` |
| Supabase vector DB | `contract_chunks`, with `project_id` and `doc_name`/`form` for citations |

Usage: `python tools/ingest-contract.py --project <uuid> --form "PAM 2018" --file <path>`.
Re-running for the same `doc_name` replaces that document's chunks.

Also index past-project rates (`js/ratehistory.js` sources) and BQ items, if time allows.
The rate *suggestion* stays rule-based; embeddings only help find comparable items.

## Edge Function `ask-contract` (`supabase/functions/ask-contract/index.ts`)

Input: `{ project_id, vo_id?, role, question, engine_facts? }`. `engine_facts` is the
rule engine's output for the VO (classification, rate checks, totals, clocks), passed in by
the client so the model never computes them.

Steps:
1. Check the caller is a member of `project_id` (use the user's JWT).
2. Embed `question` (DashScope).
3. `match_chunks` → top clauses above the similarity bar.
4. With none: return `{ answer: null, reason: "no-clause" }`. The UI says it found nothing.
5. Otherwise call Qwen with a fixed system prompt:
   - answer only from the clauses given;
   - cite each as 「引用：{form} 第 {clause_no} 条」;
   - never calculate or invent amounts, use only `engine_facts`;
   - answer in the question's language;
   - say so when the clauses do not cover the question.
6. Return `{ answer, citations: [{clause_no, title, doc_name, similarity}] }`. The client
   shows each citation as a link that opens that clause's text.

Role framing (system prompt addition per role):
- **承包商自查员 (contractor):** "check this claim before submission".
- **咨询核价员 (consultant):** "assess against the contract".
- **业主核证员 (client):** "decide whether to certify".

## Front end

- `js/cloud.js`: `Cloud.enabled()`, `signIn`, `signOut`, `loadProject`, `saveVO`,
  `uploadFile`, `fileUrl`, `ask`. Configured from a small `js/config.js` containing **only**
  `SUPABASE_URL` and `SUPABASE_ANON_KEY` (public), generated from the environment, never
  hand-edited with secrets.
- Sign-in page: when cloud is enabled, `index.html` shows email/password instead of the role
  picker; the role comes from `members`. Keep the role picker for the offline demo.
- `store.js`: keep the same `loadDB`/`saveDB`/`updateVO` API so pages do not change. When
  signed in, read/write Supabase and cache locally.
- Realtime (optional): subscribe to `vos` changes so another user's edit appears live.
- VO page: the 「询问此工程变更令」 card gets a 「问合同」 tab that calls `Cloud.ask`. Answers
  show 「引用」 chips. Without cloud, the tab is hidden and the existing helper stays.
- Deck: the GreenGru-style 「工程变更令智能体知识库」 slide (sources → 预处理 → 条文切分 →
  向量嵌入 → 向量数据库 → three agents), with the 「AI 不碰数字」 strip.

## Order of work

Pick the cut by the presentation date. Each step ends shippable, with the offline fallback
intact.

1. **Supabase schema + RLS + sign-in + shared VOs and files.** Fixes "data only in one
   browser" and "anyone can be the client". Highest value for judges.
2. **Ingestion script + `contract_chunks`.** Import the team's PAM 2018 text (they have
   `PAM-2018-OCR.txt` from the earlier session) into their project.
3. **`ask-contract` Edge Function + 「问合同」 UI with citations.**
4. **Three agent personas** in the UI.
5. **Deck slide + docs + defence Q&A** (what is RAG here, what the AI never does, cost,
   where data lives).

If the presentation is only a few days away, do 1 and 3 (with 2's import run once by hand),
and present 4 on the slide as 「下一版」.

## Tests to add

- Unit: `cloud.js` with a fake client (enabled/disabled paths), and the store adapter with
  the same API for both backends.
- Unit: ingestion splitter parity with `splitClauses` on the sample texts already in
  `test/contractread.test.js`.
- Edge Function: no clause above the bar → `answer: null`. Answer must contain a citation.
  Answers that contain amounts not present in `engine_facts` are rejected.
- Manual: two browsers, contractor and consultant signed in, contractor records on site, the
  consultant sees the VO and the photo.

## Cost and limits (to say in 答辩)

- Supabase free tier covers the demo (database, auth, storage, Edge Functions).
- DashScope: new accounts get free quota. Embedding a 56-page contract once is a few hundred
  chunks. Each question is one embedding plus one short chat call.
- Data residency: Supabase Singapore. The contract text sits in the team's own project,
  behind RLS.
