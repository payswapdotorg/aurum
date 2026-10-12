-- P001 audit area: the append-only audit trail shared by every kernel store.
--
-- Mirror of the in-memory AuditTrailStore: tenant-scoped entries, ids of the
-- form audit-<n> drawn from one global sequence (the in-memory counter is
-- kernel-global, not per-tenant), insertion order preserved by the identity
-- column. The full domain AuditRecord is retained verbatim in `record`
-- (jsonb); the strong columns exist for constraints, indexes and the
-- subject/time query surface. UPDATE and DELETE are rejected by trigger.

create sequence domain_audit_seq start 1;

create table domain_audit_entries (
  tenant_id text not null,
  audit_id text not null,
  seq bigint generated always as identity unique,
  subject_kind text not null,
  subject_id text not null,
  action text not null,
  actor jsonb not null,
  acted_at bigint not null,
  reason text not null,
  details jsonb,
  record jsonb not null,
  primary key (tenant_id, audit_id),
  check (audit_id ~ '^audit-[0-9]+$'),
  check (acted_at >= 0),
  check (char_length(reason) > 0),
  check (jsonb_typeof(actor) = 'object')
);

create index domain_audit_entries_subject_idx
  on domain_audit_entries (tenant_id, subject_kind, subject_id);
create index domain_audit_entries_time_idx on domain_audit_entries (tenant_id, acted_at);

create trigger domain_audit_entries_append_only
  before update or delete on domain_audit_entries
  for each row execute function aurum_reject_mutation();
