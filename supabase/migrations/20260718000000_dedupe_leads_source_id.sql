-- Prevent duplicate CRM leads for the same Google Place. `source_id` is the Places id a lead was
-- imported from; two rows sharing one means the same business was added twice. A partial unique
-- index enforces this only where source_id is set, so manually-created leads (source_id null) are
-- unaffected. The client guards against duplicates too, but this closes the cross-session race.

-- Collapse any existing duplicates first, keeping the earliest-created row per source_id, so the
-- unique index can be created without error.
delete from leads a
using leads b
where a.source_id is not null
  and a.source_id = b.source_id
  and (a.created_at, a.id) > (b.created_at, b.id);

create unique index if not exists leads_source_id_unique
  on leads (source_id)
  where source_id is not null;
