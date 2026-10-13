-- P002 fabric area, migration 0002: the model catalog and the append-only
-- model-binding ledger.
--
-- Catalog entries (manual + discovered, one first-class shape) and model
-- bindings share the versioned upsert shape of migration 0001: one immutable
-- row per (tenant, record, mutation_seq).
--
-- THE BINDING LEDGER LAW: superseding a binding NEVER rewrites history — the
-- superseded version is a NEW appended row (mutation_seq + 1) carrying the
-- successor pointer, while the original active row is retained verbatim at
-- its own mutation_seq. The port's read model derives the current record per
-- id (highest mutation_seq) so consumers see exactly the in-memory upsert
-- semantics; the database keeps every prior version, rejects UPDATE/DELETE
-- by trigger and rejects version rewrites by primary key — the ledger stays
-- append-only at the DATABASE level, not just by runtime discipline.

create table fabric_catalog_entries (
  tenant_id text not null,
  entry_id text not null,
  mutation_seq integer not null,
  provider_definition_id text not null,
  model_key text not null,
  record jsonb not null,
  seq bigint generated always as identity unique,
  primary key (tenant_id, entry_id, mutation_seq),
  check (char_length(tenant_id) > 0 and char_length(tenant_id) <= 128),
  check (char_length(entry_id) > 0),
  check (mutation_seq >= 0),
  check (char_length(model_key) > 0 and char_length(model_key) <= 200)
);

create index fabric_catalog_entries_key_idx
  on fabric_catalog_entries (tenant_id, provider_definition_id, model_key);
create index fabric_catalog_entries_tenant_idx
  on fabric_catalog_entries (tenant_id, entry_id, mutation_seq);

create trigger fabric_catalog_entries_append_only
  before update or delete on fabric_catalog_entries
  for each row execute function aurum_reject_mutation();

create table fabric_model_bindings (
  tenant_id text not null,
  binding_id text not null,
  mutation_seq integer not null,
  purpose text not null,
  status text not null,
  record jsonb not null,
  seq bigint generated always as identity unique,
  primary key (tenant_id, binding_id, mutation_seq),
  check (char_length(tenant_id) > 0 and char_length(tenant_id) <= 128),
  check (char_length(binding_id) > 0),
  check (mutation_seq >= 0),
  check (char_length(purpose) > 0 and char_length(purpose) <= 64),
  check (status in ('active', 'superseded'))
);

create index fabric_model_bindings_purpose_idx
  on fabric_model_bindings (tenant_id, purpose, status);
create index fabric_model_bindings_tenant_idx
  on fabric_model_bindings (tenant_id, binding_id, mutation_seq);

create trigger fabric_model_bindings_append_only
  before update or delete on fabric_model_bindings
  for each row execute function aurum_reject_mutation();
