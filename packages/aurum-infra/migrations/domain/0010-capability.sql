-- P001 capability area: the capability graph (capabilities, supplies,
-- requirements, computed gaps).
--
-- Mirror of the in-memory capability graph. Storage rulings:
-- - capabilities, supplies and requirements are immutable base rows keyed
--   (tenant, <record id>) with strong capability_id/source_kind columns
--   serving the list filters;
-- - gap records are appended by recomputeGaps: immutable rows keyed
--   (tenant, gap_id) with a strong gap_number column backing the GLOBAL
--   sequential gap counter (the in-memory counter is per store instance,
--   i.e. across tenants — max(gap_number) over the whole table is the
--   allocation base, taken inside the command transaction);
-- - gap ids are kernel-generated `gap-<n>` values and never repeat, so the
--   primary key makes every recompute append-only.
-- Every table below rejects UPDATE and DELETE by trigger.

create table domain_capabilities (
  tenant_id text not null,
  capability_id text not null,
  seq bigint generated always as identity unique,
  record jsonb not null,
  primary key (tenant_id, capability_id),
  check (char_length(capability_id) > 0 and char_length(capability_id) <= 128),
  check (jsonb_typeof(record) = 'object')
);

create index domain_capabilities_tenant_idx on domain_capabilities (tenant_id);

create table domain_capability_supplies (
  tenant_id text not null,
  supply_id text not null,
  capability_id text not null,
  seq bigint generated always as identity unique,
  record jsonb not null,
  primary key (tenant_id, supply_id),
  check (char_length(supply_id) > 0 and char_length(supply_id) <= 128),
  check (char_length(capability_id) > 0 and char_length(capability_id) <= 128),
  check (jsonb_typeof(record) = 'object')
);

create index domain_capability_supplies_capability_idx
  on domain_capability_supplies (tenant_id, capability_id);

create table domain_capability_requirements (
  tenant_id text not null,
  requirement_id text not null,
  capability_id text not null,
  source_kind text not null,
  seq bigint generated always as identity unique,
  record jsonb not null,
  primary key (tenant_id, requirement_id),
  check (char_length(requirement_id) > 0 and char_length(requirement_id) <= 128),
  check (char_length(capability_id) > 0 and char_length(capability_id) <= 128),
  check (char_length(source_kind) > 0),
  check (jsonb_typeof(record) = 'object')
);

create index domain_capability_requirements_capability_idx
  on domain_capability_requirements (tenant_id, capability_id);

create table domain_capability_gaps (
  tenant_id text not null,
  gap_id text not null,
  gap_number integer not null,
  requirement_id text not null,
  kind text not null,
  computed_at bigint not null,
  seq bigint generated always as identity unique,
  record jsonb not null,
  primary key (tenant_id, gap_id),
  check (gap_number >= 1),
  unique (gap_number),
  check (char_length(gap_id) > 0),
  check (char_length(requirement_id) > 0),
  check (kind in ('uncovered', 'level', 'capacity')),
  check (computed_at >= 0),
  check (jsonb_typeof(record) = 'object')
);

create index domain_capability_gaps_tenant_idx on domain_capability_gaps (tenant_id);

create trigger domain_capabilities_append_only
  before update or delete on domain_capabilities
  for each row execute function aurum_reject_mutation();

create trigger domain_capability_supplies_append_only
  before update or delete on domain_capability_supplies
  for each row execute function aurum_reject_mutation();

create trigger domain_capability_requirements_append_only
  before update or delete on domain_capability_requirements
  for each row execute function aurum_reject_mutation();

create trigger domain_capability_gaps_append_only
  before update or delete on domain_capability_gaps
  for each row execute function aurum_reject_mutation();
