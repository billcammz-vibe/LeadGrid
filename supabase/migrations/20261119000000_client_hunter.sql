-- Client Hunter: the saved brief (one row) and a history of hunts with their full results.
create table if not exists hunter_settings (
  id text primary key default 'default',
  brief jsonb not null default '{}',
  updated_at timestamptz default now()
);

create table if not exists hunts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  brief jsonb not null default '{}',
  status text default 'done',          -- done | none_found
  summary text,                        -- one-line result, shown in the history list
  result jsonb not null default '{}'   -- leads, removals, scores, ballots, final checks, top 3 + drafts
);
create index if not exists hunts_created_at on hunts (created_at desc);

alter table hunter_settings enable row level security;
alter table hunts enable row level security;

create policy "authenticated only" on hunter_settings for all using (auth.role() = 'authenticated');
create policy "authenticated only" on hunts for all using (auth.role() = 'authenticated');
