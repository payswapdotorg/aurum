-- P001 memory area: the append-only organizational knowledge versions.
--
-- Mirror of the in-memory OrganizationalMemory: one row per immutable
-- version, keyed (tenant_id, memory_id, version); currentVersion is derived
-- as the highest number on read. The strong subject columns serve the
-- listMemory subject filter; the full MemoryVersion is retained verbatim in
-- `record` (jsonb). UPDATE and DELETE are rejected by trigger.

create table domain_memory_versions (
  tenant_id text not null,
  memory_id text not null,
  version integer not null,
  seq bigint generated always as identity unique,
  subject_kind text not null,
  subject_id text not null,
  record jsonb not null,
  primary key (tenant_id, memory_id, version),
  check (version >= 1),
  check (char_length(memory_id) > 0 and char_length(memory_id) <= 128),
  check (char_length(subject_kind) > 0),
  check (char_length(subject_id) > 0),
  check (jsonb_typeof(record) = 'object')
);

create index domain_memory_versions_subject_idx
  on domain_memory_versions (tenant_id, subject_kind, subject_id);

create trigger domain_memory_versions_append_only
  before update or delete on domain_memory_versions
  for each row execute function aurum_reject_mutation();
