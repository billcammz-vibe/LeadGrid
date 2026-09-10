-- LeadGrid schema — paste this into the Supabase SQL editor (SQL Editor > New query > Run).
-- Single-owner app: RLS just requires "authenticated", no per-row ownership needed.

create table reps (
  id text primary key,
  name text not null,
  init text,
  color text,
  area text,
  created_at timestamptz default now()
);

create table leads (
  id text primary key,
  source_id text,
  name text not null,
  cat text, city text, province text, postal text, street text, address text,
  lat double precision, lng double precision,
  phone text, website boolean, web text,
  rating numeric, review_count int, value numeric,
  email text,
  socials jsonb default '{}',
  reviews jsonb default '[]',
  hot boolean default false,
  score int,
  gaps jsonb,
  gap_summary text,
  demand_signal numeric,
  business_status text,
  stage text default 'new',
  rep_id text references reps(id) on delete set null,
  enrich_checked boolean default false,
  enrich_ok boolean,
  enrich_note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table events (
  id uuid primary key default gen_random_uuid(),
  lead_id text references leads(id) on delete cascade,
  rep_id text references reps(id) on delete cascade,
  type text,
  starts_at timestamptz not null,
  duration_minutes int default 30,
  created_at timestamptz default now()
);

-- Keep updated_at honest on every UPDATE, so the dashboard's "recent activity"
-- feed (built off this column) reflects real edits, not just inserts.
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

create trigger leads_set_updated_at before update on leads
  for each row execute function set_updated_at();

-- One CRM lead per source business: source_id is the Google Place id a lead was imported from,
-- so a unique index on it (where set) stops the same business being added twice. Partial, so
-- manually-created leads with a null source_id are unaffected.
create unique index if not exists leads_source_id_unique
  on leads (source_id)
  where source_id is not null;

alter table reps enable row level security;
alter table leads enable row level security;
alter table events enable row level security;

create policy "authenticated only" on reps for all using (auth.role() = 'authenticated');
create policy "authenticated only" on leads for all using (auth.role() = 'authenticated');
create policy "authenticated only" on events for all using (auth.role() = 'authenticated');
