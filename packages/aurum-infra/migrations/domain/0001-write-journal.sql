-- P001 machinery: the shared write journal (P-series reusable).
--
-- Every storage mutation of the domain kernel lands here with a derived
-- idempotency key (mutation identity: area + operation + tenant + record id
-- + version), in the same transaction as the mutation. The table is
-- append-only by database trigger: UPDATE and DELETE are rejected, which is
-- the durability contract replay safety rests on.

create table domain_write_journal (
  tenant_id text not null,
  journal_key text not null,
  area text not null,
  operation text not null,
  record_id text not null,
  version integer,
  outcome jsonb,
  written_at timestamptz not null default now(),
  seq bigint generated always as identity unique,
  primary key (tenant_id, journal_key),
  check (char_length(tenant_id) > 0 and char_length(tenant_id) <= 128),
  check (char_length(journal_key) > 0),
  check (char_length(area) > 0),
  check (char_length(operation) > 0),
  check (char_length(record_id) > 0),
  check (version is null or version >= 1)
);

create index domain_write_journal_area_idx on domain_write_journal (tenant_id, area, record_id);

-- Generic append-only guard shared by every immutable table in this schema
-- family (P001 areas and later P-series migrations).
create function aurum_reject_mutation() returns trigger as $$
begin
  raise exception '% on % is forbidden: table is append-only', tg_op, tg_table_name;
end;
$$ language plpgsql;

create trigger domain_write_journal_append_only
  before update or delete on domain_write_journal
  for each row execute function aurum_reject_mutation();
