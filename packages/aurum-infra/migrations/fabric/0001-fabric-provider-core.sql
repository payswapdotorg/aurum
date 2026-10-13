-- P002 fabric area, migration 0001: the provider fabric core — registered
-- protocols, provider definitions and provider accounts.
--
-- House shape (P001 lifecycle ruling): every record store of the fabric ports
-- is an UPSERT-by-id surface (`put` overwrites the id in the in-memory
-- TenantTable). The database mirror is one IMMUTABLE row per
-- (tenant_id, record_id, mutation_seq): every put appends the next version,
-- the current record is derived as the highest mutation_seq on read, and a
-- rewrite of an existing (tenant, record, mutation_seq) is rejected by the
-- primary key. UPDATE and DELETE are rejected by the shared
-- aurum_reject_mutation trigger (defined once in the domain area's migration
-- 0001 — fabric tables ATTACH it, never re-create it; the fabric area rides a
-- database that also carries the domain machinery, per the shared-database
-- composition registered in domain-storage/WORK-NOTES.md).
--
-- Strong columns (name, protocol_id, provider_definition_id, connection_state)
-- exist for the tenants' list filters and for the append-only ledger's
-- readability; the full record always lives in `record` jsonb, round-tripped
-- verbatim.

create table fabric_protocols (
  tenant_id text not null,
  protocol_id text not null,
  mutation_seq integer not null,
  record jsonb not null,
  seq bigint generated always as identity unique,
  primary key (tenant_id, protocol_id, mutation_seq),
  check (char_length(tenant_id) > 0 and char_length(tenant_id) <= 128),
  check (char_length(protocol_id) > 0),
  check (mutation_seq >= 0)
);

create index fabric_protocols_tenant_idx on fabric_protocols (tenant_id, protocol_id, mutation_seq);

create trigger fabric_protocols_append_only
  before update or delete on fabric_protocols
  for each row execute function aurum_reject_mutation();

create table fabric_provider_definitions (
  tenant_id text not null,
  definition_id text not null,
  mutation_seq integer not null,
  name text not null,
  protocol_id text not null,
  record jsonb not null,
  seq bigint generated always as identity unique,
  primary key (tenant_id, definition_id, mutation_seq),
  check (char_length(tenant_id) > 0 and char_length(tenant_id) <= 128),
  check (char_length(definition_id) > 0),
  check (mutation_seq >= 0),
  check (char_length(name) > 0 and char_length(name) <= 120),
  check (char_length(protocol_id) > 0)
);

create index fabric_provider_definitions_name_idx
  on fabric_provider_definitions (tenant_id, name);
create index fabric_provider_definitions_tenant_idx
  on fabric_provider_definitions (tenant_id, definition_id, mutation_seq);

create trigger fabric_provider_definitions_append_only
  before update or delete on fabric_provider_definitions
  for each row execute function aurum_reject_mutation();

create table fabric_accounts (
  tenant_id text not null,
  account_id text not null,
  mutation_seq integer not null,
  provider_definition_id text not null,
  connection_state text not null,
  record jsonb not null,
  seq bigint generated always as identity unique,
  primary key (tenant_id, account_id, mutation_seq),
  check (char_length(tenant_id) > 0 and char_length(tenant_id) <= 128),
  check (char_length(account_id) > 0),
  check (mutation_seq >= 0),
  check (connection_state in ('disconnected', 'connecting', 'connected', 'error'))
);

create index fabric_accounts_definition_idx
  on fabric_accounts (tenant_id, provider_definition_id);
create index fabric_accounts_tenant_idx
  on fabric_accounts (tenant_id, account_id, mutation_seq);

create trigger fabric_accounts_append_only
  before update or delete on fabric_accounts
  for each row execute function aurum_reject_mutation();
