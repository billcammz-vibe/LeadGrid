-- Step 3: the pipeline board — per-lead notes + next action, a real timestamped history log,
-- and the stage set reconciled to New -> Contacted -> Replied -> Won / Lost.

alter table leads add column if not exists notes text;
alter table leads add column if not exists next_action text;
alter table leads add column if not exists next_action_at timestamptz;

-- Collapse the old middle stages into 'contacted' (no data yet, but keeps the migration portable).
update leads set stage = 'contacted' where stage in ('qualified', 'proposal');

-- Append-only activity log. Replaces the dashboard's faked "recent activity" feed.
create table if not exists lead_history (
  id uuid primary key default gen_random_uuid(),
  lead_id text references leads(id) on delete cascade,
  at timestamptz default now(),
  kind text not null,            -- created | stage_change | note | next_action | email_drafted
  body text,                     -- human-readable summary shown in the timeline
  meta jsonb default '{}',       -- structured detail, e.g. {"from":"new","to":"contacted"}
  created_at timestamptz default now()
);

create index if not exists lead_history_lead_id_at on lead_history (lead_id, at desc);

alter table lead_history enable row level security;
create policy "authenticated only" on lead_history for all using (auth.role() = 'authenticated');
