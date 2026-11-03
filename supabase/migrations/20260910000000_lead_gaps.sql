-- Step 2 of the pipeline evolution: persist the gap analysis the Lead Finder computes.
-- `gaps` is the [{type,tag,sev}] array from detectGaps(); NULL means "never analysed" (a row
-- created before this migration) so the client recomputes it from the stored rating/website/
-- review_count fields on load. An empty array means "analysed, nothing flagged".
alter table leads add column if not exists gaps jsonb;
alter table leads add column if not exists gap_summary text;
alter table leads add column if not exists demand_signal numeric;
alter table leads add column if not exists business_status text;
